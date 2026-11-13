import { useEffect, useRef, useState } from 'react'
import { createClient } from '@deepgram/sdk'
import { io, type Socket } from 'socket.io-client'
import { usePCMAudio } from '../hooks/usePCMAudio'
import { BACKEND_URL } from '../config/backend'
import './VoiceResponse.css'

type VoiceResponseProps = {
  mode?: 'public'
}

const VoiceResponse = ({ mode }: VoiceResponseProps) => {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [messages, setMessages] = useState<{ role: 'user' | 'bot'; text: string; done?: boolean }[]>([])
  const [isBotSpeaking, setIsBotSpeaking] = useState(false)
  const [speechDetected, setSpeechDetected] = useState(false)

  // Server Warmup & Cold-Start states
  const [serverStatus, setServerStatus] = useState<'checking' | 'ready' | 'warming'>('checking')
  const [warmupSeconds, setWarmupSeconds] = useState(45)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const clientRef = useRef<any>(null)
  const socketRef = useRef<any>(null)        // Deepgram socket
  const llmSocketRef = useRef<Socket | null>(null) // App socket (Gemini + TTS)

  const lastFinalRef = useRef<string>('')
  const pendingUtteranceRef = useRef<string>('')
  const turnTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const llmSocketReadyRef = useRef(false)    // guard StrictMode double-connects

  // Interruption detection
  const vadRef = useRef<any>(null)
  const speechDetectionRef = useRef<any>(null)
  const speechStartTimeRef = useRef<number>(0)
  const speechThresholdRef = useRef(-45) // dB for speech detection (very sensitive)
  const minSpeechDurationRef = useRef(300) // 300ms minimum for interruption (very fast response)

  // PCM Audio playback
  const pcmAudio = usePCMAudio(llmSocketRef.current)

  // Initialize PCM audio when needed
  const initializePCMAudio = async () => {
    try {
      await pcmAudio.start()
      console.log('PCM audio initialized')
    } catch (error) {
      console.error('Failed to initialize PCM audio:', error)
    }
  }

  // Proactive background ping on page mount to wake Render container
  useEffect(() => {
    let timer: NodeJS.Timeout
    const pingServer = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(4000) })
        if (res.ok) {
          setServerStatus('ready')
          return
        }
      } catch (e) {
        // Server is sleeping or cold
      }
      setServerStatus('warming')
    }

    pingServer()

    // If warming, poll every 3 seconds until online
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(4000) })
        if (res.ok) {
          setServerStatus('ready')
          clearInterval(interval)
        }
      } catch (e) {}
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  // Warmup countdown timer when waking up
  useEffect(() => {
    if (serverStatus !== 'warming') return
    const timer = setInterval(() => {
      setWarmupSeconds((prev) => (prev > 1 ? prev - 1 : 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [serverStatus])

  /** ---------- Smart Interruption Detection ---------- */
  const setupInterruptionDetection = (stream: MediaStream) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const analyser = audioContext.createAnalyser()
    const microphone = audioContext.createMediaStreamSource(stream)

    analyser.fftSize = 2048
    analyser.minDecibels = -90
    analyser.maxDecibels = -10
    analyser.smoothingTimeConstant = 0.8

    microphone.connect(analyser)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const detectSpeech = () => {
      analyser.getByteFrequencyData(dataArray)

      // Focus on speech frequencies (approx 300–3000 Hz)
      const speechBins = dataArray.slice(8, 100)
      let speechSum = 0
      let totalSum = 0

      for (let i = 0; i < speechBins.length; i++) speechSum += speechBins[i]
      for (let i = 0; i < dataArray.length; i++) totalSum += dataArray[i]

      const speechAverage = speechBins.length ? speechSum / speechBins.length : 0
      const totalAverage = dataArray.length ? totalSum / dataArray.length : 1

      // Convert to decibels (roughly 0..255 -> 0..1)
      const speechDecibels = 20 * Math.log10(Math.max(speechAverage / 255, 1e-6))

      // Check if it's likely speech (not just noise)
      const speechRatio = speechAverage / (totalAverage + 1)
      
      // Very sensitive speech detection
      const volumeThreshold = speechDecibels > speechThresholdRef.current
      const speechPattern = speechRatio > 0.3 // Very low threshold for better detection
      const isSpeechLike = volumeThreshold && speechPattern

      // Update speech detection indicator
      setSpeechDetected(isSpeechLike)

      // Debug logging for speech detection
      if (isSpeechLike) {
        console.log(`🎤 Speech detected: ${speechDecibels.toFixed(1)}dB, ratio: ${speechRatio.toFixed(2)}, botSpeaking: ${isBotSpeaking}`)
      }
      
      // Debug logging every 2 seconds to show current state
      if (Date.now() % 2000 < 50) {
        console.log(`📊 Audio levels: ${speechDecibels.toFixed(1)}dB, ratio: ${speechRatio.toFixed(2)}, botSpeaking: ${isBotSpeaking}, speechLike: ${isSpeechLike}`)
      }

      if (isSpeechLike && isBotSpeaking) {
        if (speechStartTimeRef.current === 0) {
          speechStartTimeRef.current = Date.now()
          console.log('🎤 Speech start detected, starting timer...')
        } else {
          const speechDuration = Date.now() - speechStartTimeRef.current
          console.log(`🎤 Speech duration: ${speechDuration}ms (need ${minSpeechDurationRef.current}ms)`)
          if (speechDuration >= minSpeechDurationRef.current) {
            console.log('🛑 Triggering voice interruption!')
            handleInterruption()
            speechStartTimeRef.current = 0
          }
        }
      } else {
        if (speechStartTimeRef.current > 0) {
          console.log('🎤 Speech ended, resetting timer')
        }
        speechStartTimeRef.current = 0
      }

      speechDetectionRef.current = setTimeout(detectSpeech, 50) // Check every 50ms
    }

    vadRef.current = { audioContext, detectSpeech }
    detectSpeech()
  }

  const handleInterruption = () => {
    if (llmSocketRef.current && isBotSpeaking) {
      // Stop server-side LLM + TTS
      llmSocketRef.current.emit('interrupt-ai')
      setIsBotSpeaking(false)

      // Stop PCM audio playback immediately with enhanced interruption
      pcmAudio.stopPlayback()
      
      console.log('User interrupted - stopped audio playback with enhanced method')
    }
  }

  /** ---------- STT (Deepgram) ---------- */
  const getToken = async (): Promise<string> => {
    const res = await fetch(`${BACKEND_URL}/token`)
    if (!res.ok) throw new Error('Failed to fetch token')
    const json = await res.json()
    return json.access_token
  }

  const ensureSocket = async () => {
    if (socketRef.current) return socketRef.current
    const token = await getToken()
    const client = (clientRef.current ||= createClient({ accessToken: token }))
    const socket = client.listen.live({ model: 'nova', smart_format: true })
    socketRef.current = socket

    socket.on('open', () => {
      socket.on('Results', (data: any) => {
        const text = data?.channel?.alternatives?.[0]?.transcript || ''
        const isFinal = Boolean(
          (data?.is_final ?? data?.speech_final ?? data?.channel?.alternatives?.[0]?.confidence === 1)
        )

        if (text) setTranscript((prev) => (prev ? prev + ' ' + text : text))

        if (isFinal) {
          const finalChunk = (text || '').trim()
          if (finalChunk && finalChunk !== lastFinalRef.current) {
            lastFinalRef.current = finalChunk

            // Accumulate connected speech fragments across short mid-sentence pauses
            pendingUtteranceRef.current = pendingUtteranceRef.current
              ? `${pendingUtteranceRef.current} ${finalChunk}`
              : finalChunk

            // Clear any pending turn-dispatch timer from previous fragment
            if (turnTimeoutRef.current) {
              clearTimeout(turnTimeoutRef.current)
            }

            // Wait 800ms of silence before dispatching the completed user turn
            turnTimeoutRef.current = setTimeout(() => {
              const fullUtterance = pendingUtteranceRef.current.trim()
              pendingUtteranceRef.current = ''
              if (!fullUtterance) return

              console.log('🗣️ Dispatched complete user turn:', fullUtterance)

              setMessages((prev) => {
                const next = [...prev]
                next.push({ role: 'user', text: fullUtterance })
                next.push({ role: 'bot', text: '', done: false })
                return next
              })

              if (llmSocketRef.current) {
                llmSocketRef.current.emit('ai-processing', fullUtterance)
              }
            }, 800)
          }
        }
      })
    })

    socket.on('error', (e: any) => console.error('Deepgram socket error:', e))
    socket.on('close', () => (socketRef.current = null))
    return socket
  }

  const openMic = async (socket: any) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream
    const rec = new MediaRecorder(stream)
    recorderRef.current = rec

    // Setup interruption detection
    setupInterruptionDetection(stream)

    rec.onstart = () => {
      setIsRecording(true)
      document.body.classList.add('recording')
    }

    rec.onstop = () => {
      document.body.classList.remove('recording')
      setIsRecording(false)

      // Clean up interruption detection
      try { vadRef.current?.audioContext?.close() } catch {}
      vadRef.current = null
      if (speechDetectionRef.current) {
        clearTimeout(speechDetectionRef.current)
        speechDetectionRef.current = null
      }

      try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch {}
      streamRef.current = null
      recorderRef.current = null
    }

    rec.ondataavailable = (e: any) => {
      try {
        socket.send(e.data)
      } catch (err) {
        console.error('Failed to send audio chunk to Deepgram:', err)
      }
    }

    rec.start(500)
  }

  const start = async () => {
    // If backend is cold, flag it and wait for it to wake before crashing
    if (serverStatus !== 'ready') {
      setServerStatus('warming')
      return
    }

    try {
      // Initialize PCM audio first
      await initializePCMAudio()
  
      // Play intro and wait for it to complete
      if (llmSocketRef.current) {
        llmSocketRef.current.emit("voly-intro", {
          text: "Hey! I'm Voly, your AI voice assistant. What's on your mind today?",
        })
        
        // Wait for intro to complete before starting microphone
        // You can either:
        // Option 1: Fixed delay (simple)
        await new Promise(resolve => setTimeout(resolve, 3000)) // 3 seconds
        
        // Option 2: Wait for pcm-end event (better)
        // await new Promise(resolve => {
        //   const handler = () => {
        //     llmSocketRef.current?.off('pcm-end', handler)
        //     resolve()
        //   }
        //   llmSocketRef.current?.on('pcm-end', handler)
        // })
      }
  
      // Now start microphone after intro is done
      const socket = await ensureSocket()
      if (socket && !isRecording && !recorderRef.current) {
        console.log('🎤 Starting microphone after intro completed')
        await openMic(socket)
      }
    } catch (err) {
      console.error('Failed to start:', err)
    }
  }

  const stop = () => {
    if (turnTimeoutRef.current) {
      clearTimeout(turnTimeoutRef.current)
      turnTimeoutRef.current = null
    }
    pendingUtteranceRef.current = ''
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    } catch (err) {
      console.error('Failed to stop microphone:', err)
    }
  }

  /** ---------- LLM + TTS Socket.IO ---------- */
  useEffect(() => {
    if (llmSocketReadyRef.current) return
    llmSocketReadyRef.current = true

    const s = io(BACKEND_URL || window.location.origin, { transports: ['websocket'] })
    llmSocketRef.current = s

    s.on('llm-token', (token: string) => {
      if (!token) return
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.role === 'bot' && !last.done) {
          last.text += token
        }
        return next
      })
    })

    s.on('llm-complete', () => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.role === 'bot') last.done = true
        return next
      })
    })

    s.on('pcm-chunk', () => {
      // PCM chunks are handled by the usePCMAudio hook
      setIsBotSpeaking(true)
    })

    s.on('pcm-end', () => {
      setIsBotSpeaking(false)
    })

    s.on('ai-interrupted', () => {
      setIsBotSpeaking(false)
      // PCM audio is already stopped by the interrupt handler
      console.log('AI processing interrupted')
    })

    s.on('clear-audio', () => {
      console.log("🛑 Clear-audio received from server, stopping playback immediately")
      pcmAudio.stopPlayback()
      setIsBotSpeaking(false)
    })

    s.on('error', (err) => console.error('Socket error:', err))

    return () => {
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      } catch {}
      try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch {}
      try { socketRef.current?.close?.() } catch {}
      socketRef.current = null
      try { s.disconnect() } catch {}
      llmSocketRef.current = null

      // Clean up detection
      try { vadRef.current?.audioContext?.close() } catch {}
      vadRef.current = null
      if (speechDetectionRef.current) {
        clearTimeout(speechDetectionRef.current)
        speechDetectionRef.current = null
      }

      // PCM audio cleanup is handled by the usePCMAudio hook
    }
  }, []) // <-- IMPORTANT: no dependency on isBotSpeaking

  if (mode === 'public') {
    const agentState = isBotSpeaking ? 'Voly is speaking' : isRecording ? 'Listening' : 'Ready when you are'

    return (
      <main className="voly-demo">
        <div className="voly-demo__glow voly-demo__glow--one" />
        <div className="voly-demo__glow voly-demo__glow--two" />

        <header className="voly-demo__header">
          <a className="voly-demo__brand" href="/" aria-label="Voly home">
            <img src="/voly-logo.png" alt="" />
            <span>voly</span>
          </a>
          <span className="voly-demo__badge"><i /> Live voice demo</span>
        </header>

        <section className="voly-demo__hero">
          <p className="voly-demo__eyebrow">INTELLIGENT VOICE ASSISTANT</p>
          <h1>Have a real conversation.<br /><em>Just start talking.</em></h1>
          <p className="voly-demo__intro">Meet Voly — a fast, conversational voice AI companion. Chat freely about ideas, explore AI concepts, or schedule time for a meeting.</p>

          {serverStatus === 'warming' && (
            <div className="voly-demo__warmup">
              <span className="voly-demo__warmup-spinner" />
              <span>
                <strong>Waking up server...</strong> (Render free tier sleeps when idle). Ready in ~{warmupSeconds}s
              </span>
            </div>
          )}

          <div className={`voly-demo__voice-card ${isRecording ? 'is-listening' : ''} ${isBotSpeaking ? 'is-speaking' : ''}`}>
            <div className="voly-demo__orb-wrap">
              <span className="voly-demo__orbit voly-demo__orbit--outer" />
              <span className="voly-demo__orbit voly-demo__orbit--inner" />
              <button className="voly-demo__orb" onClick={isRecording ? stop : start} aria-label={isRecording ? 'Stop voice demo' : 'Start voice demo'}>
                {isRecording ? <span className="voly-demo__stop-icon" /> : <span className="voly-demo__mic-icon">⌁</span>}
              </button>
            </div>
            <div className="voly-demo__voice-copy">
              <strong>{agentState}</strong>
              <span>{isRecording ? 'Tap the button when you’re done' : 'Tap to start a conversation'}</span>
            </div>
          </div>

          <p className="voly-demo__privacy">Your microphone is used only while this demo is active.</p>
        </section>

        <section className="voly-demo__details">
          <div className="voly-demo__detail"><span>01</span><p><strong>Natural Speech</strong>Talk like you would with a friend — effortless and unscripted.</p></div>
          <div className="voly-demo__detail"><span>02</span><p><strong>Smart Assistant</strong>Discuss technology, ask questions, or explore new ideas.</p></div>
          <div className="voly-demo__detail"><span>03</span><p><strong>Calendar Integrated</strong>Ask to schedule a meeting and Voly will find open slots instantly.</p></div>
        </section>

        {messages.length > 0 && (
          <section className="voly-demo__conversation" aria-live="polite">
            <p className="voly-demo__eyebrow">CONVERSATION</p>
            {messages.slice(-4).map((message, index) => <p key={index} className={`voly-demo__message voly-demo__message--${message.role}`}><span>{message.role === 'user' ? 'You' : 'Voly'}</span>{message.text || '…'}</p>)}
          </section>
        )}

        <footer className="voly-demo__footer">
          Built by <a href="https://harsha-peach.vercel.app/" target="_blank" rel="noreferrer">Harsha Adithya Kumar</a>
        </footer>
      </main>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <button onClick={start} disabled={isRecording}>
          {isRecording ? 'Recording…' : 'Start'}
        </button>
        <button onClick={stop} disabled={!isRecording} style={{ marginLeft: 10 }}>
          Stop
        </button>

        <span style={{ marginLeft: 10, color: '#555' }}>
          {transcript && '(listening…)'} 
          {isBotSpeaking && (
            <span style={{ 
              color: '#0066cc', 
              fontWeight: 'bold'
            }}>
              🤖 Bot Speaking
            </span>
          )}
          {speechDetected && (
            <span style={{ 
              marginLeft: 10, 
              color: '#ff6600', 
              fontWeight: 'bold',
              backgroundColor: '#fff3cd',
              padding: '2px 6px',
              borderRadius: '3px'
            }}>
              🎤 Voice Detected
            </span>
          )}
          {speechDetected && isBotSpeaking && (
            <span style={{ 
              marginLeft: 10, 
              color: '#dc3545', 
              fontWeight: 'bold',
              backgroundColor: '#f8d7da',
              padding: '2px 6px',
              borderRadius: '3px'
            }}>
              ⚡ Interrupt Ready
            </span>
          )}
        </span>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Conversation</h3>
        <div
          style={{
            border: '1px solid #ccc',
            borderRadius: 4,
            padding: 10,
            minHeight: 200,
            background: '#fafafa',
          }}
        >
          {messages.length === 0 && <div style={{ color: '#777' }}>Start speaking…</div>}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                margin: '6px 0',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '80%',
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: m.role === 'user' ? '#d1e7ff' : '#e8f5e9',
                  border: '1px solid #ddd',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.text}
                {m.role === 'bot' && !m.done && <span style={{ opacity: 0.5 }}> ▍</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 10 }}>
          <h4>Interrupt Settings (Debug)</h4>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', fontSize: '14px', flexWrap: 'wrap' }}>
            <label>
              Speech Threshold: 
              <input 
                type="range" 
                min="-50" 
                max="-20" 
                value={speechThresholdRef.current}
                onChange={(e) => {
                  speechThresholdRef.current = parseInt(e.target.value)
                  console.log('🎛️ Speech threshold changed to:', speechThresholdRef.current)
                }}
                style={{ marginLeft: '5px' }}
              />
              <span style={{ marginLeft: '5px' }}>{speechThresholdRef.current}dB</span>
            </label>
            <label>
              Min Duration: 
              <input 
                type="range" 
                min="200" 
                max="1500" 
                step="100"
                value={minSpeechDurationRef.current}
                onChange={(e) => {
                  minSpeechDurationRef.current = parseInt(e.target.value)
                  console.log('🎛️ Min duration changed to:', minSpeechDurationRef.current)
                }}
                style={{ marginLeft: '5px' }}
              />
              <span style={{ marginLeft: '5px' }}>{minSpeechDurationRef.current}ms</span>
            </label>
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
            💡 Try: Threshold -45dB, Duration 300ms for sensitive interruption
          </div>
        </div>
        
        <div style={{ fontSize: '12px', color: '#666' }}>
          Audio Status: {pcmAudio.isPlaying ? 'Playing' : 'Ready'}
          {/* Debug info - remove in production */}
          <br />
          PCM State: {JSON.stringify(pcmAudio.getState())}
          <br />
          Speech Detection: {speechDetected ? '🎤 Active' : '🔇 Inactive'}
        </div>
      </div>
    </div>
  )
}

export default VoiceResponse
