import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';

export interface ModelRecord {
  id: string;
  provider_id: string;
  canonical_id?: string | null;
  model_name: string;
  display_name: string;
  context_window: number;
  supports_tools: number;
  supports_vision: number;
  cost_input_per_1k: number;
  cost_output_per_1k: number;
  bench_tps: number | null;
  bench_ttft_ms: number | null;
  bench_p95_latency_ms: number | null;
  bench_reasoning_score?: number | null;
  bench_coding_score?: number | null;
  bench_command_score?: number | null;
  bench_math_score?: number | null;
  bench_vision_score?: number | null;
  bench_long_context_score?: number | null;
  task_fitness: string; // JSON string
  is_active: number;
}

export class ModelRepository {
  constructor(private db: Database.Database) {}

  public upsert(model: Omit<ModelRecord, 'id'> & { id?: string }): ModelRecord {
    const existing = this.findByProviderAndName(model.provider_id, model.model_name);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE models
        SET canonical_id = ?, display_name = ?, context_window = ?, supports_tools = ?, supports_vision = ?,
            cost_input_per_1k = ?, cost_output_per_1k = ?, bench_tps = ?, bench_ttft_ms = ?,
            bench_p95_latency_ms = ?, bench_reasoning_score = ?, bench_coding_score = ?,
            bench_command_score = ?, bench_math_score = ?, bench_vision_score = ?,
            bench_long_context_score = ?, task_fitness = ?, is_active = ?
        WHERE id = ?
      `);
      stmt.run(
        model.canonical_id || null,
        model.display_name,
        model.context_window,
        model.supports_tools ? 1 : 0,
        model.supports_vision ? 1 : 0,
        model.cost_input_per_1k || 0,
        model.cost_output_per_1k || 0,
        model.bench_tps || null,
        model.bench_ttft_ms || null,
        model.bench_p95_latency_ms || null,
        model.bench_reasoning_score ?? null,
        model.bench_coding_score ?? null,
        model.bench_command_score ?? null,
        model.bench_math_score ?? null,
        model.bench_vision_score ?? null,
        model.bench_long_context_score ?? null,
        model.task_fitness || '{}',
        model.is_active ?? 1,
        existing.id
      );
      return this.findById(existing.id)!;
    } else {
      const id = model.id || generateId('mdl');
      const stmt = this.db.prepare(`
        INSERT INTO models (
          id, provider_id, canonical_id, model_name, display_name, context_window, supports_tools, supports_vision,
          cost_input_per_1k, cost_output_per_1k, bench_tps, bench_ttft_ms, bench_p95_latency_ms,
          bench_reasoning_score, bench_coding_score, bench_command_score, bench_math_score, bench_vision_score, bench_long_context_score,
          task_fitness, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        model.provider_id,
        model.canonical_id || null,
        model.model_name,
        model.display_name,
        model.context_window,
        model.supports_tools ? 1 : 0,
        model.supports_vision ? 1 : 0,
        model.cost_input_per_1k || 0,
        model.cost_output_per_1k || 0,
        model.bench_tps || null,
        model.bench_ttft_ms || null,
        model.bench_p95_latency_ms || null,
        model.bench_reasoning_score ?? null,
        model.bench_coding_score ?? null,
        model.bench_command_score ?? null,
        model.bench_math_score ?? null,
        model.bench_vision_score ?? null,
        model.bench_long_context_score ?? null,
        model.task_fitness || '{}',
        model.is_active ?? 1
      );
      return this.findById(id)!;
    }
  }

  public findById(id: string): ModelRecord | null {
    const stmt = this.db.prepare('SELECT * FROM models WHERE id = ?');
    return (stmt.get(id) as ModelRecord) || null;
  }

  public findByProviderAndName(providerId: string, modelName: string): ModelRecord | null {
    const stmt = this.db.prepare('SELECT * FROM models WHERE provider_id = ? AND model_name = ?');
    return (stmt.get(providerId, modelName) as ModelRecord) || null;
  }

  public listByProviderId(providerId: string): ModelRecord[] {
    const stmt = this.db.prepare('SELECT * FROM models WHERE provider_id = ? AND is_active = 1 ORDER BY display_name ASC');
    return stmt.all(providerId) as ModelRecord[];
  }

  public listAll(): ModelRecord[] {
    const stmt = this.db.prepare('SELECT * FROM models WHERE is_active = 1 ORDER BY display_name ASC');
    return stmt.all() as ModelRecord[];
  }
}
