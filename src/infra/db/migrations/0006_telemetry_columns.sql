-- 0006: Account scoping + rich per-request telemetry.
-- NOTE: SQLite ADD COLUMN cannot carry REFERENCES or a non-null default. Plain nullable only.

ALTER TABLE goals  ADD COLUMN account_id TEXT;
ALTER TABLE pools  ADD COLUMN account_id TEXT;

ALTER TABLE request_logs ADD COLUMN account_id      TEXT;
ALTER TABLE request_logs ADD COLUMN api_key_id      TEXT;
ALTER TABLE request_logs ADD COLUMN provider_slug   TEXT;
ALTER TABLE request_logs ADD COLUMN model_name      TEXT;
ALTER TABLE request_logs ADD COLUMN route_protocol  TEXT;
ALTER TABLE request_logs ADD COLUMN is_stream       TEXT;
ALTER TABLE request_logs ADD COLUMN client_name     TEXT;
ALTER TABLE request_logs ADD COLUMN trace_id        TEXT;

CREATE INDEX IF NOT EXISTS idx_goals_account   ON goals(account_id);
CREATE INDEX IF NOT EXISTS idx_pools_account   ON pools(account_id);
CREATE INDEX IF NOT EXISTS idx_logs_account_created ON request_logs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_key_created     ON request_logs(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_model_created   ON request_logs(model_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_status_created  ON request_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace           ON request_logs(trace_id);