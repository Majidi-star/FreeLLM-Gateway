-- 0007: Pre-aggregated usage. Survives request_logs retention purges.

CREATE TABLE IF NOT EXISTS usage_rollups (
    bucket_start        INTEGER NOT NULL,  -- epoch ms, floored to the granularity
    granularity         TEXT    NOT NULL CHECK (granularity IN ('hour','day')),
    account_id          TEXT    NOT NULL DEFAULT '',   -- '' == unattributed/admin traffic
    api_key_id          TEXT    NOT NULL DEFAULT '',
    pool_id             TEXT    NOT NULL DEFAULT '',
    provider_slug       TEXT    NOT NULL DEFAULT '',
    model_name          TEXT    NOT NULL DEFAULT '',
    requests            INTEGER NOT NULL DEFAULT 0,
    requests_success    INTEGER NOT NULL DEFAULT 0,
    requests_failed     INTEGER NOT NULL DEFAULT 0,
    requests_timeout    INTEGER NOT NULL DEFAULT 0,
    tokens_in           INTEGER NOT NULL DEFAULT 0,
    tokens_out          INTEGER NOT NULL DEFAULT 0,
    tokens_cached       INTEGER NOT NULL DEFAULT 0,
    tokens_reasoning    INTEGER NOT NULL DEFAULT 0,
    cost_usd            REAL    NOT NULL DEFAULT 0,
    latency_sum_ms      INTEGER NOT NULL DEFAULT 0,
    latency_max_ms      INTEGER NOT NULL DEFAULT 0,
    ttft_sum_ms         INTEGER NOT NULL DEFAULT 0,
    ttft_count          INTEGER NOT NULL DEFAULT 0,
    fallback_count      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_start, granularity, account_id, api_key_id, pool_id, provider_slug, model_name)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_rollups_acct_gran_bucket
    ON usage_rollups(account_id, granularity, bucket_start);
CREATE INDEX IF NOT EXISTS idx_rollups_gran_bucket
    ON usage_rollups(granularity, bucket_start);

-- Per-account / per-key sliding-window counters for rate limiting.
CREATE TABLE IF NOT EXISTS tenant_rate_usage (
    scope_id        TEXT    NOT NULL,   -- 'account:<id>' | 'key:<id>'
    dimension       TEXT    NOT NULL,   -- 'requests' | 'tokens'
    window_start    INTEGER NOT NULL,   -- epoch ms, floored to 60_000
    used_value      REAL    NOT NULL DEFAULT 0,
    PRIMARY KEY (scope_id, dimension, window_start)
) WITHOUT ROWID;