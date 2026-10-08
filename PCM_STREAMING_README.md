# Voly AI Call Bot - PCM Streaming System

## Overview

This project implements a real-time PCM audio streaming system for conversational AI, replacing the traditional MediaSource/SourceBuffer approach with Web Audio API for ultra-low latency and immediate interrupt capabilities.

## Architecture

```
[User Mic] → MediaRecorder → Deepgram STT → Gemini LLM → ElevenLabs TTS
                                                              ↓
[Web Audio API] ← PCM Chunks ← FFmpeg Conversion ← MP3 Stream
```

## Key Features

### ✅ **Ultra-Low Latency PCM Streaming**
- **Backend**: Converts ElevenLabs MP3/Opus to PCM using FFmpeg
- **Frontend**: Web Audio API with 100ms buffer chunks
- **Latency**: ~50-150ms from TTS to audio playback

### ✅ **Immediate Interrupt Support**
- **Voice Activity Detection**: Smart speech detection to avoid false interrupts
- **Instant Stop**: AudioBufferSourceNode.stop() for immediate audio halt
- **Context Preservation**: Interrupted responses are saved for context

### ✅ **Performance Monitoring**
- **Real-time Metrics**: Latency, throughput, buffer underruns
- **Performance Dashboard**: Comprehensive monitoring interface
- **Export Capabilities**: JSON export for detailed analysis

### ✅ **Robust Error Handling**
- **Graceful Degradation**: Continues operation despite individual chunk failures
- **Connection Recovery**: Automatic reconnection and state restoration
- **Memory Management**: Automatic cleanup of audio resources

## File Structure

```
Backend (Node.js + Express + Socket.IO):
├── index.js                          # Main server with Socket.IO handlers
├── services/
│   ├── PCMStreamer.service.js        # FFmpeg-based PCM conversion
│   ├── LLM.service.js               # Gemini integration
│   └── STT.service.js               # Deepgram integration

Frontend (React + TypeScript):
├── src/
│   ├── hooks/
│   │   └── usePCMAudio.ts           # React hook for PCM audio
│   ├── utils/
│   │   ├── AudioQueue.ts            # Web Audio API PCM playback
│   │   └── PerformanceMonitor.ts    # Performance tracking
│   ├── components/
│   │   ├── InterruptExample.tsx     # Basic interrupt test
│   │   ├── AdvancedInterruptTest.tsx # Advanced testing scenarios
│   │   ├── PerformanceDashboard.tsx # Real-time performance monitoring
│   │   └── Navigation.tsx           # App navigation
│   └── pages/
│       ├── VoiceResponse.tsx        # Main voice interaction page
│       └── Chatbot.tsx             # Text-based chat interface
```

## API Reference

### Backend Socket Events

#### Outgoing Events (Server → Client)
```javascript
// PCM audio chunk
socket.emit('pcm-chunk', {
  data: Float32Array,        // PCM samples as array
  sampleRate: 24000,         // Sample rate in Hz
  channels: 1,               // Number of channels
  chunkIndex: number,        // Sequential chunk number
  timestamp: number          // Relative timestamp in ms
})

// PCM stream ended
socket.emit('pcm-end', {
  chunkCount: number,        // Total chunks sent
  duration: number           // Total duration in ms
})

// LLM token (for text display)
socket.emit('llm-token', string)

// LLM generation complete
socket.emit('llm-complete')

// AI processing interrupted
socket.emit('ai-interrupted')
```

#### Incoming Events (Client → Server)
```javascript
// Start AI processing
socket.emit('ai-processing', prompt)

// Interrupt all AI processing
socket.emit('interrupt-ai')

// Play intro message
socket.emit('voly-intro', { text: string })
```

### Frontend React Hook

```typescript
const pcmAudio = usePCMAudio(socket)

// Methods
await pcmAudio.start()           // Initialize audio context
pcmAudio.stop()                  // Stop playback immediately
pcmAudio.setVolume(0.8)         // Set volume (0.0 - 1.0)
const state = pcmAudio.getState() // Get current state

// State object
{
  isPlaying: boolean,
  queueLength: number,
  activeSourcesCount: number,
  contextState: string,
  chunksReceived: number,
  chunksPlayed: number,
  averageLatency: number
}
```

## Usage Examples

### Basic PCM Audio Playback
```typescript
import { usePCMAudio } from '../hooks/usePCMAudio'

const MyComponent = () => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const pcmAudio = usePCMAudio(socket)

  const startAudio = async () => {
    await pcmAudio.start()
    socket?.emit('voly-intro', { text: 'Hello world!' })
  }

  const interruptAudio = () => {
    socket?.emit('interrupt-ai')
    pcmAudio.stop()
  }

  return (
    <div>
      <button onClick={startAudio}>Start Audio</button>
      <button onClick={interruptAudio}>Interrupt</button>
      <div>Status: {pcmAudio.isPlaying ? 'Playing' : 'Ready'}</div>
    </div>
  )
}
```

