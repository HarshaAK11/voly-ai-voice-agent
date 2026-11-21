import assert from 'node:assert/strict'
import test from 'node:test'

import { DeepgramClient } from '@deepgram/sdk'

// The app grants temporary tokens on the server (auth.v1.tokens.grant) and
// opens live transcription sockets in the browser (listen.v1.connect).
// Those v5 surfaces must exist; the v4 SDK only exposed auth.grantToken and
// listen.live, so this guards the API adaptation.
test('Deepgram SDK exposes the v5 token grant and live listen APIs', () => {
  const client = new DeepgramClient({ accessToken: 'test-token' })

  assert.equal(typeof client.auth?.v1?.tokens?.grant, 'function')
  assert.equal(typeof client.listen?.v1?.connect, 'function')
})
