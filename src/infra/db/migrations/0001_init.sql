-- ============================================================
-- 0001_init.sql — Initial GoalRoute Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS providers (
    id              TEXT PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    base_url        TEXT NOT NULL,
    auth_type       TEXT NOT NULL CHECK (auth_type IN ('api_key','oauth','keyless')),
    protocol        TEXT NOT NULL CHECK (protocol IN ('openai','anthropic','gemini','custom')),
    docs_url        TEXT,
    capabilities    TEXT NOT NULL DEFAULT '{}',
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_connections (
    id                  TEXT PRIMARY KEY,
    provider_id         TEXT NOT NULL REFERENCES providers(id),
    label               TEXT NOT NULL,
    credential_enc      BLOB NOT NULL,
    credential_iv       BLOB NOT NULL,
    credential_tag      BLOB NOT NULL,
    tier                TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','paid','subscription')),
    status              TEXT NOT NULL DEFAULT 'untested'
                            CHECK (status IN ('untested','healthy','unavailable','expired','banned')),
    last_tested_at      INTEGER,
    last_error          TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
    id                  TEXT PRIMARY KEY,
    provider_id         TEXT NOT NULL REFERENCES providers(id),
    model_name          TEXT NOT NULL,
    display_name        TEXT NOT NULL,
    context_window      INTEGER NOT NULL,
    supports_tools      INTEGER NOT NULL DEFAULT 0,
    supports_vision     INTEGER NOT NULL DEFAULT 0,
    cost_input_per_1k   REAL NOT NULL DEFAULT 0,
    cost_output_per_1k  REAL NOT NULL DEFAULT 0,
    bench_tps           REAL,
    bench_ttft_ms       REAL,
    bench_p95_latency_ms REAL,
    task_fitness        TEXT NOT NULL DEFAULT '{}',
    is_active           INTEGER NOT NULL DEFAULT 1,
    UNIQUE(provider_id, model_name)
);

CREATE TABLE IF NOT EXISTS quota_policies (
    id                  TEXT PRIMARY KEY,
    connection_id       TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    dimension           TEXT NOT NULL,
    window_seconds      INTEGER NOT NULL,
    limit_value         REAL NOT NULL,
    reset_anchor        TEXT NOT NULL DEFAULT 'rolling' CHECK (reset_anchor IN ('rolling','fixed_utc_midnight')),
    UNIQUE(connection_id, dimension)
);

CREATE TABLE IF NOT EXISTS quota_usage (
    connection_id       TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    dimension           TEXT NOT NULL,
    window_start        INTEGER NOT NULL,
    used_value          REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, dimension, window_start)
);

CREATE TABLE IF NOT EXISTS health_state (
    connection_id       TEXT PRIMARY KEY REFERENCES provider_connections(id) ON DELETE CASCADE,
    state               TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed','open','half_open')),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    opened_at           INTEGER,
    cooldown_until      INTEGER,
    updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    task_type               TEXT NOT NULL CHECK (task_type IN ('coding_agent','chatbot','batch','research','general')),
    target_requests_per_day INTEGER,
    target_tokens_per_day   INTEGER,
    latency_pref            TEXT NOT NULL DEFAULT 'relaxed' CHECK (latency_pref IN ('instant','relaxed')),
    budget_pref             TEXT NOT NULL DEFAULT 'free' CHECK (budget_pref IN ('free','capped','unlimited')),
    budget_cap_usd_monthly  REAL,
    exhaustion_pref         TEXT NOT NULL DEFAULT 'preserve_backup'
                                CHECK (exhaustion_pref IN ('fill_first','preserve_backup')),
    reliability_pref        TEXT NOT NULL DEFAULT 'standard' CHECK (reliability_pref IN ('standard','maximum')),
    safety_margin_pct       REAL NOT NULL DEFAULT 20.0,
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pools (
    id              TEXT PRIMARY KEY,
    goal_id         TEXT REFERENCES goals(id),
    name            TEXT NOT NULL,
    policy          TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pool_steps (
    id              TEXT PRIMARY KEY,
    pool_id         TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    order_index     INTEGER NOT NULL,
    connection_id   TEXT NOT NULL REFERENCES provider_connections(id),
    model_id        TEXT NOT NULL REFERENCES models(id),
    role            TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','backup','overflow')),
    weight          REAL NOT NULL DEFAULT 1.0,
    UNIQUE(pool_id, order_index)
);

CREATE TABLE IF NOT EXISTS request_logs (
    id              TEXT PRIMARY KEY,
    pool_id         TEXT REFERENCES pools(id),
    connection_id   TEXT REFERENCES provider_connections(id),
    model_id        TEXT REFERENCES models(id),
    status          TEXT NOT NULL CHECK (status IN ('success','failed','timeout')),
    latency_ms      INTEGER,
    tokens_in       INTEGER,
    tokens_out      INTEGER,
    cost_usd        REAL,
    error_code      TEXT,
    decision_trace  TEXT,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_logs_pool_created ON request_logs(pool_id, created_at);
CREATE INDEX IF NOT EXISTS idx_quota_usage_lookup ON quota_usage(connection_id, dimension, window_start);
