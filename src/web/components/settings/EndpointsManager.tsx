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

interface SystemEndpointsStatus {
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

const COPY_TARGETS = (status: SystemEndpointsStatus): Snippet[] => {
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
    {
      id: 'mcp-config',
      label: 'MCP Server Config',
      text: `{\n  "mcpServers": {\n    "goalroute": {\n      "url": "http://${displayHost}:${mcp.port}/mcp/sse"\n    }\n  }\n}`,
    },
  ];
};

function getAdminToken(): string {
  return (
    sessionStorage.getItem('goalroute_admin_token') ||
    localStorage.getItem('goalroute_admin_token') ||
    'dev-admin-secret-token'
  );
}

export const EndpointsManager: React.FC = () => {
  const [status, setStatus] = useState<SystemEndpointsStatus | null>(null);
  const [portDrafts, setPortDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/endpoints', {
        headers: { authorization: `Bearer ${getAdminToken()}` },
      });
      if (!res.ok) throw new Error(`Failed to load endpoints (HTTP ${res.status})`);
      const data = (await res.json()) as SystemEndpointsStatus;
      setStatus(data);
      setPortDrafts(Object.fromEntries(Object.values(data.endpoints).map((e) => [e.protocol, String(e.port)])));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
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

  if (!status) {
    return (
      <div className="p-5 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading endpoint status…
      </div>
    );
  }

  const snippets = COPY_TARGETS(status);

  return (
    <div className="p-5 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-5">
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
            {status.remoteAccessEnabled ? (
              <Globe className="w-4 h-4 text-[var(--signal-amber)]" />
            ) : (
              <Lock className="w-4 h-4 text-[var(--signal-mint)]" />
            )}
            {status.remoteAccessEnabled ? 'Remote Access (0.0.0.0)' : 'Local Only (127.0.0.1)'}
          </div>
          <button
            disabled={busy}
            onClick={() => void applyUpdate({ remoteAccessEnabled: !status.remoteAccessEnabled })}
            className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-50"
          >
            {status.remoteAccessEnabled ? (
              <ToggleRight className="w-5 h-5 text-[var(--signal-amber)]" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-[var(--text-muted)]" />
            )}
            {status.remoteAccessEnabled ? 'Remote' : 'Local'}
          </button>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
          Local mode binds every protocol port to 127.0.0.1. Remote mode binds 0.0.0.0 to expose the gateway on
          your network — only enable on trusted networks.
        </p>
      </div>


      {/* Exposed Endpoints List */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Exposed Endpoints
        </div>
        {Object.values(status.endpoints).map((endpoint) => (
          <div
            key={endpoint.protocol}
            className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    endpoint.enabled ? 'bg-[var(--signal-mint)]' : 'bg-[var(--signal-coral)]'
                  }`}
                />
                <span className="text-xs font-bold text-[var(--text-primary)]">
                  {PROTOCOL_LABELS[endpoint.protocol] ?? endpoint.protocol}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={portDrafts[endpoint.protocol] ?? String(endpoint.port)}
                  onChange={(e) => setPortDrafts((prev) => ({ ...prev, [endpoint.protocol]: e.target.value }))}
                  className="w-20 px-2 py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] rounded-lg font-mono text-xs text-[var(--text-primary)] focus:outline-none"
                  dir="ltr"
                  disabled={busy}
                />
                <button
                  disabled={busy || (portDrafts[endpoint.protocol] ?? '') === String(endpoint.port)}
                  onClick={() => void applyUpdate({ ports: { [endpoint.protocol]: Number(portDrafts[endpoint.protocol]) } })}
                  className="px-2.5 py-1 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-40 text-slate-950 font-bold text-[10px] transition-all"
                >
                  Apply
                </button>
                <button
                  disabled={busy}
                  onClick={() => void applyUpdate({ enabledProtocols: { [endpoint.protocol]: !endpoint.enabled } })}
                  className="text-[10px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  {endpoint.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
            <div className="text-[10px] text-[var(--text-muted)] font-mono" dir="ltr">
              http://{status.host === '0.0.0.0' ? '127.0.0.1' : status.host}:{endpoint.port}
              {endpoint.pathPrefix}
            </div>
            <div className="text-[10px] text-[var(--text-secondary)]">{endpoint.description}</div>
            <button
              onClick={() => void copy(`curl-${endpoint.protocol}`, endpoint.sampleCurl)}
              className="flex items-center gap-1.5 text-[10px] text-[var(--accent-primary)] hover:underline"
            >
              {copiedId === `curl-${endpoint.protocol}` ? (
                <Check className="w-3 h-3 text-[var(--signal-mint)]" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              {copiedId === `curl-${endpoint.protocol}` ? 'Copied!' : 'Copy connection snippet'}
            </button>
          </div>
        ))}
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
              className="p-1.5 rounded-lg hover:bg-[var(--bg-card-active)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0 transition-colors"
              title={`Copy ${snippet.label}`}
            >
              {copiedId === snippet.id ? (
                <Check className="w-3.5 h-3.5 text-[var(--signal-mint)]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

