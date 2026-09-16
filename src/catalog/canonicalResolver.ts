import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CanonicalModelSeed, canonicalModelSeedSchema } from './catalogTypes.js';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CanonicalResolver {
  private canonicalModels: CanonicalModelSeed[] = [];
  private aliasMap = new Map<string, CanonicalModelSeed>();

  constructor(customCanonicalModels?: CanonicalModelSeed[]) {
    if (customCanonicalModels) {
      this.init(customCanonicalModels);
    } else {
      this.loadDefaultSeed();
    }
  }

  private loadDefaultSeed(): void {
    const projectRoot = process.cwd();
    const srcSeedPath = path.join(projectRoot, 'src', 'catalog', 'canonical_models.seed.json');
    const fallbackPath = path.join(__dirname, 'canonical_models.seed.json');

    const seedPath = fs.existsSync(srcSeedPath) ? srcSeedPath : fallbackPath;
    if (!fs.existsSync(seedPath)) {
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
      const parsed = z.array(canonicalModelSeedSchema).parse(raw);
      this.init(parsed);
    } catch {
      // Return gracefully if canonical seed fails to parse
    }
  }

  private init(models: CanonicalModelSeed[]): void {
    this.canonicalModels = models;
    this.aliasMap.clear();

    for (const model of models) {
      this.aliasMap.set(model.canonicalId.toLowerCase(), model);
      for (const alias of model.knownAliases) {
        this.aliasMap.set(alias.toLowerCase(), model);
      }
    }
  }

  /**
   * Resolves a raw model string (e.g., "deepseek-ai/DeepSeek-V4-Flash", "stealth/ox-alpha")
   * into a canonical model definition.
   */
  public resolveCanonicalModel(rawModelName: string): CanonicalModelSeed | null {
    if (!rawModelName || typeof rawModelName !== 'string') return null;

    const trimmed = rawModelName.trim().toLowerCase();

    // 1. Direct Alias / Canonical ID Match
    if (this.aliasMap.has(trimmed)) {
      return this.aliasMap.get(trimmed)!;
    }

    // 2. Strip Org Prefix (e.g., "meta-llama/Llama-4-Scout-17B-16E-Instruct" -> "llama-4-scout-17b-16e-instruct")
    const parts = trimmed.split('/');
    const cleanName = parts[parts.length - 1];
    if (this.aliasMap.has(cleanName)) {
      return this.aliasMap.get(cleanName)!;
    }

    // 3. Normalized Delimiter Match (strip delimiters & fp8/turbo suffixes)
    const normalizedClean = cleanName.replace(/[-_.]/g, '');
    for (const model of this.canonicalModels) {
      const normCanonical = model.canonicalId.replace(/[-_.]/g, '');
      if (normalizedClean.includes(normCanonical) || normCanonical.includes(normalizedClean)) {
        return model;
      }
      for (const alias of model.knownAliases) {
        const aliasClean = alias.split('/').pop()!.replace(/[-_.]/g, '');
        if (normalizedClean === aliasClean || normalizedClean.includes(aliasClean)) {
          return model;
        }
      }
    }

    return null;
  }
}
