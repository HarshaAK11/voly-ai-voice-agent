import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from '@ffmpeg-installer/ffmpeg'
import { PassThrough, Readable } from 'stream'
import { ReadableStream } from 'stream/web'
import { createReadStream } from 'fs'

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath.path)

/**
 * PCM Streaming Service
 * Converts MP3/Opus audio streams to PCM chunks for Web Audio API
 */
export class PCMStreamer {
  constructor(socket, sampleRate = 24000, channels = 1) {
    this.socket = socket
    this.sampleRate = sampleRate
    this.channels = channels
    this.isStreaming = false
    this.ffmpegProcess = null
    this.inputStream = null
    this.outputStream = null
    this.chunkCount = 0
    this.startTime = null
    this.abortController = null
  }

  /**
   * Start PCM streaming from MP3 input
   * @param {ReadableStream} mp3Stream - The MP3 audio stream (Web ReadableStream)
   * @param {AbortSignal} signal - Optional abort signal for cancellation
   */
  async startPCMStream(mp3Stream, signal = null) {
    if (this.isStreaming) {
      this.stopStream()
    }

    this.isStreaming = true
    this.startTime = Date.now()
    this.chunkCount = 0
    this.abortController = new AbortController()
    this.inputStream = new PassThrough()
    this.outputStream = new PassThrough()

    // Handle external abort signal
    if (signal) {
      signal.addEventListener('abort', () => {
        this.stopStream()
      })
    }

    // Setup ffmpeg to convert MP3 to PCM
    this.ffmpegProcess = ffmpeg()
      .input(this.inputStream)
      .inputFormat('mp3')
      .audioFrequency(this.sampleRate)
      .audioChannels(this.channels)
      .audioCodec('pcm_f32le') // 32-bit float PCM (Web Audio API format)
      .format('f32le')
      .on('start', (commandLine) => {
        console.log('FFmpeg started:', commandLine)
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err)
        this.cleanup()
      })
      .on('end', () => {
        console.log('FFmpeg processing finished')
        this.cleanup()
      })

    // Pipe ffmpeg output to our output stream
    this.ffmpegProcess.pipe(this.outputStream, { end: false })

    // Handle PCM output chunks
    this.outputStream.on('data', (chunk) => {
      if (this.isStreaming && this.socket.connected) {
        try {
          // Convert Buffer to Float32Array for Web Audio API
          const float32Array = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.length / 4)
          
          this.chunkCount++
          
          // Emit PCM chunk to frontend
          this.socket.emit('pcm-chunk', {
            data: Array.from(float32Array), // Convert to regular array for JSON serialization
            sampleRate: this.sampleRate,
            channels: this.channels,
            chunkIndex: this.chunkCount,
            timestamp: Date.now() - this.startTime
          })
          
          // Log first chunk for debugging
          if (this.chunkCount === 1) {
            console.log(`First PCM chunk sent: ${float32Array.length} samples, ${this.sampleRate}Hz`)
          }
        } catch (error) {
          console.error('Error processing PCM chunk:', error)
        }
      }
    })

    this.outputStream.on('end', () => {
      if (this.isStreaming) {
        const duration = this.startTime ? Date.now() - this.startTime : 0
        console.log(`PCM stream ended: ${this.chunkCount} chunks, ${duration}ms duration`)
        this.socket.emit('pcm-end', {
          chunkCount: this.chunkCount,
          duration: duration
        })
      }
      this.cleanup()
    })

    // Pipe MP3 stream (Web ReadableStream) to ffmpeg input
    const reader = mp3Stream.getReader()
    this.pumpMP3Data(reader)
  }

  /**
   * Pump MP3 data from ReadableStream to ffmpeg input
   */
  async pumpMP3Data(reader) {
    try {
      while (this.isStreaming) {
        const { done, value } = await reader.read()
        
        if (done) {
          this.inputStream.end()
          break
        }

        if (this.isStreaming && this.inputStream.writable) {
          this.inputStream.write(Buffer.from(value))
        }
      }
    } catch (error) {
      console.error('Error pumping MP3 data:', error)
      this.cleanup()
    } finally {
      try {
        reader.releaseLock()
      } catch (e) {
        // Reader might already be released
      }
    }
  }

  /**
   * Stop the PCM stream immediately
   */
  stopStream() {
    this.isStreaming = false
    this.cleanup()
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.isStreaming = false

    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.kill('SIGKILL')
      } catch (e) {
        // Process might already be dead
      }
      this.ffmpegProcess = null
    }

    if (this.inputStream) {
      try {
        this.inputStream.destroy()
      } catch (e) {}
      this.inputStream = null
    }

    if (this.outputStream) {
      try {
        this.outputStream.destroy()
      } catch (e) {}
      this.outputStream = null
    }
  }
}

