const pool = require('./pool')

async function record({ method, url, status, cacheStatus, durationMs }) {
  await pool.query(
    `INSERT INTO request_stats (method, url, status, cache_status, duration_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [method, url, status, cacheStatus, durationMs],
  )
}

module.exports = { record }
