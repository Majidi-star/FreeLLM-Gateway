import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { QuotaRepository } from '../infra/db/repositories/quotaRepo.js';
import { HealthRepository } from '../infra/db/repositories/healthRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { GoalService } from './goalService.js';
import { PoolService } from './poolService.js';
import { ProviderService } from './providerService.js';
import { AccountService } from './accountService.js';
import { CatalogService } from '../catalog/catalogService.js';
import { StatsService } from './statsService.js';
import { RequestLogRepository } from '../infra/db/repositories/requestLogRepo.js';
import { ApiKeyRepository } from '../infra/db/repositories/apiKeyRepo.js';
import { AccountRepository } from '../infra/db/repositories/accountRepo.js';
import { GoalRepository, GoalRecord } from '../infra/db/repositories/goalRepo.js';
import { ConnectionTier, TaskType, LatencyPreference, BudgetPreference, ExhaustionPreference, RoutingPolicyName } from '../shared/types.js';
import { logger } from '../infra/logger.js';
import pLimit from 'p-limit';

export class McpService {
  private server: Server;
  private isSafeMode: boolean = true;
  private sseTransports: Map<string, SSEServerTransport> = new Map();

  constructor(
    private quotaRepo: QuotaRepository,
    private healthRepo: HealthRepository,
    private connectionRepo: ConnectionRepository,
    private providerRepo: ProviderRepository,
    private goalService: GoalService,
    private poolService: PoolService,
    private providerService: ProviderService,
    private accountService?: AccountService,
    private catalogService?: CatalogService,
    private statsService?: StatsService,
    private logRepo?: RequestLogRepository,
    private apiKeyRepo?: ApiKeyRepository,
    private accountRepo?: AccountRepository,
    private goalRepo?: GoalRepository
  ) {
    this.server = new Server(
      {
        name: 'goalroute-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerHandlers();
  }

  public setSafeMode(enabled: boolean): void {
    this.isSafeMode = enabled;
    logger.info({ safeMode: enabled }, 'GoalRoute MCP Safe Mode updated');
  }

  public getSafeMode(): boolean {
    return this.isSafeMode;
  }

  public getToolDefinitions() {
    return [
      {
        name: 'list_providers_and_connections',
        description: 'List all LLM provider catalog entries and configured API connections with credentials and health.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mutate_connections',
        description: 'Add, update, delete, or test provider API connection settings (API keys, tier, priorities, custom base URL).',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'delete', 'test'], description: 'Connection action' },
            connectionId: { type: 'string', description: 'Target connection ID' },
            providerSlug: { type: 'string', description: 'Provider slug (e.g. openai, anthropic, gemini, groq, deepseek, ollama)' },
            label: { type: 'string', description: 'Connection label' },
            apiKey: { type: 'string', description: 'API Key credential' },
            tier: { type: 'string', enum: ['free', 'paid', 'subscription'], description: 'Connection tier' },
            baseUrl: { type: 'string', description: 'Custom endpoint base URL override' },
          },
          required: ['action'],
        },
      },
      {
        name: 'list_goals',
        description: 'List all active routing goals, policies, and latency/reliability constraints.',
        inputSchema: {
          type: 'object',
          properties: {
            accountId: { type: 'string', description: 'Optional account filter' },
          },
        },
      },
      {
        name: 'mutate_goals',
        description: 'Create, update, or delete routing goals (defining LLM routing strategies and fallback chains).',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'Goal mutation action' },
            goalId: { type: 'string', description: 'Target goal ID' },
            name: { type: 'string', description: 'Goal name' },
            taskType: { type: 'string', description: 'Task category (coding_agent, chatbot, batch, research, general)' },
            strategy: { type: 'string', description: 'Routing policy (fallback, round-robin, latency-based, cost-optimized)' },
            description: { type: 'string', description: 'Description of the goal' },
            maxLatencyMs: { type: 'number', description: 'Maximum acceptable latency ceiling in ms' },
            preferReasoning: { type: 'boolean', description: 'Whether reasoning capability is required' },
          },
          required: ['action'],
        },
      },
      {
        name: 'list_pools',
        description: 'List all routing pools, policy strategies, and candidate model steps.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mutate_pools',
        description: 'Create, update, toggle active status, or delete routing pools.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'delete', 'toggle'], description: 'Pool action to perform' },
            goalId: { type: 'string', description: 'Goal ID for pool creation' },
            name: { type: 'string', description: 'Name of the pool' },
            poolId: { type: 'string', description: 'Target pool ID' },
            isActive: { type: 'boolean', description: 'Whether the pool is active' },
            policy: { type: 'string', description: 'Routing policy' },
          },
          required: ['action'],
        },
      },
      {
        name: 'list_accounts',
        description: 'List tenant accounts, tiers, monthly budget caps, and rate limit ceilings (RPM/TPM).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mutate_accounts',
        description: 'Create, update, or delete tenant accounts and configure custom rate limits.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'Account action' },
            accountId: { type: 'string', description: 'Target account ID' },
            name: { type: 'string', description: 'Account name' },
            description: { type: 'string', description: 'Account description' },
            status: { type: 'string', enum: ['active', 'suspended', 'deleted'], description: 'Account status' },
            rateLimitRpm: { type: 'number', description: 'Requests per minute limit' },
            rateLimitTpm: { type: 'number', description: 'Tokens per minute limit' },
            defaultPoolId: { type: 'string', description: 'Default routing pool ID' },
          },
          required: ['action'],
        },
      },
      {
        name: 'list_api_keys',
        description: 'List system or tenant API keys, pinned pool bindings, and last-used statistics.',
        inputSchema: {
          type: 'object',
          properties: {
            accountId: { type: 'string', description: 'Optional account filter' },
          },
        },
      },
      {
        name: 'mutate_api_keys',
        description: 'Generate new tenant API keys or revoke existing ones.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'delete'], description: 'API key action' },
            keyId: { type: 'string', description: 'API key ID (for delete/revoke)' },
            accountId: { type: 'string', description: 'Account ID (for creation)' },
            name: { type: 'string', description: 'Key label/name' },
            poolId: { type: 'string', description: 'Optional pinned pool ID' },
          },
          required: ['action'],
        },
      },
      {
        name: 'check_quota',
        description: 'Inspect remaining daily quotas, rate limit counters, and provider health states.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'probe_provider_keys',
        description: 'Test live health, latency, and availability of all configured provider keys.',
        inputSchema: {
          type: 'object',
          properties: {
            connectionId: { type: 'string', description: 'Optional specific connection ID to probe' },
          },
        },
      },
      {
        name: 'solve_routing_goal',
        description: 'Determine the optimal free LLM route based on task requirements and constraints.',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task description or category (code, reasoning, chat, general)' },
            goalId: { type: 'string', description: 'Optional explicit Goal ID to evaluate' },
            maxLatencyMs: { type: 'number', description: 'Maximum acceptable latency in milliseconds' },
            preferReasoning: { type: 'boolean', description: 'Whether reasoning capabilities are preferred' },
          },
          required: ['task'],
        },
      },
      {
        name: 'get_system_stats_and_logs',
        description: 'Query gateway request logs, traffic volume, error rates, and average latency metrics.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum log items to return (default 20)' },
            filter: { type: 'string', enum: ['error', 'success', 'all'], description: 'Log status filter' },
          },
        },
      },
      {
        name: 'sync_model_catalog',
        description: 'Trigger automatic catalog refresh and synchronization across LLM providers and models.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mutate_system_settings',
        description: 'Update Gateway operational settings including Safe Mode and remote access.',
        inputSchema: {
          type: 'object',
          properties: {
            isSafeMode: { type: 'boolean', description: 'Set MCP safe mode toggle' },
          },
        },
      },
    ];
  }

  public async callTool(name: string, args: Record<string, any> = {}) {
    // Audit safe-mode enforcement for mutation operations
    const mutationTools = [
      'mutate_connections',
      'mutate_goals',
      'mutate_pools',
      'mutate_accounts',
      'mutate_api_keys',
      'sync_model_catalog',
    ];

    if (this.isSafeMode && mutationTools.includes(name)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Operation '${name}' denied: GoalRoute is operating in Safe Mode. Disable Safe Mode in MCP settings to execute mutations.`
      );
    }

    switch (name) {
      case 'list_providers_and_connections':
        return this.handleListProvidersAndConnections();
      case 'mutate_connections':
        return this.handleMutateConnections(args as any);
      case 'list_goals':
        return this.handleListGoals(args as any);
      case 'mutate_goals':
        return this.handleMutateGoals(args as any);
      case 'list_pools':
        return this.handleListPools();
      case 'mutate_pools':
        return this.handleMutatePools(args as any);
      case 'list_accounts':
        return this.handleListAccounts();
      case 'mutate_accounts':
        return this.handleMutateAccounts(args as any);
      case 'list_api_keys':
        return this.handleListApiKeys(args as any);
      case 'mutate_api_keys':
        return this.handleMutateApiKeys(args as any);
      case 'check_quota':
        return this.handleCheckQuota();
      case 'probe_provider_keys':
        return this.handleProbeProviderKeys(args as any);
      case 'solve_routing_goal':
        return this.handleSolveRoutingGoal(args as any);
      case 'get_system_stats_and_logs':
        return this.handleGetSystemStatsAndLogs(args as any);
      case 'sync_model_catalog':
        return this.handleSyncModelCatalog();
      case 'mutate_system_settings':
        return this.handleMutateSystemSettings(args as any);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.getToolDefinitions() };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return this.callTool(name, (args as any) || {});
    });
  }

  private async handleListProvidersAndConnections() {
    const data = this.providerService.getProvidersWithConnections();
    return {
      content: [{ type: 'text', text: JSON.stringify({ providers: data, count: data.length }, null, 2) }],
    };
  }

  private async handleMutateConnections(args: {
    action: 'create' | 'update' | 'delete' | 'test';
    connectionId?: string;
    providerSlug?: string;
    label?: string;
    apiKey?: string;
    tier?: ConnectionTier;
    baseUrl?: string;
  }) {
    if (args.action === 'create') {
      if (!args.providerSlug || !args.apiKey) {
        throw new McpError(ErrorCode.InvalidParams, 'providerSlug and apiKey are required for creating a connection.');
      }
      const conn = await this.providerService.addConnection({
        providerSlug: args.providerSlug,
        apiKey: args.apiKey,
        label: args.label,
        tier: args.tier || 'free',
        baseUrl: args.baseUrl,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Connection created successfully', connection: conn }, null, 2) }] };
    }

    if (args.action === 'delete') {
      if (!args.connectionId) throw new McpError(ErrorCode.InvalidParams, 'connectionId is required for delete');
      this.providerService.removeConnection(args.connectionId);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Connection removed', connectionId: args.connectionId }) }] };
    }

    if (args.action === 'test') {
      if (!args.connectionId) throw new McpError(ErrorCode.InvalidParams, 'connectionId is required for test');
      const res = await this.providerService.testConnection(args.connectionId);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    throw new McpError(ErrorCode.InvalidParams, `Unsupported connection action: ${args.action}`);
  }

  private async handleListGoals(args: { accountId?: string }) {
    const goals = this.goalService.listGoals(args.accountId);
    return { content: [{ type: 'text', text: JSON.stringify({ goals, count: goals.length }, null, 2) }] };
  }

  private async handleMutateGoals(args: {
    action: 'create' | 'update' | 'delete';
    goalId?: string;
    name?: string;
    taskType?: string;
    strategy?: string;
    description?: string;
    maxLatencyMs?: number;
    preferReasoning?: boolean;
    accountId?: string;
  }) {
    if (args.action === 'create') {
      if (!args.name || !args.taskType) {
        throw new McpError(ErrorCode.InvalidParams, 'name and taskType are required for goal creation.');
      }
      const taskType: TaskType = (args.taskType as TaskType) || 'general';
      const goal = this.goalService.createGoal({
        name: args.name,
        task_type: taskType,
        target_requests_per_day: null,
        target_tokens_per_day: null,
        latency_pref: args.strategy === 'latency-based' ? 'instant' : 'relaxed',
        budget_pref: 'free',
        budget_cap_usd_monthly: null,
        exhaustion_pref: 'fill_first',
        reliability_pref: 'standard',
        safety_margin_pct: 20,
        max_latency: args.maxLatencyMs || null,
        target_quality: args.preferReasoning ? 90 : 70,
        min_availability: 95,
        account_id: args.accountId || null,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Goal created', goal }, null, 2) }] };
    }

    if (args.action === 'delete') {
      if (!args.goalId) throw new McpError(ErrorCode.InvalidParams, 'goalId is required for goal deletion');
      this.goalService.deleteGoal(args.goalId);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Goal deleted', goalId: args.goalId }) }] };
    }

    if (args.action === 'update') {
      if (!args.goalId) throw new McpError(ErrorCode.InvalidParams, 'goalId is required for goal update');
      const updates: Partial<Omit<GoalRecord, 'id' | 'created_at'>> = {};
      if (args.name) updates.name = args.name;
      if (args.taskType) updates.task_type = args.taskType as TaskType;

      const updated = this.goalService.updateGoal(args.goalId, updates);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Goal updated', goal: updated }, null, 2) }] };
    }

    throw new McpError(ErrorCode.InvalidParams, `Unsupported goal action: ${args.action}`);
  }

  private async handleListPools() {
    const pools = this.poolService.listPools();
    return { content: [{ type: 'text', text: JSON.stringify({ pools, count: pools.length }, null, 2) }] };
  }

  private async handleMutatePools(args: {
    action: 'create' | 'update' | 'delete' | 'toggle';
    goalId?: string;
    name?: string;
    poolId?: string;
    isActive?: boolean;
    policy?: string;
  }) {
    if (args.action === 'create') {
      if (!args.goalId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required argument: goalId');
      }
      const pool = this.poolService.createPoolFromGoal(args.goalId, args.name);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Pool created successfully', pool }, null, 2) }] };
    }

    if (args.action === 'toggle') {
      if (!args.poolId || typeof args.isActive !== 'boolean') {
        throw new McpError(ErrorCode.InvalidParams, 'poolId and isActive (boolean) are required for toggle');
      }
      const pool = this.poolService.updatePool(args.poolId, { isActive: args.isActive });
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Pool status updated', pool }, null, 2) }] };
    }

    if (args.action === 'delete') {
      if (!args.poolId) throw new McpError(ErrorCode.InvalidParams, 'poolId is required for delete');
      this.poolService.deletePool(args.poolId);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Pool deleted', poolId: args.poolId }) }] };
    }

    throw new McpError(ErrorCode.InvalidParams, `Unsupported pool action: ${args.action}`);
  }

  private async handleListAccounts() {
    if (!this.accountService) {
      return { content: [{ type: 'text', text: JSON.stringify({ accounts: [] }) }] };
    }
    const accounts = this.accountService.listAccounts();
    return { content: [{ type: 'text', text: JSON.stringify({ accounts, count: accounts.length }, null, 2) }] };
  }

  private async handleMutateAccounts(args: {
    action: 'create' | 'update' | 'delete';
    accountId?: string;
    name?: string;
    description?: string;
    status?: 'active' | 'suspended' | 'deleted';
    rateLimitRpm?: number;
    rateLimitTpm?: number;
    defaultPoolId?: string;
  }) {
    if (!this.accountService) throw new McpError(ErrorCode.InternalError, 'AccountService not available');

    if (args.action === 'create') {
      if (!args.name) throw new McpError(ErrorCode.InvalidParams, 'name is required for creating an account.');
      const acc = this.accountService.createAccount({
        name: args.name,
        description: args.description,
        rateLimitRpm: args.rateLimitRpm,
        rateLimitTpm: args.rateLimitTpm,
        defaultPoolId: args.defaultPoolId,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Account created', account: acc }, null, 2) }] };
    }

    if (args.action === 'delete') {
      if (!args.accountId) throw new McpError(ErrorCode.InvalidParams, 'accountId required for delete');
      this.accountService.deleteAccount(args.accountId);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Account deleted', accountId: args.accountId }) }] };
    }

    if (args.action === 'update') {
      if (!args.accountId) throw new McpError(ErrorCode.InvalidParams, 'accountId required for update');
      const updated = this.accountService.updateAccount(args.accountId, {
        ...(args.name ? { name: args.name } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.rateLimitRpm !== undefined ? { rateLimitRpm: args.rateLimitRpm } : {}),
        ...(args.rateLimitTpm !== undefined ? { rateLimitTpm: args.rateLimitTpm } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Account updated', account: updated }, null, 2) }] };
    }

    throw new McpError(ErrorCode.InvalidParams, `Unsupported account action: ${args.action}`);
  }

  private async handleListApiKeys(args: { accountId?: string }) {
    if (!this.accountService) return { content: [{ type: 'text', text: JSON.stringify({ keys: [] }) }] };
    if (!args.accountId) {
      if (this.accountRepo) {
        const accs = this.accountRepo.listAll();
        const allKeys = accs.flatMap((a) => this.accountService!.listKeys(a.id));
        return { content: [{ type: 'text', text: JSON.stringify({ keys: allKeys, count: allKeys.length }, null, 2) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ keys: [] }) }] };
    }
    const keys = this.accountService.listKeys(args.accountId);
    return { content: [{ type: 'text', text: JSON.stringify({ keys, count: keys.length }, null, 2) }] };
  }

  private async handleMutateApiKeys(args: {
    action: 'create' | 'delete';
    keyId?: string;
    accountId?: string;
    name?: string;
    poolId?: string;
  }) {
    if (!this.accountService) throw new McpError(ErrorCode.InternalError, 'AccountService not available');

    if (args.action === 'create') {
      if (!args.accountId || !args.name) {
        throw new McpError(ErrorCode.InvalidParams, 'accountId and name are required for key generation.');
      }
      const keyResult = this.accountService.createKey(args.accountId, {
        name: args.name,
        poolId: args.poolId,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'API key created', key: keyResult }, null, 2) }] };
    }

    if (args.action === 'delete') {
      if (!args.keyId) throw new McpError(ErrorCode.InvalidParams, 'keyId is required for key revocation.');
      this.accountService.revokeKey(args.keyId);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'API key revoked', keyId: args.keyId }) }] };
    }

    throw new McpError(ErrorCode.InvalidParams, `Unsupported API key action: ${args.action}`);
  }

  private async handleCheckQuota() {
    const connections = this.connectionRepo.listAll();
    const result = connections.map((conn) => {
      const provider = this.providerRepo.findById(conn.provider_id);
      const health = this.healthRepo.get(conn.id);
      const dailyTokensPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
      const dailyReqsPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_requests');

      return {
        connectionId: conn.id,
        label: conn.label,
        provider: provider ? provider.display_name : conn.provider_id,
        tier: conn.tier,
        status: conn.status,
        healthState: health ? health.state : 'closed',
        dailyTokensLimit: dailyTokensPolicy ? dailyTokensPolicy.limit_value : 5000000,
        dailyRequestsLimit: dailyReqsPolicy ? dailyReqsPolicy.limit_value : 2000,
      };
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({ connections: result, count: result.length }, null, 2) }],
    };
  }

  private async handleProbeProviderKeys(args: { connectionId?: string }) {
    const connections = args.connectionId
      ? this.connectionRepo.listAll().filter((c) => c.id === args.connectionId)
      : this.connectionRepo.listAll();

    const limit = pLimit(5);
    const testResults = await Promise.all(
      connections.map((conn) =>
        limit(async () => {
          try {
            const res = await this.providerService.testConnection(conn.id);
            return { connectionId: conn.id, label: conn.label, ...res };
          } catch (err: any) {
            return { connectionId: conn.id, label: conn.label, ok: false, error: err.message };
          }
        })
      )
    );

    return {
      content: [{ type: 'text', text: JSON.stringify({ results: testResults }, null, 2) }],
    };
  }

  private async handleSolveRoutingGoal(args: { task: string; goalId?: string; maxLatencyMs?: number; preferReasoning?: boolean }) {
    if (args.goalId) {
      const plan = this.goalService.solveGoalById(args.goalId);
      return { content: [{ type: 'text', text: JSON.stringify({ goalId: args.goalId, plan }, null, 2) }] };
    }

    const goals = this.goalService.listGoals();
    const taskLower = (args.task || 'general').toLowerCase();

    let matchedGoal = goals.find((g) => g.task_type.toLowerCase() === taskLower || taskLower.includes(g.task_type.toLowerCase()));
    if (!matchedGoal && goals.length > 0) {
      matchedGoal = goals[0];
    }

    if (matchedGoal) {
      const plan = this.goalService.solveGoalById(matchedGoal.id);
      return { content: [{ type: 'text', text: JSON.stringify({ goal: matchedGoal.name, plan }, null, 2) }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify({ message: 'No goals found to solve', task: args.task }) }] };
  }

  private async handleGetSystemStatsAndLogs(args: { limit?: number; filter?: 'error' | 'success' | 'all' }) {
    const logLimit = args.limit || 20;
    if (this.logRepo) {
      const res = this.logRepo.query({ limit: logLimit });
      const filtered = args.filter === 'error'
        ? res.rows.filter((l) => l.status === 'failed')
        : args.filter === 'success'
        ? res.rows.filter((l) => l.status === 'success')
        : res.rows;

      return { content: [{ type: 'text', text: JSON.stringify({ logs: filtered, count: filtered.length }, null, 2) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ message: 'Log repository not attached' }) }] };
  }

  private async handleSyncModelCatalog() {
    if (this.catalogService) {
      const res = this.catalogService.syncCatalog();
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Model catalog synchronized successfully', ...res }, null, 2) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ message: 'Catalog service not attached' }) }] };
  }

  private async handleMutateSystemSettings(args: { isSafeMode?: boolean }) {
    if (typeof args.isSafeMode === 'boolean') {
      this.setSafeMode(args.isSafeMode);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ isSafeMode: this.getSafeMode(), success: true }, null, 2) }],
    };
  }

  public async connectStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  public async handleSseConnection(req: any, reply: any): Promise<void> {
    const transport = new SSEServerTransport('/mcp/messages', reply.raw);
    this.sseTransports.set(transport.sessionId, transport);

    transport.onclose = () => {
      this.sseTransports.delete(transport.sessionId);
    };

    await this.server.connect(transport);
  }

  public async handleSseMessage(req: any, reply: any): Promise<void> {
    const sessionId = (req.query as any)?.sessionId;
    const transport = this.sseTransports.get(sessionId);
    if (!transport) {
      reply.status(404).send({ error: 'SSE Session not found' });
      return;
    }
    await transport.handlePostMessage(req.raw, reply.raw, req.body);
  }
}
