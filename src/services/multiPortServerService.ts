import Fastify, { FastifyInstance } from 'fastify';
import { AppError, ValidationError } from '../shared/errors.js';
import {
  ProtocolType,
  ProtocolEndpointConfig,
  SystemEndpointsStatus,
  UpdateEndpointsInput,
} from '../domain/server/types.js';

const PROTOCOL_ORDER: readonly ProtocolType[] = ['native', 'openai', 'anthropic', 'mcp'] as const;

const PROTOCOL_PATH_PREFIX: Record<ProtocolType, string> = {
  native: '/',
  openai: '/v1/chat/completions',
  anthropic: '/v1/messages',
  mcp: '/mcp',
};

const PROTOCOL_DESCRIPTION: Record<ProtocolType, string> = {
  native: 'Native FreeLLM Gateway API (management + chat completions)',
  openai: 'OpenAI-compatible endpoint (/v1/chat/completions, /v1/models)',
  anthropic: 'Anthropic Messages-compatible endpoint (/v1/messages)',
  mcp: 'Model Context Protocol bridge (SSE + message transport)',
};

export interface MultiPortServerDeps {
  buildProtocolApp: (protocol: ProtocolType) => Promise<FastifyInstance>;
  initialPorts: Record<ProtocolType, number>;
  initialHost: string;
  remoteAccessEnabled: boolean;
  initialEnabled?: Partial<Record<ProtocolType, boolean>>;
}

interface RuntimeSnapshot {
  ports: Record<ProtocolType, number>;
  host: string;
  remoteAccessEnabled: boolean;
  enabled: Record<ProtocolType, boolean>;
  bound: Set<ProtocolType>;
}

export class MultiPortServerService {
  private ports: Record<ProtocolType, number>;
  private host: string;
  private remoteAccessEnabled: boolean;
  private enabled: Record<ProtocolType, boolean>;
  private instances: Map<ProtocolType, FastifyInstance> = new Map();
  private addresses: Map<ProtocolType, string> = new Map();
  private started = false;

  constructor(private deps: MultiPortServerDeps) {
    this.ports = { ...deps.initialPorts };
    this.host = deps.initialHost;
    this.remoteAccessEnabled = deps.remoteAccessEnabled;
    this.enabled = {
      native: deps.initialEnabled?.native ?? true,
      openai: deps.initialEnabled?.openai ?? true,
      anthropic: deps.initialEnabled?.anthropic ?? true,
      mcp: deps.initialEnabled?.mcp ?? true,
    };
  }

  public async startAll(): Promise<void> {
    for (const protocol of PROTOCOL_ORDER) {
      if (this.enabled[protocol] && !this.instances.has(protocol)) {
        await this.bindProtocol(protocol);
      }
    }
    this.started = true;
  }

  public async stopAll(): Promise<void> {
    for (const protocol of PROTOCOL_ORDER) {
      await this.unbindProtocol(protocol);
    }
    this.started = false;
  }

  public getEndpointsStatus(): SystemEndpointsStatus {
    const endpoints = {} as Record<ProtocolType, ProtocolEndpointConfig>;
    for (const protocol of PROTOCOL_ORDER) {
      endpoints[protocol] = {
        protocol,
        enabled: this.enabled[protocol],
        port: this.ports[protocol],
        pathPrefix: PROTOCOL_PATH_PREFIX[protocol],
        description: PROTOCOL_DESCRIPTION[protocol],
        sampleCurl: this.buildSampleCurl(protocol),
      };
    }
    return {
      host: this.host,
      remoteAccessEnabled: this.remoteAccessEnabled,
      endpoints,
    };
  }

