const express = require('express')

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

  try {
    const originRes = await fetch(target, {
      method: req.method,
      headers,
      body: sendBody ? req.body : undefined,
    })

    const body = Buffer.from(await originRes.arrayBuffer())

    res.status(originRes.status)
    originRes.headers.forEach((value, name) => {
      if (!HOP_BY_HOP.has(name)) {
        res.setHeader(name, value)
      }
    })
    // fetch already decompressed the body, so the origin's content-encoding would be a lie
    res.removeHeader('content-length')
    res.removeHeader('content-encoding')
    res.send(body)
  } catch (err) {
    console.error(`origin request failed: ${req.method} ${target} — ${err.message}`)
    res.status(502).send('Bad Gateway')
  }
})

app.listen(PORT, () => {
  console.log(`caching-proxy listening on http://localhost:${PORT}`)
  console.log(`forwarding to origin: ${ORIGIN}`)
})
