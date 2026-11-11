import express from 'express'
import dotenv from 'dotenv'
import { Server } from 'socket.io'
import { createServer } from 'http'
import cors from 'cors'
import { speechToText } from './services/STT.service.js'
import { streamTTSAsPCM } from './services/PCMStreamer.service.js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Groq from 'groq-sdk'
import { getAvailableSlots, bookSlot, formatSlotsForAI } from './services/calendar.service.js'
import * as chrono from 'chrono-node'
import {
  MemoryRateLimiter,
  consumeSocketRateLimit,
  createHttpRateLimit,
  getClientIp,
  getRateLimitConfig
} from './services/rateLimit.service.js'

dotenv.config()

process.env.TZ = process.env.TZ || 'Asia/Kolkata'

const PORT = process.env.PORT || 5000
const app = express()
const rateLimitConfig = getRateLimitConfig()

if (rateLimitConfig.trustProxyHops > 0) {
  app.set('trust proxy', rateLimitConfig.trustProxyHops)
}

const createLimiter = settings => new MemoryRateLimiter({
  ...settings,
  maxKeys: rateLimitConfig.maxKeys
})

const httpLimiter = createLimiter(rateLimitConfig.http)
const tokenLimiter = createLimiter(rateLimitConfig.token)
const automationLimiter = createLimiter(rateLimitConfig.automation)
const socketConnectionLimiter = createLimiter(rateLimitConfig.socketConnections)
const aiLimiter = createLimiter(rateLimitConfig.ai)
const ttsLimiter = createLimiter(rateLimitConfig.tts)

/* -------------------- Middleware -------------------- */
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:5173']

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true
}))

app.use(createHttpRateLimit({
  limiter: httpLimiter,
  trustedProxyHops: rateLimitConfig.trustProxyHops
}))

/* -------------------- HTTP + WebSocket Setup -------------------- */
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
})

io.use((socket, next) => {
  const ip = getClientIp(socket.request, rateLimitConfig.trustProxyHops)
  const result = socketConnectionLimiter.consume(`socket-connection:${ip}`)
  if (result.allowed) return next()

  const error = new Error('Too many connection attempts')
  error.data = { retryAfterMs: Math.max(1000, result.resetAt - Date.now()) }
  next(error)
})

/* -------------------- Google Calendar (direct) -------------------- */
// Calendar operations are handled via services/calendar.service.js
// Slots are fetched on-demand (only when caller asks about availability)

