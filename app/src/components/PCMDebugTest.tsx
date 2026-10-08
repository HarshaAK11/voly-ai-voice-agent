import { useState, useEffect } from 'react'
import { io, type Socket } from 'socket.io-client'
import { AudioQueue } from '../utils/AudioQueue'

/**
 * Simple PCM debug test to isolate the audio issue
 */
export const PCMDebugTest = () => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [audioQueue, setAudioQueue] = useState<AudioQueue | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs(prev => [...prev.slice(-20), `[${timestamp}] ${message}`])
    console.log(`[PCM Debug] ${message}`)
  }

  const connect = () => {
    if (socket) return

    addLog('Connecting to server...')
    const newSocket = io('http://localhost:5000', { transports: ['websocket'] })
    
    newSocket.on('connect', () => {
      setIsConnected(true)
      addLog('✅ Connected to server')
    })

    newSocket.on('disconnect', () => {
      setIsConnected(false)
      addLog('❌ Disconnected from server')
    })

    newSocket.on('pcm-chunk', (chunk) => {
      addLog(`📦 Received PCM chunk: ${chunk.data?.length || 0} samples, ${chunk.sampleRate}Hz`)
      
      if (audioQueue) {
        try {
          const pcmData = new Float32Array(chunk.data)
          audioQueue.enqueuePCMData(pcmData, {
            chunkIndex: chunk.chunkIndex,
            timestamp: chunk.timestamp
          })
          addLog(`🎵 Enqueued PCM data successfully`)
        } catch (error) {
          addLog(`❌ Error enqueuing PCM data: ${error}`)
        }
      } else {
        addLog('⚠️ AudioQueue not initialized')
      }
    })

    newSocket.on('pcm-end', (info) => {
      addLog(`🏁 PCM stream ended: ${info?.chunkCount || 0} chunks, ${info?.duration || 0}ms`)
    })

    newSocket.on('error', (error) => {
      addLog(`❌ Socket error: ${error}`)
    })

    setSocket(newSocket)
  }

  const disconnect = () => {
    if (socket) {
      socket.disconnect()
      setSocket(null)
      setIsConnected(false)
      addLog('Disconnected')
    }
  }

  const initializeAudio = async () => {
    try {
      addLog('Initializing AudioQueue...')
      const queue = new AudioQueue(24000, 1)
      await queue.initialize()
      setAudioQueue(queue)
      addLog('✅ AudioQueue initialized successfully')
      
      // Log audio context details
      const state = queue.getState()
      addLog(`Audio Context State: ${state.contextState}`)
    } catch (error) {
      addLog(`❌ Failed to initialize AudioQueue: ${error}`)
    }
  }

  const testTTS = () => {
    if (!socket || !isConnected) {
      addLog('⚠️ Not connected to server')
      return
    }
    
    if (!audioQueue) {
      addLog('⚠️ AudioQueue not initialized')
      return
    }

    addLog('🎤 Requesting TTS...')
    socket.emit('voly-intro', {
      text: 'This is a test message to debug PCM audio streaming.'
    })
  }

  const clearLogs = () => {
    setLogs([])
  }

  const getAudioState = () => {
    return audioQueue ? audioQueue.getState() : null
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h2>PCM Audio Debug Test</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <button onClick={connect} disabled={isConnected}>
            Connect
          </button>
          <button onClick={disconnect} disabled={!isConnected}>
            Disconnect
          </button>
          <button onClick={initializeAudio} disabled={!!audioQueue}>
            Initialize Audio
          </button>
          <button onClick={testTTS} disabled={!isConnected || !audioQueue}>
            Test TTS
          </button>
          <button onClick={clearLogs}>
            Clear Logs
          </button>
        </div>
        
        <div style={{ fontSize: '14px' }}>
          <strong>Status:</strong> {isConnected ? '✅ Connected' : '❌ Disconnected'} | 
          <strong> Audio:</strong> {audioQueue ? '✅ Ready' : '❌ Not Ready'}
        </div>
      </div>

      {audioQueue && (
        <div style={{ marginBottom: '20px', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }}>
          <h3>Audio State</h3>
          <pre style={{ fontSize: '12px', margin: 0 }}>
            {JSON.stringify(getAudioState(), null, 2)}
          </pre>
        </div>
      )}

      <div style={{ marginBottom: '20px' }}>
        <h3>Debug Logs</h3>
        <div style={{ 
          height: '300px', 
          overflowY: 'auto', 
          border: '1px solid #ddd', 
          padding: '10px',
          background: '#f8f8f8',
          fontSize: '12px'
        }}>
          {logs.length === 0 ? (
            <div style={{ color: '#666' }}>No logs yet...</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} style={{ marginBottom: '2px' }}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#666' }}>
        <strong>Instructions:</strong>
        <ol style={{ margin: '5px 0', paddingLeft: '20px' }}>
          <li>Click "Connect" to connect to the server</li>
          <li>Click "Initialize Audio" to set up the AudioQueue</li>
          <li>Click "Test TTS" to request audio from the server</li>
          <li>Watch the logs for detailed debugging information</li>
        </ol>
      </div>
    </div>
  )
}