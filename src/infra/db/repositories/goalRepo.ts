import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';
import {
  TaskType,
  LatencyPreference,
  BudgetPreference,
  ExhaustionPreference,
  ReliabilityPreference,
} from '../../../shared/types.js';

export interface GoalRecord {
  id: string;
  name: string;
  task_type: TaskType;
  target_requests_per_day: number | null;
  target_tokens_per_day: number | null;
  latency_pref: LatencyPreference;
  budget_pref: BudgetPreference;
  budget_cap_usd_monthly: number | null;
  exhaustion_pref: ExhaustionPreference;
  reliability_pref: ReliabilityPreference;
  safety_margin_pct: number;
  max_latency: number | null;
  target_quality: number | null;
  min_availability: number | null;
  created_at: number;
  updated_at: number;
  account_id: string | null;
}

export class GoalRepository {
  constructor(private db: Database.Database) {}

  public create(goal: Omit<GoalRecord, 'id' | 'created_at' | 'updated_at' | 'account_id'> & { account_id?: string | null }): GoalRecord {
    const id = generateId('goal');
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO goals (
        id, name, task_type, target_requests_per_day, target_tokens_per_day, latency_pref, budget_pref,
        budget_cap_usd_monthly, exhaustion_pref, reliability_pref, safety_margin_pct,
        max_latency, target_quality, min_availability, account_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const g = goal as any;
    const taskType = goal.task_type || g.taskType || 'general';
    const targetReqs = goal.target_requests_per_day ?? g.targetRequestsPerDay ?? null;
    const targetTokens = goal.target_tokens_per_day ?? g.targetTokensPerDay ?? null;
    const latencyPref = goal.latency_pref || g.latencyPref || 'relaxed';
    const budgetPref = goal.budget_pref || g.budgetPref || 'free';
    const budgetCap = goal.budget_cap_usd_monthly ?? g.budgetCapUsdMonthly ?? null;
    const exhaustionPref = goal.exhaustion_pref || g.exhaustionPref || 'preserve_backup';
    const reliabilityPref = goal.reliability_pref || g.reliabilityPref || 'standard';
    const safetyMarginPct = goal.safety_margin_pct ?? g.safetyMarginPct ?? 20.0;
    const maxLatency = goal.max_latency ?? g.maxLatency ?? null;
    const targetQuality = goal.target_quality ?? g.targetQuality ?? null;
    const minAvailability = goal.min_availability ?? g.minAvailability ?? null;
    const accountId = goal.account_id ?? g.accountId ?? null;

    stmt.run(
      id,
      goal.name,
      taskType,
      targetReqs,
      targetTokens,
      latencyPref,
      budgetPref,
      budgetCap,
      exhaustionPref,
      reliabilityPref,
      safetyMarginPct,
      maxLatency,
      targetQuality,
      minAvailability,
      accountId,
      now,
      now
    );

    return this.findById(id)!;
  }
  public findById(id: string): GoalRecord | null {
    const stmt = this.db.prepare('SELECT * FROM goals WHERE id = ?');
    return (stmt.get(id) as GoalRecord) || null;
  }

  public listAll(accountId?: string | null): GoalRecord[] {
    if (accountId !== undefined) {
      const stmt = this.db.prepare('SELECT * FROM goals WHERE account_id = ? OR account_id IS NULL ORDER BY created_at DESC');
      return stmt.all(accountId) as GoalRecord[];
    }
    const stmt = this.db.prepare('SELECT * FROM goals ORDER BY created_at DESC');
    return stmt.all() as GoalRecord[];
  }

  public update(id: string, updates: Partial<Omit<GoalRecord, 'id' | 'created_at'>>): GoalRecord | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updated_at: Date.now() };
    const stmt = this.db.prepare(`
      UPDATE goals SET
        name = ?, task_type = ?, target_requests_per_day = ?, target_tokens_per_day = ?,
        latency_pref = ?, budget_pref = ?, budget_cap_usd_monthly = ?, exhaustion_pref = ?,
        reliability_pref = ?, safety_margin_pct = ?, max_latency = ?, target_quality = ?,
        min_availability = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      merged.name,
      merged.task_type,
      merged.target_requests_per_day,
      merged.target_tokens_per_day,
      merged.latency_pref,
      merged.budget_pref,
      merged.budget_cap_usd_monthly,
      merged.exhaustion_pref,
      merged.reliability_pref,
      merged.safety_margin_pct,
      merged.max_latency,
      merged.target_quality,
      merged.min_availability,
      merged.updated_at,
      id
    );

    return this.findById(id);
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM goals WHERE id = ?');
    const res = stmt.run(id);
    return res.changes > 0;
  }
}
