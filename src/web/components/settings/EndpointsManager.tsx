import React, { useCallback, useEffect, useState } from 'react';
import { Network, ToggleLeft, ToggleRight, Copy, Check, RefreshCw, Globe, Lock, AlertCircle } from 'lucide-react';
import { sanitizeForClipboard } from '../../utils/clipboardSanitizer.js';

interface ProtocolEndpointConfig {
  protocol: string;
  enabled: boolean;
  port: number;
  pathPrefix: string;
  description: string;
  sampleCurl: string;
}

export interface SystemEndpointsStatus {
  host: string;
  remoteAccessEnabled: boolean;
  endpoints: Record<string, ProtocolEndpointConfig>;
}

interface Snippet {
  id: string;
  label: string;
  text: string;
}

const PROTOCOL_LABELS: Record<string, string> = {
  native: 'Native Gateway',
  openai: 'OpenAI Compatible',
  anthropic: 'Anthropic Compatible',
  mcp: 'MCP Server',
};

export const COPY_TARGETS = (status: SystemEndpointsStatus, hideMcp = false): Snippet[] => {
  const displayHost = status.host === '0.0.0.0' ? '127.0.0.1' : status.host;
  const openai = status.endpoints.openai;
  const anthropic = status.endpoints.anthropic;
  const mcp = status.endpoints.mcp;
  return [
    {
      id: 'curl',
      label: 'cURL (OpenAI format)',
      text: `curl http://${displayHost}:${openai.port}/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"<model>","messages":[{"role":"user","content":"Hello"}]}'`,
    },
    {
      id: 'openai-sdk',
      label: 'OpenAI SDK baseURL',
      text: `baseURL: "http://${displayHost}:${openai.port}/v1"`,
    },
    {
      id: 'anthropic-sdk',
      label: 'Anthropic SDK baseURL',
      text: `baseURL: "http://${displayHost}:${anthropic.port}"`,
    },
    ...(!hideMcp
      ? [
          {
            id: 'mcp-config',
            label: 'MCP Server Config',
            text: `{\n  "mcpServers": {\n    "goalroute": {\n      "url": "http://${displayHost}:${mcp.port}/mcp/sse"\n    }\n  }\n}`,
          },
        ]
      : []),
  ];
};

export function getAdminToken(): string {
  return (
    sessionStorage.getItem('goalroute_admin_token') ||
    localStorage.getItem('goalroute_admin_token') ||
    (import.meta as any).env?.VITE_ADMIN_API_TOKEN ||
    'dev-admin-secret-token'
  );
}

export const DEFAULT_FALLBACK_STATUS: SystemEndpointsStatus = {
  host: typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1',
  remoteAccessEnabled: false,
  endpoints: {
    native: { protocol: 'native', enabled: true, port: 8787, pathPrefix: '/api/v1', description: 'Native Gateway API', sampleCurl: '' },
    openai: { protocol: 'openai', enabled: true, port: 8788, pathPrefix: '/v1', description: 'OpenAI Compatibility', sampleCurl: '' },
    anthropic: { protocol: 'anthropic', enabled: true, port: 8789, pathPrefix: '/v1', description: 'Anthropic Compatibility', sampleCurl: '' },
    mcp: { protocol: 'mcp', enabled: true, port: 8790, pathPrefix: '/mcp', description: 'MCP Bridge Server', sampleCurl: '' },
  },
};