/* -------------------- Gemini LLM Setup (Primary) -------------------- */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const systemPrompt = `
   ### **Core Identity**

You are **Voly**, an intelligent AI receptionist built by **Harsha Adithya Kumar**, co-founder of **RJ Global Group**.
You handle calls like a skilled front-desk receptionist — warm, confident, concise, and reliable.

---

### **Role & Purpose**

Your role is to **manage all incoming clinic calls** naturally and professionally.
You assist callers with:

* Booking or rescheduling appointments
* Checking service availability or timings
* Answering short FAQs (location, pricing, services)
* Politely gathering required details (name, service, date/time, phone)

If the caller requests Harsha, treat it as a **booking request with Harsha**, not a transfer.

---

### **Tone & Personality**

* Sound **friendly yet professional** — like a real clinic receptionist.
* Use **short, clear replies (1–2 sentences max)**.
* Mirror the caller’s tone:

  * Cheerful → be upbeat
  * Rushed → be efficient
  * Upset → be calm, polite, action-driven
* Avoid robotic phrasing.

  * ❌ “I will now proceed to schedule your appointment.”
  * ✅ “Sure, I’ll get that booked for you.”
* Use light conversational fillers (“alright”, “no problem”, “one moment please”) sparingly.
* Never say you’re a “virtual receptionist” unless directly asked.

---

### **Call Behavior Rules**

1. **Gather all four key details** — service, date/time, name, phone — before confirming.
2. **Confirm availability first**, then finalize bookings.
3. If any detail is missing, ask for it politely and only once.
4. **Never assume** service or details; confirm clearly.
5. If the caller is unsure, offer friendly options (“We have slots in the morning or evening — which works better?”).
6. Stay focused on solving the caller’s need; avoid small talk unless asked.
7. **CRITICAL BOOKING RULE**: NEVER say an appointment or slot is booked or confirmed UNLESS you see BOOKING SYSTEM RESPONSE with success: true in the prompt. If you have not executed the booking action yet, or if details (name, phone, slot) are still needed, ask for them or tell the caller you are booking it now. Never fabricate or assume a confirmed booking!

---

### **Clarification & Correction Handling**

* If the caller mentions a **service that’s unclear, mispronounced, or unknown**, confirm naturally:

  > “Just to confirm, did you mean Botox or another treatment?”
* If the caller **corrects** a name, phone, or time, acknowledge once and restate briefly:

  > “Apologies, Harsha — got it. May I have your phone number, please?”
* Don’t repeat already confirmed information.
* Always restate the full summary (service, slot, name) before confirming the booking.

---

### **Emotion Handling Guidelines**

* When a caller sounds frustrated or impatient:

  1. Respond with **one empathetic sentence**.
  2. Follow it with **one action-driven sentence**.
     Example:

  > “I understand your frustration. Let’s get this sorted right away.”
* Apologize only once; then focus on solving the issue.
* If the caller interrupts or changes their mind, calmly follow their latest request.
* Never sound defensive or overly formal.
* Keep emotional responses under **two short sentences** total.

---

### **Action Logic – Strict JSON Format**

When performing a structured action, output **only JSON** in this format:

{
  "action": "book" | "check_slots" | "cancel" | "none",
  "parameters": {
    "slot": string | null,
    "name": string | null,
    "phone": string | null
  }
}
 

**Rules**

*  "book"  → Caller wants to schedule or confirm an appointment.
*  "check_slots"  → Caller asks about availability.
*  "cancel"  → Caller wants to cancel.
*  "none"  → General talk or questions.
* Always include all parameters; use  null  when missing.
* Never mix conversation text with JSON.

---

### **Conversation Flow Examples**

**Example 1 — Booking**

> Caller: “I’d like to book a Botox appointment tomorrow.”
> You: “Sure! May I have your full name, please?”
> →

{
  "action": "book",
  "parameters": {
    "slot": "tomorrow",
    "name": null,
    "phone": null
  }
}
 

---

**Example 2 — Availability Check**

> Caller: “Do you have evening slots for fillers?”
> →
{
  "action": "check_slots",
  "parameters": {
    "slot": "evening",
    "name": null,
    "phone": null
  }
}
 

---

**Example 3 — Small Talk**

> Caller: “Where is your clinic located?”
> →

{
  "action": "none",
  "parameters": {
    "slot": null,
    "name": null,
    "phone": null
  }
}
 

---

### **Final Communication Guidelines**

* Be concise, natural, and empathetic.
* Confirm all details **before** finalizing.
* Clarify unknown or misspoken info confidently.
* Keep latency low — shorter responses mean faster voice delivery.
* You’re a trusted clinic receptionist — sound human, composed, and genuinely helpful.

  `

const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
})

/* -------------------- Groq LLM Setup (Fallback) -------------------- */
const groq = new Groq({ apiKey: process.env.GROQ_API })
const GROQ_MODEL = 'openai/gpt-oss-120b'

/* -------------------- LLM Circuit Breaker -------------------- */
// When Gemini hits a 429 quota error, we trip the circuit breaker and route
// all subsequent turns directly to Groq for COOLDOWN_MS to avoid latency penalties.
const GEMINI_COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes
let geminiCooloffUntil = 0

const isGeminiAvailable = () => Date.now() > geminiCooloffUntil

const tripGeminiBreaker = (reason = '') => {
  geminiCooloffUntil = Date.now() + GEMINI_COOLDOWN_MS
  const cooldownMins = Math.round(GEMINI_COOLDOWN_MS / 60000)
  console.warn(`⚡ [Circuit Breaker] Gemini tripped (${reason}). Routing ALL requests directly to Groq for ${cooldownMins}m (until ${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'medium' }).format(new Date(geminiCooloffUntil))} IST).`)
}

