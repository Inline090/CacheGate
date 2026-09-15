import { useEffect, useState } from 'react'

const API = 'http://localhost:3000'

export default function App() {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${API}/stats/summary`)
      .then((res) => res.json())
      .then(setSummary)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <main>
      <h1>Caching Proxy Dashboard</h1>

      {error && <p className="error">Could not load stats: {error}</p>}

      {summary && (
        <section>
          <h2>Hit rate</h2>
          <p className="figure">{Math.round(summary.hitRate * 100)}%</p>
          <p>
            {summary.hits} hits / {summary.misses} misses across {summary.total} requests
          </p>
        </section>
      )}
    </main>
  )
}