export interface EndpointsManagerProps { hideMcp?: boolean; onStatusChange?: (status: SystemEndpointsStatus) => void }
export const EndpointsManager: React.FC<EndpointsManagerProps> = ({ hideMcp = false, onStatusChange }) => {
  const [status, setStatus] = useState<SystemEndpointsStatus | null>(null);
  const [portDrafts, setPortDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const adminToken = getAdminToken();
      const headers: Record<string, string> = {};
      if (adminToken) {
        headers['authorization'] = `Bearer ${adminToken}`;
      }
      const res = await fetch('/api/v1/system/endpoints', { headers });
      if (!res.ok) {
        // Fallback gracefully without locking the UI in an error state
        setStatus(DEFAULT_FALLBACK_STATUS);
        return;
      }
      const data = (await res.json()) as SystemEndpointsStatus;
      setStatus(data);
      onStatusChange?.(data);
      setPortDrafts(Object.fromEntries(Object.values(data.endpoints).map((e) => [e.protocol, String(e.port)])));
      setError(null);
    } catch (err) {
      setStatus(DEFAULT_FALLBACK_STATUS);
      setError(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyUpdate = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/system/endpoints', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as SystemEndpointsStatus | { error?: { message?: string } };
      if (!res.ok) {
        const message =
          'error' in data && data.error?.message ? data.error.message : `Update failed (HTTP ${res.status})`;
        throw new Error(message);
      }
      const next = data as SystemEndpointsStatus;
      setStatus(next);
      onStatusChange?.(next);
      setPortDrafts(Object.fromEntries(Object.values(next.endpoints).map((e) => [e.protocol, String(e.port)])));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const copy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(sanitizeForClipboard(text));
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  if (!status && !error) {
    return (
      <div className="p-5 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-between text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-[var(--accent-primary)]" />
          <span>Connecting to Gateway Server status…</span>
        </div>
      </div>
    );
  }

  const activeStatus = status || DEFAULT_FALLBACK_STATUS;

  const snippets = COPY_TARGETS(activeStatus, hideMcp);

  return (
    <div className="p-5 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-5">
      {/* Error Alert Banner if fetch/update failed */}
      {error && (
        <div className="p-3.5 rounded-xl bg-[var(--signal-coral)]/10 border border-[var(--signal-coral)]/30 text-xs text-[var(--signal-coral)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void load()}
            className="px-2.5 py-1 rounded-lg bg-[var(--signal-coral)]/20 hover:bg-[var(--signal-coral)]/30 font-semibold text-[11px] transition-colors"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Network className="w-4 h-4 text-[var(--accent-primary)]" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">Connection &amp; Endpoints</h3>
        </div>
        <button
          onClick={() => void load()}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-card-active)] text-[var(--text-muted)] transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <div className="p-2.5 rounded-xl bg-[var(--bg-well)] border border-[var(--signal-coral)]/40 flex items-center gap-2 text-xs text-[var(--signal-coral)]">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span dir="ltr">{error}</span>
        </div>
      )}

      {/* Host & Remote Access Controls */}
      <div className="p-4 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
            {activeStatus.remoteAccessEnabled ? (
              <Globe className="w-4 h-4 text-[var(--signal-amber)]" />
            ) : (
              <Lock className="w-4 h-4 text-[var(--signal-mint)]" />
            )}
            {activeStatus.remoteAccessEnabled ? 'Remote Access (0.0.0.0)' : 'Local Only (127.0.0.1)'}
          </div>
          <button
            disabled={busy}
            onClick={() => void applyUpdate({ remoteAccessEnabled: !activeStatus.remoteAccessEnabled })}
            className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-50"
          >
            {activeStatus.remoteAccessEnabled ? (
              <ToggleRight className="w-5 h-5 text-[var(--signal-amber)]" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-[var(--text-muted)]" />
            )}
            {activeStatus.remoteAccessEnabled ? 'Remote' : 'Local'}
          </button>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
          Local mode binds every protocol port to 127.0.0.1. Remote mode binds 0.0.0.0 to expose the gateway on
          your network — only enable on trusted networks.
        </p>
      </div>


      {/* Exposed Endpoints List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Exposed Endpoints
          </div>
          <div className="text-[10px] text-[var(--text-muted)] hidden sm:block">
            Quickly copy endpoint URLs or toggle availability
          </div>
        </div>
        {Object.values(activeStatus.endpoints)
          .filter((endpoint) => !hideMcp || endpoint.protocol !== 'mcp')
          .map((endpoint) => {
            const displayHost = activeStatus.host === '0.0.0.0' ? '127.0.0.1' : activeStatus.host;
            const endpointUrl = `http://${displayHost}:${endpoint.port}${endpoint.pathPrefix}`;
            const isNative = endpoint.protocol === 'native';
            const isEnabled = endpoint.enabled;

            return (
              <div
                key={endpoint.protocol}
                className={`p-3.5 rounded-xl border transition-all space-y-3 ${
                  isEnabled
                    ? 'bg-[var(--bg-well)] border-[var(--border-subtle)] shadow-sm'
                    : 'bg-[var(--bg-well)]/40 border-dashed border-[var(--border-subtle)] opacity-75'
                }`}
              >
                {/* Header: Status Badge, Protocol Name & Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono border transition-colors ${
                        isEnabled
                          ? 'bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] border-[var(--signal-mint)]/30'
                          : 'bg-[var(--signal-coral)]/10 text-[var(--signal-coral)] border-[var(--signal-coral)]/30'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isEnabled ? 'bg-[var(--signal-mint)] animate-pulse' : 'bg-[var(--signal-coral)]'
                        }`}
                      />
                      {isEnabled ? 'ACTIVE' : 'DISABLED'}
                    </span>
                    <span className="text-xs font-bold text-[var(--text-primary)]">
                      {PROTOCOL_LABELS[endpoint.protocol] ?? endpoint.protocol}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">Port:</span>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={portDrafts[endpoint.protocol] ?? String(endpoint.port)}
                      onChange={(e) => setPortDrafts((prev) => ({ ...prev, [endpoint.protocol]: e.target.value }))}
                      className="w-20 px-2 py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] rounded-lg font-mono text-xs text-[var(--text-primary)] focus:outline-none"
                      dir="ltr"
                      disabled={busy}
                      readOnly={isNative}
                    />
                    <button
                      disabled={busy || (portDrafts[endpoint.protocol] ?? '') === String(endpoint.port)}
                      onClick={() => void applyUpdate({ ports: { [endpoint.protocol]: Number(portDrafts[endpoint.protocol]) } })}
                      className="px-2.5 py-1 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-40 text-slate-950 font-bold text-[10px] transition-all cursor-pointer"
                    >
                      Apply
                    </button>

                    {/* Enable / Disable Toggle Switch Button */}
                    <button
                      disabled={busy}
                      onClick={() => void applyUpdate({ enabledProtocols: { [endpoint.protocol]: !isEnabled } })}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all disabled:opacity-40 cursor-pointer ${
                        isEnabled
                          ? 'bg-[var(--signal-mint)]/10 hover:bg-[var(--signal-mint)]/20 text-[var(--signal-mint)] border-[var(--signal-mint)]/30'
                          : 'bg-[var(--bg-card)] hover:bg-[var(--bg-card-active)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border-[var(--border-subtle)]'
                      }`}
                      title={isEnabled ? 'Click to disable endpoint' : 'Click to enable endpoint'}
                    >
                      {isEnabled ? (
                        <>
                          <ToggleRight className="w-4 h-4 text-[var(--signal-mint)]" />
                          <span>Active</span>
                        </>
                      ) : (
                        <>
                          <ToggleLeft className="w-4 h-4 text-[var(--text-muted)]" />
                          <span>Disabled</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {isNative && (
                  <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                    Native port is fixed to the main server (PORT env var) and requires a restart to change.
                  </p>
                )}

                {/* Instant Copyable Endpoint URL Box */}
                <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0">
                      URL:
                    </span>
                    <code
                      className={`text-xs font-mono truncate select-all ${
                        isEnabled
                          ? 'text-[var(--accent-primary)] font-semibold'
                          : 'text-[var(--text-muted)] line-through decoration-[var(--signal-coral)]/60'
                      }`}
                      dir="ltr"
                    >
                      {endpointUrl}
                    </code>
                    {!isEnabled && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--signal-coral)]/10 text-[var(--signal-coral)] border border-[var(--signal-coral)]/20 shrink-0">
                        Inactive
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void copy(`url-${endpoint.protocol}`, endpointUrl)}
                    className="px-2.5 py-1 rounded-lg bg-[var(--bg-well)] hover:bg-[var(--accent-primary)]/15 border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/40 text-[10px] font-semibold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer"
                    title={`Copy ${PROTOCOL_LABELS[endpoint.protocol] ?? endpoint.protocol} endpoint URL`}
                  >
                    {copiedId === `url-${endpoint.protocol}` ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[var(--signal-mint)]" />
                        <span className="text-[var(--signal-mint)] font-bold">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                        <span className="text-[var(--text-primary)]">Copy URL</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Description & Optional cURL Snippet */}
                <div className="flex items-center justify-between text-[10px] gap-2 pt-0.5">
                  <div className="text-[var(--text-secondary)] truncate">{endpoint.description}</div>
                  <button
                    onClick={() =>
                      void copy(
                        `curl-${endpoint.protocol}`,
                        endpoint.sampleCurl || `curl ${endpointUrl} -H "Content-Type: application/json"`
                      )
                    }
                    className="flex items-center gap-1 text-[var(--accent-primary)] hover:underline shrink-0 font-medium cursor-pointer"
                  >
                    {copiedId === `curl-${endpoint.protocol}` ? (
                      <Check className="w-3 h-3 text-[var(--signal-mint)]" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {copiedId === `curl-${endpoint.protocol}` ? 'Copied Snippet!' : 'Copy Snippet'}
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {/* Copyable SDK Connection Snippets */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Client Connection Snippets
        </div>
        {snippets.map((snippet) => (
          <div
            key={snippet.id}
            className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-[var(--text-primary)]">{snippet.label}</div>
              <div className="text-[10px] text-[var(--text-muted)] font-mono truncate" dir="ltr">
                {snippet.text.split('\n')[0]}
              </div>
            </div>
            <button
              onClick={() => void copy(snippet.id, snippet.text)}
              className="px-2.5 py-1 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-card-active)] border border-[var(--border-subtle)] text-[10px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer"
              title={`Copy ${snippet.label}`}
            >
              {copiedId === snippet.id ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[var(--signal-mint)]" />
                  <span className="text-[var(--signal-mint)] font-bold">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Admin Security Token & Bearer Authentication Section */}
      <AdminTokenSection />
    </div>
  );
};

export const AdminTokenSection: React.FC = () => {
  const [token, setToken] = useState(() => getAdminToken());
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const saveTokenValue = (val: string) => {
    setToken(val);
    try {
      localStorage.setItem('goalroute_admin_token', val);
      sessionStorage.setItem('goalroute_admin_token', val);
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clearTokenValue = () => {
    try {
      localStorage.removeItem('goalroute_admin_token');
      sessionStorage.removeItem('goalroute_admin_token');
    } catch {}
    setToken('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const generateRandomToken = () => {
    const bytes = new Uint8Array(16);
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const newToken = `sk-admin-${hex}`;
    saveTokenValue(newToken);
  };

  const copyToken = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(sanitizeForClipboard(token));
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {}
  };

  return (
    <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-4 shadow-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <div className="p-2 rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-[var(--text-bright)] flex items-center gap-2">
              Admin Security Token &amp; Bearer Authentication
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Bearer authentication key used for securing all local and network management APIs (<code className="font-mono text-[var(--signal-mint)]">/api/v1/*</code>).
            </p>
          </div>
        </div>
        {saved && (
          <span className="text-xs text-[var(--signal-mint)] font-bold flex items-center gap-1 font-mono shrink-0">
            <Check className="w-4 h-4" /> Token Saved &amp; Active!
          </span>
        )}
      </div>

      {/* Explanatory Banner */}
      <div className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] space-y-1.5 leading-relaxed">
        <div className="font-semibold text-[var(--text-bright)] flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
          Why is this token required?
        </div>
        <p>
          GoalRoute enforces token authentication to prevent unauthorized local or network access to your configured provider API keys and routing policies. The workstation UI automatically attaches this token to all request headers.
        </p>
        <div className="font-mono text-[11px] text-[var(--text-muted)] pt-1" dir="ltr">
          Header format: <span className="text-[var(--signal-mint)]">Authorization: Bearer &lt;token&gt;</span>
        </div>
      </div>

      {/* Token Input & Buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="relative flex-1">
          <input
            type="text"
            value={token}
            onChange={(e) => saveTokenValue(e.target.value)}
            placeholder="e.g. dev-admin-secret-token"
            className="w-full p-2.5 pr-10 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] rounded-xl font-mono text-xs text-[var(--text-bright)] focus:outline-none"
            dir="ltr"
          />
          <button
            onClick={copyToken}
            className="absolute right-2 top-2 p-1 rounded hover:bg-[var(--bg-card-active)] text-[var(--text-secondary)] hover:text-[var(--text-bright)] transition-colors"
            title="Copy Token to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[var(--signal-mint)]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        <button
          type="button"
          onClick={generateRandomToken}
          className="py-2.5 px-3.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)] text-xs font-semibold text-[var(--text-bright)] flex items-center justify-center space-x-1.5 transition-all shrink-0 cursor-pointer active:scale-95"
          title="Generate a high-entropy random token"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[var(--signal-mint)]" />
          <span>Generate Token</span>
        </button>

        <button
          type="button"
          onClick={clearTokenValue}
          className="py-2.5 px-3.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] border border-[var(--border-subtle)] hover:border-red-500/50 text-xs font-semibold text-[var(--text-secondary)] hover:text-red-400 flex items-center justify-center space-x-1.5 transition-all shrink-0 cursor-pointer active:scale-95"
          title="Clear saved browser token"
        >
          <span>Reset Token</span>
        </button>

        <button
          type="button"
          onClick={() => saveTokenValue(token)}
          className="py-2.5 px-4 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-slate-950 font-bold text-xs shrink-0 transition-all shadow-sm active:scale-95 cursor-pointer"
        >
          Save Token
        </button>
      </div>
    </div>
  );
};

