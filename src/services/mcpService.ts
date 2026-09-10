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
import { logger } from '../infra/logger.js';

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
    private providerService: ProviderService
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

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'check_quota',
            description: 'Inspect remaining daily quotas and provider health.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'solve_routing_goal',
            description: 'Determine the optimal free LLM route based on task requirements.',
            inputSchema: {
              type: 'object',
              properties: {
                task: { type: 'string', description: 'Task description or type (code, reasoning, chat, general)' },
                maxLatencyMs: { type: 'number', description: 'Maximum acceptable latency in milliseconds' },
                preferReasoning: { type: 'boolean', description: 'Whether reasoning capabilities are preferred' },
              },
              required: ['task'],
            },
          },
          {
            name: 'probe_provider_keys',
            description: 'Test latency and availability of configured provider keys.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'mutate_pools',
            description: 'Add, update, or remove routing pool configurations.',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['create', 'delete'], description: 'Pool action to perform' },
                goalId: { type: 'string', description: 'Goal ID for pool creation' },
                name: { type: 'string', description: 'Name of the pool' },
                poolId: { type: 'string', description: 'Pool ID for deletion' },
              },
              required: ['action'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'check_quota') {
        return this.handleCheckQuota();
      }

      if (name === 'solve_routing_goal') {
        return this.handleSolveRoutingGoal(args as any);
      }

      if (name === 'probe_provider_keys') {
        return this.handleProbeProviderKeys();
      }

      if (name === 'mutate_pools') {
        if (this.isSafeMode) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Operation denied: GoalRoute is operating in Safe Mode.'
          );
        }
        return this.handleMutatePools(args as any);
      }

      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    });
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
      content: [
        {
          type: 'text',
          text: JSON.stringify({ connections: result, count: result.length }, null, 2),
        },
      ],
    };
  }

  private async handleSolveRoutingGoal(args: { task: string; maxLatencyMs?: number; preferReasoning?: boolean }) {
    const goals = this.goalService.listGoals();
    const taskLower = (args.task || 'general').toLowerCase();

    let matchedGoal = goals.find((g) => g.task_type.toLowerCase() === taskLower || taskLower.includes(g.task_type.toLowerCase()));
    if (!matchedGoal && goals.length > 0) {
      matchedGoal = goals[0];
    }

    if (matchedGoal) {
      const plan = this.goalService.solveGoalById(matchedGoal.id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ goal: matchedGoal.name, plan }, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ message: 'No goals found to solve', task: args.task }),
        },
      ],
    };
  }

  private async handleProbeProviderKeys() {
    const connections = this.connectionRepo.listAll();
    const testResults = await Promise.all(
      connections.map(async (conn) => {
        try {
          const res = await this.providerService.testConnection(conn.id);
          return { connectionId: conn.id, label: conn.label, ...res };
        } catch (err: any) {
          return { connectionId: conn.id, label: conn.label, ok: false, error: err.message };
        }
      })
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ results: testResults }, null, 2),
        },
      ],
    };
  }

  private async handleMutatePools(args: { action: 'create' | 'delete'; goalId?: string; name?: string; poolId?: string }) {
    if (args.action === 'create') {
      if (!args.goalId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required argument: goalId');
      }
      const pool = this.poolService.createPoolFromGoal(args.goalId, args.name);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: 'Pool created successfully', pool }, null, 2),
          },
        ],
      };
    }

    throw new McpError(ErrorCode.InvalidParams, `Unsupported pool mutation action: ${args.action}`);
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
