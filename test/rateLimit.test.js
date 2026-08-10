import assert from 'node:assert/strict'
import test from 'node:test'

import { MemoryRateLimiter, getClientIp, getRateLimitConfig } from '../services/rateLimit.service.js'

test('allows requests up to the limit and rejects the next request', () => {
  let now = 1000
  const limiter = new MemoryRateLimiter({ windowMs: 5000, limit: 2, now: () => now })

  assert.equal(limiter.consume('client').allowed, true)
  assert.equal(limiter.consume('client').allowed, true)
  assert.equal(limiter.consume('client').allowed, false)

  now = 6000
  assert.equal(limiter.consume('client').allowed, true)
})

test('keeps limits independent between clients', () => {
  const limiter = new MemoryRateLimiter({ windowMs: 5000, limit: 1, now: () => 1000 })

  assert.equal(limiter.consume('first').allowed, true)
  assert.equal(limiter.consume('first').allowed, false)
  assert.equal(limiter.consume('second').allowed, true)
})

test('ignores forwarded addresses unless proxy hops are explicitly trusted', () => {
  const request = {
    socket: { remoteAddress: '10.0.0.5' },
    headers: { 'x-forwarded-for': '198.51.100.8, 10.0.0.4' }
  }

  assert.equal(getClientIp(request, 0), '10.0.0.5')
  assert.equal(getClientIp(request, 1), '10.0.0.4')
  assert.equal(getClientIp(request, 2), '198.51.100.8')
})

test('falls back to safe defaults for invalid configuration', () => {
  const config = getRateLimitConfig({ HTTP_RATE_LIMIT_MAX: '-1', AI_RATE_LIMIT_MAX: 'invalid' })

  assert.equal(config.http.limit, 100)
  assert.equal(config.ai.limit, 15)
  assert.equal(config.trustProxyHops, 0)
})