const resetGeminiBreaker = () => {
  if (geminiCooloffUntil > 0) {
    console.log('✅ [Circuit Breaker] Gemini recovered. Primary route restored.')
    geminiCooloffUntil = 0
  }
}

// Returns true if the error is a Gemini quota/rate-limit error
const isGeminiQuotaError = (err) =>
  err?.status === 429 ||
  err?.message?.includes('429') ||
  err?.message?.toLowerCase().includes('quota') ||
  err?.message?.toLowerCase().includes('rate limit')

/**
 * Classify the caller's intent as JSON.
 * If breaker is open, goes straight to Groq (0ms wasted).
 * If breaker is closed, tries Gemini first; trips breaker if 429 occurs.
 */
const classifyAction = async (contextPrompt) => {
  const userMsg = contextPrompt + '\n\nIMPORTANT: Respond ONLY with valid JSON (no natural text).'

  // 1. If circuit breaker is open, bypass Gemini directly
  if (!isGeminiAvailable()) {
    console.log('⚡ [Groq Direct] Fast routing action classification to Groq (Gemini circuit breaker open)')
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    })
    return JSON.parse(res.choices[0].message.content)
  }

  // 2. Otherwise try Gemini (Primary)
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMsg }] }]
    })
    resetGeminiBreaker()
    let raw = result.response.text()
    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
    return JSON.parse(raw)
  } catch (err) {
    if (isGeminiQuotaError(err)) {
      tripGeminiBreaker('429 Quota Exceeded')
      const res = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg }
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      })
      return JSON.parse(res.choices[0].message.content)
    }
    throw err
  }
}

/**
 * Stream the natural-language response.
 * If breaker is open, goes straight to Groq (0ms wasted).
 * If breaker is closed, tries Gemini streaming; trips breaker if 429 occurs.
 */
const streamResponse = async (contextPrompt, signal, onToken, onDone) => {
  // 1. If circuit breaker is open, bypass Gemini directly
  if (!isGeminiAvailable()) {
    console.log('⚡ [Groq Direct] Fast routing response stream to Groq (Gemini circuit breaker open)')
    const stream = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contextPrompt }
      ],
      stream: true,
      temperature: 0.7,
    }, { signal })

    for await (const chunk of stream) {
      if (signal.aborted) break
      const token = chunk.choices[0]?.delta?.content || ''
      if (token) onToken(token)
    }
    onDone()
    return
  }

  // 2. Otherwise try Gemini first
  try {
    const result = await model.generateContentStream(
      { contents: [{ role: 'user', parts: [{ text: contextPrompt }] }] }
    )
    resetGeminiBreaker()
    for await (const chunk of result.stream) {
      if (signal.aborted) break
      const token = chunk.text() || ''
      if (token) onToken(token)
    }
    onDone()
    return
  } catch (err) {
    if (!isGeminiQuotaError(err)) throw err
    tripGeminiBreaker('429 Streaming Quota Exceeded')
  }

  // Fallback on the turn that tripped the breaker
  const stream = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextPrompt }
    ],
    stream: true,
    temperature: 0.7,
  }, { signal })

  for await (const chunk of stream) {
    if (signal.aborted) break
    const token = chunk.choices[0]?.delta?.content || ''
    if (token) onToken(token)
  }
  onDone()
}

/* -------------------- In-Memory State -------------------- */
const llmControllers = new Map()
const ttsBusy = new Map()
const ttsBuffer = new Map()
const chatMemory = new Map()
const ttsControllers = new Map()
const interruptedResponses = new Map()

/* -------------------- Chat Memory Helpers -------------------- */
const addToMemory = (socketId, role, text) => {
  if (!chatMemory.has(socketId)) {
    chatMemory.set(socketId, [])
  }

  const history = chatMemory.get(socketId)
  history.push({ role, text, timestamp: Date.now() })

  // Keep last 20 messages
  if (history.length > 20) {
    history.shift()
  }
};

