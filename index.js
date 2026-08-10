  import express from 'express'
  import dotenv from 'dotenv'
  import { Server } from 'socket.io'
  import { createServer } from 'http'
  import cors from 'cors'
  import { speechToText } from './services/STT.service.js'
  import { streamTTSAsPCM } from './services/PCMStreamer.service.js'
  import { GoogleGenerativeAI } from '@google/generative-ai'
  import axios from 'axios'
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

  /* -------------------- N8N Webhook URL -------------------- */
  const BOOKING_WEBHOOK = 'https://d0e952e04489.ngrok-free.app/webhook/appointment'

  /* -------------------- Booking Helper Function -------------------- */
  const callBookingWebhook = async (message, name = null, phone = null) => {
    console.log(`📞 Calling booking webhook with message: "${message}"`)
    
    try {
      const payload = { message }
      
      // Add contact info only if provided (for booking requests)
      if (name && phone) {
        payload.name = name
        payload.phone = phone
        console.log(`📞 Including contact info: ${name}, ${phone}`)
      }
      
      const response = await axios.post(
        BOOKING_WEBHOOK,
        payload,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000 // Increased timeout for AI processing
        }
      )
      
      console.log(`📞 Webhook response:`, response.data)
      return response.data
      
    } catch (error) {
      console.error('📞 Booking webhook error:', error.message)
      
      // Fallback response
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        return { 
          error: 'timeout',
          message: 'System is taking longer than expected. Let me take your contact info and Harsha will call you back.'
        }
      }
      
      return { 
        error: 'system_error',
        message: 'Having trouble checking the calendar right now. Please try again or I can take your details for a callback.'
      }
    }
  }

  /* -------------------- Gemini LLM Setup -------------------- */
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
7. After receiving a  [BOOKING SYSTEM RESPONSE] , acknowledge naturally and close the call:

   > “Perfect, your slot’s confirmed. See you then!”

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

  /* -------------------- In-Memory State -------------------- */
  const llmControllers = new Map()
  const ttsBusy = new Map()
  const ttsBuffer = new Map()
  const chatMemory = new Map()
  const ttsControllers = new Map()
  const interruptedResponses = new Map()

  // Global cache for 7-day slots (same for all users)
  let weeklySlots = null
  let slotsLastUpdated = null
  let slotsLoadPromise = null  

  /* -------------------- Slot Management -------------------- */
  const loadWeeklySlots = async () => {
    console.log(`📅 Loading weekly slots...`)
    
    try {
      const response = await callBookingWebhook("Get available slots for the next 7 days")
      
      if (response && !response.error) {
        weeklySlots = response
        slotsLastUpdated = Date.now()
        console.log(`📅 Weekly slots loaded successfully`)
        return response
      } else {
        console.log(`📅 Error loading slots:`, response?.message)
        return { error: response?.error || 'unknown', message: response?.message || 'Could not load slots' }
      }
      
    } catch (error) {
      console.error('📅 Failed to load weekly slots:', error)
      return { error: 'failed', message: 'Could not connect to calendar system' }
    }
  }

  const getSlots = () => {
    return weeklySlots || { error: 'not_loaded', message: 'Slots not yet loaded' }
  }

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

    // Add available slots context
    if (weeklySlots && !weeklySlots.error) {
      context += `[AVAILABLE SLOTS: ${JSON.stringify(weeklySlots)}]\n`
    } else if (weeklySlots && weeklySlots.error) {
      context += `[SLOTS STATUS: Error loading calendar - ${weeklySlots.message}]\n`
    } else {
      context += `[SLOTS STATUS: Calendar not yet loaded]\n`
    }

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
    }
    
    // Add current user prompt
    context += `\nuser: ${newPrompt}`
    
    return context
  }

  /* -------------------- Booking Intent Detection -------------------- */
  const needsBookingCheck = (prompt) => {
    const text = prompt.toLowerCase()
    
    // Let AI decide - look for any scheduling/appointment related words
    const bookingKeywords = [
      'appointment', 'schedule', 'book', 'available', 'free', 'time', 'slot',
      'meeting', 'call', 'consultation', 'when', 'today', 'tomorrow',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'morning', 'afternoon', 'evening', 'am', 'pm', 'calendar'
    ]
    
    return bookingKeywords.some(keyword => text.includes(keyword))
  }

  const extractContactInfo = (conversationHistory) => {
    let name = null
    let phone = null
    
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
        
        // Look for name patterns
        if (!name) {
          const words = text.split(/\s+/)
          
          // Check if this looks like a name response
          if (words.length <= 3 && 
              words.every(word => /^[A-Za-z]+$/.test(word)) &&
              text.length >= 2 && 
              text.length <= 50 &&
              !text.toLowerCase().includes('book') &&
              !text.toLowerCase().includes('schedule') &&
              !text.toLowerCase().includes('appointment')) {
            
            name = text
            console.log(`👤 Extracted name: ${name}`)
          }
        }
      }
    }
    
    console.log(`📋 Contact extraction result - Name: ${name}, Phone: ${phone}`)
    return { name, phone }
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

  async function maybeFlushSentence(socket) {
    const sid = socket.id
    if (ttsBusy.get(sid)) return
    const buf = (ttsBuffer.get(sid) || '').trim()
    if (!buf) return

    const match = buf.match(/(.+?[\.!\?]+)(\s|$)/)
    if (!match) return

    const sentence = match[1].trim()
    const remainder = buf.slice(match[0].length)
    ttsBuffer.set(sid, remainder)

    try {
      ttsBusy.set(sid, true)
      await streamTTS(socket, sentence)
    } catch (e) {
      console.error('TTS stream error:', e)
    } finally {
      ttsBusy.set(sid, false)
      await maybeFlushSentence(socket)
    }
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

    // 🚨 NEW: Tell client to stop playback immediately
    const socket = io.sockets.sockets.get(socketId)
    if (socket) {
      socket.emit('clear-audio')
    }
  }

  /* -------------------- WebSocket Events -------------------- */
  io.on('connection', async (socket) => {
    console.log('🔌 WS Connected!', socket.id)
    
    // Load slots only once per socket connection
    if (!weeklySlots) {
      console.log('📅 Loading weekly slots for first time...')
      socket.emit('status', 'Loading calendar...')

      if (!slotsLoadPromise) {
        slotsLoadPromise = loadWeeklySlots().finally(() => {
          slotsLoadPromise = null
        })
      }
      await slotsLoadPromise

      socket.emit('status', 'Ready')
    } else {
      socket.emit('status', 'Ready')
    }

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
        const actionPrompt = buildContextPrompt(socket.id, prompt) + 
          "\n\nIMPORTANT: Respond ONLY with valid JSON (no natural text)."
      
        const actionResult = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: actionPrompt }] }]
        })
        
        // ✅ FIXED: Use .text() method instead of choices[0]
        let raw = actionResult.response.text()
        console.log(`🤖 Raw AI Action:`, raw)
      
        // Remove markdown fences if present
        raw = raw.replace(/```json/i, '').replace(/```/g, '').trim()
      
        try {
          aiAction = JSON.parse(raw)
        } catch (e) {
          console.error("❌ Failed to parse AI action after cleaning:", raw, e.message)
          aiAction = { action: "none", parameters: {} }
        }
        
      } catch (err) {
        console.error("AI action fetch failed:", err)
        aiAction = { action: "none", parameters: {} }
      }
      } else {
        aiAction = { action: "none", parameters: {} }
      }

      // Step 3: Execute based on structured action
      let bookingResponse = null
      if (aiAction.action === "check_slots") {
        bookingResponse = { type: "availability", slots: getSlots() }
      }
      else if (aiAction.action === "book") {
        const { slot, name, phone } = aiAction.parameters
        if (slot && name && phone) {
          bookingResponse = await callBookingWebhook(slot, name, phone)
          bookingResponse.type = "booking"
        } else {
          bookingResponse = {
            status: "MISSING_INFO",
            missing: {
              slot: !slot,
              name: !name,
              phone: !phone
            }
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
        
        const result = await model.generateContentStream(
          { contents: [{ role: 'user', parts: [{ text: contextPrompt }] }] }
        )
      
        for await (const chunk of result.stream) {
          // ✅ FIXED: Use .text() method instead of choices[0]
          const token = chunk.text() || ''
          
          if (token) {
            botResponse += token
            socket.emit('llm-token', token)
            const existing = ttsBuffer.get(socket.id) || ''
            ttsBuffer.set(socket.id, existing + token)
      
            if (/[\.!\?]\s*$/.test(existing + token)) {
              await maybeFlushSentence(socket)
            }
          }
        }
      
        // Handle remaining TTS
        const remaining = (ttsBuffer.get(socket.id) || '').trim()
        if (remaining && !controller.signal.aborted) {
          ttsBuffer.set(socket.id, remaining + '.')
          await maybeFlushSentence(socket)
          ttsBuffer.set(socket.id, '')
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

  // Debug routes
  app.get('/debug/slots', (req, res) => {
    res.json({
      weeklySlots,
      slotsLastUpdated: slotsLastUpdated ? new Date(slotsLastUpdated).toISOString() : null,
      cacheAge: slotsLastUpdated ? Date.now() - slotsLastUpdated : null
    })
  })

  const automationRateLimit = createHttpRateLimit({
    limiter: automationLimiter,
    trustedProxyHops: rateLimitConfig.trustProxyHops,
    keyPrefix: 'automation'
  })

  app.get('/test-webhook', automationRateLimit, async (req, res) => {
    const message = req.query.message || "Get available slots for the next 7 days"
    
    try {
      const result = await callBookingWebhook(message)
      res.json({
        input: message,
        response: result,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      res.json({
        error: error.message,
        input: message
      })
    }
  })

  app.post('/refresh-slots', automationRateLimit, async (req, res) => {
    console.log('🔄 Manual slot refresh requested')
    
    try {
      const result = await loadWeeklySlots()
      res.json({
        success: !result.error,
        data: result,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      res.json({
        success: false,
        error: error.message
      })
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
    console.log(`📅 Weekly slots will be loaded on first connection`)
  })
