import { useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { usePCMAudio } from '../hooks/usePCMAudio'

/**
 * Simple example component demonstrating PCM audio interrupt functionality
 */
export const InterruptExample = () => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  
  const pcmAudio = usePCMAudio(socket)

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
      console.log('AI was interrupted')
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

  const startAudio = async () => {
    if (!socket || !isConnected) return
    
    try {
      await pcmAudio.start()
      console.log('PCM audio initialized')
    } catch (error) {
      console.error('Failed to start PCM audio:', error)
    }
  }

  const testTTS = () => {
    if (!socket || !isConnected) return
    
    socket.emit('voly-intro', {
      text: "This is a test of the PCM audio streaming system. I'm speaking for a longer time to demonstrate the interrupt functionality. You should be able to interrupt me at any point by clicking the interrupt button."
    })
  }

  const interruptAI = () => {
    if (!socket || !isConnected) return
    
    socket.emit('interrupt-ai')
    pcmAudio.stopPlayback() // Use enhanced interruption method
    console.log('Sent interrupt signal with enhanced audio stop')
  }

  const testNewStream = async () => {
    if (!socket || !isConnected) return
    
    // Reinitialize audio context for fresh start
    await pcmAudio.reinitialize()
    
    socket.emit('voly-intro', {
      text: "This is a new audio stream that should start immediately after the interrupt."
    })
    console.log('Started new stream with fresh audio context')
  }

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', margin: '20px' }}>
      <h3>PCM Audio Interrupt Test</h3>
      
      <div style={{ marginBottom: '20px' }}>
        <strong>Status:</strong> {isConnected ? 'Connected' : 'Disconnected'} | 
        <strong> Audio:</strong> {isSpeaking ? 'Speaking' : 'Silent'} |
        <strong> PCM:</strong> {pcmAudio.isPlaying ? 'Playing' : 'Ready'}
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button onClick={connect} disabled={isConnected}>
          Connect
        </button>
        
        <button onClick={disconnect} disabled={!isConnected}>
          Disconnect
        </button>
        
        <button onClick={startAudio} disabled={!isConnected}>
          Initialize Audio
        </button>
        
        <button onClick={testTTS} disabled={!isConnected || isSpeaking}>
          Test Long TTS
        </button>
        
        <button 
          onClick={interruptAI} 
          disabled={!isConnected || !isSpeaking}
          style={{ backgroundColor: '#ff4444', color: 'white' }}
        >
          🛑 INTERRUPT
        </button>
        
        <button onClick={testNewStream} disabled={!isConnected}>
          New Stream
        </button>
      </div>

      <div style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>
        <strong>How to test:</strong>
        <ol>
          <li>Click "Connect" to connect to the server</li>
          <li>Click "Initialize Audio" to set up PCM audio</li>
          <li>Click "Test Long TTS" to start a long audio stream</li>
          <li>While audio is playing, click "INTERRUPT" to stop it immediately</li>
          <li>Click "New Stream" to test that new audio starts right away</li>
        </ol>
      </div>

      <div style={{ marginTop: '10px', fontSize: '10px', color: '#999' }}>
        <strong>PCM Debug:</strong>
        <pre style={{ margin: '5px 0', padding: '5px', background: '#f5f5f5', borderRadius: '3px' }}>
          {JSON.stringify(pcmAudio.getState(), null, 2)}
        </pre>
      </div>
    </div>
  )
}