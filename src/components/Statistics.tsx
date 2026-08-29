import React, { useState, useEffect } from 'react';
import type { StatsHistoryEntry, GatewayConfig } from '../utils/api';
import { clearStatsHistory } from '../utils/api';

interface StatisticsProps {
  config: GatewayConfig;
}

const ERROR_DESCRIPTIONS: Record<string, string> = {
  '400': 'Bad Request: Context exceeded or malformed params.',
  '401': 'Unauthorized: Invalid API key.',
  '402': 'Payment Required: Paid tier needed.',
  '403': 'Forbidden: Access denied.',
  '404': 'Not Found: Model or endpoint missing.',
  '409': 'Conflict: Duplicate request or locked resources.',
  '421': 'Misdirected: Routing mismatch or proxy config error.',
  '429': 'Too Many Requests: Rate limited by provider.',
  '500': 'Internal Error: Provider server issue.',
  '502': 'Bad Gateway: Upstream provider error.',
  '503': 'Service Unavailable: Provider down or overloaded.',
  '504': 'Gateway Timeout: Provider took too long.',
};

export const Statistics: React.FC<StatisticsProps> = ({ config }) => {
  const [history, setHistory] = useState<StatsHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters State
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | 'all'>('24h');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'cache'>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  
  // Hovered data point for charts
  const [hoveredRequestBin, setHoveredRequestBin] = useState<any | null>(null);
  const [hoveredTokenBin, setHoveredTokenBin] = useState<any | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const [showHideModal, setShowHideModal] = useState(false);
  const [hideDate, setHideDate] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [showViewAllProviders, setShowViewAllProviders] = useState(false);
  const [showViewAllModels, setShowViewAllModels] = useState(false);
  const [showViewAllErrors, setShowViewAllErrors] = useState(false);
  const [errorSearch, setErrorSearch] = useState('');
  const [showViewAllLimits, setShowViewAllLimits] = useState(false);
  const [limitsCurrentPage, setLimitsCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [timeRange, statusFilter, providerFilter, modelFilter]);

  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const [rateLimits, setRateLimits] = useState<any>({});

  const fetchData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      // dynamically import getStats to avoid unused imports warning if not imported yet
      const { getStatsHistory, getStats } = await import('../utils/api');
      const [historyData, statsData] = await Promise.all([
        getStatsHistory(),
        getStats()
      ]);
      setHistory(historyData);
      setActiveRequests(statsData.activeRequests || []);
      setRateLimits(statsData.limits || {});
      setError(null);
    } catch (err: any) {
      console.error(err);
      if (!isBackground) setError('Failed to load statistics data.');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 1000);
    return () => clearInterval(interval);
  }, [config]);

  const handleHideStats = async () => {
    try {
      const isoDate = new Date(hideDate).toISOString();
      await clearStatsHistory(isoDate);
      setShowHideModal(false);
      fetchData(false);
    } catch (err: any) {
      console.error(err);
      setError('Failed to hide statistics history.');
    }
  };

  const handleUnhideStats = async () => {
    try {
      await clearStatsHistory(undefined, true);
      setShowHideModal(false);
      fetchData(false);
    } catch (err: any) {
      console.error(err);
      setError('Failed to unhide statistics history.');
    }
  };

  // 1. Get unique values for dropdown options from the actual data
  const uniqueProviders = Array.from(new Set(history.map(item => item.providerId))).filter(Boolean);
  const uniqueModels = Array.from(new Set(history.map(item => item.requestedModel))).filter(Boolean);

  // 2. Filter history based on selections
  const now = new Date();
  const filteredHistory = history.filter(item => {
    const itemDate = new Date(item.timestamp);
    const diffMs = now.getTime() - itemDate.getTime();
    
    // Time filter
    if (timeRange === '1h' && diffMs > 3600000) return false;
    if (timeRange === '24h' && diffMs > 86400000) return false;
    if (timeRange === '7d' && diffMs > 604800000) return false;

    // Status filter
    if (statusFilter === 'success' && !item.success) return false;
    if (statusFilter === 'failed' && item.success) return false;
    if (statusFilter === 'cache' && !item.cacheHit) return false;

    // Provider filter
    if (providerFilter !== 'all' && item.providerId !== providerFilter) return false;

    // Model filter
    if (modelFilter !== 'all' && item.requestedModel !== modelFilter) return false;

    return true;
  });

  // 3. Compute Aggregated Metrics
  const totalRequests = filteredHistory.length;
  const successfulRequests = filteredHistory.filter(item => item.success).length;
  const failedRequests = totalRequests - successfulRequests;
  const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;
  
  const cacheHits = filteredHistory.filter(item => item.cacheHit).length;
  const cacheHitRate = totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0;
  
  const requestsWithLatency = filteredHistory.filter(item => item.success && !item.cacheHit && item.latencyMs > 0);
  const avgLatency = requestsWithLatency.length > 0
    ? Math.round(requestsWithLatency.reduce((sum, item) => sum + item.latencyMs, 0) / requestsWithLatency.length)
    : 0;

  const totalTokens = filteredHistory.reduce((sum, item) => sum + (item.totalTokens || 0), 0);
  const totalPromptTokens = filteredHistory.reduce((sum, item) => sum + (item.promptTokens || 0), 0);
  const totalCompletionTokens = filteredHistory.reduce((sum, item) => sum + (item.completionTokens || 0), 0);

  // Approximate cost saved (from free models routing)
  const estimateSavings = filteredHistory.reduce((sum, item) => {
    if (!item.success || item.cacheHit) return sum;
    if (item.requestedModel === 'strong-reasoning') {
      return sum + (item.promptTokens * 1.25 / 1000000) + (item.completionTokens * 5.00 / 1000000);
    }
    if (item.requestedModel === 'coding-agent' || item.requestedModel === 'claude-3-5-sonnet-20241022') {
      return sum + (item.promptTokens * 3.00 / 1000000) + (item.completionTokens * 15.00 / 1000000);
    }
    if (item.requestedModel === 'gpt-4o') {
      return sum + (item.promptTokens * 2.50 / 1000000) + (item.completionTokens * 10.00 / 1000000);
    }
    if (item.requestedModel === 'fast-flash' || item.requestedModel === 'gpt-4o-mini') {
      return sum + (item.promptTokens * 0.15 / 1000000) + (item.completionTokens * 0.60 / 1000000);
    }
    return sum;
  }, 0);

  // 4. Generate Time Series Data for Charts
  const generateTimelineBins = () => {
    let numBins = 12;
    let binDurationMs = 300000; // 5 mins
    
    if (timeRange === '1h') {
      numBins = 12;
      binDurationMs = 5 * 60 * 1000; // 5 mins
    } else if (timeRange === '24h') {
      numBins = 24;
      binDurationMs = 60 * 60 * 1000; // 1 hour
    } else if (timeRange === '7d') {
      numBins = 7;
      binDurationMs = 24 * 60 * 60 * 1000; // 1 day
    } else {
      // all
      numBins = 15;
      const oldestDate = history.length > 0 ? new Date(history[history.length - 1].timestamp) : now;
      const diffTotal = Math.max(86400000, now.getTime() - oldestDate.getTime());
      binDurationMs = Math.ceil(diffTotal / numBins);
    }

    const bins = [];
    const endTime = now.getTime();
    
    for (let i = numBins - 1; i >= 0; i--) {
      const binEnd = endTime - (i * binDurationMs);
      const binStart = binEnd - binDurationMs;
      
      const binRequests = filteredHistory.filter(item => {
        const itemTime = new Date(item.timestamp).getTime();
        return itemTime >= binStart && itemTime < binEnd;
      });

      const binHits = binRequests.filter(item => item.cacheHit).length;
      const binTokens = binRequests.reduce((sum, item) => sum + (item.totalTokens || 0), 0);
      const binPrompt = binRequests.reduce((sum, item) => sum + (item.promptTokens || 0), 0);
      const binComp = binRequests.reduce((sum, item) => sum + (item.completionTokens || 0), 0);

      // Label formatting
      let label = '';
      const startDateObj = new Date(binStart);
      if (timeRange === '1h') {
        label = startDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (timeRange === '24h') {
        label = startDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (timeRange === '7d') {
        label = startDateObj.toLocaleDateString([], { weekday: 'short' });
      } else {
        label = startDateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }

      bins.push({
        label,
        startTime: binStart,
        endTime: binEnd,
        requests: binRequests.length,
        hits: binHits,
        tokens: binTokens,
        promptTokens: binPrompt,
        completionTokens: binComp
      });
    }

    return bins;
  };

  const timelineBins = generateTimelineBins();

  // Find max values for scaling SVG charts
  const maxRequests = Math.max(...timelineBins.map(b => b.requests), 5);
  const maxTokens = Math.max(...timelineBins.map(b => b.promptTokens + b.completionTokens), 1000);

  // 5. Providers Breakdown Data
  const providersMap: Record<string, { count: number; tokens: number; totalLatencyMs: number }> = {};
  filteredHistory.forEach(item => {
    const prov = item.providerId || (item.cacheHit ? 'cache' : 'unknown');
    if (!providersMap[prov]) {
      providersMap[prov] = { count: 0, tokens: 0, totalLatencyMs: 0 };
    }
    providersMap[prov].count++;
    providersMap[prov].tokens += item.totalTokens || 0;
    providersMap[prov].totalLatencyMs += item.latencyMs || 0;
  });

  const providersData = Object.keys(providersMap).map(id => {
    const name = id === 'cache'
      ? 'Semantic Cache'
      : (config.providers.find(p => p.id === id)?.name || id.toUpperCase());
    return {
      id,
      name,
      count: providersMap[id].count,
      tokens: providersMap[id].tokens,
      avgLatencyMs: providersMap[id].count > 0 ? Math.round(providersMap[id].totalLatencyMs / providersMap[id].count) : 0
    };
  }).sort((a, b) => b.count - a.count);

  // 6. Models Breakdown Data
  const modelsMap: Record<string, { count: number; tokens: number; totalLatencyMs: number }> = {};
  filteredHistory.forEach(item => {
    const model = item.modelId || 'unknown';
    if (!modelsMap[model]) {
      modelsMap[model] = { count: 0, tokens: 0, totalLatencyMs: 0 };
    }
    modelsMap[model].count++;
    modelsMap[model].tokens += item.totalTokens || 0;
    modelsMap[model].totalLatencyMs += item.latencyMs || 0;
  });

  const modelsData = Object.keys(modelsMap).map(name => {
    return {
      name,
      count: modelsMap[name].count,
      tokens: modelsMap[name].tokens,
      avgLatencyMs: modelsMap[name].count > 0 ? Math.round(modelsMap[name].totalLatencyMs / modelsMap[name].count) : 0
    };
  }).sort((a, b) => b.count - a.count);

  // 7. Error Breakdowns (if any)
  const errorsMap: Record<string, number> = {};
  filteredHistory.forEach(item => {
    if (!item.success && item.error) {
      const cleanErr = item.error.split(':')[0] || 'Unknown Error';
      errorsMap[cleanErr] = (errorsMap[cleanErr] || 0) + 1;
    }
  });

  const errorsData = Object.keys(errorsMap).map(msg => ({
    msg,
    count: errorsMap[msg]
  })).sort((a, b) => b.count - a.count);

  // 8. Rate Limits Formatting
  const configuredLimits = Object.keys(rateLimits).map(key => {
    const data = rateLimits[key];
    const metrics = Object.keys(data).filter(m => m !== 'cooldown' && data[m] && data[m].limit > 0).map(m => ({
      name: m,
      used: data[m].used,
      limit: data[m].limit,
      pct: Math.min((data[m].used / data[m].limit) * 100, 100)
    }));
    const maxPct = metrics.reduce((max, m) => Math.max(max, m.pct), 0);
    const totalUsed = metrics.reduce((sum, m) => sum + m.used, 0);
    return { key, metrics, maxPct, totalUsed };
  }).filter(ent => ent.metrics.length > 0);

  const activeLimits = configuredLimits.filter(ent => ent.totalUsed > 0).sort((a, b) => b.maxPct - a.maxPct);
  const displayedLimits = activeLimits.slice(0, 4);

  const limitRows = configuredLimits.flatMap(ent => ent.metrics.map(m => ({
    entity: ent.key,
    metric: m.name,
    used: m.used,
    limit: m.limit,
    pct: m.pct
  }))).sort((a, b) => b.pct - a.pct);

  // Render SVG Chart Paths helper
  const getSvgCoordinates = (bins: any[], type: 'requests' | 'hits' | 'tokens' | 'prompt' | 'comp', width: number, height: number) => {
    const paddingLeft = 45;
    const paddingRight = 15;
    const paddingTop = 15;
    const paddingBottom = 20;

    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    const numBins = bins.length;

    let maxVal = 10;
    if (type === 'requests' || type === 'hits') {
      maxVal = maxRequests;
    } else {
      maxVal = maxTokens;
    }

    const points = bins.map((bin, index) => {
      const val = type === 'requests'
        ? bin.requests
        : type === 'hits'
          ? bin.hits
          : type === 'tokens'
            ? bin.tokens
            : type === 'prompt'
              ? bin.promptTokens
              : bin.completionTokens;

      const x = paddingLeft + (index / (numBins - 1)) * plotWidth;
      const y = height - paddingBottom - (val / maxVal) * plotHeight;
      return { x, y, value: val, label: bin.label, data: bin };
    });

    const pathD = points.reduce((d, p, idx) => {
      return idx === 0 ? `M ${p.x} ${p.y}` : `${d} L ${p.x} ${p.y}`;
    }, '');

    const areaD = points.length > 0
      ? `${pathD} L ${points[points.length - 1].x} ${height - paddingBottom} L ${points[0].x} ${height - paddingBottom} Z`
      : '';

    return { points, pathD, areaD, paddingLeft, paddingRight, paddingTop, paddingBottom, plotWidth, plotHeight };
  };

  const timelineSvg = getSvgCoordinates(timelineBins, 'requests', 560, 200);
  const hitsSvg = getSvgCoordinates(timelineBins, 'hits', 560, 200);
  const tokenPromptSvg = getSvgCoordinates(timelineBins, 'prompt', 560, 200);
  const tokenCompSvg = getSvgCoordinates(timelineBins, 'comp', 560, 200);

  if (loading && history.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
        <div style={{
          width: '32px', height: '32px', border: '3px solid var(--border)', borderTopColor: 'var(--accent)',
          borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem'
        }} />
        <span style={{ color: 'var(--text-muted)' }}>Loading analytics history...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {error && (
        <div className="glass-panel" style={{ padding: '0.75rem 1rem', borderLeft: '4px solid var(--error)', color: 'var(--error)', background: 'var(--error-glow)', fontSize: '0.85rem', fontWeight: 600 }}>
          ⚠️ {error}
        </div>
      )}
      
      {/* Filters & Control bar */}
      <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'center' }}>
          
          {/* Time range */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <label style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Period</label>
            <div style={{ display: 'flex', background: '#07070a', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.15rem' }}>
              {(['1h', '24h', '7d', 'all'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setTimeRange(r)}
                  style={{
                    padding: '0.2rem 0.5rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    background: timeRange === r ? 'var(--accent)' : 'transparent',
                    color: timeRange === r ? '#05070f' : 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {r === '1h' ? '1h' : r === '24h' ? '24h' : r === '7d' ? '7d' : 'All'}
                </button>
              ))}
            </div>
          </div>

          {/* Status filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <label style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', background: '#07070a', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', outline: 'none' }}
            >
              <option value="all">All Requests</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="cache">Cache Hits</option>
            </select>
          </div>

          {/* Provider Filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <label style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Provider</label>
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', background: '#07070a', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', outline: 'none' }}
            >
              <option value="all">All Providers</option>
              <option value="cache">Semantic Cache</option>
              {uniqueProviders.filter(p => p !== 'cache').map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Model Filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <label style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Model Alias</label>
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', background: '#07070a', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', outline: 'none' }}
            >
              <option value="all">All Models</option>
              {uniqueModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          {config.stats?.hiddenBefore && (
            <button
              type="button"
              onClick={handleUnhideStats}
              style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', borderRadius: '6px', background: 'var(--success-glow)', border: '1px solid var(--success)', color: 'var(--success)', cursor: 'pointer' }}
              title="History is currently partially hidden. Click to unhide."
            >
              👁️ Unhide All
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowHideModal(true)}
            style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', borderRadius: '6px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            🙈 Hide History
          </button>
        </div>
      </div>

      {/* Metrics Summary Strip */}
      {totalRequests === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <h3>No records found matching current filters</h3>
          <p style={{ fontSize: '0.85rem' }}>Send some completion requests to the gateway to build statistics.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
            
            <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Requests</span>
              <strong style={{ fontSize: '1.6rem', color: 'var(--text)', fontWeight: 800 }}>{totalRequests}</strong>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>over selected filter</span>
            </div>

            <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Success Rate</span>
              <strong style={{ fontSize: '1.6rem', color: successRate > 95 ? 'var(--success)' : 'var(--warning)', fontWeight: 800 }}>
                {successRate.toFixed(1)}%
              </strong>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{failedRequests} failures</span>
            </div>

            <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cache Hit Rate</span>
              <strong style={{ fontSize: '1.6rem', color: 'var(--accent)', fontWeight: 800 }}>{cacheHitRate.toFixed(1)}%</strong>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{cacheHits} cache hits</span>
            </div>

            <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Avg Latency</span>
              <strong style={{ fontSize: '1.6rem', color: 'var(--text)', fontWeight: 800 }}>
                {avgLatency > 0 ? `${avgLatency}ms` : '—'}
              </strong>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>excluding cache hits</span>
            </div>

            <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Tokens</span>
              <strong style={{ fontSize: '1.6rem', color: 'var(--text)', fontWeight: 800 }}>
                {totalTokens > 1000000 ? `${(totalTokens / 1000000).toFixed(2)}M` : totalTokens.toLocaleString()}
              </strong>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                {totalPromptTokens.toLocaleString()} in / {totalCompletionTokens.toLocaleString()} out
              </span>
            </div>

            <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Est. Cost Saved</span>
              <strong style={{ fontSize: '1.6rem', color: 'var(--success)', fontWeight: 800 }}>
                ${estimateSavings.toFixed(4)}
              </strong>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>by pooling free endpoints</span>
            </div>

          </div>

          {/* Charts Layout Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '1.25rem' }}>
            
            {/* Chart 1: Request Rate and Cache Hits */}
            <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '0.9rem', margin: 0 }}>📈 Request Frequency over Time</h3>
                <div style={{ display: 'flex', gap: '0.8rem', fontSize: '0.7rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span style={{ width: '8px', height: '8px', background: 'var(--accent)', borderRadius: '2px' }} />
                    Total Requests
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span style={{ width: '8px', height: '8px', background: 'var(--success)', borderRadius: '2px' }} />
                    Cache Hits
                  </span>
                </div>
              </div>

              <div style={{ position: 'relative', width: '100%', height: '200px' }}>
                <svg width="100%" height="100%" viewBox="0 0 560 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="reqAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                    </linearGradient>
                    <linearGradient id="hitsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--success)" stopOpacity="0.15" />
                      <stop offset="100%" stopColor="var(--success)" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
                    const y = timelineSvg.paddingTop + (1 - r) * timelineSvg.plotHeight;
                    const maxVal = maxRequests;
                    return (
                      <g key={idx}>
                        <line x1={timelineSvg.paddingLeft} y1={y} x2={560 - timelineSvg.paddingRight} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                        <text x={timelineSvg.paddingLeft - 8} y={y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="8px" fontFamily="monospace">
                          {Math.round(r * maxVal)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Timeline Areas and Lines */}
                  {timelineSvg.areaD && (
                    <path d={timelineSvg.areaD} fill="url(#reqAreaGrad)" />
                  )}
                  {hitsSvg.areaD && (
                    <path d={hitsSvg.areaD} fill="url(#hitsAreaGrad)" />
                  )}

                  {timelineSvg.pathD && (
                    <path d={timelineSvg.pathD} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                  {hitsSvg.pathD && (
                    <path d={hitsSvg.pathD} fill="none" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 2" />
                  )}

                  {/* Dots / Hover interaction anchors */}
                  {timelineSvg.points.map((p, idx) => (
                    <g key={idx}>
                      {p.value > 0 && (
                        <circle cx={p.x} cy={p.y} r="3" fill="#0b0f19" stroke="var(--accent)" strokeWidth="2" />
                      )}
                      {/* Invisible vertical hover capture bands */}
                      <rect
                        x={p.x - (timelineSvg.plotWidth / timelineBins.length) / 2}
                        y={timelineSvg.paddingTop}
                        width={timelineSvg.plotWidth / timelineBins.length}
                        height={timelineSvg.plotHeight}
                        fill="transparent"
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredRequestBin(p)}
                        onMouseLeave={() => setHoveredRequestBin(null)}
                      />
                    </g>
                  ))}

                  {/* X Axis line */}
                  <line x1={timelineSvg.paddingLeft} y1={200 - timelineSvg.paddingBottom} x2={560 - timelineSvg.paddingRight} y2={200 - timelineSvg.paddingBottom} stroke="rgba(255,255,255,0.1)" />

                  {/* X Axis labels */}
                  {timelineSvg.points.filter((_, i) => timelineBins.length <= 12 || i % 2 === 0).map((p, idx) => (
                    <text key={idx} x={p.x} y={200 - 6} textAnchor="middle" fill="var(--text-muted)" fontSize="8px">
                      {p.label}
                    </text>
                  ))}
                </svg>

                {/* Hover Tooltip inside Chart */}
                {hoveredRequestBin && (
                  <div style={{
                    position: 'absolute',
                    left: `${(hoveredRequestBin.x / 560) * 100}%`,
                    top: '20px',
                    transform: 'translateX(-50%)',
                    background: 'var(--surface-solid)',
                    border: '1px solid var(--accent)',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    pointerEvents: 'none',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    zIndex: 10
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: '0.15rem', marginBottom: '0.2rem' }}>
                      {hoveredRequestBin.label}
                    </div>
                    <div>Requests: <strong style={{ color: 'var(--accent)' }}>{hoveredRequestBin.data.requests}</strong></div>
                    <div>Cache Hits: <strong style={{ color: 'var(--success)' }}>{hoveredRequestBin.data.hits}</strong></div>
                  </div>
                )}
              </div>
            </div>

            {/* Chart 2: Token Volume (Prompt vs Completion) */}
            <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '0.9rem', margin: 0 }}>📊 Input/Output Token Volume</h3>
                <div style={{ display: 'flex', gap: '0.8rem', fontSize: '0.7rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span style={{ width: '8px', height: '8px', background: 'oklch(62% 0.17 264.4 / 0.5)', borderRadius: '2px' }} />
                    Prompt (Input)
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span style={{ width: '8px', height: '8px', background: 'var(--accent)', borderRadius: '2px' }} />
                    Completion (Output)
                  </span>
                </div>
              </div>

              <div style={{ position: 'relative', width: '100%', height: '200px' }}>
                <svg width="100%" height="100%" viewBox="0 0 560 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="promptAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(62% 0.17 264.4)" stopOpacity="0.15" />
                      <stop offset="100%" stopColor="oklch(62% 0.17 264.4)" stopOpacity="0.0" />
                    </linearGradient>
                    <linearGradient id="compAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
                    const y = tokenPromptSvg.paddingTop + (1 - r) * tokenPromptSvg.plotHeight;
                    const maxVal = maxTokens;
                    return (
                      <g key={idx}>
                        <line x1={tokenPromptSvg.paddingLeft} y1={y} x2={560 - tokenPromptSvg.paddingRight} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                        <text x={tokenPromptSvg.paddingLeft - 8} y={y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="8px" fontFamily="monospace">
                          {maxVal > 1000000 ? `${(r * maxVal / 1000000).toFixed(1)}M` : `${Math.round(r * maxVal / 1000)}k`}
                        </text>
                      </g>
                    );
                  })}

                  {/* Stacked/Double Areas */}
                  {tokenPromptSvg.areaD && (
                    <path d={tokenPromptSvg.areaD} fill="url(#promptAreaGrad)" />
                  )}
                  {tokenCompSvg.areaD && (
                    <path d={tokenCompSvg.areaD} fill="url(#compAreaGrad)" />
                  )}

                  {tokenPromptSvg.pathD && (
                    <path d={tokenPromptSvg.pathD} fill="none" stroke="oklch(62% 0.17 264.4 / 0.5)" strokeWidth="1.5" />
                  )}
                  {tokenCompSvg.pathD && (
                    <path d={tokenCompSvg.pathD} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
                  )}

                  {/* Hover interaction handlers */}
                  {tokenPromptSvg.points.map((p, idx) => (
                    <g key={idx}>
                      <rect
                        x={p.x - (tokenPromptSvg.plotWidth / timelineBins.length) / 2}
                        y={tokenPromptSvg.paddingTop}
                        width={tokenPromptSvg.plotWidth / timelineBins.length}
                        height={tokenPromptSvg.plotHeight}
                        fill="transparent"
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredTokenBin(p)}
                        onMouseLeave={() => setHoveredTokenBin(null)}
                      />
                    </g>
                  ))}

                  {/* X Axis line */}
                  <line x1={tokenPromptSvg.paddingLeft} y1={200 - tokenPromptSvg.paddingBottom} x2={560 - tokenPromptSvg.paddingRight} y2={200 - tokenPromptSvg.paddingBottom} stroke="rgba(255,255,255,0.1)" />

                  {/* X Axis labels */}
                  {tokenPromptSvg.points.filter((_, i) => timelineBins.length <= 12 || i % 2 === 0).map((p, idx) => (
                    <text key={idx} x={p.x} y={200 - 6} textAnchor="middle" fill="var(--text-muted)" fontSize="8px">
                      {p.label}
                    </text>
                  ))}
                </svg>

                {/* Hover Tooltip */}
                {hoveredTokenBin && (
                  <div style={{
                    position: 'absolute',
                    left: `${(hoveredTokenBin.x / 560) * 100}%`,
                    top: '20px',
                    transform: 'translateX(-50%)',
                    background: 'var(--surface-solid)',
                    border: '1px solid var(--accent)',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    pointerEvents: 'none',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    zIndex: 10
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: '0.15rem', marginBottom: '0.2rem' }}>
                      {hoveredTokenBin.label}
                    </div>
                    <div>Input (Prompt): <strong>{hoveredTokenBin.data.promptTokens.toLocaleString()}</strong></div>
                    <div>Output (Comp): <strong>{hoveredTokenBin.data.completionTokens.toLocaleString()}</strong></div>
                    <div>Total: <strong style={{ color: 'var(--accent)' }}>{hoveredTokenBin.data.tokens.toLocaleString()}</strong></div>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Bottom section: Distribution Breakdown and Error details */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
            
            {/* Providers Breakdown */}
            <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '0.9rem', margin: 0 }}>📡 Providers Share</h3>
                {providersData.length > 4 && (
                  <button type="button" onClick={() => setShowViewAllProviders(true)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    View All
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {providersData.slice(0, 4).map((prov, index) => {
                  const percent = totalRequests > 0 ? (prov.count / totalRequests) * 100 : 0;
                  return (
                    <div key={prov.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                          {index + 1}. {prov.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.25rem' }}>~{prov.avgLatencyMs}ms</span>
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          <strong>{prov.count}</strong> reqs ({percent.toFixed(1)}%)
                        </span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${percent}%`,
                          background: prov.id === 'cache'
                            ? 'var(--success)'
                            : `linear-gradient(to right, var(--accent-glow), var(--accent))`
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Models Breakdown */}
            <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '0.9rem', margin: 0 }}>🧠 Models Share</h3>
                {modelsData.length > 4 && (
                  <button type="button" onClick={() => setShowViewAllModels(true)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    View All
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {modelsData.slice(0, 4).map((mod, index) => {
                  const percent = totalRequests > 0 ? (mod.count / totalRequests) * 100 : 0;
                  return (
                    <div key={mod.name} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }} title={mod.name}>
                          {index + 1}. {mod.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.25rem' }}>~{mod.avgLatencyMs}ms</span>
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          <strong>{mod.count}</strong> reqs ({percent.toFixed(1)}%)
                        </span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${percent}%`,
                          background: `linear-gradient(to right, #6b40ac, #a168ff)`
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Success/Error breakdown */}
            <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '0.9rem', margin: 0 }}>🚨 Failure Analysis</h3>
                {errorsData.length > 5 && (
                  <button type="button" onClick={() => setShowViewAllErrors(true)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    View All
                  </button>
                )}
              </div>
              {failedRequests === 0 ? (
                <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '120px', gap: '0.5rem' }}>
                  <span style={{ fontSize: '2rem' }}>🎉</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--success)', fontWeight: 600 }}>100% Success Rate!</span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>No failed requests in selected scope.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                    {/* Tiny Donut */}
                    <svg width="60" height="60" viewBox="0 0 50 50">
                      <circle cx="25" cy="25" r="18" fill="none" stroke="var(--error)" strokeWidth="6" />
                      <circle cx="25" cy="25" r="18" fill="none" stroke="var(--success)" strokeWidth="6"
                        strokeDasharray={113.1}
                        strokeDashoffset={113.1 - (successRate / 100) * 113.1}
                        transform="rotate(-90 25 25)"
                      />
                    </svg>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text)' }}>
                        <strong>{failedRequests}</strong> failures detected
                      </span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        Out of {totalRequests} routed requests
                      </span>
                    </div>
                  </div>
                  
                  {/* Detailed Errors list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '120px', overflowY: 'auto' }}>
                    {errorsData.slice(0, 5).map((err, idx) => {
                      const isInternal = err.msg.toLowerCase().includes('timeout') || err.msg.toLowerCase().includes('econnrefused') || err.msg.toLowerCase().includes('internal') || err.msg.toLowerCase().includes('fetch failed');
                      return (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', padding: '0.3rem 0.5rem', background: isInternal ? 'rgba(255, 165, 0, 0.1)' : 'var(--error-glow)', borderRadius: '4px', border: `1px solid ${isInternal ? 'rgba(255, 165, 0, 0.2)' : 'rgba(255, 68, 68, 0.1)'}` }}>
                          <span style={{ color: isInternal ? 'orange' : 'var(--error)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '80%' }} title={err.msg}>
                            {isInternal ? '⚙️' : '⚠️'} {err.msg}
                          </span>
                          <strong style={{ color: 'var(--text)' }}>{err.count}</strong>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Rate Limits Visualization */}
          {configuredLimits.length > 0 && (
            <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '0.9rem', margin: 0 }}>📊 Rate Limits & Quotas</h3>
                {configuredLimits.length > 4 && (
                  <button type="button" onClick={() => { setShowViewAllLimits(true); setLimitsCurrentPage(1); }} style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    View All
                  </button>
                )}
              </div>
              
              {activeLimits.length === 0 ? (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>No rate limits currently being consumed.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                  {displayedLimits.map(ent => (
                    <div key={ent.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border)' }}>
                      <strong style={{ fontSize: '0.75rem', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={ent.key}>{ent.key.toUpperCase()}</strong>
                      {ent.metrics.map(m => {
                        const color = m.pct >= 90 ? 'var(--error)' : (m.pct >= 75 ? 'var(--warning)' : 'var(--success)');
                        return (
                          <div key={m.name} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                              <span style={{ color: 'var(--text-muted)', textTransform: 'uppercase' }}>{m.name}</span>
                              <span style={{ color: 'var(--text)' }}><strong>{m.used.toLocaleString()}</strong> / {m.limit.toLocaleString()}</span>
                            </div>
                            <div style={{ height: '3px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${m.pct}%`, background: color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Active In-Flight Requests */}
          <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', border: activeRequests.length > 0 ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '0.9rem', margin: 0, color: activeRequests.length > 0 ? 'var(--accent)' : 'var(--text)' }}>🟢 Active In-Flight Requests ({activeRequests.length})</h3>
              {activeRequests.length > 0 && <div className="status-indicator active" style={{ width: '8px', height: '8px' }}></div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {activeRequests.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                  No active requests currently in flight.
                </div>
              ) : (
                activeRequests.map((req, idx) => {
                  const secondsPassed = Math.floor((Date.now() - req.timestamp) / 1000);
                  return (
                    <div key={idx} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.6rem 1rem',
                      background: '#0a0a0f',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '0.8rem'
                    }}>
                      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Provider</span>
                          <strong>{req.providerId}</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Model</span>
                          <strong>{req.modelId}</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Prompt Tokens</span>
                          <strong>{req.tokens || '?'}</strong>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent)', fontWeight: 'bold' }}>
                        ⏱️ {secondsPassed}s
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent History Table Log */}
          <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h3 style={{ fontSize: '0.9rem', margin: 0 }}>📋 Recent Request Trace Log</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Time</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Pool Alias</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Provider</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Actual Model</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Tokens</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Latency</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((item, idx) => {
                    let errCode = '';
                    let errMsg = '';
                    if (!item.success && item.error) {
                      const match = item.error.match(/(\d{3})/);
                      if (match) {
                        errCode = match[1];
                        errMsg = ERROR_DESCRIPTIONS[errCode] || item.error;
                      } else {
                        errMsg = item.error;
                      }
                    }

                    return (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', background: idx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                      <td style={{ padding: '0.4rem 0.5rem', color: 'var(--text-muted)' }}>
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600, fontFamily: 'monospace' }}>
                        {item.requestedModel}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>
                        {item.cacheHit ? (
                          <span style={{ color: 'var(--success)', background: 'var(--success-glow)', padding: '0.1rem 0.3rem', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700 }}>
                            ⚡ Cache
                          </span>
                        ) : (
                          item.providerId
                        )}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {item.modelId || '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>
                        {item.success ? (
                          `${item.promptTokens} in / ${item.completionTokens} out`
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace' }}>
                        {item.success && item.latencyMs > 0 ? `${item.latencyMs}ms` : '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>
                        {item.success ? (
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>Success</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ color: 'var(--error)', fontWeight: 600 }} title={item.error || 'Request failed'}>
                              Failed ✖ {errCode ? `(${errCode})` : ''}
                            </span>
                            {errMsg && (
                              <span style={{ fontSize: '0.65rem', color: 'var(--error)', opacity: 0.8, maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={errMsg}>
                                {errMsg}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredHistory.length > itemsPerPage && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="secondary"
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', borderRadius: '6px', opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                >
                  Previous
                </button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Page {currentPage} of {Math.ceil(filteredHistory.length / itemsPerPage)}
                </span>
                <button 
                  onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredHistory.length / itemsPerPage), p + 1))}
                  disabled={currentPage === Math.ceil(filteredHistory.length / itemsPerPage)}
                  className="secondary"
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', borderRadius: '6px', opacity: currentPage === Math.ceil(filteredHistory.length / itemsPerPage) ? 0.5 : 1, cursor: currentPage === Math.ceil(filteredHistory.length / itemsPerPage) ? 'not-allowed' : 'pointer' }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Hide History Modal */}
      {showHideModal && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 9999 }}>
          <div className="glass-panel" style={{ padding: '1.5rem', width: '300px', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Hide History Before</h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Select a date and time. Any request prior to this will be hidden from view but not deleted from disk.</p>
            <input type="datetime-local" value={hideDate} onChange={e => setHideDate(e.target.value)} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: '#1a1a24', color: 'var(--text)', outline: 'none' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              {config.stats?.hiddenBefore && (
                <button type="button" onClick={handleUnhideStats} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: '4px', background: 'var(--success)', color: '#fff', border: 'none', cursor: 'pointer', marginRight: 'auto' }}>Unhide All</button>
              )}
              <button type="button" className="secondary" onClick={() => setShowHideModal(false)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: '4px' }}>Cancel</button>
              <button type="button" onClick={handleHideStats} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: '4px', background: 'var(--error)', color: '#fff', border: 'none', cursor: 'pointer' }}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* View All Providers Modal */}
      {showViewAllProviders && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 9999 }}>
          <div className="glass-panel" style={{ padding: '1.5rem', width: '400px', maxHeight: '80vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>All Providers Share</h3>
              <button type="button" onClick={() => setShowViewAllProviders(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {providersData.map((prov, index) => {
                const percent = totalRequests > 0 ? (prov.count / totalRequests) * 100 : 0;
                return (
                  <div key={prov.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{index + 1}. {prov.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>~{prov.avgLatencyMs}ms</span></span>
                      <span style={{ color: 'var(--text-muted)' }}><strong>{prov.count}</strong> reqs ({percent.toFixed(1)}%)</span>
                    </div>
                    <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${percent}%`, background: prov.id === 'cache' ? 'var(--success)' : `linear-gradient(to right, var(--accent-glow), var(--accent))` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* View All Models Modal */}
      {showViewAllModels && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 9999 }}>
          <div className="glass-panel" style={{ padding: '1.5rem', width: '400px', maxHeight: '80vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>All Models Share</h3>
              <button type="button" onClick={() => setShowViewAllModels(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {modelsData.map((mod, index) => {
                const percent = totalRequests > 0 ? (mod.count / totalRequests) * 100 : 0;
                return (
                  <div key={mod.name} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{index + 1}. {mod.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>~{mod.avgLatencyMs}ms</span></span>
                      <span style={{ color: 'var(--text-muted)' }}><strong>{mod.count}</strong> reqs ({percent.toFixed(1)}%)</span>
                    </div>
                    <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${percent}%`, background: `linear-gradient(to right, #6b40ac, #a168ff)` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* View All Errors Modal */}
      {showViewAllErrors && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 9999 }}>
          <div className="glass-panel" style={{ padding: '1.5rem', width: '450px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>All Recorded Errors</h3>
              <button type="button" onClick={() => setShowViewAllErrors(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
            </div>
            <input 
              type="text" 
              placeholder="Search errors..." 
              value={errorSearch} 
              onChange={e => setErrorSearch(e.target.value)} 
              style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: '#1a1a24', color: 'var(--text)', outline: 'none', width: '100%', boxSizing: 'border-box' }} 
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', overflowY: 'auto' }}>
              {errorsData.filter(e => e.msg.toLowerCase().includes(errorSearch.toLowerCase())).map((err, idx) => {
                const isInternal = err.msg.toLowerCase().includes('timeout') || err.msg.toLowerCase().includes('econnrefused') || err.msg.toLowerCase().includes('internal') || err.msg.toLowerCase().includes('fetch failed');
                return (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.4rem 0.6rem', background: isInternal ? 'rgba(255, 165, 0, 0.1)' : 'var(--error-glow)', borderRadius: '4px', border: `1px solid ${isInternal ? 'rgba(255, 165, 0, 0.2)' : 'rgba(255, 68, 68, 0.1)'}` }}>
                    <span style={{ color: isInternal ? 'orange' : 'var(--error)' }}>
                      {isInternal ? '⚙️' : '⚠️'} {err.msg}
                    </span>
                    <strong style={{ color: 'var(--text)' }}>{err.count}</strong>
                  </div>
                );
              })}
              {errorsData.filter(e => e.msg.toLowerCase().includes(errorSearch.toLowerCase())).length === 0 && (
                <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>No matching errors found.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* View All Rate Limits Modal */}
      {showViewAllLimits && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 9999 }}>
          <div className="glass-panel" style={{ padding: '1.5rem', width: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>All Configured Rate Limits</h3>
              <button type="button" onClick={() => setShowViewAllLimits(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
            </div>
            
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>Target</th>
                    <th style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>Metric</th>
                    <th style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>Usage</th>
                    <th style={{ padding: '0.5rem', color: 'var(--text-muted)', width: '120px' }}>Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {limitRows.slice((limitsCurrentPage - 1) * 15, limitsCurrentPage * 15).map((row, idx) => {
                    const color = row.pct >= 90 ? 'var(--error)' : (row.pct >= 75 ? 'var(--warning)' : 'var(--success)');
                    return (
                      <tr key={`${row.entity}-${row.metric}-${idx}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '0.5rem' }}><strong style={{ color: 'var(--text)' }}>{row.entity}</strong></td>
                        <td style={{ padding: '0.5rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{row.metric}</td>
                        <td style={{ padding: '0.5rem' }}>{row.used.toLocaleString()} <span style={{ color: 'var(--text-muted)' }}>/ {row.limit.toLocaleString()}</span></td>
                        <td style={{ padding: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ height: '4px', flex: 1, background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${row.pct}%`, background: color }} />
                            </div>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: '35px', textAlign: 'right' }}>{row.pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {limitRows.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No rate limits configured.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {limitRows.length > 15 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: 'auto' }}>
                <button 
                  onClick={() => setLimitsCurrentPage(p => Math.max(1, p - 1))}
                  disabled={limitsCurrentPage === 1}
                  className="secondary"
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', borderRadius: '6px', opacity: limitsCurrentPage === 1 ? 0.5 : 1, cursor: limitsCurrentPage === 1 ? 'not-allowed' : 'pointer' }}
                >
                  Previous
                </button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Page {limitsCurrentPage} of {Math.ceil(limitRows.length / 15)}
                </span>
                <button 
                  onClick={() => setLimitsCurrentPage(p => Math.min(Math.ceil(limitRows.length / 15), p + 1))}
                  disabled={limitsCurrentPage === Math.ceil(limitRows.length / 15)}
                  className="secondary"
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', borderRadius: '6px', opacity: limitsCurrentPage === Math.ceil(limitRows.length / 15) ? 0.5 : 1, cursor: limitsCurrentPage === Math.ceil(limitRows.length / 15) ? 'not-allowed' : 'pointer' }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
