import React, { useState, useEffect, useRef } from 'react';
import type { GatewayConfig, VirtualModel, VirtualModelTarget } from '../utils/api';
import { getCacheStats, clearCacheDatabase, getStats, overrideRateLimit } from '../utils/api';

interface ActivePoolsProps {
  config: GatewayConfig;
  onSave: (config: GatewayConfig) => void;
}

export const ActivePools: React.FC<ActivePoolsProps> = ({ config, onSave }) => {
  const [localConfig, setLocalConfig] = useState<GatewayConfig>({ ...config });
  const [limitsData, setLimitsData] = useState<any>(null);

  const fetchLimits = async () => {
    try {
      const data = await getStats();
      setLimitsData(data.limits);
    } catch (e) {}
  };

  useEffect(() => {
    fetchLimits();
    const interval = setInterval(fetchLimits, 5000);
    return () => clearInterval(interval);
  }, []);

  // Custom Virtual Model Creator State
  const [newVmId, setNewVmId] = useState('');
  const [newVmName, setNewVmName] = useState('');
  const [showAddVm, setShowAddVm] = useState(false);

  // New Target Selector State (virtualModelId -> { selectedProviderId, selectedModelId })
  const [newTargets, setNewTargets] = useState<{ [key: string]: { providerId: string; modelId: string } }>({});

  // Search models query state per pool
  const [searchQueries, setSearchQueries] = useState<{ [vmId: string]: string }>({});
  // Search/filter state for the existing targets list per pool
  const [targetSearchQueries, setTargetSearchQueries] = useState<{ [vmId: string]: string }>({});
  const [targetFilters, setTargetFilters] = useState<{ [vmId: string]: 'all' | 'active' | 'inactive' }>({});
  // Multi-select state: vmId -> Set of original indices
  const [selectedTargets, setSelectedTargets] = useState<{ [vmId: string]: Set<number> }>({});

  // Undo/redo history for ALL user-initiated pool/config mutations.
  const HISTORY_LIMIT = 50;
  const COALESCE_MS = 450; // merge rapid keystrokes into a single undo entry
  const [undoStack, setUndoStack] = useState<GatewayConfig[]>([]);
  const [redoStack, setRedoStack] = useState<GatewayConfig[]>([]);
  const lastCommitRef = useRef(0);

  // Collapsible configuration panels state
  const [expandedConfigVmId, setExpandedConfigVmId] = useState<string | null>(null);
  const [collapsedPools, setCollapsedPools] = useState<{ [vmId: string]: boolean }>({});
  
  // Track which target settings panel is expanded for each pool
  const [expandedTargetSettings, setExpandedTargetSettings] = useState<{ [vmId: string]: number | null }>({});

  // Model Aliases State
  const [newAliasRequestName, setNewAliasRequestName] = useState('');
  const [newAliasTargetModel, setNewAliasTargetModel] = useState('');

  // Sync state when config from parent updates
  useEffect(() => {
    setLocalConfig({ ...config });
  }, [config]);

  // Debounced auto-save configuration whenever localConfig updates
  useEffect(() => {
    const timer = setTimeout(() => {
      if (JSON.stringify(localConfig) !== JSON.stringify(config)) {
        onSave(localConfig);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localConfig, config, onSave]);

  // Semantic Cache State
  const [cacheSize, setCacheSize] = useState<number>(0);

  React.useEffect(() => {
    getCacheStats()
      .then(res => setCacheSize(res.size))
      .catch(() => {});
  }, []);

  const handleClearCache = async () => {
    if (!confirm('Are you sure you want to clear the semantic cache database?')) return;
    try {
      const res = await clearCacheDatabase();
      if (res.success) {
        setCacheSize(0);
        alert('Semantic cache database cleared successfully.');
      }
    } catch (err: any) {
      alert('Failed to clear cache: ' + err.message);
    }
  };

  const handleAddAlias = () => {
    if (!newAliasRequestName.trim() || !newAliasTargetModel) return;
    const currentAliases = localConfig.aliases || {};
    const updatedAliases = {
      ...currentAliases,
      [newAliasRequestName.trim()]: newAliasTargetModel
    };
    commitConfig({
      ...localConfig,
      aliases: updatedAliases
    });
    setNewAliasRequestName('');
  };

  const handleRemoveAlias = (requestName: string) => {
    const currentAliases = { ...(localConfig.aliases || {}) };
    delete currentAliases[requestName];
    commitConfig({
      ...localConfig,
      aliases: currentAliases
    });
  };

  // Collect target models (virtual pools and enabled direct models)
  const availableTargetModels: string[] = [];
  localConfig.virtualModels.forEach(vm => availableTargetModels.push(vm.id));
  localConfig.providers.forEach(p => {
    if (p.enabled) {
      p.models.forEach(m => {
        if (!availableTargetModels.includes(m.id)) {
          availableTargetModels.push(m.id);
        }
      });
    }
  });



  const handleDragDropTarget = (vmId: string, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const virtualModel = localConfig.virtualModels.find(vm => vm.id === vmId);
    if (!virtualModel) return;

    const targets = [...virtualModel.targets];
    const [moved] = targets.splice(fromIndex, 1);
    targets.splice(toIndex, 0, moved);

    const updatedVms = localConfig.virtualModels.map(vm => 
      vm.id === vmId ? { ...vm, targets } : vm
    );

    const newConfig = { ...localConfig, virtualModels: updatedVms };
    commitConfig(newConfig);
    onSave(newConfig); // Instant apply to backend
  };

  const handleTargetTimeoutChange = (vmId: string, index: number, value: string) => {
    const updatedVms = localConfig.virtualModels.map(vm => {
      if (vm.id === vmId) {
        const targets = [...vm.targets];
        const ms = parseInt(value);
        if (!isNaN(ms) && ms > 0) {
          targets[index] = { ...targets[index], timeoutMs: ms * 1000 };
        } else {
          // If empty, remove the override
          const newTarget = { ...targets[index] };
          delete newTarget.timeoutMs;
          targets[index] = newTarget;
        }
        return { ...vm, targets };
      }
      return vm;
    });
    commitConfig({ ...localConfig, virtualModels: updatedVms });
  };

  const handleTargetCooldownChange = (vmId: string, index: number, value: string) => {
    const updatedVms = localConfig.virtualModels.map(vm => {
      if (vm.id === vmId) {
        const targets = [...vm.targets];
        const ms = parseInt(value);
        if (!isNaN(ms) && ms > 0) {
          targets[index] = { ...targets[index], cooldownMs: ms * 1000 };
        } else {
          const newTarget = { ...targets[index] };
          delete newTarget.cooldownMs;
          targets[index] = newTarget;
        }
        return { ...vm, targets };
      }
      return vm;
    });
    commitConfig({ ...localConfig, virtualModels: updatedVms });
  };

  const handleTargetLimitChange = (vmId: string, index: number, field: string, value: string) => {
    const updatedVms = localConfig.virtualModels.map(vm => {
      if (vm.id === vmId) {
        const targets = [...vm.targets];
        const parsed = parseInt(value);
        const limits = { ...(targets[index].limits || {}) };
        
        if (!isNaN(parsed) && parsed > 0) {
          limits[field] = parsed;
        } else {
          delete limits[field];
        }

        if (Object.keys(limits).length > 0) {
          targets[index] = { ...targets[index], limits };
        } else {
          const newTarget = { ...targets[index] };
          delete newTarget.limits;
          targets[index] = newTarget;
        }
        return { ...vm, targets };
      }
      return vm;
    });
    commitConfig({ ...localConfig, virtualModels: updatedVms });
  };

  const handleRemoveTarget = (vmId: string, index: number) => {
    const virtualModel = localConfig.virtualModels.find(vm => vm.id === vmId);
    if (!virtualModel) return;

    const targets = virtualModel.targets.filter((_, idx) => idx !== index);
    const updatedVms = localConfig.virtualModels.map(vm => 
      vm.id === vmId ? { ...vm, targets } : vm
    );

    commitConfig({ ...localConfig, virtualModels: updatedVms });
  };

  const handleAddTarget = (vmId: string) => {
    const selector = newTargets[vmId];
    if (!selector || !selector.providerId || !selector.modelId) return;

    const virtualModel = localConfig.virtualModels.find(vm => vm.id === vmId);
    if (!virtualModel) return;

    const exists = virtualModel.targets.some(t => 
      t.providerId === selector.providerId && t.modelId === selector.modelId
    );

    if (exists) {
      alert('This target is already in the priority queue.');
      return;
    }

    const targets = [...virtualModel.targets, { providerId: selector.providerId, modelId: selector.modelId }];
    const updatedVms = localConfig.virtualModels.map(vm => 
      vm.id === vmId ? { ...vm, targets } : vm
    );

    commitConfig({ ...localConfig, virtualModels: updatedVms });

    // Reset selector state for this pool
    setNewTargets({
      ...newTargets,
      [vmId]: { providerId: '', modelId: '' }
    });
  };

  const handlePoolLimitChange = (vmId: string, field: string, value: string) => {
    const num = parseInt(value, 10);
    const updatedVms = localConfig.virtualModels.map(vm => {
      if (vm.id === vmId) {
        const limits = { ...vm.limits };
        if (isNaN(num)) {
          delete limits[field];
        } else {
          limits[field] = num;
        }
        return { ...vm, limits };
      }
      return vm;
    });
    commitConfig({ ...localConfig, virtualModels: updatedVms });
  };

  const renderPoolLimitUsage = (vmId: string, limits: any, label: string, field: 'rpm'|'rph'|'rpd'|'rpmo'|'tpm'|'tph'|'tpd'|'tpmo') => {
    const limitsDataForKey = limitsData?.[vmId]?.[field];
    const used = limitsDataForKey?.used || 0;
    const limit = limits?.[field] || Infinity;
    
    return (
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '20px', marginBottom: '2px' }}>
        <span>{label}</span>
        {limitsDataForKey && (
          <span>
            <span style={{ color: used >= limit && limit > 0 ? 'var(--error)' : 'var(--accent)' }}>{used}</span> used
            <button 
              type="button" 
              onClick={() => {
                const newVal = prompt(`Enter new used value for ${label} (${vmId}):`, used.toString());
                if (newVal !== null && !isNaN(Number(newVal))) {
                  overrideRateLimit(vmId, field.startsWith('t') ? 'tokens' : 'count', Number(newVal))
                    .then(() => fetchLimits());
                }
              }} 
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 4px', fontSize: '0.75rem' }}
              title="Edit Usage"
            >
              ✏️
            </button>
          </span>
        )}
      </span>
    );
  };

  const renderModelLimitUsage = (providerId: string, modelId: string, targetLimits: any, label: string, field: 'rpm'|'rph'|'rpd'|'rpmo'|'tpm'|'tph'|'tpd'|'tpmo') => {
    const key = `${providerId}:${modelId}`;
    const limitsDataForKey = limitsData?.[key]?.[field];
    const used = limitsDataForKey?.used || 0;
    const limit = targetLimits?.[field] || Infinity;
    
    return (
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '20px', marginBottom: '2px' }}>
        <span>{label}</span>
        {limitsDataForKey && (
          <span>
            <span style={{ color: used >= limit && limit > 0 ? 'var(--error)' : 'var(--accent)' }}>{used}</span> used
            <button 
              type="button" 
              onClick={() => {
                const newVal = prompt(`Enter new used value for ${label} (${key}):`, used.toString());
                if (newVal !== null && !isNaN(Number(newVal))) {
                  overrideRateLimit(key, field.startsWith('t') ? 'tokens' : 'count', Number(newVal))
                    .then(() => fetchLimits());
                }
              }} 
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 4px', fontSize: '0.75rem' }}
              title="Edit Usage"
            >
              ✏️
            </button>
          </span>
        )}
      </span>
    );
  };

  const handleCreateVirtualModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVmId || !newVmName) return;

    const cleanId = newVmId.toLowerCase().trim().replace(/\s+/g, '-');
    if (localConfig.virtualModels.some(vm => vm.id === cleanId)) {
      alert('Virtual model identifier already exists.');
      return;
    }

    const newVm: VirtualModel = {
      id: cleanId,
      name: newVmName.trim(),
      targets: []
    };

    commitConfig({
      ...localConfig,
      virtualModels: [...localConfig.virtualModels, newVm]
    });

    setNewVmId('');
    setNewVmName('');
    setShowAddVm(false);
  };

  const handleDeleteVirtualModel = (vmId: string) => {
    if (!confirm('Are you sure you want to delete this routing pool?')) return;
    const updated = localConfig.virtualModels.filter(vm => vm.id !== vmId);
    commitConfig({ ...localConfig, virtualModels: updated });
  };

  const handleTargetSelectorChange = (vmId: string, field: 'providerId' | 'modelId', value: string) => {
    const current = newTargets[vmId] || { providerId: '', modelId: '' };
    const updated = { ...current, [field]: value };
    
    if (field === 'providerId') {
      updated.modelId = ''; // Reset model selection
    }

    setNewTargets({ ...newTargets, [vmId]: updated });
  };

  const getSearchResultsForPool = (query: string) => {
    if (!query.trim()) return [];
    const results: { providerId: string; providerName: string; modelId: string; modelName: string }[] = [];
    localConfig.providers.forEach(p => {
      if (p.enabled) {
        p.models.forEach(m => {
          const matchesId = m.id.toLowerCase().includes(query.toLowerCase());
          const matchesName = (m.name || '').toLowerCase().includes(query.toLowerCase());
          if (matchesId || matchesName) {
            results.push({
              providerId: p.id,
              providerName: p.name,
              modelId: m.id,
              modelName: m.name || m.id
            });
          }
        });
      }
    });
    return results;
  };

  // Filter targets by search query and active/inactive state, preserving original indices
  const getFilteredTargets = (vmId: string): { target: VirtualModelTarget; originalIndex: number }[] => {
    const vm = localConfig.virtualModels.find(v => v.id === vmId);
    if (!vm) return [];
    const query = (targetSearchQueries[vmId] || '').trim().toLowerCase();
    const filterMode = targetFilters[vmId] || 'all';
    return vm.targets
      .map((target, originalIndex) => {
        const provider = localConfig.providers.find(p => p.id === target.providerId);
        const modelObj = provider?.models.find(m => m.id === target.modelId);
        const providerName = provider?.name || target.providerId;
        const modelName = modelObj?.name || target.modelId;
        const isActive = target.enabled !== false;
        const matchesFilter = filterMode === 'all' || (filterMode === 'active' ? isActive : !isActive);
        const matchesSearch = !query ||
          modelName.toLowerCase().includes(query) ||
          target.modelId.toLowerCase().includes(query) ||
          providerName.toLowerCase().includes(query) ||
          target.providerId.toLowerCase().includes(query);
        return matchesFilter && matchesSearch ? { target, originalIndex } : null;
      })
      .filter((x): x is { target: VirtualModelTarget; originalIndex: number } => x !== null);
  };

  // ── Multi-select helpers ──────────────────────────────────────────────
  const toggleTargetSelection = (vmId: string, index: number) => {
    setSelectedTargets(prev => {
      const next = new Set(prev[vmId] || new Set<number>());
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { ...prev, [vmId]: next };
    });
  };

  const clearSelection = (vmId: string) => {
    setSelectedTargets(prev => {
      const next = { ...prev };
      delete next[vmId];
      return next;
    });
  };

  const selectAllVisible = (vmId: string, filtered: { target: VirtualModelTarget; originalIndex: number }[]) => {
    const indices = filtered.map(f => f.originalIndex);
    const current = selectedTargets[vmId] || new Set<number>();
    const allSelected = indices.length > 0 && indices.every(i => current.has(i));
    setSelectedTargets(prev => {
      const next = new Set(prev[vmId] || new Set<number>());
      if (allSelected) {
        indices.forEach(i => next.delete(i));
      } else {
        indices.forEach(i => next.add(i));
      }
      return { ...prev, [vmId]: next };
    });
  };

  // ── History helpers ───────────────────────────────────────────────────
  // commitConfig: the single entry point for ALL user-initiated mutations.
  // Replaces setLocalConfig in every handler so that every change is
  // checkpointed for undo/redo. Time-based coalescing (COALESCE_MS) merges
  // a burst of rapid edits (e.g. typing in a text/number field) into a
  // single undo entry to avoid stack flooding.
  //
  // NOTE: The config-sync effect and handleUndo/handleRedo deliberately use
  // raw setLocalConfig (NOT commitConfig) — syncing remote/external changes
  // or restoring snapshots must not push new history entries.
  const commitConfig = (next: GatewayConfig) => {
    if (next === localConfig) return; // no-op guard
    const now = Date.now();
    if (now - lastCommitRef.current > COALESCE_MS) {
      // Enough time elapsed → push a new checkpoint of the *pre-change* state
      setUndoStack(prev => {
        const stack = [...prev, localConfig];
        return stack.length > HISTORY_LIMIT ? stack.slice(stack.length - HISTORY_LIMIT) : stack;
      });
      setRedoStack([]); // a new action forks the timeline
      console.log('[History] checkpoint captured', { undoDepth: undoStack.length + 1 });
    }
    // else: within coalesce window → merge into the current top checkpoint
    lastCommitRef.current = now;
    setLocalConfig(next); // existing 300ms debounced auto-save persists it
  };

  const handleUndo = () => {
    if (undoStack.length === 0) {
      console.log('[Undo] No history to undo — undoStack is empty.');
      return;
    }
    const snapshot = undoStack[undoStack.length - 1];
    console.log('[Undo] Restoring previous config snapshot.', {
      undoStackSizeBefore: undoStack.length,
      redoStackSizeBefore: redoStack.length,
    });
    lastCommitRef.current = 0; // next user edit starts a fresh checkpoint
    setRedoStack(prev => [...prev, localConfig]);
    setUndoStack(prev => prev.slice(0, -1));
    setLocalConfig(snapshot); // raw setLocalConfig — bypasses commitConfig
  };

  const handleRedo = () => {
    if (redoStack.length === 0) {
      console.log('[Redo] No history to redo — redoStack is empty.');
      return;
    }
    const snapshot = redoStack[redoStack.length - 1];
    console.log('[Redo] Restoring next config snapshot.', {
      undoStackSizeBefore: undoStack.length,
      redoStackSizeBefore: redoStack.length,
    });
    lastCommitRef.current = 0; // next user edit starts a fresh checkpoint
    setUndoStack(prev => [...prev, localConfig]);
    setRedoStack(prev => prev.slice(0, -1));
    setLocalConfig(snapshot); // raw setLocalConfig — bypasses commitConfig
  };

  // Keyboard shortcuts: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // ── Bulk operation handlers ───────────────────────────────────────────
  const handleBulkRemoveTargets = (vmId: string, indices: number[]) => {
    if (indices.length === 0) return;
    const idxSet = new Set(indices);
    const updatedVms = localConfig.virtualModels.map(vm => {
      if (vm.id !== vmId) return vm;
      return { ...vm, targets: vm.targets.filter((_, i) => !idxSet.has(i)) };
    });
    commitConfig({ ...localConfig, virtualModels: updatedVms });
    clearSelection(vmId);
  };

  const handleBulkSetEnabled = (vmId: string, indices: number[], enabled: boolean) => {
    if (indices.length === 0) return;
    const idxSet = new Set(indices);
    const updatedVms = localConfig.virtualModels.map(vm => {
      if (vm.id !== vmId) return vm;
      return {
        ...vm,
        targets: vm.targets.map((t, i) => idxSet.has(i) ? { ...t, enabled } : t)
      };
    });
    commitConfig({ ...localConfig, virtualModels: updatedVms });
    clearSelection(vmId);
  };

  const handleImportAllMatches = (vmId: string, matchedTargets: { providerId: string; modelId: string }[]) => {
    const virtualModel = localConfig.virtualModels.find(vm => vm.id === vmId);
    if (!virtualModel) return;

    const newAddedTargets = matchedTargets.filter(match => 
      !virtualModel.targets.some(t => t.providerId === match.providerId && t.modelId === match.modelId)
    );

    if (newAddedTargets.length === 0) {
      alert('All matched models are already in this pool.');
      return;
    }

    const targets = [...virtualModel.targets, ...newAddedTargets];
    const updatedVms = localConfig.virtualModels.map(vm => 
      vm.id === vmId ? { ...vm, targets } : vm
    );

    commitConfig({ ...localConfig, virtualModels: updatedVms });
    setSearchQueries({ ...searchQueries, [vmId]: '' });
  };

  const handleToggleTargetEnabled = (vmId: string, index: number) => {
    const updatedVms = localConfig.virtualModels.map(vm => {
      if (vm.id === vmId) {
        const targets = [...vm.targets];
        const isCurrentlyEnabled = targets[index].enabled !== false;
        targets[index] = { ...targets[index], enabled: !isCurrentlyEnabled };
        return { ...vm, targets };
      }
      return vm;
    });
    commitConfig({ ...localConfig, virtualModels: updatedVms });
  };

  const handleAddSingleTarget = (vmId: string, providerId: string, modelId: string) => {
    const virtualModel = localConfig.virtualModels.find(vm => vm.id === vmId);
    if (!virtualModel) return;

    const exists = virtualModel.targets.some(t => 
      t.providerId === providerId && t.modelId === modelId
    );

    if (exists) {
      alert('This model is already in the priority queue.');
      return;
    }

    const targets = [...virtualModel.targets, { providerId, modelId }];
    const updatedVms = localConfig.virtualModels.map(vm => 
      vm.id === vmId ? { ...vm, targets } : vm
    );

    commitConfig({ ...localConfig, virtualModels: updatedVms });
  };

  const handleStrategyChange = (vmId: string, strategy: string) => {
    const updatedVms = localConfig.virtualModels.map(vm => 
      vm.id === vmId ? { ...vm, strategy } : vm
    );
    commitConfig({ ...localConfig, virtualModels: updatedVms });
  };

  const handleStrategyConfigChange = (vmId: string, key: string, value: any) => {
    const updatedVms = localConfig.virtualModels.map(vm => {
      if (vm.id === vmId) {
        const configObj = { 
          maxRetries: 1,
          timeoutMs: 30000,
          cooldownMs: 60000,
          fallbackOn5xx: true,
          fallbackOn429: true,
          fallbackOn403: true,
          ...(vm.config || {}) 
        };
        (configObj as any)[key] = value;
        return { ...vm, config: configObj };
      }
      return vm;
    });
    commitConfig({ ...localConfig, virtualModels: updatedVms });
  };



  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Settings Options Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Active Routing Pools</h2>
          <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
            Map a virtual pool model (e.g. <code>strong-reasoning</code>) to a priority order of synced backends.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button type="button" className="primary" onClick={() => setShowAddVm(!showAddVm)}>
            {showAddVm ? 'Cancel' : 'Create Custom Pool'}
          </button>
        </div>
      </div>

      {/* Config parameters */}
      <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <input 
            type="checkbox" 
            id="rateLimitQueueEnabled" 
            checked={localConfig.rateLimitQueueEnabled !== false}
            onChange={(e) => commitConfig({ ...localConfig, rateLimitQueueEnabled: e.target.checked })}
          />
          <label htmlFor="rateLimitQueueEnabled" style={{ fontWeight: 600, cursor: 'pointer' }}>
            Enable Queue retry (Wait before returning failure if rate-limited)
          </label>
        </div>
        {localConfig.rateLimitQueueEnabled !== false && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginLeft: 'auto' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Max Queue Timeout (seconds):</label>
            <input 
              type="number" 
              min={1}
              max={300}
              value={((localConfig.rateLimitQueueTimeoutMs ?? 30000) / 1000)}
              onChange={(e) => commitConfig({ ...localConfig, rateLimitQueueTimeoutMs: (parseInt(e.target.value) || 30) * 1000 })}
              style={{ width: '80px', padding: '0.2rem 0.5rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '4px' }}
            />
          </div>
        )}
      </div>

      {/* Add New VM Pool Overlay */}
      {showAddVm && (
        <form onSubmit={handleCreateVirtualModel} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h4 style={{ margin: 0 }}>Create Virtual Pool Endpoint</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Identifier / ID (Used in Client API)</label>
              <input 
                type="text" 
                placeholder="e.g. coding-agent" 
                value={newVmId} 
                onChange={(e) => setNewVmId(e.target.value)} 
                required
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Display Name</label>
              <input 
                type="text" 
                placeholder="e.g. Smart Coding Assistant" 
                value={newVmName} 
                onChange={(e) => setNewVmName(e.target.value)} 
                required
              />
            </div>
          </div>
          <button type="submit" className="primary" style={{ alignSelf: 'flex-end' }}>Create Pool</button>
        </form>
      )}

      {/* Virtual Pools List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {localConfig.virtualModels.map((vm, index) => {
          const targetSelector = newTargets[vm.id] || { providerId: '', modelId: '' };
          const selectedProvider = localConfig.providers.find(p => p.id === targetSelector.providerId);
          
          return (
            <div key={index} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Pool Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <button type="button" onClick={() => setCollapsedPools(prev => ({ ...prev, [vm.id]: !prev[vm.id] }))} style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: '1.2rem', cursor: 'pointer', padding: '0.2rem' }}>
                    {collapsedPools[vm.id] ? '▶' : '▼'}
                  </button>
                  <div>
                    <input 
                      type="text" 
                      value={vm.name} 
                      onChange={(e) => {
                        const updatedVms = localConfig.virtualModels.map(model => 
                          model.id === vm.id ? { ...model, name: e.target.value } : model
                        );
                        commitConfig({ ...localConfig, virtualModels: updatedVms });
                      }}
                      style={{ 
                        margin: 0, 
                        fontSize: '1.15rem', 
                        fontWeight: 'bold', 
                        background: 'transparent', 
                        border: '1px solid transparent', 
                        color: 'inherit',
                        padding: '0 0.25rem',
                        borderRadius: '4px',
                        cursor: 'text'
                      }}
                      onFocus={(e) => e.target.style.border = '1px solid var(--border)'}
                      onBlur={(e) => e.target.style.border = '1px solid transparent'}
                      title="Click to edit pool name"
                    />
                    <div style={{ paddingLeft: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Client Model Identifier:</span>
                      <input 
                        type="text" 
                        value={vm.id} 
                        onChange={(e) => {
                          const newId = e.target.value.toLowerCase().replace(/\s+/g, '-');
                          
                          // Update all aliases that might point to this old ID
                          const newAliases = { ...(localConfig.aliases || {}) };
                          Object.keys(newAliases).forEach(aliasKey => {
                            if (newAliases[aliasKey] === vm.id) {
                              newAliases[aliasKey] = newId;
                            }
                          });

                          const updatedVms = localConfig.virtualModels.map(model => 
                            model.id === vm.id ? { ...model, id: newId } : model
                          );
                          commitConfig({ ...localConfig, virtualModels: updatedVms, aliases: newAliases });
                        }}
                        style={{ 
                          fontSize: '0.8rem', 
                          fontFamily: 'monospace',
                          background: 'transparent', 
                          border: '1px solid transparent', 
                          color: 'var(--text-muted)',
                          padding: '0 0.25rem',
                          borderRadius: '4px',
                          cursor: 'text'
                        }}
                        onFocus={(e) => e.target.style.border = '1px solid var(--border)'}
                        onBlur={(e) => e.target.style.border = '1px solid transparent'}
                        title="Click to edit pool ID"
                      />
                    </div>
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setExpandedConfigVmId(expandedConfigVmId === vm.id ? null : vm.id)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', background: expandedConfigVmId === vm.id ? 'var(--accent)' : 'transparent', color: expandedConfigVmId === vm.id ? '#000' : 'inherit', border: '1px solid var(--border)' }}>
                    ⚙️ Pool Settings
                  </button>
                  <button type="button" className="danger" onClick={() => handleDeleteVirtualModel(vm.id)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>
                    Delete
                  </button>
                </div>
              </div>

              {expandedConfigVmId === vm.id && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'oklch(17% 0.017 255.4 / 0.4)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Routing Strategy:</label>
                    <select 
                      value={vm.strategy || 'priority'}
                      onChange={(e) => handleStrategyChange(vm.id, e.target.value)}
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                    >
                      <option value="priority">Priority Failover</option>
                      <option value="random">Load Balanced (Random)</option>
                      <option value="latency">Fastest (Latency-Based)</option>
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Max Retry Attempts</label>
                        <input type="number" min={0} max={5} value={vm.config?.maxRetries ?? 1} onChange={(e) => handleStrategyConfigChange(vm.id, 'maxRetries', parseInt(e.target.value) || 0)} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Request Timeout (seconds)</label>
                        <input type="number" min={1} max={120} value={((vm.config?.timeoutMs ?? 30000) / 1000)} onChange={(e) => handleStrategyConfigChange(vm.id, 'timeoutMs', (parseInt(e.target.value) || 30) * 1000)} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Failure Cooldown (seconds)</label>
                        <input type="number" min={5} max={600} value={((vm.config?.cooldownMs ?? 60000) / 1000)} onChange={(e) => handleStrategyConfigChange(vm.id, 'cooldownMs', (parseInt(e.target.value) || 60) * 1000)} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input type="checkbox" id={`fallbackOn429-${vm.id}`} checked={vm.config?.fallbackOn429 !== false} onChange={(e) => handleStrategyConfigChange(vm.id, 'fallbackOn429', e.target.checked)} />
                        <label htmlFor={`fallbackOn429-${vm.id}`} style={{ fontSize: '0.8rem', cursor: 'pointer' }}>Fallback on Rate Limits (429)</label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input type="checkbox" id={`fallbackOn403-${vm.id}`} checked={vm.config?.fallbackOn403 !== false} onChange={(e) => handleStrategyConfigChange(vm.id, 'fallbackOn403', e.target.checked)} />
                        <label htmlFor={`fallbackOn403-${vm.id}`} style={{ fontSize: '0.8rem', cursor: 'pointer' }}>Fallback on Quota Exceeded (403)</label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input type="checkbox" id={`fallbackOn5xx-${vm.id}`} checked={vm.config?.fallbackOn5xx !== false} onChange={(e) => handleStrategyConfigChange(vm.id, 'fallbackOn5xx', e.target.checked)} />
                        <label htmlFor={`fallbackOn5xx-${vm.id}`} style={{ fontSize: '0.8rem', cursor: 'pointer' }}>Fallback on Server Errors (5xx / Network)</label>
                      </div>
                      <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>Rate Limit Cooldown Scope</label>
                        <select className="input" style={{ padding: '0.4rem', fontSize: '0.85rem' }} value={vm.config?.cooldownScope || 'provider'} onChange={(e) => handleStrategyConfigChange(vm.id, 'cooldownScope', e.target.value)}>
                          <option value="provider">Entire Provider (Default)</option>
                          <option value="model">Only the Specific Model</option>
                        </select>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>If "Specific Model", hitting a rate limit won't disable other models from the same provider.</span>
                      </div>
                    </div>
                  </div>

                  {/* Virtual Pool Rate Limits */}
                  <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                    <h5 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: 'var(--text)' }}>Global Pool Rate Limits</h5>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {renderPoolLimitUsage(vm.id, vm.limits, 'RPM (Req/Min)', 'rpm')}
                        <input type="number" min={1} className="input" placeholder="No limit" value={vm.limits?.rpm || ''} onChange={(e) => handlePoolLimitChange(vm.id, 'rpm', e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {renderPoolLimitUsage(vm.id, vm.limits, 'RPH (Req/Hour)', 'rph')}
                        <input type="number" min={1} className="input" placeholder="No limit" value={vm.limits?.rph || ''} onChange={(e) => handlePoolLimitChange(vm.id, 'rph', e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {renderPoolLimitUsage(vm.id, vm.limits, 'RPD (Req/Day)', 'rpd')}
                        <input type="number" min={1} className="input" placeholder="No limit" value={vm.limits?.rpd || ''} onChange={(e) => handlePoolLimitChange(vm.id, 'rpd', e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {renderPoolLimitUsage(vm.id, vm.limits, 'Req/Month', 'rpmo')}
                        <input type="number" min={1} className="input" placeholder="No limit" value={vm.limits?.rpmo || ''} onChange={(e) => handlePoolLimitChange(vm.id, 'rpmo', e.target.value)} />
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {renderPoolLimitUsage(vm.id, vm.limits, 'TPM (Tok/Min)', 'tpm')}
                        <input type="number" min={1} className="input" placeholder="No limit" value={vm.limits?.tpm || ''} onChange={(e) => handlePoolLimitChange(vm.id, 'tpm', e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {renderPoolLimitUsage(vm.id, vm.limits, 'TPH (Tok/Hour)', 'tph')}
                        <input type="number" min={1} className="input" placeholder="No limit" value={vm.limits?.tph || ''} onChange={(e) => handlePoolLimitChange(vm.id, 'tph', e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {renderPoolLimitUsage(vm.id, vm.limits, 'TPD (Tok/Day)', 'tpd')}
                        <input type="number" min={1} className="input" placeholder="No limit" value={vm.limits?.tpd || ''} onChange={(e) => handlePoolLimitChange(vm.id, 'tpd', e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {renderPoolLimitUsage(vm.id, vm.limits, 'Tok/Month', 'tpmo')}
                        <input type="number" min={1} className="input" placeholder="No limit" value={vm.limits?.tpmo || ''} onChange={(e) => handlePoolLimitChange(vm.id, 'tpmo', e.target.value)} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!collapsedPools[vm.id] && (
                <>

              {/* Priority Targets Table */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Priority Failover Order:</span>
                
                {/* Search & Filter Bar for existing targets */}
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
                    <input 
                      type="text" 
                      placeholder="Filter targets by model name/ID or provider name/ID..."
                      value={targetSearchQueries[vm.id] || ''}
                      onChange={(e) => setTargetSearchQueries({ ...targetSearchQueries, [vm.id]: e.target.value })}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '0.45rem 2rem 0.45rem 0.75rem', fontSize: '0.85rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', outline: 'none' }}
                    />
                    {targetSearchQueries[vm.id] && (
                      <button 
                        type="button"
                        title="Clear search"
                        onClick={() => setTargetSearchQueries({ ...targetSearchQueries, [vm.id]: '' })}
                        style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '0.2rem', lineHeight: 1 }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <select
                    value={targetFilters[vm.id] || 'all'}
                    onChange={(e) => setTargetFilters({ ...targetFilters, [vm.id]: e.target.value as 'all' | 'active' | 'inactive' })}
                    style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="all">All Targets</option>
                    <option value="active">✅ Active Only</option>
                    <option value="inactive">❌ Inactive Only</option>
                  </select>
                  {vm.targets.length > 0 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none', marginLeft: 'auto' }}>
                      <input
                        type="checkbox"
                        checked={(() => {
                          const filtered = getFilteredTargets(vm.id);
                          const sel = selectedTargets[vm.id] || new Set<number>();
                          return filtered.length > 0 && filtered.every(f => sel.has(f.originalIndex));
                        })()}
                        onChange={() => selectAllVisible(vm.id, getFilteredTargets(vm.id))}
                        style={{ cursor: 'pointer' }}
                      />
                      Select All
                    </label>
                  )}
                </div>
                
                {/* Bulk Action Toolbar — shown only when targets are selected */}
                {vm.targets.length > 0 && (selectedTargets[vm.id]?.size ?? 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'var(--accent-glow, rgba(120, 130, 255, 0.08))', border: '1px solid var(--accent)', borderRadius: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600, marginRight: '0.25rem' }}>
                      {selectedTargets[vm.id]!.size} selected
                    </span>
                    <button
                      type="button"
                      onClick={() => handleBulkSetEnabled(vm.id, [...selectedTargets[vm.id]!], true)}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'var(--success-glow)', color: 'var(--success)', border: '1px solid var(--success)', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      ✅ Activate
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkSetEnabled(vm.id, [...selectedTargets[vm.id]!], false)}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'var(--warning-glow, rgba(255, 180, 0, 0.1))', color: 'var(--warning, #f0a020)', border: '1px solid var(--warning, #f0a020)', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      ⏸️ Deactivate
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        const count = selectedTargets[vm.id]!.size;
                        if (confirm(`Remove ${count} target(s) from this pool? (Undo available via Ctrl+Z)`)) {
                          handleBulkRemoveTargets(vm.id, [...selectedTargets[vm.id]!]);
                        }
                      }}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      🗑️ Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => clearSelection(vm.id)}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', marginLeft: 'auto' }}
                    >
                      Clear Selection
                    </button>
                  </div>
                )}
                
                {vm.targets.length === 0 ? (
                  <div style={{ padding: '1.5rem', border: '1px dashed var(--border)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    No targets added. Requests to <code>{vm.id}</code> will fail.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {getFilteredTargets(vm.id).map(({ target, originalIndex }) => {
                      const index = originalIndex;
                      const provider = localConfig.providers.find(p => p.id === target.providerId);
                      const modelObj = provider?.models.find(m => m.id === target.modelId);
                      const isMissing = provider && !modelObj;
                      
                      return (
                        <div key={index} style={{ display: 'flex', flexDirection: 'column' }}>
                          <div 
                            draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', index.toString());
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                            handleDragDropTarget(vm.id, fromIndex, index);
                          }}
                          style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.75rem 1rem',
                          background: isMissing ? 'oklch(20% 0.05 25 / 0.3)' : 'oklch(20% 0.018 255.4 / 0.3)',
                          border: isMissing ? '1px dashed var(--error)' : '1px solid var(--border)',
                          borderRadius: '8px',
                          opacity: target.enabled !== false ? 1 : 0.5,
                          cursor: 'grab'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                            <span style={{ cursor: 'grab', fontSize: '1.2rem', color: 'var(--text-muted)' }}>☰</span>
                            <input
                              type="checkbox"
                              checked={selectedTargets[vm.id]?.has(index) || false}
                              onChange={() => toggleTargetSelection(vm.id, index)}
                              onClick={(e) => e.stopPropagation()}
                              title="Select for bulk actions"
                              style={{ cursor: 'pointer', width: '1rem', height: '1rem', flexShrink: 0 }}
                            />
                            <span style={{ fontWeight: 800, color: 'var(--accent)', fontSize: '1.1rem' }}>Priority #{index + 1}</span>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: 600, color: isMissing ? 'var(--error)' : 'inherit' }}>
                                {modelObj?.name || target.modelId} {isMissing && <span style={{ fontSize: '0.75rem', background: 'var(--error)', color: '#fff', padding: '0.1rem 0.3rem', borderRadius: '4px', marginLeft: '0.5rem' }}>⚠️ Removed from Provider</span>}
                              </span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Provider: {provider?.name || target.providerId}</span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginRight: '0.5rem' }}>
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} title="Override the pool's default timeout for this specific model">Timeout (s):</label>
                              <input 
                                type="number" 
                                min={1}
                                placeholder="Auto"
                                value={target.timeoutMs ? target.timeoutMs / 1000 : ''}
                                onChange={(e) => handleTargetTimeoutChange(vm.id, index, e.target.value)}
                                style={{ width: '60px', padding: '0.2rem 0.4rem', fontSize: '0.75rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '4px' }}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleToggleTargetEnabled(vm.id, index)}
                              style={{ 
                                padding: '0.3rem 0.6rem', 
                                fontSize: '0.75rem', 
                                background: target.enabled !== false ? 'var(--success-glow)' : 'var(--error-glow)',
                                color: target.enabled !== false ? 'var(--success)' : 'var(--error)',
                                border: `1px solid ${target.enabled !== false ? 'var(--success)' : 'var(--error)'}`
                              }}
                            >
                              {target.enabled !== false ? '✅ Active' : '❌ Disabled'}
                            </button>
                            <button 
                              type="button" 
                              title="Advanced Settings (Cooldown & Rate Limits)"
                              onClick={() => setExpandedTargetSettings(prev => ({ ...prev, [vm.id]: prev[vm.id] === index ? null : index }))}
                              style={{ 
                                padding: '0.3rem 0.6rem', 
                                fontSize: '0.9rem', 
                                background: expandedTargetSettings[vm.id] === index ? 'var(--accent)' : 'transparent',
                                border: '1px solid var(--border)',
                                color: expandedTargetSettings[vm.id] === index ? '#000' : 'inherit'
                              }}
                            >
                              ⚙️
                            </button>
                            <button 
                              type="button" 
                              className="danger" 
                              onClick={() => handleRemoveTarget(vm.id, index)}
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        {expandedTargetSettings[vm.id] === index && (
                          <div style={{
                            margin: '0.5rem 0 1rem 2.5rem',
                            padding: '1rem',
                            background: '#0d0d12',
                            border: '1px solid var(--border)',
                            borderLeft: '2px solid var(--accent)',
                            borderRadius: '4px'
                          }}>
                            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text)' }}>
                              Advanced Overrides for {modelObj?.name || target.modelId}
                            </h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Custom Cooldown (seconds)</label>
                                <input 
                                  type="number" 
                                  className="input"
                                  min={1}
                                  placeholder="Use Pool Default"
                                  value={target.cooldownMs ? target.cooldownMs / 1000 : ''}
                                  onChange={(e) => handleTargetCooldownChange(vm.id, index, e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                />
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Concurrency Limit</label>
                                <input 
                                  type="number" 
                                  className="input"
                                  min={1}
                                  placeholder="No override"
                                  value={target.limits?.concurrent || ''}
                                  onChange={(e) => handleTargetLimitChange(vm.id, index, 'concurrent', e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                />
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                {renderModelLimitUsage(target.providerId, target.modelId, target.limits, 'Requests Per Minute (RPM)', 'rpm')}
                                <input type="number" className="input" min={1} placeholder="No override"
                                  value={target.limits?.rpm || ''} onChange={(e) => handleTargetLimitChange(vm.id, index, 'rpm', e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                {renderModelLimitUsage(target.providerId, target.modelId, target.limits, 'Requests Per Hour (RPH)', 'rph')}
                                <input type="number" className="input" min={1} placeholder="No override"
                                  value={target.limits?.rph || ''} onChange={(e) => handleTargetLimitChange(vm.id, index, 'rph', e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                {renderModelLimitUsage(target.providerId, target.modelId, target.limits, 'Requests Per Day (RPD)', 'rpd')}
                                <input type="number" className="input" min={1} placeholder="No override"
                                  value={target.limits?.rpd || ''} onChange={(e) => handleTargetLimitChange(vm.id, index, 'rpd', e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                {renderModelLimitUsage(target.providerId, target.modelId, target.limits, 'Requests Per Month', 'rpmo')}
                                <input type="number" className="input" min={1} placeholder="No override"
                                  value={target.limits?.rpmo || ''} onChange={(e) => handleTargetLimitChange(vm.id, index, 'rpmo', e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                {renderModelLimitUsage(target.providerId, target.modelId, target.limits, 'Tokens Per Minute (TPM)', 'tpm')}
                                <input type="number" className="input" min={1} placeholder="No override"
                                  value={target.limits?.tpm || ''} onChange={(e) => handleTargetLimitChange(vm.id, index, 'tpm', e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                {renderModelLimitUsage(target.providerId, target.modelId, target.limits, 'Tokens Per Hour (TPH)', 'tph')}
                                <input type="number" className="input" min={1} placeholder="No override"
                                  value={target.limits?.tph || ''} onChange={(e) => handleTargetLimitChange(vm.id, index, 'tph', e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                {renderModelLimitUsage(target.providerId, target.modelId, target.limits, 'Tokens Per Day (TPD)', 'tpd')}
                                <input type="number" className="input" min={1} placeholder="No override"
                                  value={target.limits?.tpd || ''} onChange={(e) => handleTargetLimitChange(vm.id, index, 'tpd', e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                {renderModelLimitUsage(target.providerId, target.modelId, target.limits, 'Tokens Per Month', 'tpmo')}
                                <input type="number" className="input" min={1} placeholder="No override"
                                  value={target.limits?.tpmo || ''} onChange={(e) => handleTargetLimitChange(vm.id, index, 'tpmo', e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                              </div>

                            </div>
                          </div>
                        )}
                      </div>
                    );
                    })}
                  </div>
                )}
              </div>



              {/* Add New Target Selector Row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', marginTop: '0.5rem', background: 'oklch(15% 0.015 255.4 / 0.4)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                
                {/* Select Provider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1, minWidth: '150px' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Add Target Provider</label>
                  <select 
                    value={targetSelector.providerId}
                    onChange={(e) => handleTargetSelectorChange(vm.id, 'providerId', e.target.value)}
                  >
                    <option value="">Select Provider...</option>
                    {localConfig.providers.filter(p => p.enabled).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* Select Model */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1, minWidth: '150px' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Target Model (Select or Type ID)</label>
                  <input 
                    type="text"
                    list={`model-list-${vm.id}`}
                    value={targetSelector.modelId}
                    onChange={(e) => handleTargetSelectorChange(vm.id, 'modelId', e.target.value)}
                    disabled={!targetSelector.providerId}
                    placeholder="e.g. gpt-4o or meta/llama3..."
                    style={{ padding: '0.45rem', fontSize: '0.85rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px' }}
                  />
                  <datalist id={`model-list-${vm.id}`}>
                    {selectedProvider?.models?.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    ))}
                  </datalist>
                </div>

                <button 
                  type="button" 
                  className="primary" 
                  disabled={!targetSelector.providerId || !targetSelector.modelId}
                  onClick={() => handleAddTarget(vm.id)}
                  style={{ height: '38px', padding: '0 1.25rem' }}
                >
                  + Add to Queue
                </button>
              </div>

              {/* Search & Batch Import Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem', background: 'oklch(17% 0.017 255.4 / 0.4)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Search & Batch Import from All Enabled Providers:</label>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <input 
                    type="text" 
                    placeholder="Search model name/ID across all providers... (e.g. gemini, llama)"
                    value={searchQueries[vm.id] || ''}
                    onChange={(e) => setSearchQueries({ ...searchQueries, [vm.id]: e.target.value })}
                    style={{ flex: 1, padding: '0.45rem', fontSize: '0.85rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', outline: 'none' }}
                  />
                  {searchQueries[vm.id] && (
                    <button 
                      type="button" 
                      onClick={() => setSearchQueries({ ...searchQueries, [vm.id]: '' })}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                
                {/* Search Results */}
                {(() => {
                  const query = searchQueries[vm.id] || '';
                  if (!query.trim()) return null;
                  const results = getSearchResultsForPool(query);
                  if (results.length === 0) {
                    return <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No matching models found.</div>;
                  }
                  
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Found {results.length} matching models:</span>
                        <button 
                          type="button" 
                          className="primary"
                          onClick={() => handleImportAllMatches(vm.id, results)}
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                        >
                          🚀 Import All {results.length} Models
                        </button>
                      </div>
                      
                      <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingRight: '0.25rem' }}>
                        {results.map((r, idx) => {
                          const isAdded = vm.targets.some(t => t.providerId === r.providerId && t.modelId === r.modelId);
                          return (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0.5rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: isAdded ? 'var(--text-muted)' : '#c5c9db' }}>{r.modelName}</span>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ID: <code>{r.modelId}</code> | Provider: {r.providerName}</span>
                              </div>
                              <button 
                                type="button" 
                                disabled={isAdded}
                                onClick={() => handleAddSingleTarget(vm.id, r.providerId, r.modelId)}
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
                              >
                                {isAdded ? 'Added' : '+ Add'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
              
              </>
              )}

            </div>
          );
        })}
      </div>

      {/* Model Redirection Rules Card */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
          <h4 style={{ margin: 0, fontSize: '1.15rem' }}>Model Redirection & Aliases</h4>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Map legacy client model requests (e.g., <code>gpt-4</code>) on-the-fly to your local routing pools.
          </span>
        </div>

        {/* Existing Aliases Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {!localConfig.aliases || Object.keys(localConfig.aliases).length === 0 ? (
            <div style={{ padding: '1.5rem', border: '1px dashed var(--border)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              No redirection rules defined.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {Object.entries(localConfig.aliases).map(([reqName, targetName]) => (
                <div key={reqName} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  background: 'oklch(20% 0.018 255.4 / 0.3)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Requested:</span>
                    <strong style={{ fontFamily: 'monospace', fontSize: '0.95rem' }}>{reqName}</strong>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>➔ Redirects to:</span>
                    <strong style={{ color: 'var(--accent)', fontFamily: 'monospace', fontSize: '0.95rem' }}>{targetName}</strong>
                  </div>

                  <button 
                    type="button" 
                    className="danger" 
                    onClick={() => handleRemoveAlias(reqName)}
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                  >
                    Delete Rule
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add New Alias Rule Row */}
        <div style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: '0.75rem', 
          alignItems: 'flex-end', 
          background: 'oklch(15% 0.015 255.4 / 0.4)', 
          padding: '1rem', 
          borderRadius: '8px', 
          border: '1px solid var(--border)' 
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1, minWidth: '150px' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Incoming Request Model Name</label>
            <input 
              type="text" 
              placeholder="e.g. gpt-4, claude-3-5-sonnet"
              value={newAliasRequestName}
              onChange={(e) => setNewAliasRequestName(e.target.value)}
              style={{ padding: '0.4rem', fontSize: '0.85rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1, minWidth: '150px' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Target Routing Pool / Model</label>
            <select
              value={newAliasTargetModel}
              onChange={(e) => setNewAliasTargetModel(e.target.value)}
              style={{ padding: '0.4rem', fontSize: '0.85rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', outline: 'none' }}
            >
              <option value="">Select Target...</option>
              {availableTargetModels.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <button 
            type="button" 
            className="primary" 
            disabled={!newAliasRequestName.trim() || !newAliasTargetModel}
            onClick={handleAddAlias}
            style={{ height: '38px', padding: '0 1.25rem' }}
          >
            + Add Redirect Rule
          </button>
        </div>
      </div>

      {/* Semantic Cache Settings Card */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
          <h4 style={{ margin: 0, fontSize: '1.15rem' }}>Local Semantic Caching</h4>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Intercept requests matching semantically similar questions and return cached responses instantly.
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <input 
              type="checkbox" 
              id="semanticCacheEnabled" 
              checked={localConfig.semanticCacheEnabled === true}
              onChange={(e) => commitConfig({ ...localConfig, semanticCacheEnabled: e.target.checked })}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="semanticCacheEnabled" style={{ fontWeight: 600, cursor: 'pointer' }}>
              Enable Semantic Prompt Caching
            </label>
          </div>

          {localConfig.semanticCacheEnabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'oklch(15% 0.015 255.4 / 0.4)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Similarity Match Threshold:</span>
                <strong style={{ color: 'var(--accent)' }}>
                  {Math.round((localConfig.semanticCacheThreshold || 0.92) * 100)}%
                </strong>
              </div>
              <input 
                type="range" 
                min="0.80" 
                max="0.99" 
                step="0.01" 
                value={localConfig.semanticCacheThreshold || 0.92}
                onChange={(e) => commitConfig({ ...localConfig, semanticCacheThreshold: parseFloat(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer', margin: 0 }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Higher thresholds require a closer query text match. Values around 90-95% are recommended.
              </span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Cache Database Size: <strong style={{ color: '#c5c9db' }}>{cacheSize} entries</strong>
            </span>
            <button 
              type="button" 
              disabled={cacheSize === 0}
              onClick={handleClearCache}
              style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }}
            >
              Clear Cache Database
            </button>
          </div>
        </div>
      </div>



    </div>
  );
};
