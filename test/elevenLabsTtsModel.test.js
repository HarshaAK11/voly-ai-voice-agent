import assert from 'node:assert/strict'
import test from 'node:test'

import { PCMStreamer, streamTTSAsPCM } from '../services/PCMStreamer.service.js'

// ElevenLabs is deprecating music_v1 and eleven_text_to_sound_v2. This repo
// only uses the text-to-speech endpoint, so guard that the streaming call
// keeps using a non-deprecated TTS model and the PCM output format.
test('ElevenLabs streaming TTS uses a non-deprecated model and PCM output', async () => {
  const originalFetch = globalThis.fetch
  const originalStartPCMStream = PCMStreamer.prototype.startPCMStream
  const originalApiKey = process.env.ELEVENLABS_API_KEY
  const originalVoiceId = process.env.ELEVENLABS_VOICE_ID

  let captured
  const events = []

  try {
    process.env.ELEVENLABS_API_KEY = 'test-key'
    process.env.ELEVENLABS_VOICE_ID = 'test-voice'

    // The production function also has a legacy MP3/FFmpeg branch after the
    // PCM branch. Stub it so this test only exercises the streaming request.
    PCMStreamer.prototype.startPCMStream = async () => {}

    globalThis.fetch = async (url, options) => {
      captured = { url, options }
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3, 4]))
            controller.close()
          }
        })
      }
    }

    const socket = {
      emit: (event, ...args) => events.push({ event, args })
    }

    await streamTTSAsPCM(socket, 'Hello from the test caller.', undefined)

    assert.ok(captured, 'expected the TTS request to be made')
    assert.match(captured.url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/test-voice\/stream\?/)
    assert.match(captured.url, /output_format=pcm_24000/)
    assert.equal(captured.options.method, 'POST')
    assert.equal(captured.options.headers['xi-api-key'], 'test-key')

    const body = JSON.parse(captured.options.body)
    assert.equal(body.text, 'Hello from the test caller.')
    assert.notEqual(body.model_id, 'music_v1')
    assert.notEqual(body.model_id, 'eleven_text_to_sound_v2')
    assert.equal(body.model_id, 'eleven_flash_v2_5')

    assert.ok(events.some(({ event }) => event === 'pcm-chunk'))
    assert.ok(events.some(({ event }) => event === 'pcm-end'))
  } finally {
    globalThis.fetch = originalFetch
    PCMStreamer.prototype.startPCMStream = originalStartPCMStream

    if (originalApiKey === undefined) delete process.env.ELEVENLABS_API_KEY
    else process.env.ELEVENLABS_API_KEY = originalApiKey

    if (originalVoiceId === undefined) delete process.env.ELEVENLABS_VOICE_ID
    else process.env.ELEVENLABS_VOICE_ID = originalVoiceId
  }
})
