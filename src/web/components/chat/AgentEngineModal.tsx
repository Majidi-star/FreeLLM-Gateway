import React, { useState, useEffect } from 'react';
import { X, Cpu, Server, Globe, Check, Sliders, Shield, Zap, Sparkles, Activity, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { getAdminToken } from '../settings/EndpointsManager.js';

export type AgentEngineMode = 'pool' | 'model' | 'external';
export type ExternalProtocol = 'auto' | 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface AgentEngineConfig {
  mode: AgentEngineMode;
  // Pool mode settings
  selectedPoolId: string;
  maxLatencyMs: number;
  preferReasoning: boolean;
  // Model mode settings
  selectedModelName: string;
  // External mode settings
  externalBaseUrl: string;
  externalApiKey: string;
  externalModelName: string;
  externalProtocol?: ExternalProtocol;
}

export const DEFAULT_ENGINE_CONFIG: AgentEngineConfig = {
  mode: 'pool',
  selectedPoolId: 'auto',
  maxLatencyMs: 2000,
  preferReasoning: true,
  selectedModelName: 'auto',
  externalBaseUrl: 'http://localhost:11434/v1',
  externalApiKey: '',
  externalModelName: 'llama3.2',
  externalProtocol: 'auto',
};

function extractStringError(data: unknown, fallback: string): string {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (typeof data === 'object' && data !== null) {
    const d = data as any;
    if (typeof d.message === 'string' && d.message) return d.message;
    if (typeof d.error === 'string' && d.error) return d.error;
    if (typeof d.error === 'object' && d.error !== null) {
      if (typeof d.error.message === 'string' && d.error.message) return d.error.message;
    }
  }
  return fallback;
}

interface AgentEngineModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AgentEngineConfig;
  onSaveConfig: (newConfig: AgentEngineConfig) => void;
}

