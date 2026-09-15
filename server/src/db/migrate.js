const fs = require('node:fs')
const path = require('node:path')
const pool = require('./pool')

const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const { rows } = await pool.query('SELECT name FROM schema_migrations')
  const applied = new Set(rows.map((row) => row.name))

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) {
      continue
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')

    try {
      await pool.query('BEGIN')
      await pool.query(sql)
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await pool.query('COMMIT')
      console.log(`applied ${file}`)
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }
  }

  await pool.end()
}

migrate().catch((err) => {
  console.error(`migration failed: ${err.message}`)
  process.exit(1)
})
