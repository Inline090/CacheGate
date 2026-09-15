const pool = require('./pool')

async function record({ method, url, status, cacheStatus, durationMs }) {
  await pool.query(
    `INSERT INTO request_stats (method, url, status, cache_status, duration_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [method, url, status, cacheStatus, durationMs],
  )
}

async function summary() {
  const { rows } = await pool.query(`
    SELECT
      count(*)::int                                    AS total,
      count(*) FILTER (WHERE cache_status = 'HIT')::int AS hits
    FROM request_stats
  `)

  const { total, hits } = rows[0]

  return {
    total,
    hits,
    misses: total - hits,
    hitRate: total === 0 ? 0 : Number((hits / total).toFixed(3)),
  }
}

module.exports = { record, summary }
