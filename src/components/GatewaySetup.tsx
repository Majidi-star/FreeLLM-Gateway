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

  // Virtual Keys creation state
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyRpm, setNewKeyRpm] = useState(10);
  const [newKeyRpd, setNewKeyRpd] = useState(500);
  const [showAddKey, setShowAddKey] = useState(false);

  // Action status trackers
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  
  // Track expanded configuration drawers (providerId -> boolean)
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const handleLimitChange = (id: string, limitField: string, value: string) => {
    const numValue = value === '' ? null : Number(value);
    const updated = localConfig.providers.map((p) => {
      if (p.id === id) {
        return {
          ...p,
          limits: {
            ...(p.limits || {}),
            [limitField]: numValue
          }
        };
      }
      return p;
    });
    setLocalConfig({ ...localConfig, providers: updated });
  };

  const handleAddAccountKey = (providerId: string) => {
    const provider = localConfig.providers.find(p => p.id === providerId);
    if (!provider) return;
    const currentKeys = provider.apiKeys || [];
    const newKey = {
      id: `key-${Date.now()}`,
      key: '',
      weight: 1,
      enabled: true
    };
    const updatedKeys = [...currentKeys, newKey];
    handleProviderChange(providerId, 'apiKeys', updatedKeys);
  };

  const handleRemoveAccountKey = (providerId: string, keyId: string) => {
    const provider = localConfig.providers.find(p => p.id === providerId);
    if (!provider) return;
    const updatedKeys = (provider.apiKeys || []).filter(k => k.id !== keyId);
    handleProviderChange(providerId, 'apiKeys', updatedKeys);
  };

  const handleAccountKeyChange = (providerId: string, keyId: string, field: 'key' | 'weight' | 'enabled', value: any) => {
    const provider = localConfig.providers.find(p => p.id === providerId);
    if (!provider) return;
    const updatedKeys = (provider.apiKeys || []).map(k => {
      if (k.id === keyId) {
        return { ...k, [field]: value };
      }
      return k;
    });
    handleProviderChange(providerId, 'apiKeys', updatedKeys);
  };

  const handleGenerateVirtualKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    const randomHex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const newKeyId = `sk-gw-${randomHex}`;

    const newKey = {
      id: newKeyId,
      name: newKeyName.trim(),
      enabled: true,
      limits: { rpm: newKeyRpm, rpd: newKeyRpd },
      usage: { requests: [] }
    };

    const updatedKeys = [...(localConfig.virtualKeys || []), newKey];
    const newConf = { ...localConfig, virtualKeys: updatedKeys };
    setLocalConfig(newConf);
    onSave(newConf);

    setNewKeyName('');
    setNewKeyRpm(10);
    setNewKeyRpd(500);
    setShowAddKey(false);
    alert(`Generated key successfully:\n${newKeyId}`);
  };

  const handleToggleVirtualKey = (keyId: string, enabled: boolean) => {
    const updatedKeys = (localConfig.virtualKeys || []).map(k => 
      k.id === keyId ? { ...k, enabled } : k
    );
    const newConf = { ...localConfig, virtualKeys: updatedKeys };
    setLocalConfig(newConf);
    onSave(newConf);
  };

  const handleDeleteVirtualKey = (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this Gateway API key? Users with this token will lose access immediately.')) return;
    const updatedKeys = (localConfig.virtualKeys || []).filter(k => k.id !== keyId);
    const newConf = { ...localConfig, virtualKeys: updatedKeys };
    setLocalConfig(newConf);
    onSave(newConf);
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
              <th style={{ padding: '0.75rem 1rem', maxWidth: '180px' }}>Base Endpoint URL</th>
              <th style={{ padding: '0.75rem 1rem', width: '120px' }}>Synced Models</th>
              <th style={{ padding: '0.75rem 1rem', width: '160px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {localConfig.providers.map((provider) => {
              const isExpanded = expandedId === provider.id;
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
                    <td style={{ padding: '1rem' }}>
                      <div style={{ 
                        fontFamily: 'monospace', 
                        color: 'var(--text-muted)', 
                        fontSize: '0.8rem', 
                        maxWidth: '180px', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap' 
                      }} title={provider.baseUrl}>
                        {provider.baseUrl}
                      </div>
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
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {provider.id !== 'cloudflare' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <label style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 700 }}>
                                    Manage Key Accounts (Load Balanced)
                                  </label>
                                  <button 
                                    type="button" 
                                    onClick={() => handleAddAccountKey(provider.id)}
                                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                                  >
                                    + Add Account Key
                                  </button>
                                </div>

                                {/* List of keys */}
                                {(!provider.apiKeys || provider.apiKeys.length === 0) ? (
                                  <div style={{ padding: '0.75rem', border: '1px dashed var(--border)', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                                    No custom key accounts configured. Balancing defaults to primary key:
                                    <input 
                                      type="password" 
                                      placeholder="Primary API Key"
                                      value={provider.apiKey}
                                      onChange={(e) => handleProviderChange(provider.id, 'apiKey', e.target.value)}
                                      style={{ marginTop: '0.5rem', width: '100%', fontSize: '0.8rem', padding: '0.4rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px' }}
                                    />
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {provider.apiKeys.map((k) => (
                                      <div key={k.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <input 
                                          type="checkbox"
                                          checked={k.enabled}
                                          onChange={(e) => handleAccountKeyChange(provider.id, k.id, 'enabled', e.target.checked)}
                                          style={{ cursor: 'pointer', margin: 0 }}
                                        />
                                        <input 
                                          type="password"
                                          placeholder="API Key string"
                                          value={k.key}
                                          onChange={(e) => handleAccountKeyChange(provider.id, k.id, 'key', e.target.value)}
                                          style={{ flex: 1, fontSize: '0.8rem', padding: '0.35rem 0.5rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px' }}
                                        />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', width: '80px' }}>
                                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Wt:</span>
                                          <input 
                                            type="number"
                                            value={k.weight || 1}
                                            min={1}
                                            max={100}
                                            onChange={(e) => handleAccountKeyChange(provider.id, k.id, 'weight', parseInt(e.target.value) || 1)}
                                            style={{ fontSize: '0.8rem', padding: '0.3rem', width: '50px', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px' }}
                                          />
                                        </div>
                                        <button 
                                          type="button" 
                                          className="danger"
                                          onClick={() => handleRemoveAccountKey(provider.id, k.id)}
                                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    ))}
                                    
                                    <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Primary Default API Key:</span>
                                      <input 
                                        type="password" 
                                        placeholder="Primary Default key (used for syncing)"
                                        value={provider.apiKey}
                                        onChange={(e) => handleProviderChange(provider.id, 'apiKey', e.target.value)}
                                        style={{ fontSize: '0.8rem', padding: '0.4rem', width: '100%', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px' }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Override Base URL</label>
                              <input 
                                type="text" 
                                value={provider.baseUrl}
                                onChange={(e) => handleProviderChange(provider.id, 'baseUrl', e.target.value)}
                                style={{ background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem' }}
                              />
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                              <label style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 700 }}>Rate Limits (Provider Level)</label>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>RPM (Req/Min)</span>
                                  <input 
                                    type="number" 
                                    min="0"
                                    placeholder="Uncapped"
                                    value={provider.limits?.rpm ?? ''}
                                    onChange={(e) => handleLimitChange(provider.id, 'rpm', e.target.value)}
                                    style={{ background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem', fontSize: '0.8rem' }}
                                  />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>RPD (Req/Day)</span>
                                  <input 
                                    type="number" 
                                    min="0"
                                    placeholder="Uncapped"
                                    value={provider.limits?.rpd ?? ''}
                                    onChange={(e) => handleLimitChange(provider.id, 'rpd', e.target.value)}
                                    style={{ background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem', fontSize: '0.8rem' }}
                                  />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>TPM (Tokens/Min)</span>
                                  <input 
                                    type="number" 
                                    min="0"
                                    placeholder="Uncapped"
                                    value={provider.limits?.tpm ?? ''}
                                    onChange={(e) => handleLimitChange(provider.id, 'tpm', e.target.value)}
                                    style={{ background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem', fontSize: '0.8rem' }}
                                  />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>TPD (Tokens/Day)</span>
                                  <input 
                                    type="number" 
                                    min="0"
                                    placeholder="Uncapped"
                                    value={provider.limits?.tpd ?? ''}
                                    onChange={(e) => handleLimitChange(provider.id, 'tpd', e.target.value)}
                                    style={{ background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem', fontSize: '0.8rem' }}
                                  />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Concurrent</span>
                                  <input 
                                    type="number" 
                                    min="1"
                                    placeholder="Uncapped"
                                    value={provider.limits?.concurrent ?? ''}
                                    onChange={(e) => handleLimitChange(provider.id, 'concurrent', e.target.value)}
                                    style={{ background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem', fontSize: '0.8rem' }}
                                  />
                                </div>
                              </div>
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

      {/* Virtual Gateway Keys Manager Card */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Virtual Gateway API Keys</h3>
            <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
              Create usage-capped keys to securely share your free gateway access with external tools.
            </p>
          </div>
          <button type="button" className="primary" onClick={() => setShowAddKey(!showAddKey)}>
            {showAddKey ? 'Cancel' : '+ Generate Gateway Key'}
          </button>
        </div>

        {/* Generate Key Drawer */}
        {showAddKey && (
          <form onSubmit={handleGenerateVirtualKey} className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'oklch(15% 0.015 255.4 / 0.4)' }}>
            <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--accent)' }}>Create Shared Gateway Credential</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Key Name Description</label>
                <input 
                  type="text" 
                  placeholder="e.g. Cursor dev key" 
                  value={newKeyName} 
                  onChange={(e) => setNewKeyName(e.target.value)} 
                  required
                  style={{ background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>RPM Limit (0 for unlimited)</label>
                <input 
                  type="number" 
                  min={0}
                  value={newKeyRpm} 
                  onChange={(e) => setNewKeyRpm(parseInt(e.target.value) || 0)} 
                  style={{ background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>RPD Limit (0 for unlimited)</label>
                <input 
                  type="number" 
                  min={0}
                  value={newKeyRpd} 
                  onChange={(e) => setNewKeyRpd(parseInt(e.target.value) || 0)} 
                  style={{ background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem' }}
                />
              </div>
            </div>
            <button type="submit" className="primary" style={{ alignSelf: 'flex-end', padding: '0.4rem 1.25rem' }}>
              Generate Key
            </button>
          </form>
        )}

        {/* Keys Table list */}
        {(!localConfig.virtualKeys || localConfig.virtualKeys.length === 0) ? (
          <div style={{ padding: '2rem', border: '1px dashed var(--border)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No virtual keys generated. Gateway API requires no authentication.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem 0.75rem', width: '50px' }}>Active</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Label / Description</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Gateway API Key (Bearer Token)</th>
                  <th style={{ padding: '0.5rem 0.75rem', width: '120px' }}>RPM limit</th>
                  <th style={{ padding: '0.5rem 0.75rem', width: '120px' }}>RPD limit</th>
                  <th style={{ padding: '0.5rem 0.75rem', width: '100px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {localConfig.virtualKeys.map((key) => {
                  const reqsToday = key.usage?.requests?.length || 0;
                  return (
                    <tr key={key.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <input 
                          type="checkbox" 
                          checked={key.enabled} 
                          onChange={(e) => handleToggleVirtualKey(key.id, e.target.checked)}
                          style={{ cursor: 'pointer', margin: 0 }}
                        />
                      </td>
                      <td style={{ padding: '0.75rem', fontWeight: 600 }}>{key.name}</td>
                      <td style={{ padding: '0.75rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <code style={{ background: '#0a0a0f', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)', color: 'var(--accent)' }}>
                            {key.id}
                          </code>
                          <button 
                            type="button" 
                            style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }}
                            onClick={() => {
                              navigator.clipboard.writeText(key.id);
                              alert('API Token copied to clipboard!');
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem' }}>{key.limits.rpm || 'Unlimited'}</td>
                      <td style={{ padding: '0.75rem' }}>
                        {key.limits.rpd || 'Unlimited'} 
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                          ({reqsToday} used today)
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                        <button 
                          type="button" 
                          className="danger" 
                          onClick={() => handleDeleteVirtualKey(key.id)}
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
