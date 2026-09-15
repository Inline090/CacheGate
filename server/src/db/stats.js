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

async function topRoutes(limit = 10) {
  const { rows } = await pool.query(
    `SELECT
       url,
       count(*)::int                                     AS total,
       count(*) FILTER (WHERE cache_status = 'HIT')::int  AS hits,
       count(*) FILTER (WHERE cache_status = 'MISS')::int AS misses
     FROM request_stats
     GROUP BY url
     ORDER BY total DESC, url ASC
     LIMIT $1`,
    [limit],
  )

  return rows
}

async function latency() {
  const { rows } = await pool.query(`
    SELECT
      coalesce(round(avg(duration_ms) FILTER (WHERE cache_status = 'HIT')), 0)::int  AS avg_hit_ms,
      coalesce(round(avg(duration_ms) FILTER (WHERE cache_status = 'MISS')), 0)::int AS avg_miss_ms,
      count(*) FILTER (WHERE cache_status = 'HIT')::int                             AS hits
    FROM request_stats
  `)

  const { avg_hit_ms: avgHitMs, avg_miss_ms: avgMissMs, hits } = rows[0]

  return {
    avgHitMs,
    avgMissMs,
    hits,
    savedMs: Math.max(avgMissMs - avgHitMs, 0) * hits,
  }
}

module.exports = { record, summary, topRoutes, latency }