/**
 * Create a Web ReadableStream from a Buffer
 */
function bufferToWebReadableStream(buffer, chunkSize = 32 * 1024) {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= buffer.length) {
        controller.close()
        return
      }
      const end = Math.min(offset + chunkSize, buffer.length)
      controller.enqueue(buffer.subarray(offset, end))
      offset = end
    }
  })
}

/**
 * Stream TTS as PCM chunks using ElevenLabs
 * @param {Socket} socket - Socket.IO socket
 * @param {string} text - Text to convert to speech
 * @param {AbortSignal} signal - Abort signal for cancellation
 */
export async function streamTTSAsPCM(socket, text, signal) {
  console.log('🎤 Starting TTS PCM stream for text (ElevenLabs):', text.substring(0, 50) + '...')

  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_VOICE_ID
  
  console.log('🔑 API Key present:', !!apiKey)
  console.log('🎵 Voice ID present:', !!voiceId)
  
  if (!apiKey || !voiceId) {
    console.error('❌ Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID')
    socket.emit('error', 'Missing ElevenLabs credentials')
    return
  }

  // Ask for the exact PCM format used by the browser. This removes MP3
  // encoding, FFmpeg decoding/resampling, and JSON number-array payloads.
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=4&output_format=pcm_24000`

  const body = {
    model_id: 'eleven_flash_v2_5',
    text,
    voice_settings: {
      stability: 0.4,
      similarity_boost: 0.7,
      style: 0.2,
      use_speaker_boost: true
    }
  }

  try {
    console.log('📡 Making request to ElevenLabs:', url)
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal
    })

    console.log('📡 ElevenLabs response status:', res.status)

    if (!res.ok || !res.body) {
      console.error('❌ ElevenLabs streaming error status:', res.status)
      const errorText = await res.text().catch(() => 'Unable to read error')
      console.error('❌ ElevenLabs error response:', errorText)
      socket.emit('error', `ElevenLabs API error: ${res.status}`)
      return
    }

    // Forward binary PCM immediately. Do not await the pump: the next
    // sentence can be requested while this one is already playing.
    void streamPCMToSocket(socket, res.body, signal)
    if (res.body) return

    // Legacy MP3/FFmpeg path (unreachable; retained temporarily for rollback).
    console.log('🔄 Creating PCM streamer...')
    const pcmStreamer = new PCMStreamer(socket, 24000, 1)

    if (signal) {
      signal.addEventListener('abort', () => {
        console.log('🛑 Abort signal received, stopping PCM stream')
        pcmStreamer.stopStream()
      })
    }

    // Start PCM streaming
    console.log('🎵 Starting PCM stream conversion...')
    await pcmStreamer.startPCMStream(res.body, signal)
    console.log('✅ PCM stream completed (ElevenLabs)')

  } catch (error) {
    if (error?.name === 'AbortError') {
      console.log('🛑 TTS PCM request aborted')
      return
    }

    console.error('❌ TTS PCM stream error (ElevenLabs):', error)
    socket.emit('error', 'TTS PCM stream failed')
  }
}

/** Forward ElevenLabs pcm_24000 bytes as Socket.IO binary frames. */
async function streamPCMToSocket(socket, pcmStream, signal) {
  const reader = pcmStream.getReader()
  let remainder = Buffer.alloc(0)
  let chunkIndex = 0
  const startedAt = Date.now()

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read()
      if (done) break

      const incoming = Buffer.from(value)
      const combined = remainder.length ? Buffer.concat([remainder, incoming]) : incoming
      // ElevenLabs PCM is signed 16-bit little-endian, so frames must be
      // sent on a two-byte boundary.
      const usableLength = combined.length - (combined.length % 2)
      if (!usableLength) {
        remainder = combined
        continue
      }

      const pcmChunk = combined.subarray(0, usableLength)
      remainder = combined.subarray(usableLength)
      chunkIndex += 1
      socket.emit('pcm-chunk', pcmChunk, {
        sampleRate: 24000,
        channels: 1,
        chunkIndex,
        timestamp: Date.now() - startedAt
      })
    }

    if (!signal?.aborted) {
      socket.emit('pcm-end', { chunkCount: chunkIndex, duration: Date.now() - startedAt })
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error('PCM socket stream error:', error)
      socket.emit('error', 'TTS PCM stream failed')
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }
}
