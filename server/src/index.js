const express = require('express')
const { parseArgs } = require('node:util')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const cache = require('./cache')
const stats = require('./db/stats')
const statsRouter = require('./routes/stats')

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p' },
    origin: { type: 'string', short: 'o' },
    'clear-cache': { type: 'boolean' },
  },
})

const PORT = Number(values.port || process.env.PORT) || 3000
const ORIGIN = values.origin || process.env.ORIGIN || 'http://localhost:8080'

const MAX_CACHE_BYTES = 1024 * 1024

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

async function streamFromOrigin(req, res, cacheStatus, startedAt, cacheable) {
  const originRes = await fetch(ORIGIN + req.originalUrl, {
    method: req.method,
    headers: requestHeaders(req.headers),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
  })

  const headers = responseHeaders(originRes.headers)

  res.status(originRes.status)
  res.set(headers)
  res.setHeader('X-Cache', cacheStatus)

  const originStream = Readable.fromWeb(originRes.body)
  const chunks = []

  let keep = cacheable && cache.isCacheableResponse(originRes.status)
  let size = 0

  originStream.on('data', (chunk) => {
    if (!keep) {
      return
    }

    size += chunk.length

    if (size > MAX_CACHE_BYTES) {
      // past the cap we stop holding the body — copying it is what caused the memory spike
      keep = false
      chunks.length = 0
      return
    }

    chunks.push(chunk)
  })

  await pipeline(originStream, res)

  await stats.record({
    method: req.method,
    url: req.originalUrl,
    status: originRes.status,
    cacheStatus,
    durationMs: Date.now() - startedAt,
  })

  if (!keep) {
    return null
  }

  const body = Buffer.concat(chunks)
  await cache.set(req.method, req.originalUrl, { status: originRes.status, headers, body })

  return { status: originRes.status, headers, body }
}

async function reply(req, res, result, cacheStatus, startedAt) {
  await stats.record({
    method: req.method,
    url: req.originalUrl,
    status: result.status,
    cacheStatus,
    durationMs: Date.now() - startedAt,
  })

  res.status(result.status)
  res.set(result.headers)
  res.setHeader('X-Cache', cacheStatus)
  res.send(result.body)
}

app.get('/', (req, res) => {
  res.send(`caching-proxy is running. Forwarding to origin: ${ORIGIN}`)
})

// reserved for the proxy's own API, so these paths never reach the origin
app.use('/stats', statsRouter)

app.use(express.raw({ type: '*/*', limit: '10mb' }))

app.use(async (req, res) => {
  const startedAt = Date.now()

  try {
    if (!cache.isCacheableRequest(req.method)) {
      await streamFromOrigin(req, res, 'MISS', startedAt, false)
      return
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

    try {
      const result = await streamFromOrigin(req, res, 'MISS', startedAt, true)

      for (const waiter of entry.waiters) {
        if (result) {
          await reply(waiter.req, waiter.res, result, 'MISS', waiter.startedAt)
        } else {
          await streamFromOrigin(waiter.req, waiter.res, 'MISS', waiter.startedAt, true)
        }
      }
    } catch (err) {
      // waiters share this fetch, so a failure has to reach them as well
      for (const waiter of entry.waiters) {
        if (!waiter.res.headersSent) {
          waiter.res.status(502).send('Bad Gateway')
        }
      }

      throw err
    } finally {
      // success or failure, never leave a dead fetch in the map
      inFlight.delete(key)
    }
  } catch (err) {
    console.error(`origin request failed: ${req.method} ${req.originalUrl} — ${err.message}`)

    if (!res.headersSent) {
      res.status(502).send('Bad Gateway')
    }
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
