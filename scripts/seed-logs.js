import Database from 'better-sqlite3';
import { ulid } from 'ulid';

const db = new Database('./data/goalroute.db');

const connections = db.prepare('SELECT id, provider_id FROM provider_connections LIMIT 5').all();
const geminiConn = connections[0]?.id;
const groqConn = connections[1]?.id;

const models = db.prepare('SELECT id, model_name FROM models LIMIT 5').all();
const model1 = models[0]?.id || null;
const model2 = models[1]?.id || null;

const logs = [
  {
    conn: groqConn,
    model: model1,
    model_name: 'llama-3.3-70b-versatile',
    provider_slug: 'groq',
    status: 'success',
    latency_ms: 78,
    ttft_ms: 62,
    tokens_in: 412,
    tokens_out: 284,
    cost_usd: 0.0,
    route_protocol: 'openai',
    client_name: 'Cursor IDE',
    fallback_used: 0,
    decision_trace: JSON.stringify([
      { modelId: 'llama-3.3-70b-versatile', providerSlug: 'groq', latencyMs: 78, status: 'selected', reason: 'Primary winner: lowest TTFT (62ms) & zero rate limit' },
      { modelId: 'llama-3.3-70b', providerSlug: 'cerebras', latencyMs: 95, status: 'filtered', reason: 'Secondary candidate standby' }
    ])
  },
  {
    conn: geminiConn,
    model: model2,
    model_name: 'gemini-2.5-flash',
    provider_slug: 'gemini',
    status: 'success',
    latency_ms: 112,
    ttft_ms: 88,
    tokens_in: 1240,
    tokens_out: 850,
    cost_usd: 0.0,
    route_protocol: 'anthropic',
    client_name: 'Claude Desktop',
    fallback_used: 0,
    decision_trace: JSON.stringify([
      { modelId: 'gemini-2.5-flash', providerSlug: 'gemini', latencyMs: 112, status: 'selected', reason: 'Optimal context fit (1M token capacity)' }
    ])
  },
  {
    conn: groqConn,
    model: model1,
    model_name: 'deepseek-r1-distill-llama-70b',
    provider_slug: 'groq',
    status: 'success',
    latency_ms: 145,
    ttft_ms: 110,
    tokens_in: 820,
    tokens_out: 1420,
    cost_usd: 0.0,
    route_protocol: 'openai',
    client_name: 'Cline Autonomous Agent',
    fallback_used: 0,
    decision_trace: JSON.stringify([
      { modelId: 'deepseek-r1-distill-llama-70b', providerSlug: 'groq', latencyMs: 145, status: 'selected', reason: 'Deep reasoning objective satisfied' }
    ])
  },
  {
    conn: groqConn,
    model: model1,
    model_name: 'llama-3.3-70b',
    provider_slug: 'groq',
    status: 'success',
    latency_ms: 64,
    ttft_ms: 48,
    tokens_in: 550,
    tokens_out: 320,
    cost_usd: 0.0,
    route_protocol: 'openai',
    client_name: 'Windsurf Agent',
    fallback_used: 1,
    decision_trace: JSON.stringify([
      { modelId: 'llama-3.3-70b-versatile', providerSlug: 'groq', latencyMs: 0, status: 'failed', error: 'HTTP 429 Quota Exhausted' },
      { modelId: 'llama-3.3-70b', providerSlug: 'groq', latencyMs: 64, status: 'selected', reason: 'Instant auto-failover in 4ms' }
    ])
  },
  {
    conn: geminiConn,
    model: model2,
    model_name: 'gemini-2.5-pro',
    provider_slug: 'gemini',
    status: 'success',
    latency_ms: 185,
    ttft_ms: 140,
    tokens_in: 2100,
    tokens_out: 1650,
    cost_usd: 0.0,
    route_protocol: 'openai',
    client_name: 'LangChain Multi-Agent',
    fallback_used: 0,
    decision_trace: JSON.stringify([
      { modelId: 'gemini-2.5-pro', providerSlug: 'gemini', latencyMs: 185, status: 'selected', reason: 'High-precision research synthesis' }
    ])
  }
];

const pool = db.prepare('SELECT id FROM pools LIMIT 1').get();
const poolId = pool?.id || null;

const stmt = db.prepare(`
  INSERT INTO request_logs (
    id, pool_id, connection_id, model_id, status, latency_ms, tokens_in, tokens_out, cost_usd, error_code, decision_trace,
    account_id, api_key_id, provider_slug, model_name, route_protocol, is_stream, client_name, trace_id,
    ttft_ms, attempt_count, fallback_used, tokens_cached, tokens_reasoning, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (let i = 0; i < logs.length; i++) {
  const l = logs[i];
  const id = `req_${ulid()}`;
  const now = Date.now() - (logs.length - i) * 15000;
  stmt.run(
    id,
    poolId,
    l.conn,
    l.model,
    l.status,
    l.latency_ms,
    l.tokens_in,
    l.tokens_out,
    l.cost_usd,
    null,
    l.decision_trace,
    null,
    null,
    l.provider_slug,
    l.model_name,
    l.route_protocol,
    '1',
    l.client_name,
    `tr-${id.slice(-8)}`,
    l.ttft_ms,
    1,
    l.fallback_used,
    120,
    250,
    now
  );
}

console.log(`[✓] Seeded ${logs.length} realistic request logs.`);
