-- 0009: System settings table for token/config persistence (A3) and explicit default pool flag (P5)

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE pools ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
