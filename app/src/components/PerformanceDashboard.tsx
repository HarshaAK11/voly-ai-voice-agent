import { useState, useEffect } from 'react'
import { io, type Socket } from 'socket.io-client'
import { usePCMAudio } from '../hooks/usePCMAudio'
import { performanceMonitor } from '../utils/PerformanceMonitor'

/**
 * Comprehensive performance dashboard for PCM audio streaming
 */
export const PerformanceDashboard = () => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [performanceStats, setPerformanceStats] = useState<any>({})
  const [autoRefresh, setAutoRefresh] = useState(true)
  
  const pcmAudio = usePCMAudio(socket)

  // Update performance stats periodically
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      setPerformanceStats(performanceMonitor.getStats())
    }, 1000)

    return () => clearInterval(interval)
  }, [autoRefresh])

  const connect = () => {
    if (socket) return

    const newSocket = io('http://localhost:5000', { transports: ['websocket'] })
    
    newSocket.on('connect', () => {
      setIsConnected(true)
      console.log('Connected to server')
      performanceMonitor.reset()
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
      console.log('AI processing interrupted')
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

  const runPerformanceTest = (testName: string, text: string) => {
    if (!socket || !isConnected) return
    
    performanceMonitor.startMeasurement(`test-${testName}`, { testName, text })
    socket.emit('voly-intro', { text })
  }

  const interruptAI = () => {
    if (!socket || !isConnected) return
    
    performanceMonitor.startMeasurement('interrupt-response')
    socket.emit('interrupt-ai')
    pcmAudio.stop()
    performanceMonitor.endMeasurement('interrupt-response')
  }

  const resetStats = () => {
    performanceMonitor.reset()
    setPerformanceStats({})
  }

  const exportData = () => {
    const data = performanceMonitor.exportData()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pcm-performance-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const audioState = pcmAudio.getState()

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h2>PCM Audio Performance Dashboard</h2>
      
      {/* Connection Controls */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
        <h3>Connection & Controls</h3>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <button onClick={connect} disabled={isConnected}>Connect</button>
          <button onClick={disconnect} disabled={!isConnected}>Disconnect</button>
          <button onClick={startAudio} disabled={!isConnected}>Initialize Audio</button>
          <button onClick={interruptAI} disabled={!isConnected || !isSpeaking} 
                  style={{ backgroundColor: '#ff4444', color: 'white' }}>
            🛑 INTERRUPT
          </button>
        </div>
        <div>
          <strong>Status:</strong> {isConnected ? '✅ Connected' : '❌ Disconnected'} | 
          <strong> Audio:</strong> {isSpeaking ? '🔊 Speaking' : '🔇 Silent'} |
          <strong> PCM:</strong> {pcmAudio.isPlaying ? '▶️ Playing' : '⏹️ Ready'}
        </div>
      </div>

      {/* Performance Tests */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
        <h3>Performance Tests</h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={() => runPerformanceTest('latency', 'Quick test')} 
                  disabled={!isConnected || isSpeaking}>
            Latency Test
          </button>
          <button onClick={() => runPerformanceTest('throughput', 'This is a longer message to test throughput and streaming performance of the PCM audio system.')} 
                  disabled={!isConnected || isSpeaking}>
            Throughput Test
          </button>
          <button onClick={() => runPerformanceTest('stress', 'This is a very long stress test message designed to push the PCM streaming system to its limits. We will generate a lot of audio data and measure how well the system handles the load. The goal is to identify any bottlenecks or performance issues that might occur under heavy usage.')} 
                  disabled={!isConnected || isSpeaking}>
            Stress Test
          </button>
        </div>
      </div>

      {/* Real-time Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        
        {/* Audio Queue Metrics */}
        <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
          <h3>Audio Queue Metrics</h3>
          <div style={{ fontSize: '14px' }}>
            <div><strong>Queue Length:</strong> {audioState.queueLength}</div>
            <div><strong>Active Sources:</strong> {audioState.activeSourcesCount}</div>
            <div><strong>Chunks Received:</strong> {audioState.chunksReceived}</div>
            <div><strong>Chunks Played:</strong> {audioState.chunksPlayed}</div>
            <div><strong>Context State:</strong> {audioState.contextState}</div>
            <div><strong>Current Latency:</strong> {audioState.averageLatency}ms</div>
          </div>
        </div>

        {/* Performance Statistics */}
        <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
          <h3>Performance Statistics</h3>
          <div style={{ fontSize: '14px' }}>
            <div><strong>Avg Latency:</strong> {Math.round(performanceStats.averageLatency || 0)}ms</div>
            <div><strong>Min Latency:</strong> {Math.round(performanceStats.minLatency || 0)}ms</div>
            <div><strong>Max Latency:</strong> {Math.round(performanceStats.maxLatency || 0)}ms</div>
            <div><strong>Avg Chunk Size:</strong> {Math.round(performanceStats.averageChunkSize || 0)} samples</div>
            <div><strong>Total Chunks:</strong> {performanceStats.totalChunks || 0}</div>
            <div><strong>Buffer Underruns:</strong> {performanceStats.bufferUnderruns || 0}</div>
            <div><strong>Underrun Rate:</strong> {(performanceStats.underrunRate || 0).toFixed(2)}%</div>
          </div>
        </div>
      </div>

      {/* Detailed Measurements */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h3>Detailed Measurements</h3>
          <div>
            <label style={{ marginRight: '10px' }}>
              <input 
                type="checkbox" 
                checked={autoRefresh} 
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto Refresh
            </label>
            <button onClick={resetStats} style={{ marginRight: '10px' }}>Reset</button>
            <button onClick={exportData}>Export Data</button>
          </div>
        </div>
        
        <div style={{ 
          maxHeight: '300px', 
          overflowY: 'auto', 
          background: '#f8f8f8', 
          padding: '10px',
          borderRadius: '3px'
        }}>
          <pre style={{ margin: 0, fontSize: '12px' }}>
            {JSON.stringify(performanceStats.measurements || {}, null, 2)}
          </pre>
        </div>
      </div>

      {/* Latency Chart (Simple Text-based) */}
      <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
        <h3>Latency Trend (Last 20 measurements)</h3>
        <div style={{ 
          fontFamily: 'monospace', 
          fontSize: '12px', 
          background: '#f8f8f8', 
          padding: '10px',
          borderRadius: '3px',
          overflowX: 'auto'
        }}>
          {/* Simple ASCII chart would go here - for now just show raw data */}
          <div>Recent latencies: {JSON.stringify(audioState.averageLatency)}</div>
        </div>
      </div>

      <div style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>
        <strong>Tips:</strong>
        <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
          <li>Lower latency values indicate better performance</li>
          <li>Buffer underruns indicate audio dropouts</li>
          <li>Monitor queue length to detect buffering issues</li>
          <li>Use interrupt test to measure response time</li>
          <li>Export data for detailed analysis</li>
        </ul>
      </div>
    </div>
  )
}