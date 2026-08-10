# Enhanced Audio Interruption System

## Overview

This document describes the enhanced audio interruption system implemented for the Voly AI Call Bot. The system provides immediate audio stopping, buffer clearing, and seamless transition to new audio streams.

## Key Features

✅ **Immediate Audio Stop**: Audio stops instantly without delay  
✅ **Buffer Clearing**: All pending audio chunks are cleared  
✅ **Fresh Context**: New AudioContext for each stream  
✅ **Seamless Transition**: No gaps or artifacts between streams  
✅ **Simple API**: Easy-to-use methods for common scenarios  

## Architecture

### Core Components

1. **AudioQueue** (`src/utils/AudioQueue.ts`)
   - Web Audio API based PCM audio playback
   - Enhanced with `stopPlayback()` and `reinitialize()` methods
   - Immediate source stopping and buffer clearing

2. **usePCMAudio Hook** (`src/hooks/usePCMAudio.ts`)
   - React hook wrapper for AudioQueue
   - Exposes enhanced interruption methods
   - Manages audio lifecycle

3. **useAudioInterruption Hook** (`src/hooks/useAudioInterruption.ts`)
   - High-level API for common interruption scenarios
   - Combines server communication with audio control
   - Provides convenient methods for different use cases

## API Reference

### AudioQueue Methods

```typescript
// Enhanced stop with immediate effect
stopPlayback(): void

// Reinitialize audio context for fresh start
async reinitialize(): Promise<void>

// Original stop method (still available)
stop(): void
```

### usePCMAudio Hook

```typescript
interface UsePCMAudioReturn {
  isPlaying: boolean
  start: () => Promise<void>
  stop: () => void
  stopPlayback: () => void          // NEW: Enhanced interruption
  reinitialize: () => Promise<void> // NEW: Fresh context
  setVolume: (volume: number) => void
  getState: () => any
}
```

### useAudioInterruption Hook

```typescript
interface AudioInterruptionReturn {
  // All usePCMAudio methods plus:
  interruptAI: () => void                                    // Stop server + audio
  startNewStream: (text: string) => Promise<void>           // Fresh stream
  interruptAndRestart: (text: string) => Promise<void>      // Seamless transition
  isReady: boolean                                           // Connection status
}
```

## Usage Examples

### Basic Interruption

```typescript
import { useAudioInterruption } from '../hooks/useAudioInterruption'

const MyComponent = () => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const audio = useAudioInterruption(socket)

  // Stop current audio immediately
  const handleInterrupt = () => {
    audio.interruptAI()
  }

  // Start new stream with fresh context
  const handleNewMessage = async (text: string) => {
    await audio.startNewStream(text)
  }

  // Interrupt and immediately start new stream
  const handleUserInterruption = async (newText: string) => {
    await audio.interruptAndRestart(newText)
  }
}
```

### Real-world Chat Implementation

```typescript
const ChatComponent = () => {
  const audio = useAudioInterruption(socket)
  const [userInput, setUserInput] = useState('')

  const handleUserMessage = async (message: string) => {
    if (audio.isPlaying) {
      // User interrupted while AI was speaking
      await audio.interruptAndRestart(message)
    } else {
      // Normal new conversation
      await audio.startNewStream(message)
    }
  }

  const handleEmergencyStop = () => {
    // Just stop audio without server interrupt
    audio.stopPlayback()
  }
}
```

## Implementation Details

### Enhanced AudioQueue.stopPlayback()

```typescript
stopPlayback(): void {
  console.log('🛑 Interrupting audio playback - immediate stop')
  
  // Force stop all audio sources with immediate effect
  this.audioSources.forEach((source, index) => {
    try {
      source.stop(0)        // Stop immediately, not at scheduled time
      source.disconnect()   // Disconnect to prevent residual audio
    } catch (e) {
      console.warn(`Failed to stop audio source ${index}:`, e)
    }
  })
  this.audioSources = []

  // Clear all pending audio data
  this.bufferQueue = []
  
  // Reset timing to current context time
  if (this.audioContext && this.audioContext.state !== 'closed') {
    this.nextStartTime = this.audioContext.currentTime
  }
  
  // Reset all state flags and metrics
  this.isPlaying = false
  this.isProcessing = false
  this.totalChunksReceived = 0
  this.totalChunksPlayed = 0
  this.firstChunkTime = 0
  this.latencyMeasurements = []
}
```

### AudioContext Reinitialization

```typescript
async reinitialize(): Promise<void> {
  // Stop everything first
  this.stopPlayback()
  
  // Close existing context
  if (this.audioContext && this.audioContext.state !== 'closed') {
    await this.audioContext.close()
  }
  
  // Reset references
  this.audioContext = null
  this.gainNode = null
  
  // Initialize fresh context
  await this.initialize()
}
```

## Testing Components

### 1. Enhanced Interrupt Demo (`/enhanced-interrupt`)
- Comprehensive testing interface
- Real-time logging of interruption events
- Multiple test scenarios including rapid interruption

### 2. Usage Examples (`/usage-examples`)
- Practical implementation examples
- Code snippets for common scenarios
- Interactive demonstrations

### 3. Existing Components (Updated)
- `InterruptExample`: Uses `stopPlayback()` for enhanced interruption
- `AdvancedInterruptTest`: Enhanced with new methods
- `VoiceResponse`: Updated interruption handling

## Migration Guide

### From Old System

```typescript
// OLD: Basic stop
pcmAudio.stop()

// NEW: Enhanced interruption
pcmAudio.stopPlayback()
```

### For New Implementations

```typescript
// Use the high-level hook for most cases
const audio = useAudioInterruption(socket)

// Common patterns:
await audio.startNewStream(text)           // New stream
audio.interruptAI()                        // Stop current
await audio.interruptAndRestart(newText)   // Seamless transition
```

## Performance Considerations

- **Immediate Stop**: Audio sources stop at time 0, not scheduled end
- **Buffer Clearing**: All pending chunks are discarded immediately
- **Context Reuse**: AudioContext is reinitialized only when needed
- **Memory Management**: Proper cleanup of disconnected sources

## Browser Compatibility

- **Chrome/Edge**: Full support for Web Audio API
- **Firefox**: Full support
- **Safari**: Full support (with webkit prefix handling)
- **Mobile**: Tested on iOS Safari and Chrome Mobile

## Troubleshooting

### Common Issues

1. **Audio doesn't stop immediately**
   - Ensure using `stopPlayback()` instead of `stop()`
   - Check that `source.stop(0)` is called with immediate timing

2. **Leftover audio after interruption**
   - Verify buffer queue is cleared: `this.bufferQueue = []`
   - Ensure all sources are disconnected: `source.disconnect()`

3. **New stream doesn't start**
   - Check AudioContext state after reinitialization
   - Verify socket connection is active

### Debug Information

The system provides extensive logging:
- `🛑` Interruption events
- `🎵` Audio context operations  
- `📡` Server communication
- `✅` Success confirmations

## Future Enhancements

- [ ] Fade-out option for smoother interruptions
- [ ] Queue management for multiple rapid interruptions
- [ ] Advanced buffering strategies
- [ ] WebRTC integration for lower latency