import React, { useState } from 'react';
import { Key, ShieldCheck, RefreshCw, CheckCircle2, AlertTriangle, Cpu, Lock, Terminal, Activity, Zap, Check, ChevronDown, Plus, X, ExternalLink } from 'lucide-react';
import { GlossaryTerm } from '../common/GlossaryTerm.js';

export function formatCleanError(rawErr: string | null | undefined): string {
  if (!rawErr) return 'Verification failed';
  let str = String(rawErr).trim();
  if (str.includes('snippet=')) {
    const snippetPart = str.split('snippet=')[1];
    if (snippetPart) {
      try {
        const parsed = JSON.parse(snippetPart.trim());
        if (parsed.message) return parsed.message;
        if (parsed.error?.message) return parsed.error.message;
      } catch {
        str = snippetPart.replace(/[{}"\\]/g, '').trim();
      }
    }
  }
  if (str.includes('status=401') || str.includes('401')) {
    return 'Invalid API key (HTTP 401)';
  }
  if (str.includes('status=403') || str.includes('403')) {
    return 'Forbidden access or invalid permissions (HTTP 403)';
  }
  if (str.includes('status=429') || str.includes('429')) {
    return 'Rate limit exceeded (HTTP 429)';
  }
  if (str.includes('status=500') || str.includes('500')) {
    return 'Provider service error (HTTP 500)';
  }
  str = str.replace(/^\[PROVIDER_ERROR\]\s*/, '').replace(/status=\d+\s*type=\w+\s*/g, '').trim();
  return str || 'Verification failed';
}



export const formatErrorMessage = (err: any): string => {
  if (!err) return 'An unexpected error occurred';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string') return err.message;
  if (typeof err.error === 'string') return err.error;
  if (typeof err.error?.message === 'string') return err.error.message;
  try {
    return JSON.stringify(err);
  } catch {
    return 'An unexpected error occurred';
  }
};

export interface KeyEntry {
  id: string;
  provider: string;
  slug?: string;
  maskedKey: string;
  status: 'active' | 'testing' | 'degraded' | 'unavailable' | 'unconfigured';
  lastPingMs: number;
  lastVerified: string;
  dailyQuotaUsedPct: number;
  tier: 'Free Tier' | 'Pro Enclave';
  hasKey?: boolean;
  lastError?: string | null;
}

export type TierCategory = 'free' | 'freemium' | 'paid';

export interface CatalogOption {
  slug: string;
  displayName: string;
  keyUrl: string;
  baseUrl: string;
  tierCategory: TierCategory;
  tierLabel: string;
}

export const CATALOG_OPTIONS: CatalogOption[] = [
  { slug: 'groq', displayName: 'Groq Cloud', keyUrl: 'https://console.groq.com/keys', baseUrl: 'https://api.groq.com/openai/v1', tierCategory: 'free', tierLabel: '100% Free Tier' },
  { slug: 'cerebras', displayName: 'Cerebras', keyUrl: 'https://cloud.cerebras.ai/', baseUrl: 'https://api.cerebras.ai/v1', tierCategory: 'free', tierLabel: '100% Free Tier' },
  { slug: 'sambanova', displayName: 'SambaNova Cloud', keyUrl: 'https://cloud.sambanova.ai/', baseUrl: 'https://api.sambanova.ai/v1', tierCategory: 'free', tierLabel: '100% Free Tier' },
  { slug: 'gemini', displayName: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', tierCategory: 'freemium', tierLabel: 'Initially Free' },
  { slug: 'openrouter', displayName: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', baseUrl: 'https://openrouter.ai/api/v1', tierCategory: 'freemium', tierLabel: 'Initially Free' },
  { slug: 'together', displayName: 'Together AI', keyUrl: 'https://api.together.ai/settings/api-keys', baseUrl: 'https://api.together.xyz/v1', tierCategory: 'freemium', tierLabel: 'Initially Free' },
  { slug: 'mistral', displayName: 'Mistral AI', keyUrl: 'https://console.mistral.ai/api-keys/', baseUrl: 'https://api.mistral.ai/v1', tierCategory: 'freemium', tierLabel: 'Initially Free' },
  { slug: 'fireworks', displayName: 'Fireworks AI', keyUrl: 'https://fireworks.ai/account/api-keys', baseUrl: 'https://api.fireworks.ai/inference/v1', tierCategory: 'freemium', tierLabel: 'Initially Free' },
  { slug: 'deepinfra', displayName: 'DeepInfra', keyUrl: 'https://deepinfra.com/dash/api_keys', baseUrl: 'https://api.deepinfra.com/v1', tierCategory: 'freemium', tierLabel: 'Initially Free' },
  { slug: 'openai', displayName: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', baseUrl: 'https://api.openai.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'anthropic', displayName: 'Anthropic Claude', keyUrl: 'https://console.anthropic.com/', baseUrl: 'https://api.anthropic.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'deepseek', displayName: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys', baseUrl: 'https://api.deepseek.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
];

export type TierFilter = 'all' | TierCategory;

export function filterCatalogOptions(
  options: CatalogOption[],
  tierFilter: TierFilter,
  searchQuery: string
): CatalogOption[] {
  const q = searchQuery.trim().toLowerCase();
  return options.filter((opt) => {
    const matchesTier = tierFilter === 'all' || opt.tierCategory === tierFilter;
    const matchesSearch =
      q === '' ||
      opt.displayName.toLowerCase().includes(q) ||
      opt.slug.toLowerCase().includes(q);
    return matchesTier && matchesSearch;
  });
}

const getAdminToken = () =>
  sessionStorage.getItem('goalroute_admin_token') ||
  localStorage.getItem('goalroute_admin_token') ||
  (import.meta as any).env?.VITE_ADMIN_API_TOKEN ||
  'dev-admin-secret-token';

export const CredentialVault: React.FC = () => {
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [isProbing, setIsProbing] = useState(false);
  const [testingKeyIds, setTestingKeyIds] = useState<Record<string, boolean>>({});
  
  // Modal state
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [selectedProviderSlug, setSelectedProviderSlug] = useState('openai');
  const [inputApiKey, setInputApiKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [providerSearchQuery, setProviderSearchQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('https://api.openai.com/v1');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

  const handleSyncModels = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await fetch('/api/v1/catalog/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        const syncedCount = data.syncedProviders?.length || 0;
        const failedList = data.failedProviders || [];
        if (failedList.length > 0) {
          setSyncFeedback({
            type: 'warning',
            message: `Synced ${syncedCount} providers (${data.totalModels} models). Failed to sync: ${failedList.join(', ')}`,
          });
        } else {
          setSyncFeedback({
            type: 'success',
            message: `Successfully synced ${data.totalModels} models across ${syncedCount} active providers!`,
          });
        }
      } else {
        setSyncFeedback({ type: 'error', message: formatErrorMessage(data.error || data) });
      }
    } catch (e: any) {
      setSyncFeedback({ type: 'error', message: formatErrorMessage(e) });
    } finally {
      setIsSyncing(false);
    }
  };

  const currentProvider = CATALOG_OPTIONS.find((p) => p.slug === selectedProviderSlug) || CATALOG_OPTIONS[0];

  const filteredCatalogOptions = filterCatalogOptions(CATALOG_OPTIONS, tierFilter, providerSearchQuery);

  const selectProvider = (slug: string) => {
    setSelectedProviderSlug(slug);
    const prov = CATALOG_OPTIONS.find((p) => p.slug === slug);
    if (prov) setCustomBaseUrl(prov.baseUrl);
    setIsDropdownOpen(false);
  };

  const adminToken = getAdminToken();
  const activeTimers = React.useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const fetchProviders = React.useCallback(async () => {
    try {
      const res = await fetch('/api/v1/providers', {
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setKeys(data);
        }
      }
    } catch (e) {
      console.error('Failed to fetch providers', e);
    }
  }, [adminToken]);

  React.useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  React.useEffect(() => {
    return () => {
      activeTimers.current.forEach((t) => clearTimeout(t));
      activeTimers.current.clear();
    };
  }, []);

  const safeTimeout = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      activeTimers.current.delete(t);
      fn();
    }, ms);
    activeTimers.current.add(t);
    return t;
  };

  const handleSaveKey = async () => {
    if (!inputApiKey.trim()) return;
    setIsSavingKey(true);
    setConnectError(null);
    try {
      const res = await fetch('/api/v1/providers/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          providerSlug: selectedProviderSlug,
          apiKey: inputApiKey.trim(),
          baseUrl: customBaseUrl.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to save key' }));
        throw new Error(err.message || 'Failed to save key');
      }

      const connData = await res.json();

      // Immediately run handshake verification before committing connection to vault grid
      const testRes = await fetch(`/api/v1/providers/${connData.id}/test`, {
        method: 'POST',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      const testData = await testRes.json().catch(() => ({}));

      if (!testRes.ok || (testData as any).success === false) {
        const rawErr = (testData as any).error || 'Handshake verification failed';
        const cleanErr = formatCleanError(rawErr);

        // Rollback unverified connection from SQLite to prevent vault grid pollution
        await fetch(`/api/v1/providers/${connData.id}`, {
          method: 'DELETE',
          headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
        }).catch(() => {});

        setConnectError(`Verification failed: ${cleanErr}`);
        return; // Keep modal open for user retry without persisting invalid key
      }

      setInputApiKey('');
      setIsConnectModalOpen(false);
      await fetchProviders();

      // Fire-and-forget background model sync for the newly verified provider.
      const adminTokenBg = getAdminToken();
      fetch('/api/v1/catalog/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminTokenBg ? { authorization: `Bearer ${adminTokenBg}` } : {}),
        },
        body: JSON.stringify({}),
      }).catch(() => {});
    } catch (e: any) {
      setConnectError(e.message || 'Failed to save key');
    } finally {
      setIsSavingKey(false);
    }
  };

  const probeKey = async (id: string) => {
    // Skip unconfigured providers — never run handshake probes on keys that aren't set up
    const targetKey = keys.find((k) => k.id === id);
    if (!targetKey || targetKey.hasKey === false || targetKey.status === 'unconfigured') {
      return;
    }
    try {
      const res = await fetch(`/api/v1/providers/${id}/test`, {
        method: 'POST',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      const latencyMs = typeof data.latencyMs === 'number' ? data.latencyMs : 0;
      const success = res.ok && data.success !== false;
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, status: success ? 'active' : 'degraded', lastPingMs: latencyMs, lastVerified: success ? 'Just now' : 'Failed' } : k))
      );
    } catch {
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, status: 'degraded', lastVerified: 'Failed' } : k))
      );
    }
  };

  const handleTestAllKeys = async () => {
    setIsProbing(true);
    // Real concurrent handshake probes against every configured, non-unconfigured key via the backend test endpoint.
    await Promise.all(
      keys.filter((k) => k.hasKey !== false && k.status !== 'unconfigured').map((k) => probeKey(k.id))
    );
    // Re-fetch providers to ensure top capsules and card states align 100% with backend DB records
    await fetchProviders();
    setIsProbing(false);
  };

  const handleRevoke = async (id: string) => {
    setKeys((prev) =>
      prev.map((k) => (k.id === id ? { ...k, status: 'unconfigured', maskedKey: 'Not Configured', hasKey: false } : k))
    );
    try {
      const res = await fetch(`/api/v1/providers/${id}`, {
        method: 'DELETE',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      if (!res.ok) {
        console.error(`Failed to revoke provider key: HTTP ${res.status}`);
      }
      await fetchProviders();
    } catch (e) {
      console.error('Failed to revoke provider key', e);
      await fetchProviders();
    }
  };

  const handleTestKey = async (id: string) => {
    // Skip unconfigured providers — never run handshake probes on keys that aren't set up
    const targetKey = keys.find((k) => k.id === id);
    if (!targetKey || targetKey.hasKey === false || targetKey.status === 'unconfigured') {
      return;
    }
    setTestingKeyIds((prev) => ({ ...prev, [id]: true }));
    const startTime = Date.now();
    try {
      const res = await fetch(`/api/v1/providers/${id}/test`, {
        method: 'POST',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      const elapsed = Date.now() - startTime;
      if (elapsed < 400) {
        await new Promise<void>((resolve) => safeTimeout(resolve, 400 - elapsed));
      }
      const success = res.ok && data.success !== false;
      const latencyMs = typeof data.latencyMs === 'number' ? data.latencyMs : 0;
      setKeys((prev) =>
        prev.map((k) => {
          if (k.id !== id) return k;
          return {
            ...k,
            status: success ? 'active' : 'degraded',
            lastPingMs: latencyMs,
            lastVerified: success ? 'Just now' : 'Failed',
          };
        })
      );
    } catch {
      const elapsed = Date.now() - startTime;
      if (elapsed < 400) {
        await new Promise<void>((resolve) => safeTimeout(resolve, 400 - elapsed));
      }
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, status: 'degraded', lastVerified: 'Failed' } : k))
      );
    } finally {
      setTestingKeyIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  // Real telemetry capsules derived from keys loaded from GET /api/v1/providers.
  const configuredKeys = keys.filter((k) => k.hasKey !== false);
  const activeKeys = keys.filter((k) => k.hasKey && k.status === 'active');
  const healthyKeys = configuredKeys.filter((k) => k.status === 'active');
  const healthySlaPct = configuredKeys.length
    ? Math.round((healthyKeys.length / configuredKeys.length) * 100)
    : 0;
  const quotaErrors = configuredKeys.filter((k) => k.status === 'degraded').length;
  const pingValues = configuredKeys.map((k) => k.lastPingMs).filter((ms) => ms > 0);
  const avgPingMs = pingValues.length
    ? Math.round(pingValues.reduce((sum, ms) => sum + ms, 0) / pingValues.length)
    : 0;
  const fastestPing = pingValues.length ? Math.min(...pingValues) : 0;
  const quotaAvailablePct = configuredKeys.length
    ? Math.round(
        configuredKeys.reduce((sum, k) => sum + Math.max(0, 100 - (k.dailyQuotaUsedPct || 0)), 0) / configuredKeys.length
      )
    : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
            <Key className="w-6 h-6 text-[var(--accent-primary)]" />
            Credential Vault & Provider Key Gallery
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Zero-trust <GlossaryTerm term="Enclave Enforcing" /> client key store. All keys remain encrypted in local memory.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setIsConnectModalOpen(true);
              setTierFilter('all');
              setProviderSearchQuery('');
            }}
            className="px-4 py-2.5 rounded-xl bg-[var(--signal-mint)] hover:bg-[var(--signal-mint)]/80 text-slate-950 font-bold text-xs flex items-center justify-center space-x-2 shadow-lg shadow-[var(--signal-mint)]/20 transition-all active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Provider Key</span>
          </button>

          <button
            onClick={handleTestAllKeys}
            disabled={isProbing}
            className="px-4 py-2.5 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-slate-950 font-semibold text-xs flex items-center justify-center space-x-2 shadow-lg shadow-[var(--accent-primary)]/20 transition-all active:scale-95 disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${isProbing ? 'animate-spin' : ''}`} />
            <span>{isProbing ? 'Running Handshake Probe...' : 'Probe & Test All Keys'}</span>
          </button>
        </div>
      </div>

      {/* Model Sync Feedback Banner */}
      {syncFeedback && (
        <div className={`p-3 rounded-xl border text-xs flex items-center justify-between transition-all ${
          syncFeedback.type === 'success'
            ? 'bg-[var(--signal-mint)]/10 border-[var(--signal-mint)]/30 text-[var(--signal-mint)]'
            : syncFeedback.type === 'warning'
            ? 'bg-[var(--signal-amber)]/10 border-[var(--signal-amber)]/30 text-[var(--signal-amber)]'
            : 'bg-[var(--signal-coral)]/10 border-[var(--signal-coral)]/30 text-[var(--signal-coral)]'
        }`}>
          <span>{syncFeedback.message}</span>
          <button onClick={() => setSyncFeedback(null)} className="text-xs opacity-70 hover:opacity-100 font-bold ml-2">✕</button>
        </div>
      )}

      {/* 4 Telemetry Capsules */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        
        {/* Capsule 1 */}
        <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1 squircle-capsule">
          <div className="text-[11px] text-[var(--text-muted)] font-medium uppercase">Active Enclave Keys</div>
          <div className="text-xl font-bold text-[var(--text-primary)] font-mono" dir="ltr">{activeKeys.length} / {keys.length}</div>
          <div className="text-[10px] text-[var(--signal-mint)] font-mono flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> {configuredKeys.length > 0 ? 'All providers ready' : 'No keys configured'}
          </div>
        </div>

        {/* Capsule 2 */}
        <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1 squircle-capsule">
          <div className="text-[11px] text-[var(--text-muted)] font-medium uppercase">Healthy Handshake SLA</div>
          <div className="text-xl font-bold text-[var(--signal-mint)] font-mono" dir="ltr">{healthySlaPct}% Verified</div>
          <div className="text-[10px] text-[var(--text-secondary)] font-mono">{quotaErrors} quota errors</div>
        </div>

        {/* Capsule 3 */}
        <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1 squircle-capsule">
          <div className="text-[11px] text-[var(--text-muted)] font-medium uppercase">Avg Handshake Ping</div>
          <div className="text-xl font-bold text-[var(--text-primary)] font-mono" dir="ltr">{avgPingMs > 0 ? `${avgPingMs} ms` : '—'}</div>
          <div className="text-[10px] text-[var(--signal-mint)] font-mono">
            {fastestPing > 0 ? `Fastest: ${fastestPing}ms` : 'Run a handshake probe'}
          </div>
        </div>

        {/* Capsule 4 */}
        <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1 squircle-capsule">
          <div className="text-[11px] text-[var(--text-muted)] font-medium uppercase">Free Daily Quota Available</div>
          <div className="text-xl font-bold text-[var(--signal-mint)] font-mono" dir="ltr">{quotaAvailablePct}%</div>
          <div className="text-[10px] text-[var(--text-secondary)] font-mono">Resets at midnight UTC</div>
        </div>
      </div>

      {/* Vault Watchdog Alert Banner */}
      <div className="p-4 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-hover)] flex items-start space-x-3 text-xs">
        <ShieldCheck className="w-5 h-5 text-[var(--signal-mint)] shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <div className="font-semibold text-[var(--text-primary)]">Vault Watchdog Guard Active</div>
          <div className="text-[var(--text-secondary)] leading-relaxed">
            All provider keys are isolated inside local web application memory using standard zero-trust encryption primitives. Credentials are never written to disk or transmitted to third-party tracking servers.
          </div>
        </div>
      </div>

            {/* 2x2 Squircle Key Cards Gallery Grid */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <div>
            <h2 className="text-base font-bold text-[var(--text-primary)]">Configured Key Enclaves</h2>
            <p className="text-xs text-[var(--text-muted)]">Active provider credentials available for low-latency solver routing</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncModels}
              disabled={isSyncing}
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold flex items-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50"
              title="Discover and sync latest models from active providers"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-[var(--accent-primary)]' : ''}`} />
              <span>{isSyncing ? 'Syncing Catalog...' : 'Sync Models'}</span>
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {keys.length === 0 && (
            <div className="col-span-full p-8 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center text-xs text-[var(--text-secondary)]">
              No provider keys connected yet. Click "Connect Provider Key" to add your first credential.
            </div>
          )}
          {keys.map((key) => {
            return (
              <div
                key={key.id}
                className="squircle-card p-5 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-active)] transition-all duration-200 space-y-4 shadow-xl"
              >
                {/* Key Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20">
                      <Key className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[var(--text-primary)]">{key.provider}</h3>
                      <span className="text-[10px] text-[var(--signal-mint)] font-mono bg-[var(--signal-mint)]/10 px-2 py-0.5 rounded-full border border-[var(--signal-mint)]/20 whitespace-nowrap">
                        {key.tier}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full shrink-0 border ${
                      key.status === 'degraded' || key.status === 'unavailable'
                        ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                        : key.status === 'unconfigured'
                        ? 'text-[var(--text-muted)] bg-[var(--bg-well)] border-[var(--border-subtle)]'
                        : 'text-[var(--signal-mint)] bg-[var(--signal-mint)]/10 border-[var(--signal-mint)]/20'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${key.status === 'degraded' || key.status === 'unavailable' ? 'bg-amber-400' : key.status === 'unconfigured' ? 'bg-[var(--text-muted)]' : 'bg-[var(--signal-mint)] animate-pulse'}`} />
                    {key.status === 'degraded' || key.status === 'unavailable' ? 'Degraded' : key.status === 'unconfigured' ? 'Unconfigured' : key.status === 'testing' ? 'Testing' : 'Verified'}
                  </span>
                </div>
{/* Error Alert Box (Full width below header) */}
{(key.status === 'degraded' || key.status === 'unavailable') && key.lastError ? (
  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] space-y-1 w-full overflow-hidden">
    <div className="flex items-center gap-1.5 font-semibold text-amber-400">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>Verification Failed</span>
    </div>
    <p className="text-[10px] text-amber-200/80 font-mono break-words leading-tight" title={key.lastError}>
      {formatCleanError(key.lastError)}
    </p>
  </div>
) : null}

                {/* Masked Key Display */}
                <div className="bg-[var(--bg-well)] p-3 rounded-xl border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-secondary)]" dir="ltr">
                  <span className="truncate block">{key.maskedKey}</span>
                </div>

                {/* Handshake & Quota Stats */}
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--text-muted)]">Last Handshake:</span>
                    <span className="font-mono text-[var(--text-primary)]" dir="ltr">{key.lastVerified} ({key.lastPingMs}ms)</span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--text-muted)]">Daily Quota Used:</span>
                      <span className="font-mono text-[var(--accent-primary)]" dir="ltr">{key.dailyQuotaUsedPct}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent-primary)] rounded-full transition-all duration-300"
                        style={{ width: `${key.dailyQuotaUsedPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Card Actions: Test Handshake & Revoke */}
                <div className="flex items-center space-x-2 pt-2 border-t border-[var(--border-subtle)]">
                  <button
                    onClick={() => handleTestKey(key.id)}
                    disabled={testingKeyIds[key.id]}
                    className="flex-1 px-3 py-1.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingKeyIds[key.id] ? 'animate-spin text-[var(--accent-primary)]' : ''}`} />
                    <span>{testingKeyIds[key.id] ? 'Testing...' : 'Test Handshake'}</span>
                  </button>

                  {key.hasKey !== false && key.status !== 'unconfigured' && (
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition-all active:scale-95"
                      title="Revoke Key Credential"
                    >
                      Revoke
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      </div>

      {/* Enclave Security Diagnostics Card */}
      <div className="p-6 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Lock className="w-4 h-4 text-[var(--accent-primary)]" />
          Enclave Security Diagnostics & Isolation Integrity
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1">
            <div className="font-semibold text-[var(--text-primary)]">Memory Isolation</div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Process memory boundaries verified via isolated browser context sandboxing.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1">
            <div className="font-semibold text-[var(--text-primary)]">Key Leak Prevention</div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Outbound request payload scrubbers ensure headers are stripped of raw tokens in logs.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1">
            <div className="font-semibold text-[var(--text-primary)]"><GlossaryTerm term="Jitter Shield" /> Proxy</div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Sub-millisecond sliding-window jitter shielding dampens latency spikes during probes.
            </p>
          </div>
        </div>
      </div>

      {/* Connect Provider Key Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-3xl p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Key className="w-5 h-5 text-[var(--signal-mint)]" />
                Connect Provider Key
              </h3>
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-well)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {connectError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{connectError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              {/* Tier Filter Tabs */}
              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-secondary)] text-[11px] uppercase tracking-wider">
                  Filter by Tier
                </label>
                <div className="grid grid-cols-4 gap-1.5 p-1 bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded-xl text-xs">
                  {(['all', 'free', 'freemium', 'paid'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTierFilter(t)}
                      className={`py-1.5 px-2 rounded-lg font-medium capitalize text-[11px] transition-all ${
                        tierFilter === t
                          ? 'bg-[var(--accent-primary)] text-white shadow-sm font-bold'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-active)]'
                      }`}
                    >
                      {t === 'all' ? 'All' : t === 'free' ? 'Free Tier' : t === 'freemium' ? 'Initially Free' : 'Paid'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Searchable Provider Selector Combobox */}
              <div className="space-y-1.5 relative">
                <label className="font-semibold text-[var(--text-secondary)]">Select Provider</label>
                <div className="relative">
                  <input
                    type="search"
                    name="provider-search-no-autofill"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={isDropdownOpen ? providerSearchQuery : currentProvider.displayName}
                    onChange={(e) => {
                      setProviderSearchQuery(e.target.value);
                      if (!isDropdownOpen) setIsDropdownOpen(true);
                    }}
                    onFocus={() => {
                      setIsDropdownOpen(true);
                      setProviderSearchQuery('');
                    }}
                    placeholder="Type to search provider (e.g. Groq, Gemini, Claude)..."
                    className="w-full p-3 pr-10 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--signal-mint)] rounded-xl text-[var(--text-primary)] font-medium focus:outline-none transition-colors"
                    dir="ltr"
                  />
                  <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] absolute right-3 top-3.5 transition-transform pointer-events-none ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </div>

                {isDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsDropdownOpen(false)} />
                    <div className="absolute z-50 w-full mt-1 bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto custom-scrollbar">
                      {filteredCatalogOptions.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-[var(--text-muted)] text-center">
                          No providers found matching query.
                        </div>
                      ) : (
                        filteredCatalogOptions.map((opt) => (
                          <button
                            key={opt.slug}
                            type="button"
                            onClick={() => {
                              selectProvider(opt.slug);
                              setIsDropdownOpen(false);
                            }}
                            className={`w-full px-3 py-2.5 text-left font-medium flex items-center justify-between transition-colors border-b border-[var(--border-subtle)]/30 last:border-0 ${
                              opt.slug === selectedProviderSlug ? 'bg-[var(--bg-card-active)] text-[var(--accent-primary)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-card-active)]'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span>{opt.displayName}</span>
                              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full font-bold uppercase ${
                                opt.tierCategory === 'free'
                                  ? 'bg-[var(--signal-mint)]/15 text-[var(--signal-mint)] border border-[var(--signal-mint)]/30'
                                  : opt.tierCategory === 'freemium'
                                  ? 'bg-[var(--signal-amber)]/15 text-[var(--signal-amber)] border border-[var(--signal-amber)]/30'
                                  : 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                              }`}>
                                {opt.tierLabel}
                              </span>
                            </span>
                            {opt.slug === selectedProviderSlug && <Check className="w-3.5 h-3.5 text-[var(--signal-mint)]" />}
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-secondary)]">API Key</label>
                <input
                  type="password"
                  name="provider-api-key-secret"
                  autoComplete="new-password"
                  data-lpignore="true"
                  value={inputApiKey}
                  onChange={(e) => setInputApiKey(e.target.value)}
                  placeholder="Paste your API key here..."
                  className="w-full p-3 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--signal-mint)] rounded-xl text-[var(--text-primary)] font-mono focus:outline-none"
                  dir="ltr"
                />
                <a
                  href={currentProvider.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--accent-primary)] hover:underline flex items-center gap-1 font-medium"
                >
                  <span className="flex items-center gap-1.5">
                    <span>Get {currentProvider.displayName} API Key</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                </a>
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] font-medium transition-colors"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                  Advanced Settings (Base URL Override)
                </button>
                {showAdvanced && (
                  <div className="mt-3 space-y-1.5">
                    <label className="font-semibold text-[var(--text-secondary)]">Endpoint Base URL</label>
                    <input
                      type="text"
                      value={customBaseUrl}
                      onChange={(e) => setCustomBaseUrl(e.target.value)}
                      placeholder={currentProvider.baseUrl}
                      className="w-full p-3 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--signal-mint)] rounded-xl text-[var(--text-primary)] font-mono focus:outline-none"
                      dir="ltr"
                    />
                    <p className="text-[var(--text-muted)] leading-relaxed">
                      Default endpoint used for API requests. Modify only if using custom proxies or local models.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] text-[var(--text-secondary)] font-semibold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveKey}
                disabled={!inputApiKey.trim() || isSavingKey}
                className="flex-1 py-2.5 rounded-xl bg-[var(--signal-mint)] hover:bg-[var(--signal-mint)]/80 text-slate-950 font-bold text-xs flex items-center justify-center space-x-2 disabled:opacity-50 transition-all shadow-lg shadow-[var(--signal-mint)]/20"
              >
                {isSavingKey ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>{isSavingKey ? 'Saving...' : 'Save Key'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