### Performance Monitoring
```typescript
import { performanceMonitor } from '../utils/PerformanceMonitor'

// Start measurement
performanceMonitor.startMeasurement('tts-latency')

// End measurement
const duration = performanceMonitor.endMeasurement('tts-latency')

// Get statistics
const stats = performanceMonitor.getStats()
console.log(`Average latency: ${stats.averageLatency}ms`)

// Export data
const data = performanceMonitor.exportData()
```

## Configuration

### Backend Environment Variables
```env
# ElevenLabs TTS
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_VOICE_ID=your_voice_id

# Gemini LLM
GEMINI_API_KEY=your_api_key

# Deepgram STT
DEEPGRAM_API_KEY=your_api_key

# Server
PORT=5000
```

### Audio Settings
```javascript
// PCM format (configurable in PCMStreamer)
const SAMPLE_RATE = 24000    // 24kHz for high quality
const CHANNELS = 1           // Mono audio
const BIT_DEPTH = 32         // 32-bit float PCM

// Buffer settings (configurable in AudioQueue)
const BUFFER_DURATION = 0.1  // 100ms buffers for low latency
```

## Testing & Debugging

### Available Test Routes
- `/` - Main chatbot interface
- `/stt` - Voice response with interrupt detection
- `/interrupt-test` - Basic interrupt functionality test
- `/advanced-test` - Advanced testing scenarios
- `/performance` - Real-time performance dashboard

### Performance Metrics
- **Latency**: Time from TTS request to first audio playback
- **Throughput**: Audio chunks processed per second
- **Buffer Health**: Queue length and underrun detection
- **Interrupt Response**: Time to stop audio after interrupt signal

### Debugging Tips
1. **Check Browser Console**: All PCM operations are logged
2. **Monitor Network Tab**: Verify WebSocket PCM chunk transmission
3. **Use Performance Dashboard**: Real-time metrics and export capabilities
4. **Test Different Scenarios**: Short/medium/long responses, rapid fire tests
5. **Verify Audio Context**: Ensure user interaction before audio initialization

## Browser Compatibility

### Supported Browsers
- ✅ Chrome 66+ (recommended)
- ✅ Firefox 60+
- ✅ Safari 14.1+
- ✅ Edge 79+

### Required Features
- Web Audio API
- WebSocket support
- Float32Array support
- AudioContext.resume() (user gesture requirement)

## Performance Benchmarks

### Typical Performance (Chrome, local development)
- **First Chunk Latency**: 80-120ms
- **Average Latency**: 50-80ms
- **Interrupt Response**: <50ms
- **Memory Usage**: ~10-20MB for audio buffers
- **CPU Usage**: <5% during playback

### Optimization Tips
1. **Reduce Buffer Size**: Lower `bufferDuration` for less latency (may cause underruns)
2. **Increase Sample Rate**: Higher quality but more bandwidth
3. **Monitor Queue Length**: Keep between 2-5 chunks for optimal performance
4. **Use Performance Dashboard**: Identify bottlenecks and optimize accordingly

## Troubleshooting

### Common Issues

#### Audio Not Playing
- Ensure user interaction before calling `pcmAudio.start()`
- Check browser console for AudioContext errors
- Verify WebSocket connection is established

#### High Latency
- Check network connection quality
- Monitor performance dashboard for bottlenecks
- Reduce buffer duration (may cause underruns)

#### Interrupt Not Working
- Verify voice activity detection thresholds
- Check if audio is actually playing when interrupt is triggered
- Monitor console for interrupt-related logs

#### Buffer Underruns
- Increase buffer duration
- Check network stability
- Monitor chunk arrival rate vs. playback rate

### Debug Commands
```javascript
// In browser console
window.pcmAudio = pcmAudio           // Access audio state
window.performanceMonitor = performanceMonitor  // Access performance data

// Check audio context state
console.log(pcmAudio.getState())

// Export performance data
console.log(performanceMonitor.exportData())
```

## Future Enhancements

### Planned Features
- [ ] **Adaptive Buffering**: Dynamic buffer size based on network conditions
- [ ] **Audio Compression**: Optional compression for bandwidth optimization
- [ ] **Multi-channel Support**: Stereo and surround sound capabilities
- [ ] **Advanced VAD**: Machine learning-based voice activity detection
- [ ] **Audio Effects**: Real-time audio processing (reverb, EQ, etc.)

### Experimental Features
- [ ] **WebCodecs API**: Hardware-accelerated audio decoding
- [ ] **WebAssembly**: High-performance audio processing
- [ ] **Service Worker**: Background audio processing
- [ ] **WebRTC**: Peer-to-peer audio streaming

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test thoroughly using the performance dashboard
4. Submit a pull request with performance benchmarks

## License

MIT License - see LICENSE file for details