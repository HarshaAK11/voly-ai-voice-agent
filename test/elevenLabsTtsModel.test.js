import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { PCMStreamer, streamTTSAsPCM } from '../services/PCMStreamer.service.js'

// ElevenLabs deprecated music_v1 and eleven_text_to_sound_v2. This repository
// only calls text-to-speech, so these resources must never appear in an
// outgoing request or in the source tree.
const DEPRECATED_MODELS = ['music_v1', 'eleven_text_to_sound_v2']
const DEPRECATED_ENDPOINTS = ['/v1/music', '/v1/sound-generation']

function assertNoDeprecatedRequest({ url, options }) {
  for (const endpoint of DEPRECATED_ENDPOINTS) {
    assert.ok(!url.includes(endpoint), `TTS request must not target ${endpoint}: ${url}`)
  }

  const body = JSON.parse(options.body)
  for (const model of DEPRECATED_MODELS) {
    assert.notEqual(body.model_id, model, `TTS request must not use deprecated model ${model}`)
  }
  return body
}

async function findDeprecatedSourceReferences() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const scanRoots = ['index.js', 'services', 'app/src']
  const offenders = []

  async function checkFile(relative) {
    if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(relative)) return
    const contents = await readFile(path.join(repoRoot, relative), 'utf8')
    for (const token of [...DEPRECATED_MODELS, ...DEPRECATED_ENDPOINTS]) {
      if (contents.includes(token)) offenders.push(`${relative}: ${token}`)
    }
  }

  async function walk(target) {
    const entries = await readdir(path.join(repoRoot, target), { withFileTypes: true })
    for (const entry of entries) {
      const relative = path.join(target, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        await walk(relative)
        continue
      }
      await checkFile(relative)
    }
  }

  for (const target of scanRoots) {
    const entries = await readdir(path.join(repoRoot, target), { withFileTypes: true }).catch(() => null)
    if (entries === null) {
      await checkFile(target)
      continue
    }
    await walk(target)
  }

  return offenders
}

test('ElevenLabs streaming TTS never targets the deprecated music or sound models', async () => {
  const originalFetch = globalThis.fetch
  const originalStartPCMStream = PCMStreamer.prototype.startPCMStream
  const originalApiKey = process.env.ELEVENLABS_API_KEY
  const originalVoiceId = process.env.ELEVENLABS_VOICE_ID

  const requests = []
  const events = []
  const socket = { emit: (event, ...args) => events.push({ event, args }) }

  try {
    process.env.ELEVENLABS_API_KEY = 'test-key'
    process.env.ELEVENLABS_VOICE_ID = 'test-voice'

    // The service also has a legacy MP3/FFmpeg branch after the streaming
    // branch. Stub it so this test only exercises the outgoing request.
    PCMStreamer.prototype.startPCMStream = async () => {}

    // 1. A successful request uses the text-to-speech endpoint with a
    // non-deprecated model and the PCM output format.
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options })
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

    await streamTTSAsPCM(socket, 'Hello from the test caller.', undefined)

    assert.equal(requests.length, 1, 'expected exactly one ElevenLabs request')
    assert.match(
      requests[0].url,
      /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/test-voice\/stream\?/
    )
    assert.match(requests[0].url, /output_format=pcm_24000/)
    assert.equal(requests[0].options.method, 'POST')
    assert.equal(requests[0].options.headers['xi-api-key'], 'test-key')

    const successBody = assertNoDeprecatedRequest(requests[0])
    assert.equal(successBody.text, 'Hello from the test caller.')
    assert.equal(successBody.model_id, 'eleven_flash_v2_5')

    assert.ok(events.some(({ event }) => event === 'pcm-chunk'))
    assert.ok(events.some(({ event }) => event === 'pcm-end'))

    // 2. A failed request surfaces the error instead of retrying with a
    // deprecated music or sound-generation resource.
    requests.length = 0
    events.length = 0
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options })
      return {
        ok: false,
        status: 400,
        body: null,
        text: async () => 'synthetic upstream error'
      }
    }

    await streamTTSAsPCM(socket, 'Hello from the test caller.', undefined)

    assert.equal(requests.length, 1, 'expected no retry on a failed TTS request')
    assert.match(requests[0].url, /\/v1\/text-to-speech\//)
    assertNoDeprecatedRequest(requests[0])
    assert.ok(
      events.some(({ event, args }) => event === 'error' && /ElevenLabs API error/.test(args[0])),
      'expected the upstream failure to be reported to the client'
    )

    // 3. Guard the whole source tree, not just the TTS call site.
    assert.deepEqual(
      await findDeprecatedSourceReferences(),
      [],
      'deprecated ElevenLabs resources must not be referenced by any source file'
    )
  } finally {
    globalThis.fetch = originalFetch
    PCMStreamer.prototype.startPCMStream = originalStartPCMStream

    if (originalApiKey === undefined) delete process.env.ELEVENLABS_API_KEY
    else process.env.ELEVENLABS_API_KEY = originalApiKey

    if (originalVoiceId === undefined) delete process.env.ELEVENLABS_VOICE_ID
    else process.env.ELEVENLABS_VOICE_ID = originalVoiceId
  }
})
