import React, { useState, useEffect } from 'react';
import {
  X,
  Layers,
  Sparkles,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Search,
  Filter,
  Check,
  Sliders,
  ShieldAlert,
  Server,
  Activity,
} from 'lucide-react';
import { RoutingPolicyName, StepRole } from '../../../shared/types.js';

export interface DetailedPoolStep {
  id?: string;
  pool_id?: string;
  order_index?: number;
  connection_id: string;
  model_id: string;
  role: StepRole;
  weight: number;
  modelName?: string;
  modelDisplayName?: string;
  providerSlug?: string;
  providerDisplayName?: string;
}

export interface PoolDTO {
  id: string;
  goalId: string | null;
  name: string;
  policy: RoutingPolicyName;
  isActive: boolean;
  steps: DetailedPoolStep[];
  createdAt: number;
  updatedAt?: number;
  goalName?: string | null;
}

interface ProviderWithConnections {
  id: string;
  slug: string;
  display_name: string;
  connections: Array<{
    id: string;
    label: string;
    status: string;
    tier: string;
  }>;
}

interface CatalogModel {
  id: string;
  modelName: string;
  displayName: string;
  providerSlug: string;
  providerDisplayName: string;
  contextWindow?: number;
  costInputPer1k?: number;
  costOutputPer1k?: number;
}

interface PoolStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPoolsUpdated?: () => void;
}

const getAdminToken = () =>
  sessionStorage.getItem('goalroute_admin_token') ||
  localStorage.getItem('goalroute_admin_token') ||
  (import.meta as any).env?.VITE_ADMIN_API_TOKEN ||
  '';

