-- 0005: Multi-tenant accounts and hashed API keys.

CREATE TABLE IF NOT EXISTS accounts (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL UNIQUE,
    description             TEXT,
    status                  TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','suspended','deleted')),
    default_pool_id         TEXT REFERENCES pools(id),
    default_goal_id         TEXT REFERENCES goals(id),
    monthly_budget_usd      REAL,
    rate_limit_rpm          INTEGER,
    rate_limit_tpm          INTEGER,
    max_keys                INTEGER NOT NULL DEFAULT 20,
    metadata                TEXT NOT NULL DEFAULT '{}',
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
    id                      TEXT PRIMARY KEY,
    account_id              TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    key_lookup              TEXT NOT NULL,   -- first 16 chars of the plaintext key; O(1) index probe
    key_hash                TEXT NOT NULL,   -- hex HMAC-SHA256(plaintext, pepper)
    key_hint                TEXT NOT NULL,   -- display only, e.g. 'gr_live_ab12...9xQz'
    scopes                  TEXT NOT NULL DEFAULT '[\"chat\"]',
    pool_id                 TEXT REFERENCES pools(id),   -- optional hard pin
    status                  TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','revoked','rotated')),
    rotated_from_id         TEXT,
    rotated_to_id           TEXT,
    last_used_at            INTEGER,
    request_count           INTEGER NOT NULL DEFAULT 0,
    expires_at              INTEGER,
    created_at              INTEGER NOT NULL,
    revoked_at              INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_lookup ON api_keys(key_lookup);
CREATE INDEX IF NOT EXISTS idx_api_keys_account_status ON api_keys(account_id, status);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);