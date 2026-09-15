const { Pool } = require('pg')

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://caching_proxy:caching_proxy@localhost:5433/caching_proxy',
})

module.exports = pool
