const DEFAULT_MAX_KEYS = 10_000

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getRateLimitConfig(env = process.env) {
  return {
    trustProxyHops: Math.max(0, Number.parseInt(env.TRUST_PROXY_HOPS || '0', 10) || 0),
    maxKeys: positiveInteger(env.RATE_LIMIT_MAX_KEYS, DEFAULT_MAX_KEYS),
    http: {
      windowMs: positiveInteger(env.HTTP_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      limit: positiveInteger(env.HTTP_RATE_LIMIT_MAX, 100)
    },
    token: {
      windowMs: positiveInteger(env.TOKEN_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
      limit: positiveInteger(env.TOKEN_RATE_LIMIT_MAX, 10)
    },
    automation: {
      windowMs: positiveInteger(env.AUTOMATION_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
      limit: positiveInteger(env.AUTOMATION_RATE_LIMIT_MAX, 5)
    },
    socketConnections: {
      windowMs: positiveInteger(env.SOCKET_CONNECTION_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
      limit: positiveInteger(env.SOCKET_CONNECTION_RATE_LIMIT_MAX, 20)
    },
    ai: {
      windowMs: positiveInteger(env.AI_RATE_LIMIT_WINDOW_MS, 5 * 60 * 1000),
      limit: positiveInteger(env.AI_RATE_LIMIT_MAX, 15)
    },
    tts: {
      windowMs: positiveInteger(env.TTS_RATE_LIMIT_WINDOW_MS, 5 * 60 * 1000),
      limit: positiveInteger(env.TTS_RATE_LIMIT_MAX, 10)
    }
  }
}

export class MemoryRateLimiter {
  constructor({ windowMs, limit, maxKeys = DEFAULT_MAX_KEYS, now = Date.now }) {
    this.windowMs = windowMs
    this.limit = limit
    this.maxKeys = maxKeys
    this.now = now
    this.clients = new Map()
  }

  consume(key) {
    const now = this.now()
    let entry = this.clients.get(key)

    if (!entry || entry.resetAt <= now) {
      if (!entry && this.clients.size >= this.maxKeys) this.removeExpired(now)
      if (!entry && this.clients.size >= this.maxKeys) {
        return { allowed: false, limit: this.limit, remaining: 0, resetAt: now + this.windowMs }
      }

      entry = { count: 0, resetAt: now + this.windowMs }
      this.clients.set(key, entry)
    }

    entry.count += 1
    return {
      allowed: entry.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      resetAt: entry.resetAt
    }
  }

  removeExpired(now = this.now()) {
    for (const [key, entry] of this.clients) {
      if (entry.resetAt <= now) this.clients.delete(key)
    }
  }
}

export function getClientIp(request, trustedProxyHops = 0) {
  const remoteAddress = request?.socket?.remoteAddress || request?.connection?.remoteAddress || 'unknown'
  if (trustedProxyHops <= 0) return remoteAddress

  const forwardedFor = request?.headers?.['x-forwarded-for']
  if (typeof forwardedFor !== 'string' || !forwardedFor.trim()) return remoteAddress

  // Walk from the server outwards and trust only the configured number of hops.
  const chain = [remoteAddress, ...forwardedFor.split(',').map(ip => ip.trim()).filter(Boolean).reverse()]
  return chain[Math.min(trustedProxyHops, chain.length - 1)]
}

function setRateLimitHeaders(res, result) {
  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
  res.setHeader('RateLimit-Limit', String(result.limit))
  res.setHeader('RateLimit-Remaining', String(result.remaining))
  res.setHeader('RateLimit-Reset', String(retryAfterSeconds))
  return retryAfterSeconds
}

export function createHttpRateLimit({ limiter, trustedProxyHops = 0, keyPrefix = 'http' }) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next()

    const result = limiter.consume(`${keyPrefix}:${getClientIp(req, trustedProxyHops)}`)
    const retryAfterSeconds = setRateLimitHeaders(res, result)
    if (result.allowed) return next()

    res.setHeader('Retry-After', String(retryAfterSeconds))
    return res.status(429).json({ error: 'Too many requests', retryAfterSeconds })
  }
}

export function consumeSocketRateLimit(socket, limiter, event, trustedProxyHops = 0) {
  const ip = getClientIp(socket.request, trustedProxyHops)
  const result = limiter.consume(`${event}:${ip}`)
  if (result.allowed) return true

  socket.emit('rate-limit', {
    event,
    retryAfterMs: Math.max(1000, result.resetAt - Date.now())
  })
  return false
}
