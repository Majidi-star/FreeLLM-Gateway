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
  created_at: number;
  updated_at: number;
}

export class GoalRepository {
  constructor(private db: Database.Database) {}

  public create(goal: Omit<GoalRecord, 'id' | 'created_at' | 'updated_at'>): GoalRecord {
    const id = generateId('goal');
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO goals (
        id, name, task_type, target_requests_per_day, target_tokens_per_day, latency_pref, budget_pref,
        budget_cap_usd_monthly, exhaustion_pref, reliability_pref, safety_margin_pct, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      now,
      now
    );

    return this.findById(id)!;
  }

  public findById(id: string): GoalRecord | null {
    const stmt = this.db.prepare('SELECT * FROM goals WHERE id = ?');
    return (stmt.get(id) as GoalRecord) || null;
  }

  public listAll(): GoalRecord[] {
    const stmt = this.db.prepare('SELECT * FROM goals ORDER BY created_at DESC');
    return stmt.all() as GoalRecord[];
  }
}
