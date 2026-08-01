import React, { useState } from 'react';
import { testProvider, syncProviderModels } from '../utils/api';
import type { Provider, GatewayConfig } from '../utils/api';

interface GatewaySetupProps {
  config: GatewayConfig;
  onSave: (config: GatewayConfig) => void;
}

export const GatewaySetup: React.FC<GatewaySetupProps> = ({ config, onSave }) => {
  const [localConfig, setLocalConfig] = useState<GatewayConfig>({ ...config });
  
  // Custom Provider Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProv, setNewProv] = useState({
    id: '',
    name: '',
    category: 'Permanent Free',
    baseUrl: '',
    apiKey: '',
    proxyEnabled: false,
    proxyUrl: '',
    website: '',
    signupUrl: '',
    creditsDescription: '',
    limitsDescription: ''
  });

  // Action status trackers
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  
  // Track expanded configuration drawers (providerId -> boolean)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<{ [key: string]: boolean }>({});

  const handleProviderToggle = (id: string, enabled: boolean) => {
    const updated = localConfig.providers.map((p) => 
      p.id === id ? { ...p, enabled } : p
    );
    const newConf = { ...localConfig, providers: updated };
    setLocalConfig(newConf);
    onSave(newConf);
  };

  const handleProviderChange = (id: string, field: keyof Provider, value: any) => {
    const updated = localConfig.providers.map((p) => 
      p.id === id ? { ...p, [field]: value } : p
    );
    setLocalConfig({ ...localConfig, providers: updated });
  };

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys({ ...visibleKeys, [id]: !visibleKeys[id] });
  };

  const handleTestConnection = async (provider: Provider) => {
    setTestingId(provider.id);
    setActionResult(null);
    const testModelId = provider.models[0]?.id || 'test';

    try {
      const res = await testProvider({
        providerId: provider.id,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        proxyEnabled: provider.proxyEnabled,
        proxyUrl: provider.proxyUrl,
        testModelId
      });
      setActionResult({ id: provider.id, success: res.success, message: res.message });
    } catch (err: any) {
      setActionResult({ id: provider.id, success: false, message: err.message || 'Verification failed.' });
    } finally {
      setTestingId(null);
    }
  };

  const handleSyncModels = async (provider: Provider) => {
    setSyncingId(provider.id);
    setActionResult(null);

    try {
      const res = await syncProviderModels(provider.id, {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        proxyEnabled: provider.proxyEnabled,
        proxyUrl: provider.proxyUrl
      });
      
      const updatedProviders = localConfig.providers.map((p) => 
        p.id === provider.id ? { ...p, models: res.models } : p
      );
      
      const newConfig = { ...localConfig, providers: updatedProviders };
      setLocalConfig(newConfig);
      onSave(newConfig);
      
      setActionResult({ 
        id: provider.id, 
        success: true, 
        message: `Successfully synced ${res.models.length} models!` 
      });
    } catch (err: any) {
      setActionResult({ 
        id: provider.id, 
        success: false, 
        message: `Sync failed: ${err.message || 'Check Base URL or API key.'}` 
      });
    } finally {
      setSyncingId(null);
    }
  };

  const handleDeleteProvider = (id: string) => {
    if (!confirm('Are you sure you want to delete this provider? This will remove it from the directory and virtual pools.')) return;
    
    const updated = localConfig.providers.filter(p => p.id !== id);
    const newConf = { ...localConfig, providers: updated };
    setLocalConfig(newConf);
    onSave(newConf);
    
    if (expandedId === id) setExpandedId(null);
    alert('Provider deleted successfully.');
  };

  const handleCreateCustomProvider = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProv.id || !newProv.name || !newProv.baseUrl) {
      alert('ID, Name, and Base URL are required.');
      return;
    }

    const cleanId = newProv.id.toLowerCase().trim().replace(/\s+/g, '-');
    if (localConfig.providers.some(p => p.id === cleanId)) {
      alert('A provider with this ID already exists.');
      return;
    }

    const created: Provider = {
      id: cleanId,
      name: newProv.name.trim(),
      enabled: true,
      apiKey: newProv.apiKey,
      baseUrl: newProv.baseUrl.trim(),
      proxyEnabled: newProv.proxyEnabled,
      proxyUrl: newProv.proxyUrl.trim(),
      category: newProv.category,
      website: newProv.website.trim(),
      signupUrl: newProv.signupUrl.trim(),
      creditsDescription: newProv.creditsDescription.trim() || 'Custom user provider.',
      limitsDescription: newProv.limitsDescription.trim() || 'User defined limits.',
      models: []
    };

    const newConf = {
      ...localConfig,
      providers: [...localConfig.providers, created]
    };

    setLocalConfig(newConf);
    onSave(newConf);

    // Reset Form
    setNewProv({
      id: '',
      name: '',
      category: 'Permanent Free',
      baseUrl: '',
      apiKey: '',
      proxyEnabled: false,
      proxyUrl: '',
      website: '',
      signupUrl: '',
      creditsDescription: '',
      limitsDescription: ''
    });
    setShowAddForm(false);
    alert(`Custom provider "${created.name}" created successfully! Click expand to sync its models.`);
  };

  const handleGlobalProxySave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(localConfig);
    alert('Global settings saved!');
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
    setActionResult(null);
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Global Proxy Settings */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '1rem', marginTop: 0 }}>
          Global Proxy Tunnel (HTTP / SOCKS5)
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <input 
              type="checkbox" 
              id="globalProxyEnabled" 
              checked={localConfig.globalProxyEnabled}
              onChange={(e) => setLocalConfig({ ...localConfig, globalProxyEnabled: e.target.checked })}
            />
            <label htmlFor="globalProxyEnabled" style={{ fontWeight: 600, cursor: 'pointer' }}>Enable Global Proxy</label>
          </div>
          
          {localConfig.globalProxyEnabled && (
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input 
                type="text" 
                placeholder="e.g. socks5://127.0.0.1:1080 or http://proxy:8080" 
                value={localConfig.globalProxy}
                onChange={(e) => setLocalConfig({ ...localConfig, globalProxy: e.target.value })}
                style={{ flex: 1 }}
              />
              <button type="button" className="primary" onClick={handleGlobalProxySave}>Save Proxy</button>
            </div>
          )}
        </div>
      </div>

      {/* Header with "+ Add custom provider" button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Manage API Providers</h3>
        <button type="button" className="primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : '+ Add Custom Provider'}
        </button>
      </div>

      {/* Add Custom Provider Form drawer */}
      {showAddForm && (
        <form onSubmit={handleCreateCustomProvider} className="glass-panel animate-fade-in" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <h4 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--accent)' }}>Add Custom Provider Endpoint</h4>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Unique ID (lowercase, no spaces)</label>
              <input 
                type="text" 
                placeholder="e.g. local-ollama" 
                value={newProv.id} 
                onChange={(e) => setNewProv({ ...newProv, id: e.target.value })}
                required
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Provider Name</label>
              <input 
                type="text" 
                placeholder="e.g. Local Ollama Service" 
                value={newProv.name} 
                onChange={(e) => setNewProv({ ...newProv, name: e.target.value })}
                required
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Category</label>
              <select 
                value={newProv.category}
                onChange={(e) => setNewProv({ ...newProv, category: e.target.value })}
              >
                <option value="Permanent Free">Permanent Free</option>
                <option value="Trial Credits">Trial Credits</option>
                <option value="Paid Providers">Paid Providers</option>
                <option value="Custom Local">Custom Local</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Base Endpoint Address URL</label>
              <input 
                type="text" 
                placeholder="e.g. http://localhost:11434/v1" 
                value={newProv.baseUrl} 
                onChange={(e) => setNewProv({ ...newProv, baseUrl: e.target.value })}
                required
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>API Key (if required)</label>
              <input 
                type="text" 
                placeholder="Key string" 
                value={newProv.apiKey} 
                onChange={(e) => setNewProv({ ...newProv, apiKey: e.target.value })}
              />
            </div>
          </div>

          {/* Description details for the Directory tab */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Credits / Pricing Description</label>
              <input 
                type="text" 
                placeholder="e.g. Free local host" 
                value={newProv.creditsDescription} 
                onChange={(e) => setNewProv({ ...newProv, creditsDescription: e.target.value })}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Rate Limits Description</label>
              <input 
                type="text" 
                placeholder="e.g. Unlimited" 
                value={newProv.limitsDescription} 
                onChange={(e) => setNewProv({ ...newProv, limitsDescription: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button type="submit" className="primary">Create Provider</button>
          </div>
        </form>
      )}

      {/* Providers Management List */}
      <div className="glass-panel" style={{ padding: '0.5rem', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ padding: '0.75rem 1rem', width: '50px' }}>Active</th>
              <th style={{ padding: '0.75rem 1rem' }}>Provider</th>
              <th style={{ padding: '0.75rem 1rem' }}>Base Endpoint URL</th>
              <th style={{ padding: '0.75rem 1rem', width: '150px' }}>Synced Models</th>
              <th style={{ padding: '0.75rem 1rem', width: '250px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {localConfig.providers.map((provider) => {
              const isExpanded = expandedId === provider.id;
              const isVisible = visibleKeys[provider.id] || false;
              const isTesting = testingId === provider.id;
              const isSyncing = syncingId === provider.id;
              const hasResult = actionResult?.id === provider.id;
              const modelCount = provider.models?.length || 0;

              return (
                <React.Fragment key={provider.id}>
                  {/* Standard Row */}
                  <tr style={{ 
                    borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                    background: isExpanded ? 'oklch(15% 0.015 255.4 / 0.3)' : 'transparent',
                    transition: 'background 0.2s'
                  }}>
                    {/* Toggle */}
                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                      <input 
                        type="checkbox" 
                        checked={provider.enabled} 
                        onChange={(e) => handleProviderToggle(provider.id, e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    {/* Name */}
                    <td style={{ padding: '1rem', fontWeight: 700 }}>{provider.name}</td>
                    {/* URL */}
                    <td style={{ padding: '1rem', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {provider.baseUrl}
                    </td>
                    {/* Model Count */}
                    <td style={{ padding: '1rem' }}>
                      <span style={{ 
                        color: modelCount > 0 ? 'var(--success)' : 'var(--error)',
                        fontWeight: 700,
                        fontSize: '0.85rem'
                      }}>
                        {modelCount > 0 ? `${modelCount} models` : '0 synced'}
                      </span>
                    </td>
                    {/* Actions Row */}
                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        <button 
                          type="button" 
                          onClick={() => toggleExpand(provider.id)}
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                        >
                          {isExpanded ? 'Collapse' : 'Configure'}
                        </button>
                        <button 
                          type="button" 
                          className="danger" 
                          onClick={() => handleDeleteProvider(provider.id)}
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded config drawer */}
                  {isExpanded && (
                    <tr style={{ 
                      borderBottom: '1px solid var(--border)',
                      background: 'oklch(15% 0.015 255.4 / 0.3)'
                    }}>
                      <td colSpan={5} style={{ padding: '0 2rem 1.5rem 2rem' }}>
                        <div style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '1rem',
                          borderTop: '1px solid var(--border)',
                          paddingTop: '1.25rem',
                          animation: 'slideDown 0.25s ease-out'
                        }}>
                          {/* Config parameters form */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                            {provider.id !== 'cloudflare' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>API key Credentials</label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  <input 
                                    type={isVisible ? 'text' : 'password'} 
                                    placeholder="API Key"
                                    value={provider.apiKey}
                                    onChange={(e) => handleProviderChange(provider.id, 'apiKey', e.target.value)}
                                  />
                                  <button type="button" onClick={() => toggleKeyVisibility(provider.id)} style={{ padding: '0.4rem' }}>
                                    {isVisible ? 'Hide' : 'Show'}
                                  </button>
                                </div>
                              </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Override Base URL</label>
                              <input 
                                type="text" 
                                value={provider.baseUrl}
                                onChange={(e) => handleProviderChange(provider.id, 'baseUrl', e.target.value)}
                              />
                            </div>
                          </div>

                          {/* Custom Proxy Option */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              <input 
                                type="checkbox" 
                                id={`custom-proxy-${provider.id}`}
                                checked={provider.proxyEnabled}
                                onChange={(e) => handleProviderChange(provider.id, 'proxyEnabled', e.target.checked)}
                              />
                              <label htmlFor={`custom-proxy-${provider.id}`} style={{ fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                                Override Proxy for this Provider
                              </label>
                            </div>
                            
                            {provider.proxyEnabled && (
                              <input 
                                type="text" 
                                placeholder="socks5://127.0.0.1:1080"
                                value={provider.proxyUrl}
                                onChange={(e) => handleProviderChange(provider.id, 'proxyUrl', e.target.value)}
                              />
                            )}
                          </div>

                          {/* Sync / Test Results panel */}
                          {hasResult && (
                            <div style={{ 
                              padding: '0.75rem', 
                              borderRadius: '8px', 
                              fontSize: '0.85rem',
                              background: actionResult.success ? 'var(--success-glow)' : 'var(--error-glow)',
                              border: `1px solid ${actionResult.success ? 'var(--success)' : 'var(--error)'}`,
                              color: actionResult.success ? 'var(--success)' : 'var(--error)',
                              whiteSpace: 'pre-wrap'
                            }}>
                              {actionResult.message}
                            </div>
                          )}

                          {/* Actions buttons row */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button 
                                type="button" 
                                disabled={isTesting || isSyncing}
                                onClick={() => handleTestConnection(provider)}
                              >
                                {isTesting ? 'Testing connection...' : 'Test Connection'}
                              </button>
                              
                              <button 
                                type="button" 
                                className="primary"
                                disabled={isTesting || isSyncing}
                                onClick={() => handleSyncModels(provider)}
                              >
                                {isSyncing ? 'Syncing models list...' : 'Sync Models'}
                              </button>
                            </div>

                            <button 
                              type="button" 
                              className="primary" 
                              onClick={() => { onSave(localConfig); alert('Settings saved successfully!'); }}
                              style={{ padding: '0.45rem 1.25rem' }}
                            >
                              Save Settings
                            </button>
                          </div>

                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

    </div>
  );
};
