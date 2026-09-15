const { createClient } = require('redis')

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const TTL_SECONDS = Number(process.env.CACHE_TTL || 60)

// POST/PATCH bodies aren't part of the key, so replaying them to other requests is wrong
const CACHEABLE_METHODS = new Set(['GET'])
const CACHEABLE_STATUSES = new Set([200])

const client = createClient({ url: REDIS_URL })

client.on('error', (err) => {
  console.error(`redis error: ${err.message}`)
})

async function connect() {
  await client.connect()
}

async function disconnect() {
  await client.quit()
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
}

async function set(method, url, response) {
  const entry = {
    status: response.status,
    headers: response.headers,
    body: response.body.toString('base64'),
  }

  await client.set(keyFor(method, url), JSON.stringify(entry), { EX: TTL_SECONDS })
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
