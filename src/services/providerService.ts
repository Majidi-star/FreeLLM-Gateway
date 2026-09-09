import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ConnectionRepository, ProviderConnectionRecord } from '../infra/db/repositories/connectionRepo.js';
import { HealthRepository } from '../infra/db/repositories/healthRepo.js';
import { breakerRegistry, getSharedCircuitBreaker, locallyExpiredConnectionIds } from './gatewayService.js';
import { encryptCredential, decryptCredential } from '../infra/security/vault.js';
import { callProviderEndpoint } from '../infra/http/providerClient.js';
import { NotFoundError, ValidationError } from '../shared/errors.js';
import { ConnectionStatus, ConnectionTier } from '../shared/types.js';
import { logger } from '../infra/logger.js';

export interface AddConnectionInput {
  providerSlug: string;
  label: string;
  apiKey: string;
  tier?: ConnectionTier;
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
    private connectionRepo: ConnectionRepository
  ) {}

  public addConnection(input: AddConnectionInput): ConnectionDTO {
    const provider = this.providerRepo.findBySlug(input.providerSlug);
    if (!provider) {
      throw new NotFoundError(`Provider with slug '${input.providerSlug}' not found. Check catalog or seed data.`);
    }

    if (!input.apiKey || input.apiKey.trim().length === 0) {
      throw new ValidationError('API key cannot be empty');
    }

    const encrypted = encryptCredential(input.apiKey);

    const record = this.connectionRepo.create({
      provider_id: provider.id,
      label: input.label,
      credential_enc: encrypted.ciphertext,
      credential_iv: encrypted.iv,
      credential_tag: encrypted.tag,
      tier: input.tier || 'free',
      status: 'untested',
      last_tested_at: null,
      last_error: null,
    });

    logger.info({ connectionId: record.id, providerSlug: provider.slug, label: input.label }, 'Added new provider connection');

    return this.toDTO(record, provider.slug, provider.display_name);
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
