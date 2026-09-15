const test = require('node:test')
const { after, before } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createClient } = require('redis')

const PROXY_PORT = 3311
const ORIGIN_PORT = 3312
const PROXY_URL = `http://localhost:${PROXY_PORT}`
const SERVER_DIR = path.join(__dirname, '..')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let origin
let proxy
let redis
let originHits = 0
let originFailing = false

function startOrigin() {
  originHits = 0

  const server = http.createServer((req, res) => {
    if (originFailing) {
      // drop the connection after a moment so concurrent requests really do overlap
      setTimeout(() => req.socket.destroy(), 200)
      return
    }

    const hits = ++originHits

    // slow enough that concurrent requests genuinely overlap
    setTimeout(() => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ url: req.url, hits }))
    }, 200)
  })

  return new Promise((resolve) => server.listen(ORIGIN_PORT, () => resolve(server)))
}

async function waitForProxy() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`${PROXY_URL}/`)

      if (res.ok) {
        return
      }
    } catch {
      await delay(100)
    }
  }

  throw new Error(`proxy did not start on ${PROXY_URL}`)
}

before(async () => {
  origin = await startOrigin()

  proxy = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PROXY_PORT),
      ORIGIN: `http://localhost:${ORIGIN_PORT}`,
    },
    stdio: 'ignore',
  })

  await waitForProxy()

  redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' })
  await redis.connect()
})

after(async () => {
  await redis.quit()
  proxy.kill()
  await new Promise((resolve) => origin.close(resolve))
})

test('concurrent requests for one uncached url cause a single origin fetch', async () => {
  await redis.flushDb()
  originHits = 0

  const bodies = await Promise.all(
    [1, 2, 3].map(() => fetch(`${PROXY_URL}/api/coalesce`).then((res) => res.json())),
  )

  assert.equal(originHits, 1, 'the origin should be fetched exactly once')
  assert.deepEqual(bodies[1], bodies[0])
  assert.deepEqual(bodies[2], bodies[0])
})

test('a failing origin answers coalesced requests instead of hanging them', async () => {
  await redis.flushDb()
  originFailing = true

  try {
    const startedAt = Date.now()
    const statuses = await Promise.all(
      [1, 2, 3].map(() => fetch(`${PROXY_URL}/api/failing`).then((res) => res.status)),
    )
    const elapsed = Date.now() - startedAt

    assert.deepEqual(statuses, [502, 502, 502], 'every waiter should get an answer')
    assert.ok(elapsed < 3000, `waited ${elapsed}ms — coalesced waiters should not hang`)
  } finally {
    originFailing = false
  }
})

test('a failed fetch does not poison later requests for the same url', async () => {
  await redis.flushDb()
  originFailing = true

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const startedAt = Date.now()
      const res = await fetch(`${PROXY_URL}/api/poisoned`)
      const elapsed = Date.now() - startedAt

      assert.equal(res.status, 502, `attempt ${attempt} should be a bad gateway`)
      assert.ok(elapsed < 2000, `attempt ${attempt} took ${elapsed}ms — expected a fast failure`)
    }
  } finally {
    originFailing = false
  }
})

test('the proxy keeps serving once the origin recovers', async () => {
  await redis.flushDb()

  const res = await fetch(`${PROXY_URL}/api/recovered`)

  assert.equal(res.status, 200)
})
