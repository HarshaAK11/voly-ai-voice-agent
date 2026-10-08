import { useRef, useCallback, useEffect } from 'react'
import { AudioQueue } from '../utils/AudioQueue'
import type { Socket } from 'socket.io-client'

interface PCMChunkMetadata {
  sampleRate: number
  channels: number
  chunkIndex?: number
  timestamp?: number
}

interface UsePCMAudioReturn {
  isPlaying: boolean
  start: () => Promise<void>
  stop: () => void
  stopPlayback: () => void
  reinitialize: () => Promise<void>
  setVolume: (volume: number) => void
  getState: () => any
}

/**
 * React hook for PCM audio streaming with Web Audio API
 * Handles real-time PCM audio playback with interrupt support
 */
export function usePCMAudio(socket: Socket | null): UsePCMAudioReturn {
  const audioQueueRef = useRef<AudioQueue | null>(null)
  const isPlayingRef = useRef<boolean>(false)
  const initializingRef = useRef<boolean>(false)

  // Initialize AudioQueue
  const initializeAudioQueue = useCallback(async () => {
    if (audioQueueRef.current || initializingRef.current) return
    
    initializingRef.current = true
    try {
      const audioQueue = new AudioQueue(24000, 1)
      await audioQueue.initialize()
      audioQueueRef.current = audioQueue
      console.log('PCM AudioQueue initialized')
    } catch (error) {
      console.error('Failed to initialize PCM AudioQueue:', error)
    } finally {
      initializingRef.current = false
    }
  }, [])

  // Handle PCM chunk from server
  const handlePCMChunk = useCallback((payload: ArrayBuffer | Uint8Array, chunk: PCMChunkMetadata) => {
    const audioQueue = audioQueueRef.current
    if (!audioQueue) {
      console.warn('AudioQueue not ready for PCM chunk')
      return
    }

    try {
      // Socket.IO transports the server Buffer as binary, avoiding JSON
      // serialization/deserialization of every individual sample.
      const bytes = payload instanceof ArrayBuffer
        ? new Uint8Array(payload)
        : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
      const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
      const pcmData = new Float32Array(samples.length)
      for (let i = 0; i < samples.length; i += 1) {
        pcmData[i] = samples[i] / 32768
      }
      audioQueue.enqueuePCMData(pcmData, {
        chunkIndex: chunk.chunkIndex,
        timestamp: chunk.timestamp
      })
      
      if (!isPlayingRef.current) {
        isPlayingRef.current = true
      }
    } catch (error) {
      console.error('Error handling PCM chunk:', error)
    }
  }, [])

  // Handle PCM stream end
  const handlePCMEnd = useCallback(() => {
    console.log('PCM stream ended')
    // Don't stop immediately - let queued audio finish playing
    setTimeout(() => {
      isPlayingRef.current = false
    }, 500) // Small delay to let final chunks play
  }, [])

  // Setup socket event listeners
  useEffect(() => {
    if (!socket) return

    socket.on('pcm-chunk', handlePCMChunk)
    socket.on('pcm-end', handlePCMEnd)

    return () => {
      socket.off('pcm-chunk', handlePCMChunk)
      socket.off('pcm-end', handlePCMEnd)
    }
  }, [socket, handlePCMChunk, handlePCMEnd])

  // Start audio playback
  const start = useCallback(async () => {
    try {
      if (!audioQueueRef.current) {
        await initializeAudioQueue()
      }
      
      if (audioQueueRef.current) {
        await audioQueueRef.current.start()
        console.log('PCM audio playback started')
      }
    } catch (error) {
      console.error('Failed to start PCM audio:', error)
    }
  }, [initializeAudioQueue])

  // Stop audio playback immediately
  const stop = useCallback(() => {
    const audioQueue = audioQueueRef.current
    if (audioQueue) {
      audioQueue.stop()
      isPlayingRef.current = false
      console.log('PCM audio playback stopped')
    }
  }, [])

  // Stop playback with enhanced interruption handling
  const stopPlayback = useCallback(() => {
    const audioQueue = audioQueueRef.current
    if (audioQueue) {
      audioQueue.stopPlayback()
      isPlayingRef.current = false
      console.log('PCM audio playback interrupted')
    }
  }, [])

  // Reinitialize audio context for fresh start
  const reinitialize = useCallback(async () => {
    const audioQueue = audioQueueRef.current
    if (audioQueue) {
      await audioQueue.reinitialize()
      isPlayingRef.current = false
      console.log('PCM audio context reinitialized')
    } else {
      // If no audio queue exists, create a new one
      await initializeAudioQueue()
    }
  }, [initializeAudioQueue])

  // Set volume
  const setVolume = useCallback((volume: number) => {
    const audioQueue = audioQueueRef.current
    if (audioQueue) {
      audioQueue.setVolume(volume)
    }
  }, [])

  // Get playback state
  const getState = useCallback(() => {
    const audioQueue = audioQueueRef.current
    return audioQueue ? audioQueue.getState() : null
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const audioQueue = audioQueueRef.current
      if (audioQueue) {
        audioQueue.destroy()
        audioQueueRef.current = null
      }
    }
  }, [])

  return {
    isPlaying: isPlayingRef.current,
    start,
    stop,
    stopPlayback,
    reinitialize,
    setVolume,
    getState
  }
}
