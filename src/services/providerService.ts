import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ConnectionRepository, ProviderConnectionRecord } from '../infra/db/repositories/connectionRepo.js';
import { HealthRepository } from '../infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../infra/db/repositories/quotaRepo.js';
import { breakerRegistry, getSharedCircuitBreaker, locallyExpiredConnectionIds } from './gatewayService.js';
import { encryptCredential, decryptCredential } from '../infra/security/vault.js';
import { callProviderEndpoint } from '../infra/http/providerClient.js';
import { NotFoundError, ValidationError } from '../shared/errors.js';
import { ConnectionStatus, ConnectionTier } from '../shared/types.js';
import { logger } from '../infra/logger.js';
import { getWindowStart, computeSlidingWindowUsage } from '../domain/quota/slidingWindow.js';

export interface AddConnectionInput {
  providerSlug: string;
  label?: string;
  apiKey: string;
  tier?: ConnectionTier;
  baseUrl?: string;
}

export interface ConnectionDTO {
  id: string;
  providerSlug: string;
  providerDisplayName: string;
  label: string;
  tier: ConnectionTier;
  status: ConnectionStatus;
  lastTestedAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export class ProviderService {
  constructor(
    private providerRepo: ProviderRepository,
    private connectionRepo: ConnectionRepository,
    private quotaRepo?: QuotaRepository
  ) {}

  public addConnection(input: AddConnectionInput): ConnectionDTO {
    let provider = this.providerRepo.findBySlug(input.providerSlug);
    if (!provider) {
      throw new NotFoundError(`Provider with slug '${input.providerSlug}' not found. Check catalog or seed data.`);
    }

    if (!input.apiKey || input.apiKey.trim().length === 0) {
      throw new ValidationError('API key cannot be empty');
    }

    // Optional Base URL override (e.g. enterprise proxies / local gateways).
    // Only persists when non-empty and different from the catalog default.
    const trimmedBaseUrl = input.baseUrl?.trim();
    if (trimmedBaseUrl && trimmedBaseUrl !== provider.base_url) {
      provider = this.providerRepo.upsert({ ...provider, base_url: trimmedBaseUrl });
      logger.info({ providerSlug: provider.slug, baseUrl: trimmedBaseUrl }, 'Provider base URL overridden');
    }

    const encrypted = encryptCredential(input.apiKey);
    const connLabel = input.label || `${provider.display_name} Key`;

    const record = this.connectionRepo.create({
      provider_id: provider.id,
      label: connLabel,
      credential_enc: encrypted.ciphertext,
      credential_iv: encrypted.iv,
      credential_tag: encrypted.tag,
      tier: input.tier || 'free',
      status: 'untested',
      last_tested_at: null,
      last_error: null,
    });

    logger.info({ connectionId: record.id, providerSlug: provider.slug, label: connLabel }, 'Added new provider connection');

    return this.toDTO(record, provider.slug, provider.display_name);
  }

  private computeDailyQuotaUsedPct(conn: ProviderConnectionRecord | undefined): number {
    if (!conn || !this.quotaRepo) return 0;
    try {
      const policy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
      if (!policy || policy.limit_value <= 0 || policy.window_seconds <= 0) return 0;
      const now = Date.now();
      const windowStart = getWindowStart(now, policy.window_seconds);
      const currentUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart);
      const prevUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart - policy.window_seconds * 1000);
      const usage = computeSlidingWindowUsage({ currentUsage, previousUsage: prevUsage, windowSeconds: policy.window_seconds, nowMs: now });
      return Math.min(100, Math.round((usage / policy.limit_value) * 100));
    } catch (err: any) {
      logger.warn({ connectionId: conn.id, error: err?.message }, 'Failed to compute quota usage for provider DTO; reporting 0%');
      return 0;
    }
  }

  public getProvidersWithConnections() {
    const catalogProviders = this.providerRepo.listAll(true);
    const connections = this.connectionRepo.listAll();
    const connByProvId = new Map<string, any>();
    for (const c of connections) {
      connByProvId.set(c.provider_id, c);
    }

    return catalogProviders.map((p) => {
      const conn = connByProvId.get(p.id);
      // A connection is truly configured only if it exists AND has a non-empty credential
      const hasValidCredential = Boolean(conn && conn.credential_enc && conn.credential_enc.length > 0);
      const isUnconfigured = !hasValidCredential;
      return {
        id: conn ? conn.id : `prov-${p.slug}`,
        providerId: p.id,
        slug: p.slug,
        provider: p.display_name,
        displayName: p.display_name,
        baseUrl: p.base_url,
        protocol: p.protocol,
        docsUrl: p.docs_url,
        hasKey: hasValidCredential,
        maskedKey: hasValidCredential ? `sk-••••••••${conn.credential_enc.substring(0, 4)}` : 'Not Configured',
        status: isUnconfigured ? 'unconfigured' : (conn.status === 'degraded' ? 'degraded' : 'active'),
        lastPingMs: isUnconfigured ? 0 : 0,
        lastVerified: isUnconfigured ? 'Never' : (conn?.last_tested_at ? new Date(conn.last_tested_at).toLocaleTimeString() : 'Never'),
        dailyQuotaUsedPct: isUnconfigured ? 0 : this.computeDailyQuotaUsedPct(conn),
        tier: (hasValidCredential && conn?.tier === 'pro' ? 'Pro Enclave' : 'Free Tier') as 'Free Tier' | 'Pro Enclave',
      };
    });
  }

  public listConnections(): ConnectionDTO[] {
    const records = this.connectionRepo.listAll();
    return records.map((rec) => {
      const provider = this.providerRepo.findById(rec.provider_id);
      return this.toDTO(rec, provider?.slug || 'unknown', provider?.display_name || 'Unknown Provider');
    });
  }

  public async testConnection(connectionId: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    const conn = this.connectionRepo.findById(connectionId);
    if (!conn) {
      throw new NotFoundError(`Connection '${connectionId}' not found`);
    }

    // If the connection has no valid credential, do not probe — return unconfigured status
    if (!conn.credential_enc || conn.credential_enc.length === 0) {
      return { success: false, error: 'Connection is unconfigured — no credential present' };
    }

    const provider = this.providerRepo.findById(conn.provider_id);
    if (!provider) {
      throw new NotFoundError(`Provider '${conn.provider_id}' not found`);
    }

    try {
      const apiKey = decryptCredential({
        ciphertext: conn.credential_enc,
        iv: conn.credential_iv,
        tag: conn.credential_tag,
      });

      const probeEndpoint = provider.protocol === 'gemini' ? '/v1beta/models' : '/v1/models';

      // Call models list endpoint as lightweight health check
      const response = await callProviderEndpoint({
        baseUrl: provider.base_url,
        endpoint: probeEndpoint,
        apiKey,
        protocol: provider.protocol,
        method: 'GET',
        timeoutMs: 10000,
      });

      this.connectionRepo.updateStatus(conn.id, 'healthy', null);
      logger.info({ connectionId: conn.id, latencyMs: response.latencyMs }, 'Provider connection test succeeded');

      return { success: true, latencyMs: response.latencyMs };
    } catch (err: any) {
      const errorMsg = err.message || 'Connection test failed';
      this.connectionRepo.updateStatus(conn.id, 'unavailable', errorMsg);
      logger.warn({ connectionId: conn.id, error: errorMsg }, 'Provider connection test failed');

      return { success: false, error: errorMsg };
    }
  }

  public removeConnection(connectionId: string): void {
    const conn = this.connectionRepo.findById(connectionId);
    if (!conn) {
      throw new NotFoundError(`Connection '${connectionId}' not found`);
    }
    this.connectionRepo.delete(connectionId);
    breakerRegistry.delete(connectionId);
    locallyExpiredConnectionIds.delete(connectionId);
    logger.info({ connectionId }, 'Removed provider connection');
  }

  public revokeConnection(id: string, healthRepo?: HealthRepository): { success: boolean; id: string; status: string } {
    const conn = this.connectionRepo.findById(id);
    let connectionsToRevoke: ProviderConnectionRecord[] = [];

    if (conn) {
      connectionsToRevoke.push(conn);
    } else {
      const providerConns = this.connectionRepo.listByProviderId(id);
      if (providerConns.length > 0) {
        connectionsToRevoke.push(...providerConns);
      }
    }

    if (connectionsToRevoke.length === 0) {
      throw new NotFoundError(`Connection or provider with ID '${id}' not found`);
    }

    const now = Date.now();
    for (const c of connectionsToRevoke) {
      // 1. Mark status as 'revoked' in SQLite WAL database
      this.connectionRepo.updateStatus(c.id, 'revoked', 'Credential revoked by admin');
      locallyExpiredConnectionIds.add(c.id);

      // 2. Immediately transition circuit breaker state to OPEN
      if (healthRepo) {
        healthRepo.upsert({
          connection_id: c.id,
          state: 'open',
          consecutive_failures: 5,
          opened_at: now,
          cooldown_until: now + 86400000,
        });
      }

      const cb = breakerRegistry.get(c.id);
      if (cb) {
        while (cb.getState() !== 'open') {
          cb.recordFailure();
        }
      } else {
        const newCb = getSharedCircuitBreaker(c.id, { state: 'open', consecutive_failures: 5, opened_at: now }, now);
        while (newCb.getState() !== 'open') {
          newCb.recordFailure();
        }
      }

      logger.info({ connectionId: c.id }, 'Credential revoked and circuit breaker set to OPEN');
    }

    return { success: true, id, status: 'revoked' };
  }

  public getDecryptedApiKey(connectionId: string): string {
    const conn = this.connectionRepo.findById(connectionId);
    if (!conn) {
      throw new NotFoundError(`Connection '${connectionId}' not found`);
    }
    return decryptCredential({
      ciphertext: conn.credential_enc,
      iv: conn.credential_iv,
      tag: conn.credential_tag,
    });
  }

  private toDTO(record: ProviderConnectionRecord, providerSlug: string, providerDisplayName: string): ConnectionDTO {
    return {
      id: record.id,
      providerSlug,
      providerDisplayName,
      label: record.label,
      tier: record.tier,
      status: record.status,
      lastTestedAt: record.last_tested_at,
      lastError: record.last_error,
      createdAt: record.created_at,
    };
  }
}
