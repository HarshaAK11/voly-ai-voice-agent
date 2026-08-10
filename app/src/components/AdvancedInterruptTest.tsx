import { useState, useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { usePCMAudio } from '../hooks/usePCMAudio'

/**
 * Advanced interrupt test component with real-time metrics and multiple test scenarios
 */
export const AdvancedInterruptTest = () => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [testResults, setTestResults] = useState<Array<{
    test: string
    startTime: number
    interruptTime?: number
    resumeTime?: number
    latency?: number
  }>>([])
  
  const pcmAudio = usePCMAudio(socket)
  const currentTestRef = useRef<any>(null)

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

    newSocket.on('pcm-chunk', (chunk) => {
      setIsSpeaking(true)
      
      // Track first chunk latency for current test
      if (currentTestRef.current && !currentTestRef.current.firstChunkTime) {
        currentTestRef.current.firstChunkTime = Date.now()
        const latency = currentTestRef.current.firstChunkTime - currentTestRef.current.startTime
        console.log(`First chunk latency: ${latency}ms`)
      }
    })

    newSocket.on('pcm-end', () => {
      setIsSpeaking(false)
      
      // Complete current test
      if (currentTestRef.current) {
        const endTime = Date.now()
        const totalDuration = endTime - currentTestRef.current.startTime
        console.log(`Test completed: ${currentTestRef.current.test} - ${totalDuration}ms total`)
        currentTestRef.current = null
      }
    })

    newSocket.on('ai-interrupted', () => {
      setIsSpeaking(false)
      
      // Record interrupt time
      if (currentTestRef.current) {
        currentTestRef.current.interruptTime = Date.now()
        const interruptLatency = currentTestRef.current.interruptTime - currentTestRef.current.startTime
        console.log(`Interrupt latency: ${interruptLatency}ms`)
      }
    })

    setSocket(newSocket)
  }

  const disconnect = () => {
    if (socket) {
      socket.disconnect()
      setSocket(null)
      setIsConnected(false)
      setIsSpeaking(false)
      currentTestRef.current = null
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

  const runTest = (testName: string, text: string) => {
    if (!socket || !isConnected) return
    
    const testData = {
      test: testName,
      startTime: Date.now(),
      firstChunkTime: null
    }
    
    currentTestRef.current = testData
    
    socket.emit('voly-intro', { text })
    
    setTestResults(prev => [...prev, {
      test: testName,
      startTime: testData.startTime
    }])
  }

  const testShortResponse = () => {
    runTest('Short Response', 'Hello there!')
  }

  const testMediumResponse = () => {
    runTest('Medium Response', 'This is a medium length response to test the PCM streaming latency and interrupt capabilities.')
  }

  const testLongResponse = () => {
    runTest('Long Response', 'This is a very long response designed to test the interrupt functionality thoroughly. I will keep speaking for quite a while to give you plenty of time to test the interrupt button. The system should be able to stop me immediately when you click interrupt, regardless of how much I have left to say. This demonstrates the real-time nature of our PCM streaming system.')
  }

  const testRapidFire = () => {
    if (!socket || !isConnected) return
    
    const messages = [
      'First message',
      'Second message', 
      'Third message',
      'Fourth message',
      'Fifth message'
    ]
    
    messages.forEach((msg, index) => {
      setTimeout(() => {
        runTest(`Rapid Fire ${index + 1}`, msg)
      }, index * 1000)
    })
  }

  const interruptAI = () => {
    if (!socket || !isConnected) return
    
    socket.emit('interrupt-ai')
    pcmAudio.stopPlayback() // Use enhanced interruption method
    
    if (currentTestRef.current) {
      currentTestRef.current.interruptTime = Date.now()
    }
    
    console.log('Sent interrupt signal with enhanced audio stop')
  }

  const clearResults = () => {
    setTestResults([])
  }

  const audioState = pcmAudio.getState()

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', margin: '20px' }}>
      <h3>Advanced PCM Audio Interrupt Test</h3>
      
      <div style={{ marginBottom: '20px', padding: '10px', background: '#f0f0f0', borderRadius: '5px' }}>
        <div><strong>Connection:</strong> {isConnected ? '✅ Connected' : '❌ Disconnected'}</div>
        <div><strong>Audio Status:</strong> {isSpeaking ? '🔊 Speaking' : '🔇 Silent'}</div>
        <div><strong>PCM State:</strong> {pcmAudio.isPlaying ? '▶️ Playing' : '⏹️ Ready'}</div>
        <div><strong>Queue Length:</strong> {audioState.queueLength}</div>
        <div><strong>Active Sources:</strong> {audioState.activeSourcesCount}</div>
        <div><strong>Chunks:</strong> {audioState.chunksReceived} received, {audioState.chunksPlayed} played</div>
        <div><strong>Avg Latency:</strong> {audioState.averageLatency}ms</div>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <button onClick={connect} disabled={isConnected}>
          Connect
        </button>
        
        <button onClick={disconnect} disabled={!isConnected}>
          Disconnect
        </button>
        
        <button onClick={startAudio} disabled={!isConnected}>
          Initialize Audio
        </button>
        
        <button 
          onClick={interruptAI} 
          disabled={!isConnected || !isSpeaking}
          style={{ backgroundColor: '#ff4444', color: 'white', fontWeight: 'bold' }}
        >
          🛑 INTERRUPT
        </button>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h4>Test Scenarios</h4>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={testShortResponse} disabled={!isConnected || isSpeaking}>
            Short Response
          </button>
          
          <button onClick={testMediumResponse} disabled={!isConnected || isSpeaking}>
            Medium Response
          </button>
          
          <button onClick={testLongResponse} disabled={!isConnected || isSpeaking}>
            Long Response
          </button>
          
          <button onClick={testRapidFire} disabled={!isConnected || isSpeaking}>
            Rapid Fire Test
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4>Test Results</h4>
          <button onClick={clearResults} style={{ fontSize: '12px' }}>
            Clear Results
          </button>
        </div>
        
        <div style={{ 
          maxHeight: '200px', 
          overflowY: 'auto', 
          border: '1px solid #ddd', 
          borderRadius: '3px',
          padding: '10px',
          background: '#fafafa'
        }}>
          {testResults.length === 0 ? (
            <div style={{ color: '#666', fontStyle: 'italic' }}>No test results yet</div>
          ) : (
            testResults.map((result, index) => (
              <div key={index} style={{ 
                marginBottom: '5px', 
                fontSize: '12px',
                fontFamily: 'monospace'
              }}>
                <strong>{result.test}:</strong> Started at {new Date(result.startTime).toLocaleTimeString()}
                {result.interruptTime && (
                  <span style={{ color: '#ff6600' }}>
                    {' '}→ Interrupted after {result.interruptTime - result.startTime}ms
                  </span>
                )}
                {result.latency && (
                  <span style={{ color: '#0066ff' }}>
                    {' '}→ Latency: {result.latency}ms
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#666' }}>
        <strong>How to use:</strong>
        <ol style={{ margin: '5px 0', paddingLeft: '20px' }}>
          <li>Connect to server and initialize audio</li>
          <li>Run different test scenarios to measure performance</li>
          <li>Use the INTERRUPT button while audio is playing</li>
          <li>Monitor latency and chunk statistics</li>
          <li>Try rapid fire test to stress test the system</li>
        </ol>
      </div>
    </div>
  )
}