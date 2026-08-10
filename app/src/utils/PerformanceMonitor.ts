/**
 * Performance monitoring utility for PCM audio streaming
 */
export class PerformanceMonitor {
  private metrics: {
    [key: string]: {
      startTime: number
      endTime?: number
      duration?: number
      metadata?: any
    }
  } = {}

  private latencyMeasurements: number[] = []
  private chunkSizes: number[] = []
  private bufferUnderruns: number = 0
  private totalChunks: number = 0

  /**
   * Start measuring a performance metric
   */
  startMeasurement(key: string, metadata?: any): void {
    this.metrics[key] = {
      startTime: performance.now(),
      metadata
    }
  }

  /**
   * End measuring a performance metric
   */
  endMeasurement(key: string, metadata?: any): number {
    const metric = this.metrics[key]
    if (!metric) {
      console.warn(`No measurement started for key: ${key}`)
      return 0
    }

    const endTime = performance.now()
    const duration = endTime - metric.startTime

    metric.endTime = endTime
    metric.duration = duration
    if (metadata) {
      metric.metadata = { ...metric.metadata, ...metadata }
    }

    return duration
  }

  /**
   * Record latency measurement
   */
  recordLatency(latency: number): void {
    this.latencyMeasurements.push(latency)
    
    // Keep only last 100 measurements
    if (this.latencyMeasurements.length > 100) {
      this.latencyMeasurements.shift()
    }
  }

  /**
   * Record chunk size
   */
  recordChunkSize(size: number): void {
    this.chunkSizes.push(size)
    this.totalChunks++
    
    // Keep only last 100 measurements
    if (this.chunkSizes.length > 100) {
      this.chunkSizes.shift()
    }
  }

  /**
   * Record buffer underrun
   */
  recordBufferUnderrun(): void {
    this.bufferUnderruns++
  }

  /**
   * Get performance statistics
   */
  getStats(): {
    averageLatency: number
    minLatency: number
    maxLatency: number
    averageChunkSize: number
    totalChunks: number
    bufferUnderruns: number
    underrunRate: number
    measurements: { [key: string]: any }
  } {
    const latencies = this.latencyMeasurements
    const chunkSizes = this.chunkSizes

    return {
      averageLatency: latencies.length > 0 
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
        : 0,
      minLatency: latencies.length > 0 ? Math.min(...latencies) : 0,
      maxLatency: latencies.length > 0 ? Math.max(...latencies) : 0,
      averageChunkSize: chunkSizes.length > 0 
        ? chunkSizes.reduce((a, b) => a + b, 0) / chunkSizes.length 
        : 0,
      totalChunks: this.totalChunks,
      bufferUnderruns: this.bufferUnderruns,
      underrunRate: this.totalChunks > 0 ? (this.bufferUnderruns / this.totalChunks) * 100 : 0,
      measurements: Object.fromEntries(
        Object.entries(this.metrics).map(([key, metric]) => [
          key,
          {
            duration: metric.duration,
            metadata: metric.metadata
          }
        ])
      )
    }
  }

  /**
   * Reset all measurements
   */
  reset(): void {
    this.metrics = {}
    this.latencyMeasurements = []
    this.chunkSizes = []
    this.bufferUnderruns = 0
    this.totalChunks = 0
  }

  /**
   * Export performance data as JSON
   */
  exportData(): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      stats: this.getStats(),
      rawData: {
        latencyMeasurements: this.latencyMeasurements,
        chunkSizes: this.chunkSizes,
        metrics: this.metrics
      }
    }, null, 2)
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor()