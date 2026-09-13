-- Adds max_latency, target_quality, and min_availability columns to goals table.

ALTER TABLE goals ADD COLUMN max_latency INTEGER;
ALTER TABLE goals ADD COLUMN target_quality REAL;
ALTER TABLE goals ADD COLUMN min_availability REAL;