export const AgentEngineModal: React.FC<AgentEngineModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [draftConfig, setDraftConfig] = useState<AgentEngineConfig>(config);
  const [availablePools, setAvailablePools] = useState<Array<{ id: string; name: string }>>([]);
  const [availableModels, setAvailableModels] = useState<Array<{ modelName: string; providerSlug: string }>>([]);

  const [testState, setTestState] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });

  useEffect(() => {
    setDraftConfig(config);
    setTestState({ status: 'idle' });
  }, [config, isOpen]);

  const handleTestConnection = async () => {
    setTestState({ status: 'testing' });
    try {
      const token = getAdminToken();
      const res = await fetch('/api/v1/agent-engine/test-external', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          externalBaseUrl: draftConfig.externalBaseUrl,
          externalApiKey: draftConfig.externalApiKey,
          externalModelName: draftConfig.externalModelName,
          externalProtocol: draftConfig.externalProtocol || 'auto',
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setTestState({
          status: 'success',
          message: typeof data.message === 'string' ? data.message : `Connected cleanly (${data.latencyMs}ms, ${data.resolvedProtocol?.toUpperCase()})`,
        });
      } else {
        const errorMsg = extractStringError(data, `Connection failed (HTTP ${res.status})`);
        setTestState({
          status: 'error',
          message: errorMsg,
        });
      }
    } catch (err: any) {
      setTestState({
        status: 'error',
        message: err.message || 'Unable to connect to gateway server',
      });
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const token = getAdminToken();
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    // Fetch pools
    fetch('/api/v1/pools', { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setAvailablePools(data.map((p) => ({ id: p.id, name: p.name })));
        }
      })
      .catch(() => {});

    // Fetch models
    fetch('/api/v1/catalog/models', { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setAvailableModels(
            data
              .filter((m: any) => m.isActive)
              .map((m: any) => ({ modelName: m.modelName, providerSlug: m.providerSlug }))
          );
        }
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveConfig(draftConfig);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-[var(--bg-rail)] border border-[var(--border-subtle)] rounded-2xl p-6 shadow-2xl space-y-6 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)] shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-[var(--text-bright)]">Agent Engine Settings</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Configure the LLM model, routing pool, or external provider powering this agent.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-bright)] hover:bg-[var(--bg-card)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Engine Mode Tabs */}
        <div className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] shrink-0">
          <button
            type="button"
            onClick={() => setDraftConfig((prev) => ({ ...prev, mode: 'pool' }))}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
              draftConfig.mode === 'pool'
                ? 'bg-[var(--accent-primary)] text-slate-950 shadow-md font-bold'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-bright)]'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Goal Pools</span>
          </button>

          <button
            type="button"
            onClick={() => setDraftConfig((prev) => ({ ...prev, mode: 'model' }))}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
              draftConfig.mode === 'model'
                ? 'bg-[var(--accent-primary)] text-slate-950 shadow-md font-bold'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-bright)]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Platform Model</span>
          </button>

          <button
            type="button"
            onClick={() => setDraftConfig((prev) => ({ ...prev, mode: 'external' }))}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
              draftConfig.mode === 'external'
                ? 'bg-[var(--accent-primary)] text-slate-950 shadow-md font-bold'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-bright)]'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>External URL</span>
          </button>
        </div>

        {/* Mode Configuration Forms */}
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1 text-xs">
          {/* Mode 1: Goal Pools & Routing */}
          {draftConfig.mode === 'pool' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
                <label className="text-[11px] font-semibold text-[var(--text-bright)] block uppercase tracking-wider">
                  Target Routing Pool / Combo
                </label>
                <select
                  value={draftConfig.selectedPoolId}
                  onChange={(e) => setDraftConfig((prev) => ({ ...prev, selectedPoolId: e.target.value }))}
                  className="w-full p-2.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] text-xs text-[var(--text-bright)] rounded-xl focus:outline-none"
                >
                  <option value="auto">⚡ Auto-Route (Best Goal &amp; Zero Latency)</option>
                  {availablePools.map((p) => (
                    <option key={p.id} value={p.id}>
                      🎯 Pool: {p.name} ({p.id})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--text-muted)]">
                  GoalRoute will solve the request dynamically using free provider enclave keys.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-[var(--text-bright)] uppercase tracking-wider">
                    Max Latency Budget (ms)
                  </label>
                  <span className="font-mono text-[var(--signal-mint)] font-bold">{draftConfig.maxLatencyMs}ms</span>
                </div>
                <input
                  type="range"
                  min={500}
                  max={8000}
                  step={250}
                  value={draftConfig.maxLatencyMs}
                  onChange={(e) => setDraftConfig((prev) => ({ ...prev, maxLatencyMs: Number(e.target.value) }))}
                  className="w-full accent-[var(--accent-primary)]"
                />
              </div>
            </div>
          )}

          {/* Mode 2: Specific Platform Model */}
          {draftConfig.mode === 'model' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
                <label className="text-[11px] font-semibold text-[var(--text-bright)] block uppercase tracking-wider">
                  Configured Platform Model
                </label>
                <select
                  value={draftConfig.selectedModelName}
                  onChange={(e) => setDraftConfig((prev) => ({ ...prev, selectedModelName: e.target.value }))}
                  className="w-full p-2.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] text-xs text-[var(--text-bright)] rounded-xl focus:outline-none font-mono"
                >
                  <option value="auto">Auto-Select Model</option>
                  {availableModels.map((m) => (
                    <option key={`${m.providerSlug}:${m.modelName}`} value={m.modelName}>
                      [{m.providerSlug.toUpperCase()}] {m.modelName}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Forces the agent to target this specific model configured in your GoalRoute credentials.
                </p>
              </div>
            </div>
          )}

          {/* Mode 3: Custom External Endpoint */}
          {draftConfig.mode === 'external' && (
            <div className="space-y-3.5 animate-in fade-in duration-200">
              <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-[var(--text-bright)] block uppercase tracking-wider mb-1">
                    Connection Protocol
                  </label>
                  <select
                    value={draftConfig.externalProtocol || 'auto'}
                    onChange={(e) => setDraftConfig((prev) => ({ ...prev, externalProtocol: e.target.value as any }))}
                    className="w-full p-2.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] text-xs text-[var(--text-bright)] rounded-xl focus:outline-none"
                  >
                    <option value="auto">⚡ Auto-Detect Protocol (Recommended)</option>
                    <option value="openai">OpenAI Compatible (Ollama, vLLM, LM Studio, Groq, OpenRouter)</option>
                    <option value="anthropic">Anthropic Claude (/v1/messages)</option>
                    <option value="gemini">Google Gemini (/v1beta/models)</option>
                    <option value="custom">Custom Endpoint</option>
                  </select>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    Auto-detect inspects the URL/model string. Select explicit protocol to enforce exact API payload structures.
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-[var(--text-bright)] block uppercase tracking-wider mb-1">
                    External Endpoint Base URL
                  </label>
                  <input
                    type="text"
                    value={draftConfig.externalBaseUrl}
                    onChange={(e) => setDraftConfig((prev) => ({ ...prev, externalBaseUrl: e.target.value }))}
                    placeholder="e.g. http://localhost:11434/v1, https://api.anthropic.com, or https://generativelanguage.googleapis.com"
                    className="w-full p-2.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] text-xs text-[var(--text-bright)] rounded-xl font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-[var(--text-bright)] block uppercase tracking-wider mb-1">
                    API Key / Secret Token (Optional for Local Ollama)
                  </label>
                  <input
                    type="password"
                    value={draftConfig.externalApiKey}
                    onChange={(e) => setDraftConfig((prev) => ({ ...prev, externalApiKey: e.target.value }))}
                    placeholder="sk-... or API key"
                    className="w-full p-2.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] text-xs text-[var(--text-bright)] rounded-xl font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-[var(--text-bright)] block uppercase tracking-wider mb-1">
                    Model Name
                  </label>
                  <input
                    type="text"
                    value={draftConfig.externalModelName}
                    onChange={(e) => setDraftConfig((prev) => ({ ...prev, externalModelName: e.target.value }))}
                    placeholder="e.g. llama3.2, claude-3-5-sonnet-20241022, gemini-1.5-pro, gpt-4o-mini"
                    className="w-full p-2.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] text-xs text-[var(--text-bright)] rounded-xl font-mono focus:outline-none"
                  />
                </div>

                {/* Connection Test Action */}
                <div className="flex items-center justify-between pt-1 border-t border-[var(--border-subtle)]/60 mt-2">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={testState.status === 'testing'}
                    className="px-3.5 py-1.5 rounded-lg bg-[var(--bg-well)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-bright)] flex items-center space-x-1.5 transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
                  >
                    {testState.status === 'testing' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent-primary)]" />
                    ) : (
                      <Activity className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                    )}
                    <span>{testState.status === 'testing' ? 'Testing Connection...' : 'Test Connection'}</span>
                  </button>

                  {testState.status === 'success' && (
                    <div className="flex items-center space-x-1.5 text-[11px] font-medium text-emerald-400 font-mono">
                      <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{testState.message}</span>
                    </div>
                  )}

                  {testState.status === 'error' && (
                    <div className="flex items-center space-x-1.5 text-[11px] font-medium text-rose-400 font-mono">
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate max-w-[240px]" title={testState.message}>
                        {testState.message}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[var(--signal-mint)]/10 border border-[var(--signal-mint)]/20 text-[11px] text-[var(--signal-mint)] flex items-center gap-2 font-mono">
                <Shield className="w-4 h-4 shrink-0" />
                <span>Local GoalRoute MCP tools will remain active for tool execution.</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end space-x-2 pt-4 border-t border-[var(--border-subtle)] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-bright)] hover:bg-[var(--bg-card)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-slate-950 font-bold text-xs shadow-md transition-all flex items-center space-x-1.5 active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>Save Engine Config</span>
          </button>
        </div>
      </div>
    </div>
  );
};
