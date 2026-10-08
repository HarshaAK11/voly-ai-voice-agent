import { useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useAudioInterruption } from '../hooks/useAudioInterruption'

/**
 * Example component showing how to use the enhanced interruption system
 * Demonstrates the simple API for common interruption scenarios
 */
export const InterruptionUsageExample = () => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [userInput, setUserInput] = useState('')
  
  // Use the enhanced interruption hook
  const audio = useAudioInterruption(socket)

  const connect = () => {
    if (socket) return

    const newSocket = io('http://localhost:5000', { transports: ['websocket'] })
    
    newSocket.on('connect', () => {
      setIsConnected(true)
      console.log('Connected to server')
    })

    newSocket.on('disconnect', () => {
      setIsConnected(false)
      console.log('Disconnected from server')
    })

    newSocket.on('pcm-chunk', () => {
      setIsSpeaking(true)
    })

    newSocket.on('pcm-end', () => {
      setIsSpeaking(false)
    })

    newSocket.on('ai-interrupted', () => {
      setIsSpeaking(false)
    })

    setSocket(newSocket)
  }

  const disconnect = () => {
    if (socket) {
      socket.disconnect()
      setSocket(null)
      setIsConnected(false)
      setIsSpeaking(false)
    }
  }

  // Example 1: Simple interruption
  const handleSimpleInterrupt = () => {
    audio.interruptAI()
  }

  // Example 2: Stop audio only (without server interrupt)
  const handleStopAudioOnly = () => {
    audio.stopPlayback()
  }

  // Example 3: Start new stream with fresh context
  const handleNewStream = async () => {
    const text = userInput || "This is a new audio stream with fresh context."
    await audio.startNewStream(text)
    setUserInput('')
  }

  // Example 4: Interrupt and immediately start new stream
  const handleInterruptAndRestart = async () => {
    const text = userInput || "This new message interrupts the previous one and starts immediately."
    await audio.interruptAndRestart(text)
    setUserInput('')
  }

  // Example 5: Simulate user asking new question while AI is speaking
  const simulateUserInterruption = async () => {
    const newQuestion = "Actually, let me ask something else instead."
    await audio.interruptAndRestart(newQuestion)
  }

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>🎵 Audio Interruption Usage Examples</h2>
      
      <div style={{ 
        marginBottom: '20px', 
        padding: '15px', 
        background: '#f8f9fa', 
        borderRadius: '5px',
        border: '1px solid #dee2e6'
      }}>
        <h3>Status</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
          <div><strong>Connection:</strong> {isConnected ? '✅' : '❌'}</div>
          <div><strong>Audio:</strong> {isSpeaking ? '🔊 Speaking' : '🔇 Silent'}</div>
          <div><strong>Ready:</strong> {audio.isReady ? '✅' : '❌'}</div>
          <div><strong>Playing:</strong> {audio.isPlaying ? '▶️' : '⏹️'}</div>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Setup</h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={connect} disabled={isConnected}>
            Connect
          </button>
          <button onClick={disconnect} disabled={!isConnected}>
            Disconnect
          </button>
          <button onClick={audio.start} disabled={!isConnected}>
            Initialize Audio
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Test Audio</h3>
        <button 
          onClick={() => audio.startNewStream("This is a long test message to demonstrate the interruption functionality. I will keep talking for a while so you can test the various interruption methods available in this demo.")}
          disabled={!audio.isReady || isSpeaking}
          style={{ backgroundColor: '#007bff', color: 'white', padding: '10px 15px' }}
        >
          🎤 Start Long Audio Test
        </button>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Interruption Examples</h3>
        <div style={{ display: 'grid', gap: '15px' }}>
          
          <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
            <h4>Example 1: Simple Interruption</h4>
            <p>Stops the AI response and audio immediately.</p>
            <button 
              onClick={handleSimpleInterrupt}
              disabled={!audio.isReady || !isSpeaking}
              style={{ backgroundColor: '#dc3545', color: 'white' }}
            >
              🛑 Interrupt AI
            </button>
            <pre style={{ background: '#f8f9fa', padding: '10px', marginTop: '10px', fontSize: '12px' }}>
{`// Usage:
audio.interruptAI()`}
            </pre>
          </div>

          <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
            <h4>Example 2: Stop Audio Only</h4>
            <p>Stops audio playback without interrupting server processing.</p>
            <button 
              onClick={handleStopAudioOnly}
              disabled={!audio.isReady || !isSpeaking}
              style={{ backgroundColor: '#fd7e14', color: 'white' }}
            >
              🔇 Stop Audio Only
            </button>
            <pre style={{ background: '#f8f9fa', padding: '10px', marginTop: '10px', fontSize: '12px' }}>
{`// Usage:
audio.stopPlayback()`}
            </pre>
          </div>

          <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
            <h4>Example 3: New Stream with Fresh Context</h4>
            <p>Starts a new audio stream with reinitialized audio context.</p>
            <div style={{ marginBottom: '10px' }}>
              <input 
                type="text" 
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Enter text for new stream..."
                style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
              />
              <button 
                onClick={handleNewStream}
                disabled={!audio.isReady || isSpeaking}
                style={{ backgroundColor: '#28a745', color: 'white' }}
              >
                🔄 Start New Stream
              </button>
            </div>
            <pre style={{ background: '#f8f9fa', padding: '10px', fontSize: '12px' }}>
{`// Usage:
await audio.startNewStream("Your text here")`}
            </pre>
          </div>

          <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
            <h4>Example 4: Interrupt and Restart</h4>
            <p>Interrupts current audio and immediately starts new stream.</p>
            <div style={{ marginBottom: '10px' }}>
              <button 
                onClick={handleInterruptAndRestart}
                disabled={!audio.isReady}
                style={{ backgroundColor: '#6f42c1', color: 'white' }}
              >
                ⚡ Interrupt & Restart
              </button>
            </div>
            <pre style={{ background: '#f8f9fa', padding: '10px', fontSize: '12px' }}>
{`// Usage:
await audio.interruptAndRestart("New text here")`}
            </pre>
          </div>

          <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
            <h4>Example 5: Simulate User Interruption</h4>
            <p>Simulates a user asking a new question while AI is speaking.</p>
            <button 
              onClick={simulateUserInterruption}
              disabled={!audio.isReady}
              style={{ backgroundColor: '#17a2b8', color: 'white' }}
            >
              💬 User Asks New Question
            </button>
            <pre style={{ background: '#f8f9fa', padding: '10px', marginTop: '10px', fontSize: '12px' }}>
{`// Real-world usage:
const handleUserInput = async (newQuestion) => {
  if (audio.isPlaying) {
    // User interrupted while AI was speaking
    await audio.interruptAndRestart(newQuestion)
  } else {
    // Normal new conversation
    await audio.startNewStream(newQuestion)
  }
}`}
            </pre>
          </div>
        </div>
      </div>

      <div style={{ 
        marginTop: '30px', 
        padding: '15px', 
        background: '#e7f3ff', 
        borderRadius: '5px',
        border: '1px solid #b3d9ff'
      }}>
        <h3>🎯 Key Features</h3>
        <ul>
          <li><strong>Immediate Stop:</strong> Audio stops instantly without delay</li>
          <li><strong>Buffer Clearing:</strong> All pending audio chunks are cleared</li>
          <li><strong>Fresh Context:</strong> New MediaSource/AudioContext for each stream</li>
          <li><strong>Seamless Transition:</strong> No gaps or artifacts between streams</li>
          <li><strong>Simple API:</strong> Easy-to-use methods for common scenarios</li>
        </ul>
      </div>

      <div style={{ 
        marginTop: '20px', 
        padding: '15px', 
        background: '#fff3cd', 
        borderRadius: '5px',
        border: '1px solid #ffeaa7'
      }}>
        <h3>📋 Implementation Notes</h3>
        <ul style={{ fontSize: '14px' }}>
          <li>The <code>useAudioInterruption</code> hook wraps <code>usePCMAudio</code> with enhanced methods</li>
          <li><code>stopPlayback()</code> immediately stops audio and clears buffers</li>
          <li><code>reinitialize()</code> creates a fresh AudioContext for new streams</li>
          <li><code>interruptAI()</code> combines server interrupt with audio stop</li>
          <li><code>interruptAndRestart()</code> provides seamless transition to new content</li>
        </ul>
      </div>
    </div>
  )
}