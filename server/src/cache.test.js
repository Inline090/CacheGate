const test = require('node:test')
const { after } = require('node:test')
const assert = require('node:assert/strict')
const { createClient } = require('redis')
const cache = require('./cache')

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// the server entry calls this too; here it just kicks off the connection
cache.connect()

// without this the open redis socket keeps the test process alive
after(async () => {
  await cache.disconnect()
})

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// the cache connects in the background, so probe it until it answers
async function waitForCache() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const probe = { status: 200, headers: {}, body: Buffer.from(`probe-${attempt}`) }
    await cache.set('GET', `/__probe/${attempt}`, probe)

    if (await cache.get('GET', `/__probe/${attempt}`)) {
      return
    }

    await delay(100)
  }

  throw new Error(`redis not reachable at ${REDIS_URL} — run: docker compose up -d`)
}

test('keys combine method and url', () => {
  assert.equal(cache.keyFor('GET', '/api/users'), 'cache:GET:/api/users')
  assert.notEqual(cache.keyFor('GET', '/api/users'), cache.keyFor('POST', '/api/users'))
})

test('only GET requests are cacheable', () => {
  assert.equal(cache.isCacheableRequest('GET'), true)

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    assert.equal(cache.isCacheableRequest(method), false, `${method} should not be cacheable`)
  }
})

test('only 200 responses are cacheable', () => {
  assert.equal(cache.isCacheableResponse(200), true)

  for (const status of [201, 204, 301, 404, 500, 502]) {
    assert.equal(cache.isCacheableResponse(status), false, `${status} should not be cacheable`)
  }
})

test('a miss returns null', async () => {
  await waitForCache()

  assert.equal(await cache.get('GET', `/api/missing/${Date.now()}`), null)
})

test('a stored response comes back unchanged', async () => {
  await waitForCache()

  const url = `/api/round-trip/${Date.now()}`
  const original = {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from('{"ok":true}'),
  }

  await cache.set('GET', url, original)
  const stored = await cache.get('GET', url)

  assert.equal(stored.status, original.status)
  assert.deepEqual(stored.headers, original.headers)
  assert.deepEqual(stored.body, original.body)
})

test('binary bodies survive the round trip', async () => {
  await waitForCache()

  const url = `/api/binary/${Date.now()}`
  const body = Buffer.from([0, 1, 2, 127, 128, 253, 254, 255])

  await cache.set('GET', url, { status: 200, headers: {}, body })
  const stored = await cache.get('GET', url)

  assert.deepEqual(stored.body, body)
})

test('every stored entry gets a TTL', async () => {
  await waitForCache()

  const url = `/api/ttl/${Date.now()}`
  await cache.set('GET', url, { status: 200, headers: {}, body: Buffer.from('x') })

  const client = createClient({ url: REDIS_URL })
  await client.connect()

  const ttl = await client.ttl(cache.keyFor('GET', url))
  await client.quit()

  assert.ok(ttl > 0, `expected a TTL, got ${ttl}`)
  assert.ok(ttl <= 60, `expected a TTL within the default of 60s, got ${ttl}`)
})
