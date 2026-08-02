import { useState, useEffect } from 'react';
import { 
  getConfig, 
  saveConfig, 
  getStats, 
  API_BASE 
} from './utils/api';
import type { GatewayConfig, Stats } from './utils/api';
import { Directory } from './components/Directory';
import { GatewaySetup } from './components/GatewaySetup';
import { ActivePools } from './components/ActivePools';
import { Sandbox } from './components/Sandbox';
import { IntegrationHub } from './components/IntegrationHub';

function App() {
  const [activeTab, setActiveTab] = useState<'directory' | 'setup' | 'pools' | 'integrations'>('directory');
  const [showAssistant, setShowAssistant] = useState(true);
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState(false);

  // Fetch initial config and check server connectivity
  const fetchInitialData = async () => {
    try {
      setLoading(true);
      setError(null);
      const confData = await getConfig();
      setConfig(confData);
      
      const statsData = await getStats();
      setStats(statsData.stats);
      
      setServerOnline(true);
    } catch (err: any) {
      console.error(err);
      setError(`Cannot connect to Gateway Server at ${API_BASE}. Make sure the backend server is running.`);
      setServerOnline(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  // Poll stats in background
  useEffect(() => {
    if (!serverOnline) return;
    const timer = setInterval(async () => {
      try {
        const statsData = await getStats();
        setStats(statsData.stats);
      } catch (err) {
        console.error('Error polling stats:', err);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [serverOnline]);

  const handleSaveConfig = async (newConfig: GatewayConfig) => {
    try {
      const res = await saveConfig(newConfig);
      if (res.success) {
        setConfig(newConfig);
        // Refresh stats
        const statsData = await getStats();
        setStats(statsData.stats);
      }
    } catch (err: any) {
      alert(`Error saving configuration: ${err.message}`);
    }
  };

  if (loading && !config) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        gap: '1rem'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '4px solid var(--border)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Connecting to LLM Pool Gateway...</span>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '2rem 1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1.5rem',
      minHeight: '100vh'
    }}>
      
      {/* Header Bar */}
      <header className="glass-panel" style={{
        padding: '1.25rem 2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h1 style={{ fontSize: '1.4rem', margin: 0, fontWeight: 900, background: 'linear-gradient(to right, var(--text), var(--accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            LLM Free Pool Gateway
          </h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Local failover router & API credentials portal</span>
        </div>

        {/* Server Status and Stats Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          {stats && (
            <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem', background: 'oklch(20% 0.018 255.4 / 0.4)', padding: '0.4rem 1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Cost Saved: </span>
                <strong style={{ color: 'var(--success)' }}>${stats.approximateCostSaved.toFixed(2)}</strong>
              </div>
              <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '1.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Tokens Pooled: </span>
                <strong>{stats.tokensSaved.toLocaleString()}</strong>
              </div>
              <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '1.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Requests: </span>
                <strong>{stats.totalRequests}</strong>
              </div>
            </div>
          )}

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.4rem 0.8rem',
            borderRadius: '20px',
            background: serverOnline ? 'var(--success-glow)' : 'var(--error-glow)',
            border: `1px solid ${serverOnline ? 'var(--success)' : 'var(--error)'}`,
            color: serverOnline ? 'var(--success)' : 'var(--error)',
            fontSize: '0.8rem',
            fontWeight: 700
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: serverOnline ? 'var(--success)' : 'var(--error)'
            }} />
            Gateway: {serverOnline ? 'Online' : 'Offline'}
          </div>

          <button
            type="button"
            onClick={() => setShowAssistant(!showAssistant)}
            style={{
              padding: '0.4rem 0.8rem',
              borderRadius: '20px',
              border: '1px solid var(--border)',
              background: showAssistant ? 'var(--accent-glow)' : 'transparent',
              borderColor: showAssistant ? 'var(--accent)' : 'var(--border)',
              color: showAssistant ? 'var(--text)' : 'var(--text-muted)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <span>🤖</span> {showAssistant ? 'Hide Agent' : 'Show Agent'}
          </button>
        </div>
      </header>

      {/* Connectivity Error Bar */}
      {error && (
        <div className="glass-panel" style={{
          padding: '1.25rem 1.5rem',
          borderLeft: '4px solid var(--error)',
          color: 'var(--error)',
          background: 'var(--error-glow)',
          fontSize: '0.9rem',
          fontWeight: 600
        }}>
          {error}
        </div>
      )}

      {/* Main Layout Content Area & Sticky Sidebar */}
      {config && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: showAssistant ? '1fr 380px' : '1fr',
          gap: '1.5rem',
          alignItems: 'start',
          flex: 1
        }}>
          {/* Left Column: Navigation Tabs and Current View Content */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', overflow: 'hidden' }}>
            <nav style={{
              display: 'flex',
              gap: '0.75rem',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '0.5rem',
              overflowX: 'auto'
            }}>
              {[
                { id: 'directory', label: '1. Free API Directory' },
                { id: 'setup', label: '2. Gateway Setup' },
                { id: 'pools', label: '3. Active Pools' },
                { id: 'integrations', label: '4. Connect Tools' }
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as any)}
                    style={{
                      background: isActive ? 'var(--accent-glow)' : 'transparent',
                      borderColor: isActive ? 'var(--accent)' : 'transparent',
                      color: isActive ? 'var(--text)' : 'var(--text-muted)',
                      borderRadius: '8px',
                      padding: '0.6rem 1.2rem',
                      fontWeight: 600,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>

            <main style={{ minHeight: '400px' }}>
              {activeTab === 'directory' && config && (
                <Directory providers={config.providers} />
              )}
              
              {activeTab === 'setup' && (
                <GatewaySetup 
                  config={config} 
                  onSave={handleSaveConfig} 
                />
              )}
              
              {activeTab === 'pools' && (
                <ActivePools 
                  config={config} 
                  onSave={handleSaveConfig} 
                />
              )}
              
              {activeTab === 'integrations' && (
                <IntegrationHub />
              )}
            </main>
          </div>

          {/* Right Column: Global Sticky Chat Assistant */}
          {showAssistant && (
            <aside className="glass-panel animate-fade-in" style={{
              height: 'calc(100vh - 220px)',
              minHeight: '500px',
              position: 'sticky',
              top: '20px',
              overflow: 'hidden',
              padding: 0
            }}>
              <Sandbox onConfigChange={fetchInitialData} />
            </aside>
          )}
        </div>
      )}

      {/* Footer */}
      <footer style={{
        marginTop: 'auto',
        textAlign: 'center',
        padding: '2rem 0 0.5rem',
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span>LLM Free Pool Gateway &copy; 2026</span>
        <span>Point your API endpoints to: <code>http://localhost:3000/v1</code></span>
      </footer>
    </div>
  );
}

export default App;
