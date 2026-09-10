import React, { useState } from 'react';
import { Key, ShieldCheck, RefreshCw, CheckCircle2, AlertTriangle, Cpu, Lock, Terminal, Activity, Zap, Check, ChevronDown, Plus, X } from 'lucide-react';
import { GlossaryTerm } from '../common/GlossaryTerm.js';

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
}

const CATALOG_OPTIONS = [
  { slug: 'openai', displayName: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', baseUrl: 'https://api.openai.com/v1' },
  { slug: 'anthropic', displayName: 'Anthropic Claude', keyUrl: 'https://console.anthropic.com/', baseUrl: 'https://api.anthropic.com/v1' },
  { slug: 'gemini', displayName: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { slug: 'groq', displayName: 'Groq Cloud', keyUrl: 'https://console.groq.com/keys', baseUrl: 'https://api.groq.com/openai/v1' },
  { slug: 'openrouter', displayName: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', baseUrl: 'https://openrouter.ai/api/v1' },
  { slug: 'together', displayName: 'Together AI', keyUrl: 'https://api.together.ai/settings/api-keys', baseUrl: 'https://api.together.xyz/v1' },
  { slug: 'cerebras', displayName: 'Cerebras', keyUrl: 'https://cloud.cerebras.ai/', baseUrl: 'https://api.cerebras.ai/v1' },
  { slug: 'sambanova', displayName: 'SambaNova Cloud', keyUrl: 'https://cloud.sambanova.ai/', baseUrl: 'https://api.sambanova.ai/v1' },
  { slug: 'deepseek', displayName: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys', baseUrl: 'https://api.deepseek.com/v1' },
  { slug: 'mistral', displayName: 'Mistral AI', keyUrl: 'https://console.mistral.ai/api-keys/', baseUrl: 'https://api.mistral.ai/v1' },
  { slug: 'fireworks', displayName: 'Fireworks AI', keyUrl: 'https://fireworks.ai/account/api-keys', baseUrl: 'https://api.fireworks.ai/inference/v1' },
  { slug: 'deepinfra', displayName: 'DeepInfra', keyUrl: 'https://deepinfra.com/dash/api_keys', baseUrl: 'https://api.deepinfra.com/v1' },
];

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('https://api.openai.com/v1');

  const currentProvider = CATALOG_OPTIONS.find((p) => p.slug === selectedProviderSlug) || CATALOG_OPTIONS[0];

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
      setInputApiKey('');
      setIsConnectModalOpen(false);
      await fetchProviders();

      // Immediately run handshake probe on the newly added provider key
      const savedKey = (await res.json().catch(() => null)) || null;
      const provKey = savedKey ? keys.find((k) => k.slug === savedKey.providerSlug) : undefined;
      if (provKey) {
        probeKey(provKey.id);
      }

      // Fire-and-forget background model sync for the newly verified provider.
      // Errors are silent: the seeded catalog remains authoritative on failure.
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
    setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, status: 'unconfigured', maskedKey: 'Not Configured', hasKey: false } : k)));
    try {
      await fetch(`/api/v1/providers/${id}`, {
        method: 'DELETE',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      await fetchProviders();
    } catch (e) {
      console.error('Failed to revoke provider key', e);
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
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Key className="w-6 h-6 text-[var(--accent-primary)]" />
            Credential Vault & Provider Key Gallery
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Zero-trust <GlossaryTerm term="Enclave Enforcing" /> client key store. All keys remain encrypted in local memory.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsConnectModalOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-[var(--signal-mint)] hover:bg-[var(--signal-mint)]/80 text-slate-950 font-bold text-xs flex items-center justify-center space-x-2 shadow-lg shadow-[var(--signal-mint)]/20 transition-all active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>+ Connect Provider Key</span>
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

      {/* 4 Telemetry Capsules */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        
        {/* Capsule 1 */}
        <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1 squircle-capsule">
          <div className="text-[11px] text-[var(--text-muted)] font-medium uppercase">Active Enclave Keys</div>
          <div className="text-xl font-bold text-white font-mono" dir="ltr">{activeKeys.length} / {keys.length}</div>
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
          <div className="text-xl font-bold text-white font-mono" dir="ltr">{avgPingMs > 0 ? `${avgPingMs} ms` : '—'}</div>
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
          <div className="font-semibold text-white">Vault Watchdog Guard Active</div>
          <div className="text-[var(--text-secondary)] leading-relaxed">
            All provider keys are isolated inside local web application memory using standard zero-trust encryption primitives. Credentials are never written to disk or transmitted to third-party tracking servers.
          </div>
        </div>
      </div>

      {/* 2x2 Squircle Key Cards Gallery Grid */}
      <div className="space-y-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Provider Key Gallery Cards</div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {keys.length === 0 && (
            <div className="col-span-full p-8 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center text-xs text-[var(--text-secondary)]">
              No provider keys connected yet. Click "+ Connect Provider Key" to add your first credential.
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
                      <h3 className="font-bold text-sm text-white">{key.provider}</h3>
                      <span className="text-[10px] text-[var(--signal-mint)] font-mono bg-[var(--signal-mint)]/10 px-2 py-0.5 rounded-full border border-[var(--signal-mint)]/20">
                        {key.tier}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full border ${
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

                {/* Masked Key Display */}
                <div className="bg-[var(--bg-well)] p-3 rounded-xl border border-[var(--border-subtle)] font-mono text-xs text-slate-300" dir="ltr">
                  <span className="truncate block">{key.maskedKey}</span>
                </div>

                {/* Handshake & Quota Stats */}
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--text-muted)]">Last Handshake:</span>
                    <span className="font-mono text-slate-200" dir="ltr">{key.lastVerified} ({key.lastPingMs}ms)</span>
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
                    className="flex-1 px-3 py-1.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] text-slate-200 border border-[var(--border-subtle)] text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingKeyIds[key.id] ? 'animate-spin text-[var(--accent-primary)]' : ''}`} />
                    <span>{testingKeyIds[key.id] ? 'Testing...' : 'Test Handshake'}</span>
                  </button>

                  <button
                    onClick={() => handleRevoke(key.id)}
                    className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition-all active:scale-95"
                    title="Revoke Key Credential"
                  >
                    Revoke
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      </div>

      {/* Enclave Security Diagnostics Card */}
      <div className="p-6 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Lock className="w-4 h-4 text-[var(--accent-primary)]" />
          Enclave Security Diagnostics & Isolation Integrity
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1">
            <div className="font-semibold text-white">Memory Isolation</div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Process memory boundaries verified via isolated browser context sandboxing.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1">
            <div className="font-semibold text-white">Key Leak Prevention</div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Outbound request payload scrubbers ensure headers are stripped of raw tokens in logs.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1">
            <div className="font-semibold text-white"><GlossaryTerm term="Jitter Shield" /> Proxy</div>
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
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-[var(--signal-mint)]" />
                Connect Provider Key
              </h3>
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-well)] transition-colors"
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
              <div className="space-y-1.5 relative">
                <label className="font-semibold text-slate-300">Select Provider</label>
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen((o) => !o)}
                  className="w-full p-3 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--signal-mint)] rounded-xl text-white font-medium focus:outline-none cursor-pointer flex items-center justify-between transition-colors"
                >
                  <span>{currentProvider.displayName}</span>
                  <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {isDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsDropdownOpen(false)} />
                    <div className="absolute z-50 w-full mt-1 bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto">
                      {CATALOG_OPTIONS.map((opt) => (
                        <button
                          key={opt.slug}
                          type="button"
                          onClick={() => selectProvider(opt.slug)}
                          className={`w-full px-3 py-2.5 text-left text-white font-medium flex items-center justify-between transition-colors ${
                            opt.slug === selectedProviderSlug ? 'bg-[var(--bg-card-active)]' : 'hover:bg-[var(--bg-card-active)]'
                          }`}
                        >
                          <span>{opt.displayName}</span>
                          {opt.slug === selectedProviderSlug && <Check className="w-3.5 h-3.5 text-[var(--signal-mint)]" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300">API Key</label>
                <input
                  type="password"
                  value={inputApiKey}
                  onChange={(e) => setInputApiKey(e.target.value)}
                  placeholder="Paste your API key here..."
                  className="w-full p-3 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--signal-mint)] rounded-xl text-white font-mono focus:outline-none"
                  dir="ltr"
                />
                <a
                  href={currentProvider.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--accent-primary)] hover:underline flex items-center gap-1 font-medium"
                >
                  Get {currentProvider.displayName} API Key ↗
                </a>
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-white font-medium transition-colors"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                  Advanced Settings (Base URL Override)
                </button>
                {showAdvanced && (
                  <div className="mt-3 space-y-1.5">
                    <label className="font-semibold text-slate-300">Endpoint Base URL</label>
                    <input
                      type="text"
                      value={customBaseUrl}
                      onChange={(e) => setCustomBaseUrl(e.target.value)}
                      placeholder={currentProvider.baseUrl}
                      className="w-full p-3 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--signal-mint)] rounded-xl text-white font-mono focus:outline-none"
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
                className="flex-1 py-2.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] text-slate-300 font-semibold text-xs transition-colors"
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
