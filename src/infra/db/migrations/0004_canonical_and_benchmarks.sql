-- Migration 0004: Add canonical model ID and 6-axis benchmark scores to models table

ALTER TABLE models ADD COLUMN canonical_id TEXT;
ALTER TABLE models ADD COLUMN bench_reasoning_score REAL;
ALTER TABLE models ADD COLUMN bench_coding_score REAL;
ALTER TABLE models ADD COLUMN bench_command_score REAL;
ALTER TABLE models ADD COLUMN bench_math_score REAL;
ALTER TABLE models ADD COLUMN bench_vision_score REAL;
ALTER TABLE models ADD COLUMN bench_long_context_score REAL;