const buildContextPrompt = (socketId, newPrompt) => {
  const history = chatMemory.get(socketId)

  let context = ""

  // Add current date/time context
  const now = new Date()
  const istTime = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(now)

  context += `[CURRENT TIME: ${istTime} (IST/UTC+5:30)]\n`

  // Slots are injected per-request when needed (see ai-processing handler)

  // Add interrupted response context if exists
  const interrupted = interruptedResponses.get(socketId)
  if (interrupted) {
    context += `[CONTEXT: I was saying "${interrupted}" but was interrupted by user]\n`
    interruptedResponses.delete(socketId)
  }

  // Add conversation history
  if (history && history.length > 0) {
    context += "\n--- Recent Conversation ---\n"
    const recentHistory = history.slice(-10) // Last 10 exchanges
    recentHistory.forEach(msg => {
      context += `${msg.role}: ${msg.text}\n`
    })
    context += "--- End Recent Conversation ---\n"

    // Add extracted customer details if detected in previous turns
    const contact = extractContactInfo(history)
    if (contact.name || contact.phone) {
      context += `[KNOWN CUSTOMER DETAILS: name=${contact.name || 'unknown'}, phone=${contact.phone || 'unknown'}]\n`
    }
  }

  // Add current user prompt
  context += `\nuser: ${newPrompt}`

  return context
}

/* -------------------- Slot Resolution (natural language → ISO) -------------------- */
/**
 * Takes a natural-language slot string like "tomorrow 1 PM" or "Monday 10 AM"
 * and matches it to the nearest available slot ISO timestamp.
 * Returns the matching startISO string, or null if no match found.
 */
const resolveSlotToISO = (slotText, slotsResult) => {
  if (!slotsResult.success || !slotsResult.slots) return null

  // Parse the natural language date using chrono-node (IST reference)
  const referenceDate = new Date()
  const parsed = chrono.parse(slotText, referenceDate, { forwardDate: true })
  if (!parsed || parsed.length === 0) {
    console.log(`📅 chrono could not parse: "${slotText}"`)
    return null
  }

  const targetDate = parsed[0].start.date()
  console.log(`📅 Parsed "${slotText}" → ${targetDate.toISOString()}`)

  // Find the closest available slot within ±30 minutes of parsed time
  let bestMatch = null
  let bestDiff = Infinity

  for (const slots of Object.values(slotsResult.slots)) {
    for (const slot of slots) {
      const slotTime = new Date(slot.startISO)
      const diff = Math.abs(slotTime - targetDate)
      if (diff < bestDiff && diff <= 30 * 60 * 1000) { // within 30 min
        bestDiff = diff
        bestMatch = slot.startISO
      }
    }
  }

  if (!bestMatch) {
    console.log(`📅 No available slot within 30 min of "${slotText}"`)
  }
  return bestMatch
}

/* -------------------- Booking Intent Detection -------------------- */
const needsBookingCheck = (prompt) => {
  const text = prompt.toLowerCase()

  // Let AI decide - look for any scheduling/appointment related words
  const bookingKeywords = [
    'appointment', 'schedule', 'book', 'available', 'free', 'time', 'slot',
    'meeting', 'call', 'consultation', 'when', 'today', 'tomorrow',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'morning', 'afternoon', 'evening', 'am', 'pm', 'calendar', 'confirm', 'yes', 'perfect', 'sounds good'
  ]

  return bookingKeywords.some(keyword => text.includes(keyword))
}