  public async updateConfig(input: UpdateEndpointsInput): Promise<SystemEndpointsStatus> {
    const snapshot = this.captureSnapshot();

    // 1. Validate & stage new state (no side effects yet).
    const nextPorts: Record<ProtocolType, number> = { ...this.ports };
    if (input.ports) {
      for (const key of Object.keys(input.ports) as ProtocolType[]) {
        const value = input.ports[key];
        if (value === undefined) continue;
        if (!Number.isInteger(value) || value < 1 || value > 65535) {
          throw new ValidationError(`Invalid port for protocol "${key}": must be an integer between 1 and 65535`);
        }
        nextPorts[key] = value;
      }
    }

    const nextEnabled: Record<ProtocolType, boolean> = { ...this.enabled };
    if (input.enabledProtocols) {
      for (const key of Object.keys(input.enabledProtocols) as ProtocolType[]) {
        const value = input.enabledProtocols[key];
        if (value === undefined) continue;
        nextEnabled[key] = Boolean(value);
      }
    }

    let nextHost = this.host;
    let nextRemote = this.remoteAccessEnabled;
    if (input.remoteAccessEnabled !== undefined) {
      nextRemote = Boolean(input.remoteAccessEnabled);
      nextHost = nextRemote ? '0.0.0.0' : '127.0.0.1';
    }

    // 2. Duplicate-port guard across enabled protocols.
    const portOwners = new Map<number, ProtocolType>();
    for (const protocol of PROTOCOL_ORDER) {
      if (!nextEnabled[protocol]) continue;
      const port = nextPorts[protocol];
      const owner = portOwners.get(port);
      if (owner) {
        throw new ValidationError(`Port ${port} cannot be assigned to both "${owner}" and "${protocol}"`);
      }
      portOwners.set(port, protocol);
    }

    // 3. Commit staged state and compute rebind/unbind work.
    const hostChanged = nextHost !== this.host;
    this.ports = nextPorts;
    this.enabled = nextEnabled;
    this.remoteAccessEnabled = nextRemote;
    this.host = nextHost;

    try {
      const toUnbind: ProtocolType[] = [];
      const toRebind: ProtocolType[] = [];

      for (const protocol of PROTOCOL_ORDER) {
        const isBound = this.instances.has(protocol);
        if (this.enabled[protocol]) {
          if (isBound && (nextPorts[protocol] !== snapshot.ports[protocol] || hostChanged)) {
            toRebind.push(protocol);
          } else if (!isBound) {
            toRebind.push(protocol);
          }
        } else if (isBound) {
          toUnbind.push(protocol);
        }
      }

      if (!this.started && toRebind.length === 0 && toUnbind.length === 0) {
        return this.getEndpointsStatus();
      }

      for (const protocol of toUnbind) {
        await this.unbindProtocol(protocol);
      }
      for (const protocol of toRebind) {
        await this.unbindProtocol(protocol);
        await this.bindProtocol(protocol);
      }

      return this.getEndpointsStatus();
    } catch (err) {
      await this.rollbackToSnapshot(snapshot);
      throw err;
    }
  }

  private captureSnapshot(): RuntimeSnapshot {
    return {
      ports: { ...this.ports },
      host: this.host,
      remoteAccessEnabled: this.remoteAccessEnabled,
      enabled: { ...this.enabled },
      bound: new Set(this.instances.keys()),
    };
  }

  private async rollbackToSnapshot(snapshot: RuntimeSnapshot): Promise<void> {
    // Tear down everything bound in the failed attempt, then restore previous bindings.
    for (const protocol of PROTOCOL_ORDER) {
      await this.unbindProtocol(protocol);
    }
    this.ports = { ...snapshot.ports };
    this.host = snapshot.host;
    this.remoteAccessEnabled = snapshot.remoteAccessEnabled;
    this.enabled = { ...snapshot.enabled };
    for (const protocol of snapshot.bound) {
      try {
        await this.bindProtocol(protocol);
      } catch (restoreErr) {
        throw new AppError(
          `Failed to restore "${protocol}" listener during rollback: ${(restoreErr as Error).message}`,
          'PORT_ROLLBACK_FAILED',
          500
        );
      }
    }
  }

  private async bindProtocol(protocol: ProtocolType): Promise<void> {
    if (this.instances.has(protocol)) {
      throw new AppError(`Protocol "${protocol}" is already bound`, 'PORT_ALREADY_BOUND', 409);
    }
    let app: FastifyInstance | undefined;
    try {
      app = await this.deps.buildProtocolApp(protocol);
      const address = await app.listen({ port: this.ports[protocol], host: this.host });
      this.instances.set(protocol, app);
      this.addresses.set(protocol, address);
    } catch (err) {
      // Ensure a half-bound app is never leaked.
      if (app) {
        try {
          await app.close();
        } catch {
          /* app never reached listen */
        }
      }
      this.instances.delete(protocol);
      this.addresses.delete(protocol);
      throw new AppError(
        `Failed to bind "${protocol}" listener on ${this.host}:${this.ports[protocol]} — port may already be in use: ${(err as Error).message}`,
        'PORT_BIND_FAILED',
        409
      );
    }
  }

  private async unbindProtocol(protocol: ProtocolType): Promise<void> {
    const app = this.instances.get(protocol);
    this.instances.delete(protocol);
    this.addresses.delete(protocol);
    if (app) {
      try {
        await app.close();
      } catch (err) {
        throw new AppError(
          `Failed to stop "${protocol}" listener: ${(err as Error).message}`,
          'PORT_UNBIND_FAILED',
          500
        );
      }
    }
  }

  private displayHost(): string {
    return this.host === '0.0.0.0' ? '127.0.0.1' : this.host;
  }

  private buildSampleCurl(protocol: ProtocolType): string {
    const base = `http://${this.displayHost()}:${this.ports[protocol]}`;
    switch (protocol) {
      case 'openai':
        return [
          `curl ${base}/v1/chat/completions \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d '{"model":"<model>","messages":[{"role":"user","content":"Hello"}]}'`,
        ].join('\n');
      case 'anthropic':
        return [
          `curl ${base}/v1/messages \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d '{"model":"<model>","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'`,
        ].join('\n');
      case 'mcp':
        return `# MCP (SSE transport)\n# SSE:  ${base}/mcp/sse\n# POST: ${base}/mcp/messages`;
      case 'native':
      default:
        return [
          `curl ${base}/api/v1/health`,
          `curl ${base}/v1/chat/completions \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d '{"model":"<model>","messages":[{"role":"user","content":"Hello"}]}'`,
        ].join('\n');
    }
  }
}

