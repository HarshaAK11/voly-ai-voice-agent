import { useState, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { usePCMAudio } from '../hooks/usePCMAudio'

/**
 * Enhanced Interrupt Demo Component
 * Demonstrates the improved interruption handling with:
 * - Immediate audio stop
 * - Buffer clearing
 * - Fresh MediaSource/AudioContext initialization
 * - Seamless new stream playback
 */
export const EnhancedInterruptDemo = () => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [interruptionLog, setInterruptionLog] = useState<string[]>([])
  
  const pcmAudio = usePCMAudio(socket)
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    const logEntry = `[${timestamp}] ${message}`
    setInterruptionLog(prev => [...prev.slice(-9), logEntry]) // Keep last 10 entries
    console.log(logEntry)
  }

  const connect = () => {
    if (socket) return

    const newSocket = io('http://localhost:5000', { transports: ['websocket'] })
    
    newSocket.on('connect', () => {
      setIsConnected(true)
      addLog('✅ Connected to server')
    })

    newSocket.on('disconnect', () => {
      setIsConnected(false)
      addLog('❌ Disconnected from server')
    })

    newSocket.on('pcm-chunk', () => {
      if (!isSpeaking) {
        setIsSpeaking(true)
        addLog('🔊 Audio playback started')
      }
    })

    newSocket.on('pcm-end', () => {
      setIsSpeaking(false)
      addLog('🔇 Audio playback ended naturally')
    })

    newSocket.on('ai-interrupted', () => {
      setIsSpeaking(false)
      addLog('⚡ AI was interrupted by server')
    })

    setSocket(newSocket)
  }

  const disconnect = () => {
    if (socket) {
      socket.disconnect()
      setSocket(null)
      setIsConnected(false)
      setIsSpeaking(false)
      addLog('🔌 Disconnected')
    }
  }

  const initializeAudio = async () => {
    if (!socket || !isConnected) return
    
    try {
      await pcmAudio.start()
      addLog('🎵 PCM audio initialized')
    } catch (error) {
      addLog(`❌ Failed to initialize audio: ${error}`)
    }
  }

  const startLongSpeech = () => {
    if (!socket || !isConnected) return
    
    addLog('🎤 Starting long speech for interruption test')
    socket.emit('voly-intro', {
      text: "I'm going to speak for a very long time now to demonstrate the interruption functionality. This is a comprehensive test of the audio streaming system. You can interrupt me at any point by clicking the interrupt button, and the audio should stop immediately without any delay or leftover sound. The system should then be ready to start a new audio stream right away without any issues or audio artifacts from the previous stream."
    })
  }

  const interruptAudio = () => {
    if (!socket || !isConnected || !isSpeaking) return
    
    addLog('🛑 INTERRUPTING: Stopping current audio immediately')
    
    // Step 1: Stop server-side processing
    socket.emit('interrupt-ai')
    addLog('📡 Sent interrupt signal to server')
    
    // Step 2: Stop audio playback and clear buffers
    pcmAudio.stopPlayback()
    addLog('🔇 Stopped audio playback and cleared buffers')
    
    setIsSpeaking(false)
    addLog('✅ Interruption complete - ready for new audio')
  }

  const startNewStreamAfterInterrupt = async () => {
    if (!socket || !isConnected) return
    
    addLog('🔄 Starting new stream after interruption')
    
    // Step 1: Reinitialize audio context for fresh start
    await pcmAudio.reinitialize()
    addLog('🎵 Reinitialized audio context')
    
    // Step 2: Start new audio stream
    socket.emit('voly-intro', {
      text: "This is a brand new audio stream that should play immediately and seamlessly after the interruption. There should be no leftover audio from the previous stream."
    })
    addLog('🎤 Started new audio stream')
  }

  const testRapidInterruption = async () => {
    if (!socket || !isConnected) return
    
    addLog('⚡ Testing rapid interruption scenario')
    
    // Start first stream
    socket.emit('voly-intro', {
      text: "This is the first stream that will be interrupted quickly."
    })
    
    // Interrupt after 1 second
    setTimeout(() => {
      if (isSpeaking) {
        addLog('🛑 Rapid interrupt after 1 second')
        pcmAudio.stopPlayback()
        socket.emit('interrupt-ai')
        
        // Start new stream immediately
        setTimeout(async () => {
          await pcmAudio.reinitialize()
          socket.emit('voly-intro', {
            text: "This is the second stream starting immediately after rapid interruption."
          })
          addLog('🎤 Started second stream after rapid interrupt')
        }, 100)
      }
    }, 1000)
  }

  const clearLog = () => {
    setInterruptionLog([])
  }

  const audioState = pcmAudio.getState()

  return (
    <div style={{ padding: '20px', border: '2px solid #007acc', borderRadius: '8px', margin: '20px' }}>
      <h3>🎵 Enhanced Audio Interruption Demo</h3>
      
      <div style={{ 
        marginBottom: '20px', 
        padding: '15px', 
        background: '#f8f9fa', 
        borderRadius: '5px',
        border: '1px solid #dee2e6'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
          <div><strong>Connection:</strong> {isConnected ? '✅ Connected' : '❌ Disconnected'}</div>
          <div><strong>Audio Status:</strong> {isSpeaking ? '🔊 Speaking' : '🔇 Silent'}</div>
          <div><strong>PCM State:</strong> {pcmAudio.isPlaying ? '▶️ Playing' : '⏹️ Ready'}</div>
          <div><strong>Queue Length:</strong> {audioState?.queueLength || 0}</div>
          <div><strong>Active Sources:</strong> {audioState?.activeSourcesCount || 0}</div>
          <div><strong>Context State:</strong> {audioState?.contextState || 'N/A'}</div>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h4>🎮 Controls</h4>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={connect} disabled={isConnected} style={{ backgroundColor: '#28a745', color: 'white' }}>
            Connect
          </button>
          
          <button onClick={disconnect} disabled={!isConnected} style={{ backgroundColor: '#6c757d', color: 'white' }}>
            Disconnect
          </button>
          
          <button onClick={initializeAudio} disabled={!isConnected} style={{ backgroundColor: '#17a2b8', color: 'white' }}>
            Initialize Audio
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h4>🧪 Test Scenarios</h4>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button 
            onClick={startLongSpeech} 
            disabled={!isConnected || isSpeaking}
            style={{ backgroundColor: '#007bff', color: 'white' }}
          >
            🎤 Start Long Speech
          </button>
          
          <button 
            onClick={interruptAudio} 
            disabled={!isConnected || !isSpeaking}
            style={{ backgroundColor: '#dc3545', color: 'white', fontWeight: 'bold' }}
          >
            🛑 INTERRUPT NOW
          </button>
          
          <button 
            onClick={startNewStreamAfterInterrupt} 
            disabled={!isConnected || isSpeaking}
            style={{ backgroundColor: '#28a745', color: 'white' }}
          >
            🔄 New Stream (Fresh Context)
          </button>
          
          <button 
            onClick={testRapidInterruption} 
            disabled={!isConnected || isSpeaking}
            style={{ backgroundColor: '#fd7e14', color: 'white' }}
          >
            ⚡ Rapid Interrupt Test
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4>📋 Interruption Log</h4>
          <button onClick={clearLog} style={{ fontSize: '12px', padding: '4px 8px' }}>
            Clear Log
          </button>
        </div>
        
        <div 
          ref={logRef}
          style={{ 
            height: '200px', 
            overflowY: 'auto', 
            border: '1px solid #ddd', 
            borderRadius: '3px',
            padding: '10px',
            background: '#f8f9fa',
            fontFamily: 'monospace',
            fontSize: '12px'
          }}
        >
          {interruptionLog.length === 0 ? (
            <div style={{ color: '#6c757d', fontStyle: 'italic' }}>No events logged yet</div>
          ) : (
            interruptionLog.map((log, index) => (
              <div key={index} style={{ marginBottom: '2px' }}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#6c757d', lineHeight: '1.4' }}>
        <strong>🎯 How to test the enhanced interruption:</strong>
        <ol style={{ margin: '5px 0', paddingLeft: '20px' }}>
          <li><strong>Connect</strong> to the server and <strong>Initialize Audio</strong></li>
          <li>Click <strong>"Start Long Speech"</strong> to begin audio playback</li>
          <li>While audio is playing, click <strong>"INTERRUPT NOW"</strong> to test immediate stopping</li>
          <li>Click <strong>"New Stream (Fresh Context)"</strong> to test seamless new audio</li>
          <li>Try <strong>"Rapid Interrupt Test"</strong> for stress testing</li>
          <li>Watch the log to see the detailed interruption process</li>
        </ol>
        
        <div style={{ marginTop: '10px', padding: '8px', background: '#e7f3ff', borderRadius: '3px' }}>
          <strong>✨ Enhanced Features:</strong>
          <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
            <li><code>stopPlayback()</code> - Immediate audio stop with buffer clearing</li>
            <li><code>reinitialize()</code> - Fresh AudioContext for new streams</li>
            <li>No leftover audio chunks or artifacts</li>
            <li>Seamless transition between interrupted and new audio</li>
          </ul>
        </div>
      </div>
    </div>
  )
}