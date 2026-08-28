import React, { useState, useEffect } from 'react';
import type { GatewayConfig, StatsHistoryEntry } from '../utils/api';
import { getStatsHistory } from '../utils/api';

export interface Alert {
  id: string;
  providerId: string;
  providerName: string;
  errorType: string;
  message: string;
  timestamp: string;
}

interface SystemAlertsProps {
  config: GatewayConfig;
  onSave: (config: GatewayConfig) => void;
}

export const SystemAlerts: React.FC<SystemAlertsProps> = ({ config, onSave }) => {
  // Cast config alerts safely
  const alerts: Alert[] = (config as any).alerts || [];
  
  const [errorHistory, setErrorHistory] = useState<StatsHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchErrors = async () => {
      try {
        setLoading(true);
        const data = await getStatsHistory();
        // Filter out successful requests and sort by latest
        const errors = data.filter(item => !item.success && item.error).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setErrorHistory(errors);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchErrors();
  }, []);

  const handleCopyAlert = (message: string) => {
    navigator.clipboard.writeText(message);
    alert('Error message copied to clipboard!');
  };

  const handleRemoveAlert = (alertId: string) => {
    const updatedAlerts = alerts.filter(a => a.id !== alertId);
    const updatedConfig = {
      ...config,
      alerts: updatedAlerts
    };
    onSave(updatedConfig);
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all system alerts?')) {
      const updatedConfig = {
        ...config,
        alerts: []
      };
      onSave(updatedConfig);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      
      {/* System Alerts Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.5rem' }}>System Alerts</h2>
            <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
              View and manage authentication errors, invalid credentials, or exhausted credits flagged by the gateway.
            </p>
          </div>
          {alerts.length > 0 && (
            <button 
              type="button" 
              className="danger" 
              onClick={handleClearAll}
              style={{ padding: '0.5rem 1.25rem', fontWeight: 700 }}
            >
              Clear All Alerts
            </button>
          )}
        </div>

        {alerts.length === 0 ? (
          <div style={{
            padding: '2rem',
            textAlign: 'center',
            background: 'oklch(15% 0.015 255.4 / 0.4)',
            borderRadius: '12px',
            border: '1px dashed var(--border)',
            color: 'var(--text-muted)'
          }}>
            <h3 style={{ margin: '0 0 0.5rem 0', color: '#fff' }}>No Active System Alerts</h3>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              No authentication or quota-related errors have been triggered recently. Your API endpoints are healthy.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {alerts.map((alert) => (
              <div 
                key={alert.id} 
                className="glass-panel" 
                style={{
                  padding: '1.25rem 1.5rem',
                  borderLeft: '4px solid var(--error)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  background: 'var(--error-glow)'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '1rem', color: '#fff' }}>{alert.providerName}</strong>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '4px',
                      background: 'rgba(255, 68, 68, 0.2)',
                      color: 'var(--error)',
                      fontWeight: 700
                    }}>
                      {alert.errorType}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(alert.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div style={{
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    color: 'var(--text)',
                    background: '#0a0a0f',
                    padding: '0.75rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    marginTop: '0.5rem',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}>
                    {alert.message}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 600, marginTop: '0.25rem' }}>
                    ⚠️ Notice: This provider has been automatically disabled. Please verify credentials/funds and re-enable it in the Setup tab.
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                  <button 
                    type="button" 
                    onClick={() => handleCopyAlert(alert.message)}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                  >
                    Copy Message
                  </button>
                  <button 
                    type="button" 
                    className="danger" 
                    onClick={() => handleRemoveAlert(alert.id)}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Request Errors Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Recent Request Errors</h2>
          <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
            A detailed log of all failed API requests to help you troubleshoot model routing or provider issues.
          </p>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading error history...</div>
        ) : errorHistory.length === 0 ? (
          <div style={{
            padding: '2rem',
            textAlign: 'center',
            background: 'oklch(15% 0.015 255.4 / 0.4)',
            borderRadius: '12px',
            border: '1px dashed var(--border)',
            color: 'var(--text-muted)'
          }}>
            <h3 style={{ margin: '0 0 0.5rem 0', color: '#fff' }}>No Request Errors</h3>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              All your recent API requests were processed successfully.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {errorHistory.slice(0, 100).map((err, idx) => (
              <div 
                key={idx}
                className="glass-panel"
                style={{
                  padding: '1.25rem 1.5rem',
                  borderLeft: '4px solid var(--warning)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  background: 'rgba(255, 170, 0, 0.05)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '1rem', color: '#fff', fontFamily: 'monospace' }}>{err.requestedModel}</strong>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>via</span>
                    <span style={{
                      fontSize: '0.8rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '4px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: 'var(--text)',
                      fontWeight: 600
                    }}>
                      {err.providerId}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(err.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => handleCopyAlert(err.error || '')}
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                  >
                    Copy Error
                  </button>
                </div>
                <div style={{
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                  color: 'var(--error)',
                  background: '#0a0a0f',
                  padding: '1rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: '300px',
                  overflowY: 'auto'
                }}>
                  {err.error}
                </div>
              </div>
            ))}
            {errorHistory.length > 100 && (
              <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Showing last 100 errors out of {errorHistory.length}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};
