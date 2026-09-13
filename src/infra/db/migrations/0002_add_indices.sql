-- Adds missing indices for retention purge performance and foreign-key lookups.

CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_provider_connections_provider_id ON provider_connections(provider_id);
CREATE INDEX IF NOT EXISTS idx_pools_goal_id ON pools(goal_id);
CREATE INDEX IF NOT EXISTS idx_pool_steps_connection_id ON pool_steps(connection_id);
CREATE INDEX IF NOT EXISTS idx_pool_steps_model_id ON pool_steps(model_id);