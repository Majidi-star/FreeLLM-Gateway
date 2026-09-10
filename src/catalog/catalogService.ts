import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { providerSeedSchema, modelSeedSchema, ProviderSeed, ModelSeed } from './catalogTypes.js';
import { logger } from '../infra/logger.js';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CatalogService {
  constructor(
    private providerRepo: ProviderRepository,
    private modelRepo: ModelRepository
  ) {}

  public syncCatalog(customSeedDir?: string): { providersCount: number; modelsCount: number } {
    const projectRoot = process.cwd();
    const srcSeedDir = path.join(projectRoot, 'src', 'catalog');
    const seedDir = customSeedDir || (fs.existsSync(path.join(srcSeedDir, 'providers.seed.json')) ? srcSeedDir : __dirname);

    const providersPath = path.join(seedDir, 'providers.seed.json');
    const modelsPath = path.join(seedDir, 'models.seed.json');

    if (!fs.existsSync(providersPath) || !fs.existsSync(modelsPath)) {
      throw new Error(`Catalog seed files missing in directory: ${seedDir}`);
    }

    const rawProviders = JSON.parse(fs.readFileSync(providersPath, 'utf-8'));
    const rawModels = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));

    const providers = z.array(providerSeedSchema).parse(rawProviders);
    const models = z.array(modelSeedSchema).parse(rawModels);

    let providersCount = 0;
    let modelsCount = 0;

    for (const prov of providers) {
      const pRecord = this.providerRepo.upsert({
        slug: prov.slug,
        display_name: prov.displayName,
        base_url: prov.baseUrl,
        auth_type: prov.authType,
        protocol: prov.protocol,
        docs_url: prov.docsUrl || null,
        capabilities: JSON.stringify(prov.capabilities),
        is_active: prov.isActive ? 1 : 0,
      });
      providersCount++;

      const provModels = models.filter((m) => m.providerSlug === prov.slug);
      for (const mdl of provModels) {
        this.modelRepo.upsert({
          provider_id: pRecord.id,
          model_name: mdl.modelName,
          display_name: mdl.displayName,
          context_window: mdl.contextWindow,
          supports_tools: mdl.supportsTools ? 1 : 0,
          supports_vision: mdl.supportsVision ? 1 : 0,
          cost_input_per_1k: mdl.costInputPer1k,
          cost_output_per_1k: mdl.costOutputPer1k,
          bench_tps: mdl.benchTps || null,
          bench_ttft_ms: mdl.benchTtftMs || null,
          bench_p95_latency_ms: mdl.benchP95LatencyMs || null,
          task_fitness: JSON.stringify(mdl.taskFitness),
          is_active: mdl.isActive ? 1 : 0,
        });
        modelsCount++;
      }
    }

    logger.info({ providersCount, modelsCount }, 'Catalog synced successfully');
    return { providersCount, modelsCount };
  }

  public getProviders() {
    return this.providerRepo.listAll();
  }

  public getModelsForProvider(providerSlug: string) {
    const prov = this.providerRepo.findBySlug(providerSlug);
    if (!prov) return [];
    return this.modelRepo.listByProviderId(prov.id);
  }

  public getAllModels() {
    const models = this.modelRepo.listAll();
    return models.map((m) => {
      const prov = this.providerRepo.findById(m.provider_id);
      return {
        id: m.id,
        modelName: m.model_name,
        displayName: m.display_name,
        contextWindow: m.context_window,
        supportsTools: Boolean(m.supports_tools),
        supportsVision: Boolean(m.supports_vision),
        costInputPer1k: m.cost_input_per_1k,
        costOutputPer1k: m.cost_output_per_1k,
        benchTps: m.bench_tps,
        benchTtftMs: m.bench_ttft_ms,
        benchP95LatencyMs: m.bench_p95_latency_ms,
        isActive: Boolean(m.is_active),
        providerSlug: prov?.slug || 'unknown',
        providerDisplayName: prov?.display_name || 'Unknown Provider',
      };
    });
  }
}
