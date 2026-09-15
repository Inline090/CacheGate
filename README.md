# Caching Proxy

An HTTP caching proxy that sits in front of an origin server, serves repeat requests
straight from Redis, and reports what the cache is doing through a small React
dashboard.

## What it does

- Proxies every request to a configurable origin server
- Caches `GET` responses in Redis with a TTL, keyed on HTTP method and URL
- Marks every response with `X-Cache: HIT` or `X-Cache: MISS`
- Deduplicates concurrent requests for the same uncached URL, so one origin fetch
  serves every caller waiting on it
- Logs per-route hit/miss stats and latency to PostgreSQL
- Serves those stats over HTTP for the React dashboard

## Stack

Node.js · Express · Redis · PostgreSQL · React (Vite) · Docker Compose

## Getting started

You need Node 20+ and Docker running.

```bash
npm install
docker compose up -d
npm run migrate --workspace=server
```

Start the proxy (listens on port 3000, forwards to `http://localhost:8080` by default):

```bash
npm run dev
```

Start the dashboard on http://localhost:5173:

```bash
npm run dev:client
```

Send the same request twice and watch the cache answer the second one:

```bash
curl -i http://localhost:3000/api/users
curl -i http://localhost:3000/api/users   # X-Cache: HIT
```

If you don't have an origin server handy, point the proxy at any local server with
`--origin`.

## Configuration

Copy `server/.env.example` to `server/.env` and adjust as needed. Every value has a
default, so nothing is required for local development.

| Variable       | Default                                                               | Purpose                               |
| -------------- | --------------------------------------------------------------------- | ------------------------------------- |
| `PORT`         | `3000`                                                                | Port the proxy listens on             |
| `ORIGIN`       | `http://localhost:8080`                                               | Server requests are forwarded to      |
| `REDIS_URL`    | `redis://localhost:6379`                                              | Cache connection                      |
| `CACHE_TTL`    | `60`                                                                  | Seconds a cached response stays valid |
| `DATABASE_URL` | `postgres://caching_proxy:caching_proxy@localhost:5433/caching_proxy` | Stats database                        |

Postgres is published on **5433** rather than the usual 5432 so it can't collide
with a database already running on your machine.

## CLI

```bash
npm start --workspace=server -- --port 4000
npm start --workspace=server -- --origin http://localhost:9000
npm start --workspace=server -- --clear-cache
```

Flags win over environment variables, which win over the defaults. `--clear-cache`
flushes Redis and exits — handy after repointing `--origin`, since cached entries
are keyed on the URL alone and don't know which origin they came from.

## Project structure

```
server/            Express proxy, Redis cache, Postgres stats, tests
  src/cache.js         Redis cache: keying, TTL, eligibility rules
  src/db/              connection pool, migrations, stats queries
  src/routes/          the proxy's own stats API
client/            React dashboard (Vite)
docker-compose.yml Redis + Postgres for local development
```

## Tests

```bash
npm test --workspace=server
```

The suite uses Node's built-in test runner, so there is no test framework to
install. It needs Redis and Postgres running (`docker compose up -d`) because the
proxy tests exercise the real cache and stats paths.
