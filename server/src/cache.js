const { createClient } = require('redis')

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const TTL_SECONDS = Number(process.env.CACHE_TTL || 60)

// POST/PATCH bodies aren't part of the key, so replaying them to other requests is wrong
const CACHEABLE_METHODS = new Set(['GET'])
const CACHEABLE_STATUSES = new Set([200])

const client = createClient({
  url: REDIS_URL,
  // without this, commands queue while redis is unreachable and the request hangs
  disableOfflineQueue: true,
})

let outageReported = false

client.on('error', (err) => {
  // node-redis retries on its own, so only report the first failure of an outage
  if (!outageReported) {
    console.error(`redis error: ${err.message}`)
    outageReported = true
  }
})

client.on('ready', () => {
  outageReported = false
  console.log('redis connected')
})

function available() {
  return client.isReady
}

// Deliberately not awaited: a missing redis must not stop the proxy from serving.
// node-redis keeps retrying in the background, so the cache comes back on its own.
function connect() {
  client.connect().catch((err) => {
    console.error(`redis unavailable (${err.message}) — serving without cache`)
  })
}

async function disconnect() {
  if (client.isOpen) {
    await client.quit()
  }
}

async function flush() {
  await client.flushAll()
}

function keyFor(method, url) {
  return `cache:${method}:${url}`
}

function isCacheableRequest(method) {
  return CACHEABLE_METHODS.has(method)
}

function isCacheableResponse(status) {
  return CACHEABLE_STATUSES.has(status)
}

async function get(method, url) {
  if (!available()) {
    return null
  }

  try {
    const raw = await client.get(keyFor(method, url))
    if (raw === null) {
      return null
    }

    const entry = JSON.parse(raw)
    return {
      status: entry.status,
      headers: entry.headers,
      body: Buffer.from(entry.body, 'base64'),
    }
  } catch (err) {
    console.error(`cache read failed (${err.message}) — falling back to the origin`)
    return null
  }
}

async function set(method, url, response) {
  if (!available()) {
    return
  }

  const entry = {
    status: response.status,
    headers: response.headers,
    body: response.body.toString('base64'),
  }

  try {
    await client.set(keyFor(method, url), JSON.stringify(entry), { EX: TTL_SECONDS })
  } catch (err) {
    console.error(`cache write failed (${err.message}) — continuing without caching`)
  }
}

module.exports = {
  connect,
  disconnect,
  flush,
  get,
  set,
  keyFor,
  isCacheableRequest,
  isCacheableResponse,
}
