import React, { useState, useEffect } from 'react';
import type { GatewayConfig, VirtualModel } from '../utils/api';
import { getCacheStats, clearCacheDatabase } from '../utils/api';

interface ActivePoolsProps {
  config: GatewayConfig;
  onSave: (config: GatewayConfig) => void;
}

export const ActivePools: React.FC<ActivePoolsProps> = ({ config, onSave }) => {
  const [localConfig, setLocalConfig] = useState<GatewayConfig>({ ...config });
  
  // Custom Virtual Model Creator State
  const [newVmId, setNewVmId] = useState('');
  const [newVmName, setNewVmName] = useState('');
  const [showAddVm, setShowAddVm] = useState(false);

  // New Target Selector State (virtualModelId -> { selectedProviderId, selectedModelId })
  const [newTargets, setNewTargets] = useState<{ [key: string]: { providerId: string; modelId: string } }>({});

  // Collapsible configuration panels state
  const [expandedConfigVmId, setExpandedConfigVmId] = useState<string | null>(null);

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
    setLocalConfig({
      ...localConfig,
      aliases: updatedAliases
    });
    setNewAliasRequestName('');
  };

  const handleRemoveAlias = (requestName: string) => {
    const currentAliases = { ...(localConfig.aliases || {}) };
    delete currentAliases[requestName];
    setLocalConfig({
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

  const handleMoveTarget = (vmId: string, index: number, direction: 'up' | 'down') => {
    const virtualModel = localConfig.virtualModels.find(vm => vm.id === vmId);
    if (!virtualModel) return;

    const targets = [...virtualModel.targets];
    const targetIndex = index;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;

    if (swapIndex < 0 || swapIndex >= targets.length) return;

    // Swap elements
    const temp = targets[targetIndex];
    targets[targetIndex] = targets[swapIndex];
    targets[swapIndex] = temp;

    const updatedVms = localConfig.virtualModels.map(vm => 
      vm.id === vmId ? { ...vm, targets } : vm
    );

    setLocalConfig({ ...localConfig, virtualModels: updatedVms });
  };

  const handleRemoveTarget = (vmId: string, index: number) => {
    const virtualModel = localConfig.virtualModels.find(vm => vm.id === vmId);
    if (!virtualModel) return;

    const targets = virtualModel.targets.filter((_, idx) => idx !== index);
    const updatedVms = localConfig.virtualModels.map(vm => 
      vm.id === vmId ? { ...vm, targets } : vm
    );

    setLocalConfig({ ...localConfig, virtualModels: updatedVms });
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

    setLocalConfig({ ...localConfig, virtualModels: updatedVms });

    // Reset selector state for this pool
    setNewTargets({
      ...newTargets,
      [vmId]: { providerId: '', modelId: '' }
    });
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

    setLocalConfig({
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
    setLocalConfig({ ...localConfig, virtualModels: updated });
  };

  const handleTargetSelectorChange = (vmId: string, field: 'providerId' | 'modelId', value: string) => {
    const current = newTargets[vmId] || { providerId: '', modelId: '' };
    const updated = { ...current, [field]: value };
    
    if (field === 'providerId') {
      updated.modelId = ''; // Reset model selection
    }

    setNewTargets({ ...newTargets, [vmId]: updated });
  };

  const handleStrategyChange = (vmId: string, strategy: string) => {
    const updatedVms = localConfig.virtualModels.map(vm => 
      vm.id === vmId ? { ...vm, strategy } : vm
    );
    setLocalConfig({ ...localConfig, virtualModels: updatedVms });
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
    setLocalConfig({ ...localConfig, virtualModels: updatedVms });
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
        <button type="button" className="primary" onClick={() => setShowAddVm(!showAddVm)}>
          {showAddVm ? 'Cancel' : 'Create Custom Pool'}
        </button>
      </div>

      {/* Config parameters */}
      <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <input 
          type="checkbox" 
          id="rateLimitQueueEnabled" 
          checked={localConfig.rateLimitQueueEnabled !== false}
          onChange={(e) => setLocalConfig({ ...localConfig, rateLimitQueueEnabled: e.target.checked })}
        />
        <label htmlFor="rateLimitQueueEnabled" style={{ fontWeight: 600, cursor: 'pointer' }}>
          Enable Queue retry (If all priority backends are rate-limited, wait up to 30s before returning failure)
        </label>
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
        {localConfig.virtualModels.map((vm) => {
          const targetSelector = newTargets[vm.id] || { providerId: '', modelId: '' };
          const selectedProvider = localConfig.providers.find(p => p.id === targetSelector.providerId);
          
          return (
            <div key={vm.id} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Pool Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.15rem' }}>{vm.name}</h4>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Client Model Identifier: <code>{vm.id}</code></span>
                </div>
                
                <button type="button" className="danger" onClick={() => handleDeleteVirtualModel(vm.id)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>
                  Delete Pool
                </button>
              </div>

              {/* Priority Targets Table */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Priority Failover Order:</span>
                
                {vm.targets.length === 0 ? (
                  <div style={{ padding: '1.5rem', border: '1px dashed var(--border)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    No targets added. Requests to <code>{vm.id}</code> will fail.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {vm.targets.map((target, index) => {
                      const provider = localConfig.providers.find(p => p.id === target.providerId);
                      const modelObj = provider?.models.find(m => m.id === target.modelId);
                      
                      return (
                        <div key={index} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.75rem 1rem',
                          background: 'oklch(20% 0.018 255.4 / 0.3)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                            <span style={{ fontWeight: 800, color: 'var(--accent)', fontSize: '1.1rem' }}>Priority #{index + 1}</span>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: 600 }}>{modelObj?.name || target.modelId}</span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Provider: {provider?.name || target.providerId}</span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button 
                              type="button" 
                              disabled={index === 0}
                              onClick={() => handleMoveTarget(vm.id, index, 'up')}
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                            >
                              ▲ Up
                            </button>
                            <button 
                              type="button" 
                              disabled={index === vm.targets.length - 1}
                              onClick={() => handleMoveTarget(vm.id, index, 'down')}
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                            >
                              ▼ Down
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
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Fallback Strategy Config Panel */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'oklch(17% 0.017 255.4 / 0.4)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Routing Strategy:</label>
                    <select 
                      value={vm.strategy || 'priority'}
                      onChange={(e) => handleStrategyChange(vm.id, e.target.value)}
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                    >
                      <option value="priority">Priority Failover</option>
                      <option value="random">Load Balanced (Random)</option>
                    </select>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setExpandedConfigVmId(expandedConfigVmId === vm.id ? null : vm.id)}
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                  >
                    {expandedConfigVmId === vm.id ? 'Hide Settings' : '⚙️ Custom Failover Settings'}
                  </button>
                </div>

                {expandedConfigVmId === vm.id && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                    {/* Numeric parameters */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Max Retry Attempts</label>
                        <input 
                          type="number" 
                          min={0}
                          max={5}
                          value={vm.config?.maxRetries ?? 1}
                          onChange={(e) => handleStrategyConfigChange(vm.id, 'maxRetries', parseInt(e.target.value) || 0)}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Request Timeout (seconds)</label>
                        <input 
                          type="number" 
                          min={1}
                          max={120}
                          value={((vm.config?.timeoutMs ?? 30000) / 1000)}
                          onChange={(e) => handleStrategyConfigChange(vm.id, 'timeoutMs', (parseInt(e.target.value) || 30) * 1000)}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Failure Cooldown (seconds)</label>
                        <input 
                          type="number" 
                          min={5}
                          max={600}
                          value={((vm.config?.cooldownMs ?? 60000) / 1000)}
                          onChange={(e) => handleStrategyConfigChange(vm.id, 'cooldownMs', (parseInt(e.target.value) || 60) * 1000)}
                        />
                      </div>
                    </div>

                    {/* Checkboxes */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input 
                          type="checkbox" 
                          id={`fallbackOn429-${vm.id}`}
                          checked={vm.config?.fallbackOn429 !== false}
                          onChange={(e) => handleStrategyConfigChange(vm.id, 'fallbackOn429', e.target.checked)}
                        />
                        <label htmlFor={`fallbackOn429-${vm.id}`} style={{ fontSize: '0.8rem', cursor: 'pointer' }}>Fallback on Rate Limits (429)</label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input 
                          type="checkbox" 
                          id={`fallbackOn403-${vm.id}`}
                          checked={vm.config?.fallbackOn403 !== false}
                          onChange={(e) => handleStrategyConfigChange(vm.id, 'fallbackOn403', e.target.checked)}
                        />
                        <label htmlFor={`fallbackOn403-${vm.id}`} style={{ fontSize: '0.8rem', cursor: 'pointer' }}>Fallback on Quota Exceeded (403)</label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input 
                          type="checkbox" 
                          id={`fallbackOn5xx-${vm.id}`}
                          checked={vm.config?.fallbackOn5xx !== false}
                          onChange={(e) => handleStrategyConfigChange(vm.id, 'fallbackOn5xx', e.target.checked)}
                        />
                        <label htmlFor={`fallbackOn5xx-${vm.id}`} style={{ fontSize: '0.8rem', cursor: 'pointer' }}>Fallback on Server Errors (5xx / Network)</label>
                      </div>
                    </div>
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
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Target Model (Synced)</label>
                  <select 
                    value={targetSelector.modelId}
                    onChange={(e) => handleTargetSelectorChange(vm.id, 'modelId', e.target.value)}
                    disabled={!targetSelector.providerId}
                  >
                    <option value="">Select Model...</option>
                    {selectedProvider?.models?.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    ))}
                  </select>
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
              onChange={(e) => setLocalConfig({ ...localConfig, semanticCacheEnabled: e.target.checked })}
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
                onChange={(e) => setLocalConfig({ ...localConfig, semanticCacheThreshold: parseFloat(e.target.value) })}
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
