# Caching Proxy - HTTP Caching Proxy with Analytics Dashboard

An HTTP caching proxy that sits in front of an origin server, serves repeated requests straight from Redis instead of hitting the origin again, and reports what the cache is doing through a React dashboard. Built with Node.js, Express, Redis, PostgreSQL, and React.

## Features

- **HTTP Proxying**: Forwards any method to a configurable origin server, preserving query strings, request headers, and request bodies
- **Response Caching**: Stores successful GET responses in Redis with a TTL, keyed on HTTP method and URL
- **Cache Visibility**: Every proxied response carries an `X-Cache: HIT` or `X-Cache: MISS` header
- **Request Coalescing**: Concurrent requests for the same uncached URL share a single origin fetch
- **Analytics**: Per-route hit/miss counts and latency recorded in PostgreSQL
- **Dashboard**: Hit rate, busiest routes, and estimated time saved, refreshing every five seconds
- **Streaming**: Large responses are piped straight to the client instead of buffered in memory
- **Resilient**: Degrades to pass-through when Redis is unavailable, and fails fast with a 502 when the origin is down
- **CLI Options**: Configure the port and origin, or clear the cache, from the command line
- **Tested**: 11 tests covering cache policy and proxy behaviour, run by Node's built-in test runner

## Quick Start

### Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for Redis and PostgreSQL)

### 1. Clone and Install

```bash
git clone https://github.com/Inline090/CachingProxy.git
cd CachingProxy
npm install
```

### 2. Start the Infrastructure

```bash
docker compose up -d
```

This starts Redis on `6379` and PostgreSQL on `5433`.

### 3. Run the Database Migration

```bash
npm run migrate --workspace=server
```

### 4. Start the Proxy

```bash
npm run dev
```

The proxy listens on port `3000` and forwards to `http://localhost:8080` by default. Point it at a different origin with `--origin`.

### 5. Start the Dashboard

```bash
npm run dev:client
```

Visit `http://localhost:5173` to see the dashboard.

### 6. Send Some Traffic

```bash
curl -i http://localhost:3000/api/users     # X-Cache: MISS, served by the origin
curl -i http://localhost:3000/api/users     # X-Cache: HIT, served from Redis
```

## Project Structure

```
server/
├── src/
│   ├── index.js            Express app, proxy handler, CLI entry point
│   ├── cache.js            Redis cache: keying, TTL, eligibility rules
│   ├── cache.test.js       cache policy and round-trip tests
│   ├── proxy.test.js       coalescing and failure handling tests
│   ├── db/
│   │   ├── pool.js         PostgreSQL connection pool
│   │   ├── migrate.js      numbered .sql migration runner
│   │   ├── stats.js        stats queries (record, summary, top routes, latency)
│   │   └── migrations/     plain SQL schema migrations
│   └── routes/
│       └── stats.js        the proxy's own stats API
└── .env.example            environment template

client/
├── src/
│   ├── App.jsx             dashboard view and polling
│   ├── main.jsx            React entry point
│   └── index.css           styles
└── vite.config.js          React plugin and dev proxy for /stats

docker-compose.yml          Redis and PostgreSQL for local development
```

## Configuration

Copy `server/.env.example` to `server/.env` and adjust as needed. Every value has a default, so nothing is required for local development.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port the proxy listens on |
| `ORIGIN` | `http://localhost:8080` | Server requests are forwarded to |
| `REDIS_URL` | `redis://localhost:6379` | Cache connection |
| `CACHE_TTL` | `60` | Seconds a cached response stays valid |
| `DATABASE_URL` | `postgres://caching_proxy:caching_proxy@localhost:5433/caching_proxy` | Stats database |

PostgreSQL is published on `5433` rather than the usual `5432` so it cannot collide with a database already running on your machine.

## Available Scripts

- `npm run dev` - start the proxy on port 3000
- `npm run dev:client` - start the dashboard dev server on port 5173
- `npm run migrate --workspace=server` - apply database migrations
- `npm test --workspace=server` - run the test suite
- `npm run build --workspace=client` - build the dashboard for production

## CLI Options

