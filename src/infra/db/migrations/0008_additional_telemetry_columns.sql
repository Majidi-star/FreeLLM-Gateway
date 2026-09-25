-- 0008: Additional telemetry columns for Phase 7 cost accounting.
-- These columns were added after 0006 was shipped, so they go in a separate migration.

ALTER TABLE request_logs ADD COLUMN ttft_ms         INTEGER;
ALTER TABLE request_logs ADD COLUMN attempt_count   INTEGER;
ALTER TABLE request_logs ADD COLUMN fallback_used   INTEGER;
ALTER TABLE request_logs ADD COLUMN tokens_cached   INTEGER;
ALTER TABLE request_logs ADD COLUMN tokens_reasoning INTEGER;