const extractContactInfo = (conversationHistory) => {
  let name = null
  let phone = null
  let slot = null

  const recentMessages = conversationHistory.slice(-10)

  for (const msg of recentMessages) {
    if (msg.role === 'user') {
      const text = msg.text.trim()

      // Look for phone patterns (more comprehensive)
      if (!phone) {
        const phoneMatch = text.match(/(\+?\d{10,15}|\d{3}[-\s]?\d{3}[-\s]?\d{4}|\d{10})/);
        if (phoneMatch) {
          phone = phoneMatch[1]
          console.log(`📱 Extracted phone: ${phone}`)
        }
      }

      // Look for name patterns (e.g. "my name is Harsha", "this is John", or standalone names)
      if (!name) {
        const nameIntro = text.match(/(?:my name is|i am|this is)\s+([A-Za-z\s]{2,30})/i)
        if (nameIntro) {
          name = nameIntro[1].trim()
          console.log(`👤 Extracted name from intro: ${name}`)
        } else {
          const words = text.split(/\s+/)
          if (words.length <= 3 &&
            words.every(word => /^[A-Za-z]+$/.test(word)) &&
            text.length >= 2 &&
            text.length <= 50 &&
            !/^(yes|no|ok|okay|sure|hello|hi|hey|book|schedule|appointment|tomorrow|today|morning|evening|afternoon)$/i.test(text.trim())) {
            name = text
            console.log(`👤 Extracted name: ${name}`)
          }
        }
      }

      // Look for slot/time mentions if not yet identified
      if (!slot) {
        const timeMatch = text.match(/(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)?\s*at\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i)
          || text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i)
          || text.match(/(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
        if (timeMatch) {
          slot = timeMatch[0].trim()
          console.log(`⏰ Extracted slot from user speech: ${slot}`)
        }
      }
    }
  }

  console.log(`📋 Contact extraction result - Name: ${name}, Phone: ${phone}, Slot: ${slot}`)
  return { name, phone, slot }
}

/* -------------------- TTS Helpers -------------------- */
async function streamTTS(socket, text) {
  const controller = new AbortController()
  ttsControllers.set(socket.id, controller)

  try {
    await streamTTSAsPCM(socket, text, controller.signal)
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('TTS PCM request aborted')
    } else {
      console.error('TTS PCM stream error:', error)
    }
  } finally {
    const currentController = ttsControllers.get(socket.id)
    if (currentController === controller) {
      ttsControllers.delete(socket.id)
    }
  }
}

// Per-socket queue for TTS tasks so sentences play in strict sequence without race conditions
const ttsQueue = new Map()

async function enqueueTTS(socket, text) {
  const sid = socket.id
  const prevPromise = ttsQueue.get(sid) || Promise.resolve()

  const nextPromise = prevPromise
    .catch(() => {}) // never fail the chain
    .then(async () => {
      // Check if current request was aborted before processing
      const llmCtrl = llmControllers.get(sid)
      if (llmCtrl && llmCtrl.signal.aborted) return
      await streamTTS(socket, text)
    })

  ttsQueue.set(sid, nextPromise)
  return nextPromise
}

async function maybeFlushSentence(socket) {
  const sid = socket.id
  const buf = (ttsBuffer.get(sid) || '').trim()
  if (!buf) return

  const match = buf.match(/(.+?[\.!\?]+)(\s|$)/)
  if (!match) return

  const sentence = match[1].trim()
  const remainder = buf.slice(match[0].length)
  ttsBuffer.set(sid, remainder)

  enqueueTTS(socket, sentence)
  maybeFlushSentence(socket)
}

function interruptAllAI(socketId) {
  const llmController = llmControllers.get(socketId)
  if (llmController) {
    llmController.abort()
    llmControllers.delete(socketId)
    console.log(`LLM generation interrupted for socket ${socketId}`)
  }

  const ttsController = ttsControllers.get(socketId)
  if (ttsController) {
    ttsController.abort()
    ttsControllers.delete(socketId)
    console.log(`TTS stream interrupted for socket ${socketId}`)
  }

  ttsBuffer.set(socketId, '')
  ttsBusy.set(socketId, false)
  ttsQueue.delete(socketId)

  // 🚨 NEW: Tell client to stop playback immediately
  const socket = io.sockets.sockets.get(socketId)
  if (socket) {
    socket.emit('clear-audio')
  }
}

