import React, { useState, useEffect } from 'react';
import type { GatewayConfig, PlaygroundResult } from '../utils/api';
import { runPlaygroundCompletion } from '../utils/api';

interface PlaygroundProps {
  config: GatewayConfig;
}

interface BenchmarkEntry {
  id: number;
  timestamp: string;
  model: string;
  providerName: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheStatus: string;
  responsePreview: string;
  error?: string;
}

export const Playground: React.FC<PlaygroundProps> = ({ config }) => {
  const [selectedModel, setSelectedModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [topP, setTopP] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const [currentResult, setCurrentResult] = useState<PlaygroundResult | null>(null);
  const [benchmarkHistory, setBenchmarkHistory] = useState<BenchmarkEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [showParams, setShowParams] = useState(false);

  const [providerFilter, setProviderFilter] = useState('all');
  const [modelSearch, setModelSearch] = useState('');

  // Build grouped model options from config (same logic as Agent)
  const poolModels = (config.virtualModels || []).map(vm => ({
    id: vm.id,
    label: vm.name || vm.id
  }));

  const providerGroups: Record<string, { id: string; label: string }[]> = {};
  (config.providers || []).forEach(p => {
    if (p.enabled && p.models && p.models.length > 0) {
      if (!providerGroups[p.name]) providerGroups[p.name] = [];
      p.models.forEach(m => {
        providerGroups[p.name].push({ id: m.id, label: m.id });
      });
    }
  });

  const allModelIds = [
    ...poolModels.map(m => m.id),
    ...Object.values(providerGroups).flatMap(g => g.map(m => m.id))
  ];

  // Filtering logic
  let filteredPools = poolModels;
  let filteredProviders = providerGroups;

  if (providerFilter === 'pools') {
    filteredProviders = {};
  } else if (providerFilter !== 'all') {
    filteredPools = [];
    filteredProviders = { [providerFilter]: providerGroups[providerFilter] || [] };
  }

  if (modelSearch.trim()) {
    const search = modelSearch.toLowerCase();
    filteredPools = filteredPools.filter(m => m.label.toLowerCase().includes(search) || m.id.toLowerCase().includes(search));
    
    const newFilteredProviders: typeof providerGroups = {};
    Object.keys(filteredProviders).forEach(group => {
      const matched = filteredProviders[group].filter(m => m.label.toLowerCase().includes(search) || m.id.toLowerCase().includes(search));
      if (matched.length > 0) newFilteredProviders[group] = matched;
    });
    filteredProviders = newFilteredProviders;
  }

  // Auto-select first model
  useEffect(() => {
    if (!selectedModel || !allModelIds.includes(selectedModel)) {
      if (poolModels.length > 0) {
        setSelectedModel(poolModels[0].id);
      } else if (allModelIds.length > 0) {
        setSelectedModel(allModelIds[0]);
      }
    }
  }, [config]);

  const handleRun = async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setErrorMsg('');
    setCurrentResponse('');
    setCurrentResult(null);

    const messages: { role: string; content: string }[] = [];
    if (systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: prompt.trim() });

    try {
      const result = await runPlaygroundCompletion({
        model: selectedModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        top_p: topP
      });

      const responseText = result.response?.choices?.[0]?.message?.content || '(No content returned)';
      setCurrentResponse(responseText);
      setCurrentResult(result);

      const entry: BenchmarkEntry = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        model: result.model,
        providerName: result.providerName,
        latencyMs: result.latencyMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        cacheStatus: result.cacheStatus,
        responsePreview: responseText.substring(0, 80) + (responseText.length > 80 ? '...' : '')
      };
      setBenchmarkHistory(prev => [entry, ...prev]);
    } catch (err: any) {
      const errText = err.message || 'Request failed.';
      setErrorMsg(errText);
      setCurrentResponse('');

      const entry: BenchmarkEntry = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        model: selectedModel,
        providerName: '-',
        latencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheStatus: '-',
        responsePreview: '',
        error: errText
      };
      setBenchmarkHistory(prev => [entry, ...prev]);
    } finally {
      setLoading(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    fontWeight: 600,
    marginBottom: '0.25rem',
    display: 'block'
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.6rem',
    fontSize: '0.85rem',
    background: '#0a0a0f',
    color: '#c5c9db',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    outline: 'none',
    fontFamily: 'inherit'
  };

  const cardStyle: React.CSSProperties = {
    background: 'oklch(12% 0.015 255.4 / 0.5)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '1.25rem'
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Title */}
      <div>
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, background: 'linear-gradient(135deg, var(--text), var(--accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          🧪 Playground
        </h2>
        <p style={{ margin: '0.3rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Test any model or routing pool interactively. Compare latency, token usage, and response quality.
        </p>
      </div>

      {/* Config Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) minmax(150px, 1.5fr) minmax(200px, 2fr) auto', gap: '1rem', alignItems: 'end' }}>
        <div>
          <label style={labelStyle}>Source Filter</label>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            style={{ ...inputStyle, padding: '0.45rem 0.5rem' }}
          >
            <option value="all">All Sources</option>
            <option value="pools">Routing Pools</option>
            {Object.keys(providerGroups).map(name => (
              <option key={`filter-${name}`} value={name}>{name}</option>
            ))}
          </select>
        </div>
        
        <div>
          <label style={labelStyle}>Search</label>
          <input
            type="text"
            placeholder="Filter models..."
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            style={{ ...inputStyle, padding: '0.45rem 0.5rem' }}
          />
        </div>

        <div>
          <label style={labelStyle}>Model / Pool</label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            style={{ ...inputStyle, padding: '0.45rem 0.5rem' }}
          >
            {filteredPools.length > 0 && (
              <optgroup label="🔀 Routing Pools">
                {filteredPools.map(m => (
                  <option key={`pool-${m.id}`} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
            )}
            {Object.keys(filteredProviders).map(groupName => (
              <optgroup key={groupName} label={`📡 ${groupName}`}>
                {filteredProviders[groupName].map(m => (
                  <option key={`${groupName}-${m.id}`} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
            ))}
            {filteredPools.length === 0 && Object.keys(filteredProviders).length === 0 && (
              <option value="" disabled>No matches</option>
            )}
          </select>
        </div>

        <button
          type="button"
          onClick={() => setShowParams(!showParams)}
          style={{
            padding: '0.45rem 0.9rem',
            fontSize: '0.78rem',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: showParams ? 'var(--accent-glow)' : 'transparent',
            color: showParams ? 'var(--text)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            height: '35px'
          }}
        >
          ⚙️ Params
        </button>
      </div>

      {/* Parameters Panel (collapsible) */}
      {showParams && (
        <div style={{ ...cardStyle, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>Temperature: {temperature.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Max Tokens: {maxTokens}</label>
            <input
              type="range"
              min="64"
              max="16384"
              step="64"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Top P: {topP.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={topP}
              onChange={(e) => setTopP(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>
        </div>
      )}

      {/* System Prompt (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowSystemPrompt(!showSystemPrompt)}
          style={{
            padding: '0.3rem 0.7rem',
            fontSize: '0.75rem',
            borderRadius: '5px',
            border: '1px solid var(--border)',
            background: showSystemPrompt ? 'var(--accent-glow)' : 'transparent',
            color: showSystemPrompt ? 'var(--text)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontWeight: 600,
            marginBottom: '0.5rem'
          }}
        >
          {showSystemPrompt ? '▼' : '▶'} System Prompt
        </button>
        {showSystemPrompt && (
          <textarea
            placeholder="Optional system prompt..."
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: '1.4' }}
          />
        )}
      </div>

      {/* Prompt Input + Run */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Prompt</label>
          <textarea
            placeholder="Type your test prompt here..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleRun();
              }
            }}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: '1.4' }}
          />
        </div>
        <button
          type="button"
          className="primary"
          disabled={loading || !prompt.trim()}
          onClick={handleRun}
          style={{
            padding: '0.7rem 1.5rem',
            fontSize: '0.9rem',
            fontWeight: 700,
            borderRadius: '8px',
            whiteSpace: 'nowrap',
            minWidth: '100px',
            height: '42px',
            opacity: loading || !prompt.trim() ? 0.5 : 1
          }}
        >
          {loading ? '⏳ Running...' : '▶ Run'}
        </button>
      </div>

      {/* Error Display */}
      {errorMsg && (
        <div style={{
          ...cardStyle,
          borderColor: 'var(--error)',
          background: 'var(--error-glow)',
          color: 'var(--error)',
          fontSize: '0.85rem',
          fontWeight: 600
        }}>
          ❌ {errorMsg}
        </div>
      )}

      {/* Response Output + Metrics */}
      {currentResponse && currentResult && (
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Metrics Row */}
          <div style={{
            display: 'flex',
            gap: '1.5rem',
            flexWrap: 'wrap',
            padding: '0.6rem 0.8rem',
            borderRadius: '8px',
            background: 'oklch(10% 0.01 255.4 / 0.5)',
            border: '1px solid var(--border)',
            fontSize: '0.8rem'
          }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Latency: </span>
              <strong style={{ color: currentResult.latencyMs < 2000 ? 'var(--success)' : currentResult.latencyMs < 5000 ? 'oklch(80% 0.15 80)' : 'var(--error)' }}>
                {currentResult.latencyMs}ms
              </strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Model: </span>
              <strong>{currentResult.model}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Provider: </span>
              <strong>{currentResult.providerName}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Tokens: </span>
              <strong>{currentResult.promptTokens} → {currentResult.completionTokens}</strong>
              <span style={{ color: 'var(--text-muted)' }}> ({currentResult.totalTokens} total)</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Cache: </span>
              <strong style={{ color: currentResult.cacheStatus === 'hit' ? 'var(--success)' : 'var(--text-muted)' }}>
                {currentResult.cacheStatus.toUpperCase()}
              </strong>
            </div>
          </div>

          {/* Response Text */}
          <div style={{
            padding: '1rem',
            borderRadius: '8px',
            background: '#07070a',
            border: '1px solid var(--border)',
            fontSize: '0.88rem',
            lineHeight: '1.55',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--text)',
            maxHeight: '400px',
            overflowY: 'auto'
          }}>
            {currentResponse}
          </div>
        </div>
      )}

      {/* Benchmark History Table */}
      {benchmarkHistory.length > 0 && (
        <div style={{ ...cardStyle }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
              📊 Benchmark History
            </h3>
            <button
              type="button"
              onClick={() => setBenchmarkHistory([])}
              style={{
                padding: '0.25rem 0.6rem',
                fontSize: '0.7rem',
                borderRadius: '4px',
                border: '1px solid var(--border)',
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--text-muted)'
              }}
            >
              Clear History
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Time', 'Model', 'Provider', 'Latency', 'Tokens', 'Cache', 'Status', 'Response Preview'].map(h => (
                    <th key={h} style={{ padding: '0.5rem 0.6rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {benchmarkHistory.map(entry => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid oklch(20% 0.01 255.4 / 0.3)' }}>
                    <td style={{ padding: '0.45rem 0.6rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{entry.timestamp}</td>
                    <td style={{ padding: '0.45rem 0.6rem', fontWeight: 600, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.model}</td>
                    <td style={{ padding: '0.45rem 0.6rem', color: 'var(--text-muted)' }}>{entry.providerName}</td>
                    <td style={{ padding: '0.45rem 0.6rem', fontWeight: 700, color: entry.error ? 'var(--error)' : entry.latencyMs < 2000 ? 'var(--success)' : entry.latencyMs < 5000 ? 'oklch(80% 0.15 80)' : 'var(--error)' }}>
                      {entry.error ? '-' : `${entry.latencyMs}ms`}
                    </td>
                    <td style={{ padding: '0.45rem 0.6rem', whiteSpace: 'nowrap' }}>
                      {entry.error ? '-' : `${entry.promptTokens}→${entry.completionTokens} (${entry.totalTokens})`}
                    </td>
                    <td style={{ padding: '0.45rem 0.6rem' }}>
                      <span style={{
                        padding: '0.1rem 0.4rem',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        background: entry.cacheStatus === 'hit' ? 'var(--success-glow)' : 'transparent',
                        border: `1px solid ${entry.cacheStatus === 'hit' ? 'var(--success)' : 'var(--border)'}`,
                        color: entry.cacheStatus === 'hit' ? 'var(--success)' : 'var(--text-muted)'
                      }}>
                        {entry.cacheStatus.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '0.45rem 0.6rem' }}>
                      {entry.error ? (
                        <span style={{ color: 'var(--error)', fontWeight: 600 }}>❌ Error</span>
                      ) : (
                        <span style={{ color: 'var(--success)', fontWeight: 600 }}>✅ OK</span>
                      )}
                    </td>
                    <td style={{ padding: '0.45rem 0.6rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: entry.error ? 'var(--error)' : 'var(--text-muted)', fontSize: '0.72rem' }}>
                      {entry.error || entry.responsePreview}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