```bash
npm start --workspace=server -- --port 4000
npm start --workspace=server -- --origin http://localhost:9000
npm start --workspace=server -- --clear-cache
```

| Flag | Description |
| --- | --- |
| `--port`, `-p` | Port the proxy listens on |
| `--origin`, `-o` | Origin server to forward requests to |
| `--clear-cache` | Flush Redis and exit |

Flags win over environment variables, which win over the defaults. Cached entries are keyed on method and URL only, so `--clear-cache` is worth reaching for after repointing `--origin`.

## API Endpoints

The proxy reserves `/stats` for itself. These paths are answered locally and never forwarded to the origin.

| Endpoint | Returns |
| --- | --- |
| `GET /stats/summary` | Totals and hit rate: `{"total":7,"hits":4,"misses":3,"hitRate":0.571}` |
| `GET /stats/routes` | The ten busiest routes, each with its own hit/miss split |
| `GET /stats/latency` | Average latency for hits vs misses, plus total time saved |

```json
{
  "avgHitMs": 2,
  "avgMissMs": 249,
  "hits": 4,
  "savedMs": 988
}
```

`savedMs` is `(avgMissMs - avgHitMs) * hits` — an estimate of what those hits would have cost if they had all gone to the origin.

## Features Overview

### Caching

- Only `GET` responses with a `200` status are cacheable, so a POST never receives another POST's response and an error is never replayed
- Entries are keyed on HTTP method and URL, and expire after `CACHE_TTL` seconds
- Responses are stored as JSON holding status, headers, and a base64 body, so binary responses survive the round trip
- Bodies over 1 MB stream through without being cached, which keeps memory flat regardless of response size

### Request Coalescing

- The first request for an uncached URL registers itself in an in-flight map and fetches from the origin
- Any request that arrives for the same URL while that fetch is running waits and receives the same response
- Waiters are answered whether the fetch succeeds or fails, and the in-flight entry is always cleared

### Analytics

- Every proxied request writes one row to `request_stats`: method, URL, status, hit or miss, and duration
- Hit rate, busiest routes, and latency savings are aggregation queries over those rows rather than counters
- The dashboard polls the three stats endpoints every five seconds and pauses while the browser tab is hidden

### Resilience

- An unreachable origin produces a fast `502 Bad Gateway` instead of hanging clients
- Redis is treated as an enhancement: if it is unavailable the proxy serves from the origin, and caching resumes on its own when it returns
- Responses are streamed with backpressure rather than buffered, so a large download does not consume the process's memory

## Key Technologies

- **Backend**: Node.js, Express
- **Cache**: Redis 7 with the official node-redis client
- **Database**: PostgreSQL 16, plain SQL with numbered migrations
- **Frontend**: React 18, Vite
- **Infrastructure**: Docker Compose
- **Testing**: Node's built-in test runner

## Testing

```bash
npm test --workspace=server
```

The suite covers cache keying, TTL, eligibility rules, response round-tripping, request coalescing, and failure propagation. It uses Node's built-in test runner, so there is no test framework to install, and it exercises a real Redis, a real PostgreSQL, and a real running proxy — start the infrastructure with `docker compose up -d` first.

## Deployment

### Docker Compose (Local Development)

`docker compose up -d` starts Redis and PostgreSQL with healthchecks and a named volume for the database, so data survives a restart.

### Production Notes

The application is plain Node.js and can run anywhere Node runs. Before pointing it at real traffic:

- Set `ORIGIN`, `REDIS_URL`, and `DATABASE_URL` to real services instead of the local containers
- Run the migrations against the production database: `npm run migrate --workspace=server`
- Build the dashboard with `npm run build --workspace=client` and serve `client/dist` from the same host as the proxy; the Vite dev proxy exists only during development, and relative `/stats` requests then work unchanged
- Run the proxy under a process manager or container orchestrator so it restarts on failure
- Review the caching policy for your data: the cache key does not include the origin or any auth headers, so authenticated or per-user responses must not be cached as written
- Decide how the stats table is retained — nothing prunes `request_stats` yet

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and run `npm test --workspace=server`
4. Commit with a Conventional Commits message: `git commit -m 'feat(proxy): add retry on origin timeout'`
5. Push to the branch and open a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