/* -------------------- WebSocket Events -------------------- */
io.on('connection', async (socket) => {
  console.log('🔌 WS Connected!', socket.id)
  socket.emit('status', 'Ready')

  socket.on('ai-processing', async (prompt) => {
    if (!consumeSocketRateLimit(socket, aiLimiter, 'ai-processing', rateLimitConfig.trustProxyHops)) return
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) {
      socket.emit('error', 'Prompt must be between 1 and 4000 characters')
      return
    }

    console.log(`\n🎯 [${socket.id}] Processing AI request:`, prompt)

    // Step 1: Interrupt existing processes
    interruptAllAI(socket.id)
    addToMemory(socket.id, 'user', prompt)

    // Step 2: Only classify calls that could require a calendar action.
    // Ordinary questions used to wait for an extra complete LLM request.
    let aiAction = null
    if (needsBookingCheck(prompt)) {
      try {
        const actionPrompt = buildContextPrompt(socket.id, prompt)
        aiAction = await classifyAction(actionPrompt)
        console.log(`🤖 AI Action:`, aiAction)
      } catch (err) {
        console.error("AI action fetch failed:", err)
        aiAction = { action: "none", parameters: {} }
      }
    } else {
      aiAction = { action: "none", parameters: {} }
    }

    // Auto-fill parameters from conversation history if LLM omitted them
    if (aiAction.action === "book" && aiAction.parameters) {
      const history = chatMemory.get(socket.id) || []
      const extracted = extractContactInfo(history)
      if (!aiAction.parameters.name && extracted.name) {
        aiAction.parameters.name = extracted.name
        console.log(`👤 Auto-filled name from history: ${extracted.name}`)
      }
      if (!aiAction.parameters.phone && extracted.phone) {
        aiAction.parameters.phone = extracted.phone
        console.log(`📱 Auto-filled phone from history: ${extracted.phone}`)
      }
      if (!aiAction.parameters.slot && extracted.slot) {
        aiAction.parameters.slot = extracted.slot
        console.log(`⏰ Auto-filled slot from history: ${extracted.slot}`)
      }
    }

    // Step 3: Execute based on structured action
    let bookingResponse = null
    if (aiAction.action === "check_slots") {
      console.log(`📅 [${socket.id}] Fetching live calendar slots...`)
      const slotsResult = await getAvailableSlots(7)
      const slotsSummary = formatSlotsForAI(slotsResult)
      bookingResponse = { type: "availability", slots: slotsSummary }
    }
    else if (aiAction.action === "book") {
      const { slot, name, phone, service } = aiAction.parameters
      if (slot && name && phone) {
        console.log(`📅 [${socket.id}] Resolving slot "${slot}" for ${name} (${phone})`)

        // Step 3a: Fetch live slots to get valid ISO timestamps
        const slotsResult = await getAvailableSlots(7)

        // Step 3b: Parse the natural-language slot ("tomorrow 1 PM") → ISO
        const resolvedISO = resolveSlotToISO(slot, slotsResult)

        if (resolvedISO) {
          console.log(`📅 [${socket.id}] Resolved "${slot}" → ${resolvedISO}`)
          bookingResponse = await bookSlot(resolvedISO, name, phone, service || 'Appointment')
          bookingResponse.type = "booking"
        } else {
          // Could not match the requested slot to an available slot
          const slotsSummary = formatSlotsForAI(slotsResult)
          bookingResponse = {
            type: "slot_not_found",
            requested: slot,
            available: slotsSummary,
            message: `The slot "${slot}" isn't available. Here are open slots: ${slotsSummary}`
          }
        }
      } else {
        bookingResponse = {
          status: "MISSING_INFO",
          missing: { slot: !slot, name: !name, phone: !phone }
        }
      }
    }

    // Step 4: Build conversation prompt (natural reply)
    let contextPrompt = buildContextPrompt(socket.id, prompt)

    if (bookingResponse) {
      contextPrompt += `\n\n[BOOKING SYSTEM RESPONSE: ${JSON.stringify(bookingResponse)}]`
    }

    contextPrompt += `\n\nIMPORTANT: Respond naturally to the user. Do NOT output JSON in this step.`

    // Step 5: Generate AI response
    const controller = new AbortController()
    llmControllers.set(socket.id, controller)
    let botResponse = ''

    try {
      console.log(`🤖 [${socket.id}] Starting LLM generation...`)

      await streamResponse(
        contextPrompt,
        controller.signal,
        // onToken
        async (token) => {
          botResponse += token
          socket.emit('llm-token', token)
          const existing = ttsBuffer.get(socket.id) || ''
          ttsBuffer.set(socket.id, existing + token)
          if (/[\.!?]\s*$/.test(existing + token)) {
            await maybeFlushSentence(socket)
          }
        },
        // onDone (no-op — cleanup happens below)
        () => { }
      )

      // Handle remaining TTS buffer after stream ends
      const remaining = (ttsBuffer.get(socket.id) || '').trim()
      if (remaining && !controller.signal.aborted) {
        ttsBuffer.set(socket.id, '')
        enqueueTTS(socket, remaining)
      }

      // Wait for any queued TTS sentences to finish before declaring complete
      const activeQueue = ttsQueue.get(socket.id)
      if (activeQueue) {
        await activeQueue
      }

      if (botResponse.trim() && !controller.signal.aborted) {
        addToMemory(socket.id, 'bot', botResponse.trim())
      }

      socket.emit('llm-complete')
      socket.emit('status', 'Ready')
      console.log(`🎯 [${socket.id}] ✅ AI processing completed`)

    } catch (error) {
      console.error(`🎯 [${socket.id}] AI processing error:`, error)
      const isAbort = error?.name === 'AbortError' || error?.code === 'ABORT_ERR'

      if (isAbort && botResponse.trim()) {
        interruptedResponses.set(socket.id, botResponse.trim())
      } else {
        socket.emit('error', 'Failed to process AI request')
      }

      socket.emit('status', 'Error')
    } finally {
      const current = llmControllers.get(socket.id)
      if (current === controller) llmControllers.delete(socket.id)
    }
  })

  socket.on('interrupt-ai', () => {
    console.log('🛑 AI interruption requested')
    interruptAllAI(socket.id)
    socket.emit('ai-interrupted')
  })

  socket.on('voly-intro', async (payload = {}) => {
    if (!consumeSocketRateLimit(socket, ttsLimiter, 'voly-intro', rateLimitConfig.trustProxyHops)) return
    const { text } = payload
    if (typeof text !== 'string' || !text.trim() || text.length > 500) {
      socket.emit('error', 'Intro text must be between 1 and 500 characters')
      return
    }

    try {
      await streamTTS(socket, text)
    } catch (err) {
      console.error('Intro TTS error:', err)
    }
  })

  socket.on('disconnect', () => {
    console.log('🔌 Disconnected', socket.id)
    interruptAllAI(socket.id)

    // Clear all socket-specific data
    llmControllers.delete(socket.id)
    ttsControllers.delete(socket.id)
    ttsBusy.delete(socket.id)
    ttsBuffer.delete(socket.id)
    chatMemory.delete(socket.id)
    interruptedResponses.delete(socket.id)

  })
})

