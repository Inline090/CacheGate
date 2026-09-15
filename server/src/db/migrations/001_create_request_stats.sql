CREATE TABLE request_stats (
  id           bigserial   PRIMARY KEY,
  method       text        NOT NULL,
  url          text        NOT NULL,
  status       integer     NOT NULL,
  cache_status text        NOT NULL CHECK (cache_status IN ('HIT', 'MISS')),
  duration_ms  integer     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX request_stats_created_at_idx ON request_stats (created_at);
CREATE INDEX request_stats_url_idx ON request_stats (url);
