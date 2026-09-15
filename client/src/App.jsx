import { useEffect, useState } from 'react'

export default function App() {
  const [summary, setSummary] = useState(null)
  const [routes, setRoutes] = useState(null)
  const [latency, setLatency] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetch('/stats/summary').then((res) => res.json()),
      fetch('/stats/routes').then((res) => res.json()),
      fetch('/stats/latency').then((res) => res.json()),
    ])
      .then(([summaryData, routeData, latencyData]) => {
        setSummary(summaryData)
        setRoutes(routeData)
        setLatency(latencyData)
      })
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

      {latency && (
        <section>
          <h2>Latency saved</h2>
          <p className="figure">{latency.savedMs.toLocaleString()} ms</p>
          <p>
            Hits answered in ~{latency.avgHitMs} ms against ~{latency.avgMissMs} ms from the
            origin, over {latency.hits} hits
          </p>
        </section>
      )}

      {routes && (
        <section>
          <h2>Most requested routes</h2>

          {routes.length === 0 ? (
            <p>No requests recorded yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Requests</th>
                  <th>Hits</th>
                  <th>Misses</th>
                  <th>Hit rate</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((route) => (
                  <tr key={route.url}>
                    <td>{route.url}</td>
                    <td>{route.total}</td>
                    <td>{route.hits}</td>
                    <td>{route.misses}</td>
                    <td>{Math.round((route.hits / route.total) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  )
}
