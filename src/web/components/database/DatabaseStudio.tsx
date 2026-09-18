import React, { useEffect, useState, useMemo } from 'react';
import { Database, Search, ShieldCheck, Zap, Server, Cpu, ExternalLink, Filter, BarChart2, Layers, Check, Sparkles, RefreshCw, Award } from 'lucide-react';
import { ModelDetail, ModelCompareModal } from './ModelCompareModal.js';
import { BenchmarkMatrixChart } from './BenchmarkMatrixChart.js';
import { getAdminToken } from '../settings/EndpointsManager.js';

export interface ProviderDetail {
  id: string;
  providerId: string;
  slug: string;
  provider: string;
  displayName: string;
  baseUrl: string;
  protocol: string;
  docsUrl?: string | null;
  hasKey: boolean;
  status: 'active' | 'unconfigured' | 'degraded';
  capabilities?: {
    vision?: boolean;
    tools?: boolean;
    streaming?: boolean;
    jsonMode?: boolean;
  };
}

export const DatabaseStudio: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'providers' | 'models' | 'matrix'>('matrix');
  const [providers, setProviders] = useState<ProviderDetail[]>([]);
  const [models, setModels] = useState<ModelDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>('all');
  const [filterToolsOnly, setFilterToolsOnly] = useState(false);
  const [filterVisionOnly, setFilterVisionOnly] = useState(false);
  const [filterFreeOnly, setFilterFreeOnly] = useState(false);

  // Model comparison state
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const token = getAdminToken();
    const headers: Record<string, string> = {};
    if (token) headers['authorization'] = `Bearer ${token}`;

    try {
      const [resProviders, resModels] = await Promise.all([
        fetch('/api/v1/providers', { headers }),
        fetch('/api/v1/catalog/models', { headers }),
      ]);

      const dataProviders = resProviders.ok ? await resProviders.json() : [];
      const dataModels = resModels.ok ? await resModels.json() : [];

      setProviders(Array.isArray(dataProviders) ? dataProviders : []);
      setModels(Array.isArray(dataModels) ? dataModels : []);
    } catch (e) {
      console.error('Failed to fetch catalog database:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const toggleSelectModel = (modelId: string) => {
    setSelectedModelIds((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId].slice(0, 4)
    );
  };

  const selectedModelsForCompare = useMemo(() => {
    return models.filter((m) => selectedModelIds.includes(m.id));
  }, [models, selectedModelIds]);

  // Filtered Models
  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      const matchesSearch =
        m.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.modelName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.providerDisplayName.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesProvider =
        selectedProviderFilter === 'all' || m.providerSlug === selectedProviderFilter;

      const matchesTools = !filterToolsOnly || m.supportsTools;
      const matchesVision = !filterVisionOnly || m.supportsVision;
      const matchesFree = !filterFreeOnly || (m.costInputPer1k === 0 && m.costOutputPer1k === 0);

      return matchesSearch && matchesProvider && matchesTools && matchesVision && matchesFree;
    });
  }, [models, searchQuery, selectedProviderFilter, filterToolsOnly, filterVisionOnly, filterFreeOnly]);

  // Filtered Providers
  const filteredProviders = useMemo(() => {
    return providers.filter((p) => {
      return (
        p.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.protocol.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [providers, searchQuery]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-fadeIn">
      
      {/* Studio Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl bg-gradient-to-r from-[var(--bg-rail)] via-[var(--bg-card)] to-[var(--bg-well)] border border-[var(--border-hover)] shadow-lg relative overflow-hidden">
        <div className="space-y-1 z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20 shadow-inner">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight flex items-center gap-2">
                Model & Provider Database
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] border border-[var(--signal-mint)]/20">
                  LIVE CATALOG
                </span>
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Centralized registry of model specs, benchmarks, pricing, and 2D comparison matrix.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Stats Pills */}
        <div className="flex flex-wrap items-center gap-3 z-10">
          <div className="px-3 py-2 rounded-xl bg-[var(--bg-obsidian)] border border-[var(--border-subtle)] text-xs font-mono">
            <span className="text-[var(--text-muted)] block text-[10px]">TOTAL MODELS</span>
            <span className="font-bold text-[var(--text-primary)] text-sm">{models.length}</span>
          </div>
          <div className="px-3 py-2 rounded-xl bg-[var(--bg-obsidian)] border border-[var(--border-subtle)] text-xs font-mono">
            <span className="text-[var(--text-muted)] block text-[10px]">PROVIDERS</span>
            <span className="font-bold text-[var(--text-primary)] text-sm">{providers.length}</span>
          </div>
          <button
            onClick={fetchData}
            className="p-2.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card)] border border-[var(--border-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            title="Refresh Catalog Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-2">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
              activeTab === 'matrix'
                ? 'bg-[var(--accent-primary)] text-white shadow-md'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            <span>Benchmark Matrix Lab</span>
          </button>

          <button
            onClick={() => setActiveTab('models')}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
              activeTab === 'models'
                ? 'bg-[var(--accent-primary)] text-white shadow-md'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Models Catalog ({models.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('providers')}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
              activeTab === 'providers'
                ? 'bg-[var(--accent-primary)] text-white shadow-md'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>Providers Registry ({providers.length})</span>
          </button>
        </div>

        {/* Global Search Bar */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search models, providers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] font-medium"
          />
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading ? (
        <div className="p-12 text-center text-xs font-mono text-[var(--text-muted)] space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[var(--accent-primary)]" />
          <p>Loading database catalog & benchmarks...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: BENCHMARK MATRIX LAB */}
          {activeTab === 'matrix' && (
            <div className="space-y-6">
              
              <div className="p-4 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs space-y-1 text-[var(--text-secondary)]">
                <span className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[var(--signal-mint)]" />
                  Interactive 2D Benchmark Comparison Matrix
                </span>
                <p>
                  Plot and compare models across reasoning, coding, math, vision, speed (TPS), and latency metrics. Click any model node or checkbox to select up to 4 models for side-by-side spec comparison.
                </p>
              </div>

              <BenchmarkMatrixChart
                models={models}
                selectedModelIds={selectedModelIds}
                onToggleSelectModel={toggleSelectModel}
                onOpenCompareModal={() => setIsCompareModalOpen(true)}
              />

              {/* Leaderboards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Reasoning Leaderboard */}
                <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
                  <div className="flex items-center justify-between font-bold text-xs text-[var(--text-primary)] border-b border-[var(--border-subtle)] pb-2">
                    <span className="flex items-center gap-1.5 text-emerald-400 font-mono">
                      <Award className="w-4 h-4" /> Top Reasoning Models
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">SCORE / 100</span>
                  </div>
                  <div className="space-y-2">
                    {models
                      .slice()
                      .sort((a, b) => (b.benchReasoningScore || 0) - (a.benchReasoningScore || 0))
                      .slice(0, 4)
                      .map((m) => (
                        <div key={m.id} className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[var(--text-primary)] truncate max-w-[170px]">
                            {m.displayName}
                          </span>
                          <span className="font-mono font-extrabold text-emerald-400">
                            {m.benchReasoningScore || 0}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Coding Leaderboard */}
                <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
                  <div className="flex items-center justify-between font-bold text-xs text-[var(--text-primary)] border-b border-[var(--border-subtle)] pb-2">
                    <span className="flex items-center gap-1.5 text-cyan-400 font-mono">
                      <Award className="w-4 h-4" /> Top Coding Models
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">SCORE / 100</span>
                  </div>
                  <div className="space-y-2">
                    {models
                      .slice()
                      .sort((a, b) => (b.benchCodingScore || 0) - (a.benchCodingScore || 0))
                      .slice(0, 4)
                      .map((m) => (
                        <div key={m.id} className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[var(--text-primary)] truncate max-w-[170px]">
                            {m.displayName}
                          </span>
                          <span className="font-mono font-extrabold text-cyan-400">
                            {m.benchCodingScore || 0}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Speed Leaderboard */}
                <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
                  <div className="flex items-center justify-between font-bold text-xs text-[var(--text-primary)] border-b border-[var(--border-subtle)] pb-2">
                    <span className="flex items-center gap-1.5 text-amber-400 font-mono">
                      <Zap className="w-4 h-4" /> Top Throughput (TPS)
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">TOK / SEC</span>
                  </div>
                  <div className="space-y-2">
                    {models
                      .slice()
                      .sort((a, b) => (b.benchTps || 0) - (a.benchTps || 0))
                      .slice(0, 4)
                      .map((m) => (
                        <div key={m.id} className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[var(--text-primary)] truncate max-w-[170px]">
                            {m.displayName}
                          </span>
                          <span className="font-mono font-extrabold text-amber-400">
                            {m.benchTps || 0} tok/s
                          </span>
                        </div>
                      ))}
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* TAB 2: MODELS CATALOG */}
          {activeTab === 'models' && (
            <div className="space-y-4">
              
              {/* Filter Controls Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  <span className="text-[var(--text-muted)] font-bold">Filters:</span>
                  
                  <select
                    value={selectedProviderFilter}
                    onChange={(e) => setSelectedProviderFilter(e.target.value)}
                    className="bg-[var(--bg-well)] text-[var(--text-primary)] border border-[var(--border-hover)] rounded-lg px-2.5 py-1 text-xs font-medium focus:outline-none"
                  >
                    <option value="all">All Providers</option>
                    {providers.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => setFilterToolsOnly(!filterToolsOnly)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      filterToolsOnly
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-[var(--bg-well)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    Tools Only
                  </button>

                  <button
                    onClick={() => setFilterVisionOnly(!filterVisionOnly)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      filterVisionOnly
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'bg-[var(--bg-well)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    Vision Only
                  </button>

                  <button
                    onClick={() => setFilterFreeOnly(!filterFreeOnly)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      filterFreeOnly
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-[var(--bg-well)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    Free Models Only
                  </button>
                </div>

                {/* Floating Compare Action Bar */}
                {selectedModelIds.length > 0 && (
                  <button
                    onClick={() => setIsCompareModalOpen(true)}
                    className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-[var(--accent-primary)] text-white text-xs font-bold shadow cursor-pointer"
                  >
                    <span>Compare Selected ({selectedModelIds.length})</span>
                  </button>
                )}
              </div>

              {/* Models Grid Table */}
              <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                      <tr className="bg-[var(--bg-well)] text-[var(--text-muted)] text-[11px] font-mono uppercase tracking-wider border-b border-[var(--border-subtle)]">
                        <th className="p-3 w-10 text-center">Select</th>
                        <th className="p-3">Model & Provider</th>
                        <th className="p-3">Context Limit</th>
                        <th className="p-3">Token Pricing (In / Out)</th>
                        <th className="p-3">Reasoning</th>
                        <th className="p-3">Coding</th>
                        <th className="p-3">Throughput</th>
                        <th className="p-3 text-right">Capabilities</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)] text-xs">
                      {filteredModels.map((m) => {
                        const isSelected = selectedModelIds.includes(m.id);
                        return (
                          <tr
                            key={m.id}
                            className={`hover:bg-[var(--bg-well)] transition-colors ${
                              isSelected ? 'bg-[var(--accent-primary)]/5' : ''
                            }`}
                          >
                            <td className="p-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectModel(m.id)}
                                className="rounded border-[var(--border-hover)] text-[var(--accent-primary)] focus:ring-0 cursor-pointer"
                              />
                            </td>
                            <td className="p-3">
                              <div className="font-bold text-[var(--text-primary)]">{m.displayName}</div>
                              <div className="flex items-center space-x-2 text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                                <span className="text-[var(--accent-primary)] font-semibold">{m.providerDisplayName}</span>
                                <span>•</span>
                                <span>{m.modelName}</span>
                              </div>
                            </td>
                            <td className="p-3 font-mono font-semibold text-[var(--text-primary)]">
                              {(m.contextWindow / 1024).toFixed(0)}K
                            </td>
                            <td className="p-3 font-mono">
                              {m.costInputPer1k === 0 && m.costOutputPer1k === 0 ? (
                                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                                  FREE
                                </span>
                              ) : (
                                <span className="text-[var(--text-secondary)]">
                                  ${m.costInputPer1k.toFixed(4)} / ${m.costOutputPer1k.toFixed(4)}
                                </span>
                              )}
                            </td>
                            <td className="p-3 font-mono font-bold text-emerald-400">
                              {m.benchReasoningScore ? `${m.benchReasoningScore}` : '-'}
                            </td>
                            <td className="p-3 font-mono font-bold text-cyan-400">
                              {m.benchCodingScore ? `${m.benchCodingScore}` : '-'}
                            </td>
                            <td className="p-3 font-mono text-[var(--text-primary)]">
                              {m.benchTps ? `${m.benchTps} tok/s` : '-'}
                            </td>
                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end space-x-1 text-[10px] font-mono">
                                {m.supportsTools && (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                                    TOOLS
                                  </span>
                                )}
                                {m.supportsVision && (
                                  <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-bold border border-cyan-500/20">
                                    VISION
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: PROVIDERS REGISTRY */}
          {activeTab === 'providers' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProviders.map((p) => {
                const provModelsCount = models.filter((m) => m.providerSlug === p.slug).length;
                return (
                  <div
                    key={p.id}
                    className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all shadow-sm space-y-4 flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-extrabold text-base text-[var(--text-primary)]">
                            {p.displayName}
                          </h3>
                          <div className="text-xs font-mono text-[var(--accent-primary)]">{p.slug}</div>
                        </div>

                        {/* Connection Status Badge */}
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-extrabold uppercase border ${
                            p.hasKey
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-[var(--bg-well)] text-[var(--text-muted)] border-[var(--border-subtle)]'
                          }`}
                        >
                          {p.hasKey ? 'CONNECTED' : 'UNCONFIGURED'}
                        </span>
                      </div>

                      <div className="space-y-1.5 text-xs text-[var(--text-secondary)] font-mono">
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Protocol:</span>
                          <span className="font-bold text-[var(--text-primary)] uppercase">{p.protocol}</span>
                        </div>
                        <div className="flex justify-between truncate">
                          <span className="text-[var(--text-muted)]">Base URL:</span>
                          <span className="text-[var(--text-secondary)] truncate max-w-[180px]" title={p.baseUrl}>
                            {p.baseUrl}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Available Models:</span>
                          <span className="font-bold text-[var(--signal-mint)]">{provModelsCount} models</span>
                        </div>
                      </div>
                    </div>

                    {/* Footer Capabilities Badges */}
                    <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        {p.capabilities?.vision && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                            VISION
                          </span>
                        )}
                        {p.capabilities?.tools && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            TOOLS
                          </span>
                        )}
                        {p.capabilities?.streaming && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20">
                            STREAMING
                          </span>
                        )}
                      </div>

                      {p.docsUrl && (
                        <a
                          href={p.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                          title="Provider API Documentation"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </>
      )}

      {/* Side-by-Side Model Comparison Modal */}
      <ModelCompareModal
        isOpen={isCompareModalOpen}
        models={selectedModelsForCompare}
        onClose={() => setIsCompareModalOpen(false)}
        onRemoveModel={toggleSelectModel}
      />

    </div>
  );
};
