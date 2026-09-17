const { Pool } = require('pg')

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://cachegate:cachegate@localhost:5433/cachegate',
})

module.exports = pool