export const PoolStudioModal: React.FC<PoolStudioModalProps> = ({ isOpen, onClose, onPoolsUpdated }) => {
  const [pools, setPools] = useState<PoolDTO[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Edit form state
  const [poolName, setPoolName] = useState('');
  const [policy, setPolicy] = useState<RoutingPolicyName>('balanced');
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<DetailedPoolStep[]>([]);
  const [linkedGoalId, setLinkedGoalId] = useState<string | null>(null);
  const [linkedGoalName, setLinkedGoalName] = useState<string | null>(null);

  // Provider / Model selection for adding steps
  const [providers, setProviders] = useState<ProviderWithConnections[]>([]);
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>('all');
  const [isAddingStep, setIsAddingStep] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetchPools();
    fetchProvidersAndModels();
  }, [isOpen]);

  const fetchPools = async () => {
    setLoading(true);
    setError(null);
    try {
      const adminToken = getAdminToken();
      const res = await fetch('/api/v1/pools', {
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setPools(data);
        if (data.length > 0 && !selectedPoolId) {
          selectPool(data[0]);
        } else if (selectedPoolId) {
          const current = data.find((p: PoolDTO) => p.id === selectedPoolId);
          if (current) selectPool(current);
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load routing pools');
    } finally {
      setLoading(false);
    }
  };

  const fetchProvidersAndModels = async () => {
    const adminToken = getAdminToken();
    const headers = adminToken ? { authorization: `Bearer ${adminToken}` } : {};

    try {
      const [provRes, catRes] = await Promise.all([
        fetch('/api/v1/providers', { headers }),
        fetch('/api/v1/catalog/models', { headers }),
      ]);

      if (provRes.ok) setProviders(await provRes.json());
      if (catRes.ok) setCatalogModels(await catRes.json());
    } catch {}
  };

  const selectPool = (pool: PoolDTO) => {
    setSelectedPoolId(pool.id);
    setPoolName(pool.name);
    setPolicy(pool.policy);
    setIsActive(pool.isActive);
    setSteps(pool.steps ? [...pool.steps] : []);
    setLinkedGoalId(pool.goalId);
    setLinkedGoalName(pool.goalName || null);
    setIsAddingStep(false);
    setError(null);
    setSuccessMsg(null);
  };

  const handleCreateNewPool = () => {
    const newPool: PoolDTO = {
      id: `new-${Date.now()}`,
      goalId: null,
      name: 'Custom Multi-Model Pool',
      policy: 'balanced',
      isActive: true,
      steps: [],
      createdAt: Date.now(),
    };
    setSelectedPoolId(newPool.id);
    setPoolName(newPool.name);
    setPolicy('balanced');
    setIsActive(true);
    setSteps([]);
    setLinkedGoalId(null);
    setLinkedGoalName(null);
    setIsAddingStep(true);
  };

  const handleSave = async () => {
    if (!poolName.trim()) {
      setError('Pool name cannot be empty');
      return;
    }
    if (steps.length === 0) {
      setError('A pool must have at least 1 step/model candidate');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    const adminToken = getAdminToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    };

    const formattedSteps = steps.map((s, index) => ({
      connectionId: s.connection_id,
      modelId: s.model_id,
      role: s.role,
      weight: Number(s.weight) || 1.0,
      orderIndex: index,
    }));

    try {
      if (selectedPoolId && !selectedPoolId.startsWith('new-')) {
        // Update existing pool
        const res = await fetch(`/api/v1/pools/${selectedPoolId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            name: poolName,
            policy,
            isActive,
            goalId: linkedGoalId,
            steps: formattedSteps,
          }),
        });

        if (!res.ok) throw new Error(`Failed to update pool (HTTP ${res.status})`);
        const updated = await res.json();
        setSuccessMsg('Pool options saved successfully');
        selectPool(updated);
      } else {
        // Create custom pool
        const res = await fetch('/api/v1/pools', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: poolName,
            policy,
            goalId: linkedGoalId,
            steps: formattedSteps,
          }),
        });

        if (!res.ok) throw new Error(`Failed to create pool (HTTP ${res.status})`);
        const created = await res.json();
        setSuccessMsg('New pool created successfully');
        selectPool(created);
      }

      await fetchPools();
      if (onPoolsUpdated) onPoolsUpdated();
    } catch (e: any) {
      setError(e.message || 'Error saving pool options');
    } fontually {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPoolId || selectedPoolId.startsWith('new-')) return;
    if (!confirm(`Are you sure you want to delete "${poolName}"?`)) return;

    setSaving(true);
    const adminToken = getAdminToken();
    try {
      const res = await fetch(`/api/v1/pools/${selectedPoolId}`, {
        method: 'DELETE',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      if (!res.ok) throw new Error('Failed to delete pool');
      setSelectedPoolId(null);
      await fetchPools();
      if (onPoolsUpdated) onPoolsUpdated();
    } catch (e: any) {
      setError(e.message || 'Failed to delete pool');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateFromGoal = async () => {
    if (!selectedPoolId || selectedPoolId.startsWith('new-') || !linkedGoalId) return;

    setSaving(true);
    setError(null);
    const adminToken = getAdminToken();
    try {
      const res = await fetch(`/api/v1/pools/${selectedPoolId}/regenerate`, {
        method: 'POST',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to regenerate pool steps from Goal');
      }
      const regenerated = await res.json();
      selectPool(regenerated);
      setSuccessMsg('Pool steps regenerated from Goal Solver!');
      await fetchPools();
      if (onPoolsUpdated) onPoolsUpdated();
    } catch (e: any) {
      setError(e.message || 'Regeneration failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddStepFromModel = (model: CatalogModel) => {
    // Find active connection for this provider
    let connectionId = '';
    const prov = providers.find((p) => p.slug === model.providerSlug);
    if (prov && prov.connections && prov.connections.length > 0) {
      connectionId = prov.connections[0].id;
    } else {
      // Find any connection with matching provider
      for (const p of providers) {
        if (p.connections && p.connections.length > 0) {
          connectionId = p.connections[0].id;
          break;
        }
      }
    }

    if (!connectionId) {
      setError(`No active provider connection found for model "${model.displayName}". Please add provider key first.`);
      return;
    }

    const newStep: DetailedPoolStep = {
      connection_id: connectionId,
      model_id: model.id,
      role: 'primary',
      weight: 1.0,
      modelName: model.modelName,
      modelDisplayName: model.displayName,
      providerSlug: model.providerSlug,
      providerDisplayName: model.providerDisplayName,
    };

    setSteps([...steps, newStep]);
    setIsAddingStep(false);
  };

  const handleRemoveStep = (index: number) => {
    const updated = steps.filter((_, i) => i !== index);
    setSteps(updated);
  };

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === steps.length - 1)) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...steps];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    setSteps(updated);
  };

  const handleStepRoleChange = (index: number, role: StepRole) => {
    const updated = [...steps];
    updated[index].role = role;
    setSteps(updated);
  };

  const handleStepWeightChange = (index: number, weight: number) => {
    const updated = [...steps];
    updated[index].weight = weight;
    setSteps(updated);
  };

  // Filter catalog models by provider and search query
  const filteredCatalogModels = catalogModels.filter((m) => {
    const matchesProvider = selectedProviderFilter === 'all' || m.providerSlug === selectedProviderFilter;
    const matchesSearch =
      !searchQuery.trim() ||
      m.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.modelName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.providerDisplayName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesProvider && matchesSearch;
  });

  const uniqueProviders = Array.from(new Set(catalogModels.map((m) => m.providerSlug)));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                Pool Studio & Model Routing
              </h2>
              <p className="text-xs text-slate-400">
                Filter models, customize routing policies, weights, step fallback roles, and serve target pools.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Pool Selector */}
          <div className="w-72 border-r border-slate-800 bg-slate-950/40 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Routing Pools ({pools.length})
              </span>
              <button
                onClick={handleCreateNewPool}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                New Pool
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {loading ? (
                <div className="text-xs text-slate-500 py-6 text-center">Loading pools...</div>
              ) : pools.length === 0 ? (
                <div className="text-xs text-slate-500 py-6 text-center">No pools found. Create one!</div>
              ) : (
                pools.map((p) => {
                  const isSelected = p.id === selectedPoolId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => selectPool(p)}
                      className={`w-full text-left p-3 rounded-xl border transition-all text-xs flex flex-col gap-1.5 ${
                        isSelected
                          ? 'bg-purple-500/10 border-purple-500/30 text-purple-200 shadow-md'
                          : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between font-medium">
                        <span className="truncate max-w-[140px]">{p.name}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-mono ${
                            p.isActive
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-500 border border-slate-700'
                          }`}
                        >
                          {p.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span className="capitalize font-mono text-purple-400">{p.policy.replace('_', ' ')}</span>
                        <span>{p.steps?.length || 0} Models</span>
                      </div>
                      {p.goalName && (
                        <div className="text-[10px] text-slate-500 truncate">Goal: {p.goalName}</div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Main Editor */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            {error && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {selectedPoolId ? (
              <>
                {/* Header info & Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                  <div className="space-y-1 flex-1">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Pool Name
                    </label>
                    <input
                      type="text"
                      value={poolName}
                      onChange={(e) => setPoolName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-purple-500 transition-colors font-medium"
                      placeholder="e.g. Production Coding Fallback Pool"
                    />
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pt-4 sm:pt-0">
                    {linkedGoalId && (
                      <button
                        type="button"
                        onClick={handleRegenerateFromGoal}
                        disabled={saving}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all font-medium disabled:opacity-50"
                        title="Re-run GoalSolver on linked goal to regenerate candidate steps"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
                        Regenerate from Goal
                      </button>
                    )}

                    {!selectedPoolId.startsWith('new-') && (
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={saving}
                        className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-all"
                        title="Delete Pool"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Settings Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Routing Policy Selector */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Sliders className="w-3.5 h-3.5 text-purple-400" />
                      Routing Policy
                    </label>
                    <select
                      value={policy}
                      onChange={(e) => setPolicy(e.target.value as RoutingPolicyName)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                    >
                      <option value="balanced">Balanced Score (Latency + Cost + Health)</option>
                      <option value="cheapest">Cheapest First (Lowest $ / 1k Tokens)</option>
                      <option value="fastest">Fastest First (Lowest TTFT / Latency)</option>
                      <option value="fill_first">Fill-First Capacity (Max Utilization)</option>
                      <option value="auto_score">Auto-Score Heuristic Solver</option>
                    </select>
                  </div>

                  {/* Active Toggle */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Status
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsActive(!isActive)}
                      className={`w-full px-3 py-2 rounded-lg text-xs font-semibold border flex items-center justify-between transition-all ${
                        isActive
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-slate-950 border-slate-700 text-slate-400'
                      }`}
                    >
                      <span>{isActive ? 'Active Serving Endpoint' : 'Inactive'}</span>
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-slate-600'}`}
                      />
                    </button>
                  </div>

                  {/* Header Serving Info */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Server className="w-3.5 h-3.5 text-cyan-400" />
                      Target Header
                    </label>
                    <div className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-cyan-300 select-all truncate">
                      X-GoalRoute-Pool: {selectedPoolId}
                    </div>
                  </div>
                </div>

                {/* Steps & Candidates Section */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <Activity className="w-4 h-4 text-purple-400" />
                      Pool Steps & Candidate Models ({steps.length})
                    </h3>

                    <button
                      type="button"
                      onClick={() => setIsAddingStep(!isAddingStep)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:bg-purple-500/20 transition-all font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {isAddingStep ? 'Cancel Add' : 'Filter & Add Model Step'}
                    </button>
                  </div>

                  {/* Model Search & Add Panel */}
                  {isAddingStep && (
                    <div className="p-4 rounded-xl bg-slate-950 border border-purple-500/30 space-y-3 animate-in fade-in">
                      <div className="flex flex-col sm:flex-row gap-2">
                        {/* Search Input */}
                        <div className="relative flex-1">
                          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                          <input
                            type="text"
                            placeholder="Filter models by name (e.g., gpt-4o, claude, gemini)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
                          />
                        </div>

                        {/* Provider Filter Dropdown */}
                        <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg px-2 text-xs">
                          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <select
                            value={selectedProviderFilter}
                            onChange={(e) => setSelectedProviderFilter(e.target.value)}
                            className="bg-transparent text-slate-200 py-1.5 focus:outline-none capitalize"
                          >
                            <option value="all">All Providers</option>
                            {uniqueProviders.map((slug) => (
                              <option key={slug} value={slug}>
                                {slug}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Filtered Models List */}
                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 pt-1">
                        {filteredCatalogModels.length === 0 ? (
                          <div className="text-xs text-slate-500 py-4 text-center">
                            No candidate models matched search filters.
                          </div>
                        ) : (
                          filteredCatalogModels.map((m) => (
                            <div
                              key={m.id}
                              className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 hover:border-purple-500/40 transition-all text-xs"
                            >
                              <div>
                                <span className="font-semibold text-slate-200">{m.displayName || m.modelName}</span>
                                <span className="ml-2 text-[10px] text-slate-400 uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800">
                                  {m.providerDisplayName || m.providerSlug}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleAddStepFromModel(m)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 text-[11px] font-medium transition-all"
                              >
                                <Plus className="w-3 h-3" />
                                Add to Pool
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Active Pool Steps List */}
                  <div className="space-y-2">
                    {steps.length === 0 ? (
                      <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-xs text-slate-500">
                        No model steps configured in this pool. Click "Filter & Add Model Step" above to add candidates.
                      </div>
                    ) : (
                      steps.map((step, idx) => (
                        <div
                          key={step.id || `${step.connection_id}-${step.model_id}-${idx}`}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition-all text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px] font-mono shrink-0">
                              {idx + 1}
                            </span>
                            <div>
                              <div className="font-semibold text-slate-200">
                                {step.modelDisplayName || step.model_id}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                Provider:{' '}
                                <span className="font-mono text-slate-300">
                                  {step.providerDisplayName || step.providerSlug || 'Configured Provider'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 self-end sm:self-center">
                            {/* Role selector */}
                            <div className="space-y-0.5">
                              <label className="text-[9px] text-slate-500 uppercase font-semibold">Role</label>
                              <select
                                value={step.role}
                                onChange={(e) => handleStepRoleChange(idx, e.target.value as StepRole)}
                                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none"
                              >
                                <option value="primary">Primary</option>
                                <option value="backup">Backup</option>
                                <option value="overflow">Overflow</option>
                              </select>
                            </div>

                            {/* Weight Slider / Input */}
                            <div className="space-y-0.5 w-24">
                              <label className="text-[9px] text-slate-500 uppercase font-semibold flex justify-between">
                                <span>Weight</span>
                                <span>{step.weight.toFixed(1)}</span>
                              </label>
                              <input
                                type="range"
                                min="0.1"
                                max="10.0"
                                step="0.1"
                                value={step.weight}
                                onChange={(e) => handleStepWeightChange(idx, parseFloat(e.target.value))}
                                className="w-full accent-purple-500"
                              />
                            </div>

                            {/* Order adjust */}
                            <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
                              <button
                                type="button"
                                onClick={() => handleMoveStep(idx, 'up')}
                                disabled={idx === 0}
                                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveStep(idx, 'down')}
                                disabled={idx === steps.length - 1}
                                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveStep(idx)}
                                className="p-1 rounded text-rose-400 hover:bg-rose-500/10 ml-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Save Footer Button */}
                <div className="pt-4 border-t border-slate-800 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-all shadow-lg shadow-purple-600/20 disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    {saving ? 'Saving Changes...' : 'Save Pool Changes'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-xs">
                Select a pool on the left or create a new pool to configure settings and candidate models.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
