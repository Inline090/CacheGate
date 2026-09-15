const express = require('express')
const { parseArgs } = require('node:util')
const cache = require('./cache')
const stats = require('./db/stats')

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p' },
    origin: { type: 'string', short: 'o' },
    'clear-cache': { type: 'boolean' },
  },
})

const PORT = Number(values.port || process.env.PORT) || 3000
const ORIGIN = values.origin || process.env.ORIGIN || 'http://localhost:8080'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const app = express()
const inFlight = new Map()

function requestHeaders(headers) {
  const out = { ...headers }

  for (const name of Object.keys(out)) {
    if (HOP_BY_HOP.has(name) || name === 'host' || name === 'content-length') {
      delete out[name]
    }
  }

  return out
}

function responseHeaders(headers) {
  const out = {}

  headers.forEach((value, name) => {
    // fetch hands back a decompressed body, so length and encoding headers would be wrong
    if (!HOP_BY_HOP.has(name) && name !== 'content-length' && name !== 'content-encoding') {
      out[name] = value
    }
  })

  return out
}

async function fetchFromOrigin(req) {
  const originRes = await fetch(ORIGIN + req.originalUrl, {
    method: req.method,
    headers: requestHeaders(req.headers),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
  })

  return {
    status: originRes.status,
    headers: responseHeaders(originRes.headers),
    body: Buffer.from(await originRes.arrayBuffer()),
  }
}

function sendResult(res, result, cacheStatus) {
  res.status(result.status)
  res.set(result.headers)
  res.setHeader('X-Cache', cacheStatus)
  res.send(result.body)
}

async function reply(req, res, result, cacheStatus, startedAt) {
  await stats.record({
    method: req.method,
    url: req.originalUrl,
    status: result.status,
    cacheStatus,
    durationMs: Date.now() - startedAt,
  })

  sendResult(res, result, cacheStatus)
}

app.get('/', (req, res) => {
  res.send(`caching-proxy is running. Forwarding to origin: ${ORIGIN}`)
})

app.use(express.raw({ type: '*/*', limit: '10mb' }))

app.use(async (req, res) => {
  const startedAt = Date.now()

  try {
    if (!cache.isCacheableRequest(req.method)) {
      const result = await fetchFromOrigin(req)
      return await reply(req, res, result, 'MISS', startedAt)
    }

    const cached = await cache.get(req.method, req.originalUrl)

    if (cached) {
      return await reply(req, res, cached, 'HIT', startedAt)
    }

    const key = cache.keyFor(req.method, req.originalUrl)
    const existing = inFlight.get(key)

    if (existing) {
      existing.waiters.push({ req, res, startedAt })
      return
    }

    const entry = { waiters: [] }
    inFlight.set(key, entry)

    const result = await fetchFromOrigin(req)

    if (cache.isCacheableResponse(result.status)) {
      await cache.set(req.method, req.originalUrl, result)
    }

    await reply(req, res, result, 'MISS', startedAt)

    for (const waiter of entry.waiters) {
      await reply(waiter.req, waiter.res, result, 'MISS', waiter.startedAt)
    }

    inFlight.delete(key)
  } catch (err) {
    console.error(`origin request failed: ${req.method} ${req.originalUrl} — ${err.message}`)
    res.status(502).send('Bad Gateway')
  }
})

async function main() {
  await cache.connect()

  if (values['clear-cache']) {
    await cache.flush()
    await cache.disconnect()
    console.log('cache cleared')
    return
  }

  app.listen(PORT, () => {
    console.log(`caching-proxy listening on http://localhost:${PORT}`)
    console.log(`forwarding to origin: ${ORIGIN}`)
  })
}

main()
