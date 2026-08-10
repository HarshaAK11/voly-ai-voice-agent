import { performanceMonitor } from './PerformanceMonitor'

/**
 * AudioQueue - Web Audio API based PCM audio playback with interrupt support
 * Replaces MediaSource/SourceBuffer for low-latency audio streaming
 */
export class AudioQueue {
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private sampleRate: number = 24000
  private channels: number = 1
  private isPlaying: boolean = false
  private audioSources: AudioBufferSourceNode[] = []
  private nextStartTime: number = 0
  private bufferQueue: Float32Array[] = []
  private isProcessing: boolean = false
  private readonly bufferDuration: number = 0.1 // 100ms buffers for low latency
  private totalChunksReceived: number = 0
  private totalChunksPlayed: number = 0
  private firstChunkTime: number = 0
  private latencyMeasurements: number[] = []

  constructor(sampleRate: number = 24000, channels: number = 1) {
    this.sampleRate = sampleRate
    this.channels = channels
  }

  /**
   * Initialize the audio context and gain node
   */
  async initialize(): Promise<void> {
    if (this.audioContext) return

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      
      // Resume context if suspended (required by some browsers)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain()
      this.gainNode.connect(this.audioContext.destination)
      this.gainNode.gain.value = 1.0

      console.log('AudioQueue initialized:', {
        sampleRate: this.audioContext.sampleRate,
        state: this.audioContext.state
      })
    } catch (error) {
      console.error('Failed to initialize AudioQueue:', error)
      throw error
    }
  }

  /**
   * Start the audio queue (alias for initialize for compatibility)
   */
  async start(): Promise<void> {
    await this.initialize()
    
    // Resume context if suspended
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
      console.log('AudioContext resumed')
    }
  }

  /**
   * Add PCM data to the playback queue
   */
  enqueuePCMData(pcmData: Float32Array, chunkInfo?: { chunkIndex?: number, timestamp?: number }): void {
    if (!this.audioContext || !this.gainNode) {
      console.error('AudioQueue not initialized - call initialize() first')
      return
    }

    if (this.audioContext.state === 'closed') {
      console.error('AudioContext is closed')
      return
    }

    this.totalChunksReceived++
    
    // Track first chunk for latency measurement
    if (this.totalChunksReceived === 1) {
      this.firstChunkTime = Date.now()
      performanceMonitor.startMeasurement('first-chunk-to-play')
    }

    // Measure latency if chunk info is provided
    if (chunkInfo?.timestamp !== undefined) {
      const latency = Date.now() - (this.firstChunkTime + chunkInfo.timestamp)
      this.latencyMeasurements.push(latency)
      performanceMonitor.recordLatency(latency)
      
      // Keep only last 10 measurements
      if (this.latencyMeasurements.length > 10) {
        this.latencyMeasurements.shift()
      }
    }

    // Record chunk size for performance monitoring
    performanceMonitor.recordChunkSize(pcmData.length)

    this.bufferQueue.push(pcmData)
    this.processQueue()
  }

  /**
   * Process the buffer queue and schedule audio playback
   */
  private processQueue(): void {
    if (this.isProcessing || !this.audioContext || !this.gainNode) return
    if (this.bufferQueue.length === 0) return

    this.isProcessing = true

    try {
      // Combine multiple small chunks into larger buffers for efficiency
      const targetSamples = Math.floor(this.sampleRate * this.bufferDuration)
      let combinedData: Float32Array | null = null
      let totalSamples = 0

      // Collect enough data for a buffer
      while (this.bufferQueue.length > 0 && totalSamples < targetSamples) {
        const chunk = this.bufferQueue.shift()!
        
        if (!combinedData) {
          combinedData = new Float32Array(chunk)
          totalSamples = chunk.length
        } else {
          // Combine with existing data
          const newData = new Float32Array(totalSamples + chunk.length)
          newData.set(combinedData)
          newData.set(chunk, totalSamples)
          combinedData = newData
          totalSamples += chunk.length
        }
      }

      if (combinedData && totalSamples > 0) {
        this.scheduleAudioBuffer(combinedData)
      }
    } catch (error) {
      console.error('Error processing audio queue:', error)
    } finally {
      this.isProcessing = false
      
      // Continue processing if more data available
      if (this.bufferQueue.length > 0) {
        setTimeout(() => this.processQueue(), 0)
      }
    }
  }

  /**
   * Schedule an audio buffer for playback
   */
  private scheduleAudioBuffer(pcmData: Float32Array): void {
    if (!this.audioContext || !this.gainNode) {
      console.error('AudioContext or GainNode not available in scheduleAudioBuffer')
      return
    }

    if (this.audioContext.state === 'closed') {
      console.error('AudioContext is closed in scheduleAudioBuffer')
      return
    }

    try {
      // Verify AudioContext methods exist
      if (typeof this.audioContext.createBuffer !== 'function') {
        console.error('createBuffer is not a function')
        return
      }
      
      if (typeof this.audioContext.createBufferSource !== 'function') {
        console.error('createBufferSource is not a function')
        return
      }

      // Create audio buffer
      const audioBuffer = this.audioContext.createBuffer(
        this.channels,
        pcmData.length,
        this.sampleRate
      )

      // Copy PCM data to audio buffer
      audioBuffer.getChannelData(0).set(pcmData)

      // Create source node - use createBufferSource instead of createBufferSourceNode
      console.log('🎵 Creating audio buffer source using createBufferSource()')
      const source = this.audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.gainNode)
      console.log('🎵 Audio buffer source created and connected successfully')

      // Calculate when to start this buffer
      const currentTime = this.audioContext.currentTime
      const startTime = Math.max(currentTime, this.nextStartTime)
      
      // Schedule playback
      source.start(startTime)
      
      // Update next start time
      this.nextStartTime = startTime + audioBuffer.duration

      // Track source for cleanup
      this.audioSources.push(source)

      // Clean up finished sources
      source.onended = () => {
        const index = this.audioSources.indexOf(source)
        if (index > -1) {
          this.audioSources.splice(index, 1)
        }
        this.totalChunksPlayed++
      }

      if (!this.isPlaying) {
        this.isPlaying = true
        console.log('AudioQueue playback started')
        
        // End first chunk measurement
        if (this.totalChunksPlayed === 0) {
          performanceMonitor.endMeasurement('first-chunk-to-play')
        }
      }

    } catch (error) {
      console.error('Error scheduling audio buffer:', error)
    }
  }

  /**
   * Stop all audio playback immediately and clear queue
   */
  stop(): void {
    console.log(`AudioQueue stopping playback - played ${this.totalChunksPlayed}/${this.totalChunksReceived} chunks`)
    
    // Stop all active audio sources immediately
    this.audioSources.forEach(source => {
      try {
        source.stop(0) // Stop immediately, not at scheduled time
        source.disconnect() // Disconnect to prevent any residual audio
      } catch (e) {
        // Source might already be stopped
      }
    })
    this.audioSources = []

    // Clear buffer queue completely
    this.bufferQueue = []
    
    // Reset timing to current time to prevent gaps
    if (this.audioContext) {
      this.nextStartTime = this.audioContext.currentTime
    }
    
    this.isPlaying = false
    this.isProcessing = false
    
    // Reset counters for next stream
    this.totalChunksReceived = 0
    this.totalChunksPlayed = 0
    this.firstChunkTime = 0
    this.latencyMeasurements = []
    
    console.log('AudioQueue completely stopped and cleared for new stream')
  }

  /**
   * Enhanced stop function specifically for interruptions
   * Ensures complete cleanup and immediate preparation for new audio
   */
  stopPlayback(): void {
    console.log('🛑 Interrupting audio playback - immediate stop')
    
    // Force stop all audio sources with immediate effect
    this.audioSources.forEach((source, index) => {
      try {
        // Stop immediately without waiting for scheduled end
        source.stop(0)
        source.disconnect()
        console.log(`Stopped audio source ${index}`)
      } catch (e) {
        console.warn(`Failed to stop audio source ${index}:`, e)
      }
    })
    this.audioSources = []

    // Clear all pending audio data
    this.bufferQueue = []
    console.log('Cleared audio buffer queue')
    
    // Reset all timing to current context time
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.nextStartTime = this.audioContext.currentTime
      console.log(`Reset next start time to ${this.nextStartTime}`)
    }
    
    // Reset all state flags
    this.isPlaying = false
    this.isProcessing = false
    
    // Clear performance metrics for fresh start
    this.totalChunksReceived = 0
    this.totalChunksPlayed = 0
    this.firstChunkTime = 0
    this.latencyMeasurements = []
    
    console.log('✅ Audio playback completely interrupted and ready for new stream')
  }

  /**
   * Reinitialize the audio context for a fresh start
   * Useful when starting a completely new audio stream after interruption
   */
  async reinitialize(): Promise<void> {
    console.log('🔄 Reinitializing AudioQueue for new stream')
    
    // First stop everything
    this.stopPlayback()
    
    // Close existing context if it exists
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close()
        console.log('Closed previous AudioContext')
      } catch (e) {
        console.warn('Failed to close AudioContext:', e)
      }
    }
    
    // Reset references
    this.audioContext = null
    this.gainNode = null
    
    // Initialize fresh context
    await this.initialize()
    
    console.log('✅ AudioQueue reinitialized with fresh context')
  }

  /**
   * Set playback volume (0.0 to 1.0)
   */
  setVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, volume))
    }
  }

  /**
   * Get current playback state
   */
  getState(): {
    isPlaying: boolean
    queueLength: number
    activeSourcesCount: number
    contextState: string | null
    chunksReceived: number
    chunksPlayed: number
    averageLatency: number
  } {
    const avgLatency = this.latencyMeasurements.length > 0 
      ? this.latencyMeasurements.reduce((a, b) => a + b, 0) / this.latencyMeasurements.length 
      : 0

    return {
      isPlaying: this.isPlaying,
      queueLength: this.bufferQueue.length,
      activeSourcesCount: this.audioSources.length,
      contextState: this.audioContext?.state || null,
      chunksReceived: this.totalChunksReceived,
      chunksPlayed: this.totalChunksPlayed,
      averageLatency: Math.round(avgLatency)
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop()
    
    if (this.gainNode) {
      this.gainNode.disconnect()
      this.gainNode = null
    }

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }
}