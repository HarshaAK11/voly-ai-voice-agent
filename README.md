# Voly

Voly is an ultra-low-latency conversational AI voice companion designed to feel like a real human friend over a live voice call (similar to ChatGPT Voice). It listens continuously, responds naturally, handles mid-sentence interruptions, and coordinates Google Calendar scheduling.

## Try it live

Visit [voly-three.vercel.app](https://voly-three.vercel.app) to test the live voice demo. Allow microphone access when prompted, tap the orb, and start talking naturally.

## Key Capabilities

- **Natural Conversational Rally (Ping-Pong Flow)**: Keeps replies concise and dynamic (1–2 sentences), smoothly passing the conversational ball back rather than giving robotic monologues.
- **Acoustic Endpointing & Live VAD**: Powered by Deepgram Nova with native 250ms acoustic silence endpointing and immediate utterance turn flushing.
- **Ultra-Low Latency Clause-Level Streaming**: Streams audio early on punctuation boundaries (`[,;:\-—]`) via ElevenLabs Flash v2.5 (~350ms TTFB) with subtle 160ms vocal breathing pauses between phrases.
- **Barge-In Interruption Agility**: Instant client-side VAD frequency analysis cuts active PCM audio playback the moment the caller speaks, signaling the backend to abort generation and seamlessly pivot.
- **Time-of-Day Calendar Availability**: Direct Google Calendar integration that buckets open slots by Morning, Afternoon, and Evening to avoid long, robotic lists of timestamps.
- **Robust WebRTC Session Lifecycle**: Clean connection teardown, token caching to protect rate limits, and instant zero-delay mic resumption when restarting active conversations.

## Architecture

```text
Browser Microphone (WebRTC / AEC)
  │ (Raw Audio Stream)
  ▼
Deepgram Nova STT (Live WebSocket + Acoustic Endpointing)
  │ (Transcribed Turn)
  ▼
Voly Brain / Backend (Express + Socket.IO)
  ├── Action Classifier & Calendar Service (Slot grouping / Booking)
  └── Gemini 2.5 Flash / Groq LLM (Ping-pong dialogue + Mirroring)
  │ (Clause-level token stream)
  ▼
ElevenLabs Flash v2.5 TTS (PCM Audio Chunks)
  │ (Socket.IO Binary Stream)
  ▼
Browser Web Audio API (usePCMAudio / Instant Interruption)
```

## Project Structure

```text
app/                 React + Vite frontend (public voice demo & developer debug views)
services/
  ├── AI.service.js          LLM streaming engine (Gemini with Groq fallback)
  ├── STT.service.js         Deepgram ephemeral token generation
  ├── calendar.service.js    Google Calendar slot discovery and booking
  └── rateLimit.service.js   In-memory sliding window rate limiter
index.js             Express API and Socket.IO real-time voice orchestration server
prompt.txt           Grounded system instructions and conversational behavioral rules
```

## Local Development

### 1. Install Dependencies

```bash
# Backend dependencies
npm install

# Frontend dependencies
cd app
npm install
cd ..
```

### 2. Configure Environment Variables

Create a `.env` file in the project root based on `.env.example`:

```env
PORT=5000
FRONTEND_URL=http://localhost:5173

# AI & Voice Services
GEMINI_API_KEY=your_gemini_api_key
GROQ_API=your_groq_api_key
DEEPGRAM_API_KEY=your_deepgram_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id

# Google Calendar (Service Account)
GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com
# Place google-credentials.json in the project root if using direct calendar booking
```

### 3. Start the Backend Server

```bash
npm run server
```

### 4. Start the Frontend App

In a separate terminal:

```bash
cd app
npm run dev
```

Visit `http://localhost:5173` to test the voice assistant.

## Application Routes

| Route | Description |
| --- | --- |
| `/` | Public voice companion interface with interactive orb and live transcription |
| `/stt` | Developer STT testing interface |
| `/interrupt-test` | Interruption sensitivity calibration suite |
| `/advanced-test` | Extended barge-in audio tests |
| `/performance` | Audio latency & network telemetry dashboard |
| `/debug` | Real-time PCM audio buffer inspector |

## Rate Limiting & Abuse Prevention

The backend enforces in-memory rate limiting per client IP:

- **HTTP Requests**: 100 requests / 15 min
- **Deepgram Tokens**: 10 requests / 10 min (frontend also caches tokens in memory to avoid burns)
- **Socket.IO Connections**: 20 connects / 10 min
- **AI Processing Requests**: 15 turns / 5 min
- **Intro TTS Audio**: 10 plays / 5 min

When running behind reverse proxies (Render, Railway, Cloudflare), set `TRUST_PROXY_HOPS` to the exact hop count (typically `1`) to ensure accurate client IP tracking without allowing header spoofing.
