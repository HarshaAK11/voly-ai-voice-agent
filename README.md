# Voly

Voly is a real-time AI voice receptionist that listens, responds naturally, handles interruptions, and helps callers with appointments and enquiries.

## Try it live

Visit [voly-three.vercel.app](https://voly-three.vercel.app) to test the live
voice-agent demo. Allow microphone access when prompted, then start a conversation
with Voly.

## What it can do

- Convert live speech to text with Deepgram
- Generate short, natural responses with Gemini
- Stream low-latency ElevenLabs speech back to the caller
- Support barge-in: callers can interrupt Voly while it is speaking
- Check appointment availability and send booking requests to a webhook
- Preserve recent conversation context during a session

## How it works

```text
Browser microphone
  → Deepgram speech-to-text
  → Voly server (Gemini + booking logic)
  → ElevenLabs text-to-speech
  → Browser audio playback
```

The app streams native PCM audio to the browser over Socket.IO, keeping the voice response path fast and interruptible.

## Project structure

```text
app/                 React + Vite public voice demo and test UI
services/            Speech-to-text and text-to-speech services
index.js             Express and Socket.IO server
```

## Run locally

### 1. Install dependencies

```bash
npm install
cd app
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
PORT=5000
GEMINI_API_KEY=your_gemini_key
DEEPGRAM_API_KEY=your_deepgram_key
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id
```

### 3. Start the server

From the project root:

```bash
npm run server
```

### 4. Start the web app

In a second terminal:

```bash
cd app
npm run dev
```

Open the URL shown by Vite, normally `http://localhost:5173`.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Public voice-agent demo for visitors |
| `/stt` | Original developer testing interface |
| `/interrupt-test` | Basic interruption test |
| `/advanced-test` | Advanced interruption test |
| `/performance` | Audio performance dashboard |
| `/debug` | PCM audio diagnostics |

## Notes

- The booking webhook is configured server-side in `index.js`.
- Do not commit `.env`, API keys, service-account credentials, or `node_modules`.
- Microphone access is required to use the live demo.

## Rate limiting

The backend limits traffic per client IP in memory. By default it allows 100 HTTP
requests per 15 minutes, 10 Deepgram token requests per 10 minutes, 5 booking
automation requests per 10 minutes, 20 Socket.IO connections per 10 minutes,
15 AI prompts per 5 minutes, and 10 intro TTS requests per 5 minutes. Rejected
HTTP requests return `429` with `Retry-After`; rejected Socket.IO actions emit a
`rate-limit` event containing `event` and `retryAfterMs`.

All thresholds can be changed with the variables documented in `.env.example`.
When deploying behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact number
of proxies between the public client and Node. For a single Railway proxy this is
usually `1`; leave it at `0` when Node is directly exposed. Do not blindly trust
forwarded IP headers, because clients could otherwise evade the limits.

The built-in store is process-local. If you deploy multiple server replicas, use a
shared rate-limit store (for example Redis) or enforce an additional limit at the
hosting/CDN edge so every replica shares the same counters.

## Author

Built by [Harsha Adithya Kumar](https://harsha-peach.vercel.app/).
