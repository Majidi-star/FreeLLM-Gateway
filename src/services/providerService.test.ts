import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase, closeDatabase } from '../infra/db/client.js';
import { runMigrations } from '../infra/db/migrationRunner.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { ProviderService } from './providerService.js';
import { NotFoundError } from '../shared/errors.js';

describe('ProviderService', () => {
  let db: Database.Database;
  let providerRepo: ProviderRepository;
  let connectionRepo: ConnectionRepository;
  let service: ProviderService;

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    db = getDatabase(':memory:');
    runMigrations(db);

    providerRepo = new ProviderRepository(db);
    connectionRepo = new ConnectionRepository(db);
    service = new ProviderService(providerRepo, connectionRepo);

    // Seed a provider
    providerRepo.upsert({
      slug: 'groq',
      display_name: 'Groq Cloud',
      base_url: 'https://api.groq.com/openai/v1',
      auth_type: 'api_key',
      protocol: 'openai',
      docs_url: 'https://groq.com',
      capabilities: JSON.stringify({ vision: true, tools: true }),
      is_active: 1,
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('adds a provider connection and encrypts key at rest', () => {
    const conn = service.addConnection({
      providerSlug: 'groq',
      label: 'My Groq Free',
      apiKey: 'gsk_super_secret_key_12345',
      tier: 'free',
    });

    expect(conn.id).toBeDefined();
    expect(conn.providerSlug).toBe('groq');
    expect(conn.label).toBe('My Groq Free');
    expect(conn.status).toBe('untested');

    // Verify key is encrypted in raw SQLite row
    const rawRow = connectionRepo.findById(conn.id)!;
    expect(rawRow.credential_enc.toString('hex')).not.toContain('gsk_super_secret');

    // Verify decryption retrieves exact original key
    const decrypted = service.getDecryptedApiKey(conn.id);
    expect(decrypted).toBe('gsk_super_secret_key_12345');
  });

  it('throws NotFoundError for invalid provider slug', () => {
    expect(() =>
      service.addConnection({
        providerSlug: 'nonexistent',
        label: 'Bad',
        apiKey: 'key',
      })
    ).toThrow(NotFoundError);
  });

  it('lists provider connections', () => {
    service.addConnection({
      providerSlug: 'groq',
      label: 'My Groq 1',
      apiKey: 'key-1',
    });

    const list = service.listConnections();
    expect(list.length).toBe(1);
    expect(list[0].label).toBe('My Groq 1');
  });

  it('removes provider connection', () => {
    const conn = service.addConnection({
      providerSlug: 'groq',
      label: 'To Delete',
      apiKey: 'key',
    });

    service.removeConnection(conn.id);
    expect(service.listConnections().length).toBe(0);
  });
});
