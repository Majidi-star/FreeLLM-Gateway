import { describe, it, expect } from 'vitest';
import { CATALOG_OPTIONS, filterCatalogOptions, TierCategory, TierFilter } from '../../src/web/components/vault/CredentialVault';

const VALID_TIERS: readonly TierCategory[] = ['free', 'freemium', 'paid'];

describe('Provider catalog tier categorization', () => {
  it('categorizes every catalog provider with a valid tierCategory', () => {
    expect(CATALOG_OPTIONS.length).toBeGreaterThan(0);
    for (const opt of CATALOG_OPTIONS) {
      expect(VALID_TIERS).toContain(opt.tierCategory);
    }
  });

  it('assigns each tier category to at least one provider', () => {
    const categories = new Set(CATALOG_OPTIONS.map((o) => o.tierCategory));
    expect(categories).toEqual(new Set(VALID_TIERS));
  });

  it('provides a human-readable tierLabel for every provider', () => {
    for (const opt of CATALOG_OPTIONS) {
      expect(opt.tierLabel).toBeTruthy();
    }
  });
});

describe('filterCatalogOptions tier + search filtering', () => {
  it('returns all providers when tier filter is "all" and query is empty', () => {
    const result = filterCatalogOptions(CATALOG_OPTIONS, 'all', '');
    expect(result).toHaveLength(CATALOG_OPTIONS.length);
  });

  it('filters by tier category only', () => {
    const free = filterCatalogOptions(CATALOG_OPTIONS, 'free', '');
    const paid = filterCatalogOptions(CATALOG_OPTIONS, 'paid', '');
    expect(free.length).toBeGreaterThan(0);
    expect(paid.length).toBeGreaterThan(0);
    expect(free.every((o) => o.tierCategory === 'free')).toBe(true);
    expect(paid.every((o) => o.tierCategory === 'paid')).toBe(true);
  });

  it('filters by displayName case-insensitively', () => {
    const result = filterCatalogOptions(CATALOG_OPTIONS, 'all', 'gemini');
    expect(result.map((o) => o.slug)).toContain('gemini');
    expect(result.every((o) => o.displayName.toLowerCase().includes('gemini'))).toBe(true);
  });

  it('filters by slug case-insensitively', () => {
    const result = filterCatalogOptions(CATALOG_OPTIONS, 'all', 'SAMBA');
    expect(result.map((o) => o.slug)).toEqual(['sambanova']);
  });

  it('combines tier and search filters (AND semantics)', () => {
    const result = filterCatalogOptions(CATALOG_OPTIONS, 'freemium', 'a');
    expect(result.length).toBeGreaterThan(0);
    for (const opt of result) {
      expect(opt.tierCategory).toBe('freemium');
      const q = 'a';
      const matches = opt.displayName.toLowerCase().includes(q) || opt.slug.toLowerCase().includes(q);
      expect(matches).toBe(true);
    }
  });

  it('returns no providers when query has no matches', () => {
    const result = filterCatalogOptions(CATALOG_OPTIONS, 'all', 'zzz-non-existent-provider');
    expect(result).toHaveLength(0);
  });

  it('ignores surrounding whitespace in the search query', () => {
    const trimmed = filterCatalogOptions(CATALOG_OPTIONS, 'all', '  groq  ');
    const raw = filterCatalogOptions(CATALOG_OPTIONS, 'all', 'groq');
    expect(trimmed.map((o) => o.slug)).toEqual(raw.map((o) => o.slug));
  });
});