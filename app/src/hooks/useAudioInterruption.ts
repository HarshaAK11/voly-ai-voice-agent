import { useCallback } from 'react'
import { usePCMAudio } from './usePCMAudio'
import type { Socket } from 'socket.io-client'

/**
 * Custom hook for enhanced audio interruption handling
 * Provides a simple interface for stopping current audio and starting new streams
 */
export function useAudioInterruption(socket: Socket | null) {
  const pcmAudio = usePCMAudio(socket)

  /**
   * Stop the currently playing audio immediately
   * Clears all buffers and prepares for new audio
   */
  const stopPlayback = useCallback(() => {
    console.log('🛑 Stopping audio playback via useAudioInterruption')
    pcmAudio.stopPlayback()
  }, [pcmAudio])

  /**
   * Interrupt the current AI response and audio playback
   * Sends interrupt signal to server and stops audio immediately
   */
  const interruptAI = useCallback(() => {
    if (!socket) {
      console.warn('Cannot interrupt AI - no socket connection')
      return
    }

    console.log('🛑 Interrupting AI response and audio')
    
    // Stop server-side processing
    socket.emit('interrupt-ai')
    
    // Stop client-side audio immediately
    pcmAudio.stopPlayback()
    
    console.log('✅ AI interruption complete')
  }, [socket, pcmAudio])

  /**
   * Start a new audio stream with fresh context
   * Reinitializes the audio system for seamless playback
   */
  const startNewStream = useCallback(async (text: string) => {
    if (!socket) {
      console.warn('Cannot start new stream - no socket connection')
      return
    }

    console.log('🔄 Starting new audio stream with fresh context')
    
    try {
      // Reinitialize audio context for clean start
      await pcmAudio.reinitialize()
      console.log('🎵 Audio context reinitialized')
      
      // Send new text to be processed
      socket.emit('voly-intro', { text })
      console.log('📡 Sent new text to server:', text.substring(0, 50) + '...')
      
    } catch (error) {
      console.error('❌ Failed to start new stream:', error)
    }
  }, [socket, pcmAudio])

  /**
   * Interrupt current audio and immediately start new stream
   * Combines interruption and new stream start for seamless transition
   */
  const interruptAndRestart = useCallback(async (newText: string) => {
    if (!socket) {
      console.warn('Cannot interrupt and restart - no socket connection')
      return
    }

    console.log('⚡ Interrupting current audio and starting new stream')
    
    // First interrupt current audio
    socket.emit('interrupt-ai')
    pcmAudio.stopPlayback()
    
    // Small delay to ensure interruption is processed
    setTimeout(async () => {
      await startNewStream(newText)
    }, 100)
    
  }, [socket, pcmAudio, startNewStream])

  return {
    // Audio control
    ...pcmAudio,
    
    // Enhanced interruption methods
    stopPlayback,
    interruptAI,
    startNewStream,
    interruptAndRestart,
    
    // Utility methods
    isReady: Boolean(socket && pcmAudio),
  }
}