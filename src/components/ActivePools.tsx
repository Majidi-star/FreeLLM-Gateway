import React, { useState } from 'react';
import type { GatewayConfig, VirtualModel } from '../utils/api';

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(localConfig);
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

      {/* Save Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '1.5rem', marginBottom: '2rem' }}>
        <button type="submit" className="primary" onClick={handleSubmit} style={{ padding: '0.8rem 2rem', fontSize: '1rem' }}>
          Save Pools Configuration
        </button>
      </div>

    </div>
  );
};
