const express = require('express')
const cache = require('./cache')

const PORT = process.env.PORT || 3000
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080'

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

app.get('/', (req, res) => {
  res.send(`caching-proxy is running. Forwarding to origin: ${ORIGIN}`)
})

app.use(express.raw({ type: '*/*', limit: '10mb' }))

app.use(async (req, res) => {
  const target = ORIGIN + req.originalUrl
  const headers = { ...req.headers }

  for (const name of Object.keys(headers)) {
    if (HOP_BY_HOP.has(name) || name === 'host' || name === 'content-length') {
      delete headers[name]
    }
  }

  const sendBody = !['GET', 'HEAD'].includes(req.method)
  const useCache = cache.isCacheableRequest(req.method)

  try {
    const cached = useCache ? await cache.get(req.method, req.originalUrl) : null

    if (cached) {
      res.status(cached.status)
      res.set(cached.headers)
      res.setHeader('X-Cache', 'HIT')
      return res.send(cached.body)
    }

    const originRes = await fetch(target, {
      method: req.method,
      headers,
      body: sendBody ? req.body : undefined,
    })

    const body = Buffer.from(await originRes.arrayBuffer())
    const responseHeaders = {}

    originRes.headers.forEach((value, name) => {
      // fetch hands back a decompressed body, so length and encoding headers would be wrong
      if (!HOP_BY_HOP.has(name) && name !== 'content-length' && name !== 'content-encoding') {
        responseHeaders[name] = value
      }
    })

    if (useCache && cache.isCacheableResponse(originRes.status)) {
      await cache.set(req.method, req.originalUrl, {
        status: originRes.status,
        headers: responseHeaders,
        body,
      })
    }

    res.status(originRes.status)
    res.set(responseHeaders)
    // we only get here on a cache miss, so this response came from the origin
    res.setHeader('X-Cache', 'MISS')
    res.send(body)
  } catch (err) {
    console.error(`origin request failed: ${req.method} ${target} — ${err.message}`)
    res.status(502).send('Bad Gateway')
  }
})

async function main() {
  await cache.connect()

  app.listen(PORT, () => {
    console.log(`caching-proxy listening on http://localhost:${PORT}`)
    console.log(`forwarding to origin: ${ORIGIN}`)
  })
}

main()