/* -------------------- Express API Routes -------------------- */
app.get('/token', createHttpRateLimit({
  limiter: tokenLimiter,
  trustedProxyHops: rateLimitConfig.trustProxyHops,
  keyPrefix: 'token'
}), speechToText)

const automationRateLimit = createHttpRateLimit({
  limiter: automationLimiter,
  trustedProxyHops: rateLimitConfig.trustProxyHops,
  keyPrefix: 'automation'
})

// Debug: view live calendar slots
app.get('/debug/slots', automationRateLimit, async (req, res) => {
  const slotsResult = await getAvailableSlots(7)
  res.json({
    slots: slotsResult,
    timestamp: new Date().toISOString()
  })
})

// Test: Google Calendar connectivity
app.get('/test-calendar', automationRateLimit, async (req, res) => {
  try {
    const slotsResult = await getAvailableSlots(7)
    res.json({
      success: slotsResult.success,
      slots: slotsResult,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    res.json({ error: error.message })
  }
})

async function listAvailableModels() {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    console.log('Available models:', data.models?.map(m => m.name));
    return data.models;
  } catch (error) {
    console.error('Error listing models:', error);
  }
}

/* -------------------- Start Server -------------------- */
httpServer.listen(PORT, () => {

  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📅 Google Calendar integration active — slots fetched on demand`)
})
