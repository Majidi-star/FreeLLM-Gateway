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
  activeTab: string;
}

export const SystemAlerts: React.FC<SystemAlertsProps> = ({ config, onSave, activeTab }) => {
  // Cast config alerts safely
  const alerts: Alert[] = (config as any).alerts || [];
  
  const [errorHistory, setErrorHistory] = useState<StatsHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Collapsible sections
  const [alertsSectionExpanded, setAlertsSectionExpanded] = useState(true);
  const [errorsSectionExpanded, setErrorsSectionExpanded] = useState(true);

  // Searching
  const [alertsSearch, setAlertsSearch] = useState('');
  const [errorsSearch, setErrorsSearch] = useState('');

  // Pagination
  const [alertsPage, setAlertsPage] = useState(1);
  const [errorsPage, setErrorsPage] = useState(1);
  const alertsItemsPerPage = 15;
  const errorsItemsPerPage = 15;

  // Row expansions (keys: alert.id or error index)
  const [expandedAlertIds, setExpandedAlertIds] = useState<Record<string, boolean>>({});
  const [expandedErrorIndices, setExpandedErrorIndices] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (activeTab !== 'alerts') return;
    const fetchErrors = async () => {
      try {
        if (errorHistory.length === 0) {
          setLoading(true);
        }
        const data = await getStatsHistory();
        // Filter out successful requests and sort by latest
        const errors = data
          .filter(item => !item.success && item.error)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setErrorHistory(errors);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchErrors();
  }, [activeTab]);

  const handleCopyAlert = (message: string) => {
    navigator.clipboard.writeText(message);
    alert('Error message copied to clipboard!');
  };

  const handleRemoveAlert = (alertId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid expanding/collapsing row on action click
    const updatedAlerts = alerts.filter(a => a.id !== alertId);
    const updatedConfig = {
      ...config,
      alerts: updatedAlerts
    };
    onSave(updatedConfig);
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to clear all system alerts?')) {
      const updatedConfig = {
        ...config,
        alerts: []
      };
      onSave(updatedConfig);
    }
  };

  // Filtered lists
  const filteredAlerts = alerts.filter(a => {
    if (!alertsSearch) return true;
    const query = alertsSearch.toLowerCase();
    return (
      (a.providerName || '').toLowerCase().includes(query) ||
      (a.errorType || '').toLowerCase().includes(query) ||
      (a.message || '').toLowerCase().includes(query)
    );
  });

  const filteredErrors = errorHistory.filter(err => {
    if (!errorsSearch) return true;
    const query = errorsSearch.toLowerCase();
    return (
      (err.requestedModel || '').toLowerCase().includes(query) ||
      (err.providerId || '').toLowerCase().includes(query) ||
      (err.error || '').toLowerCase().includes(query)
    );
  });

  // Paginated lists
  const totalAlertsPages = Math.ceil(filteredAlerts.length / alertsItemsPerPage) || 1;
  const currentAlertsPage = Math.min(alertsPage, totalAlertsPages);
  const alertsStartIndex = (currentAlertsPage - 1) * alertsItemsPerPage;
  const paginatedAlerts = filteredAlerts.slice(alertsStartIndex, alertsStartIndex + alertsItemsPerPage);

  const totalErrorsPages = Math.ceil(filteredErrors.length / errorsItemsPerPage) || 1;
  const currentErrorsPage = Math.min(errorsPage, totalErrorsPages);
  const errorsStartIndex = (currentErrorsPage - 1) * errorsItemsPerPage;
  const paginatedErrors = filteredErrors.slice(errorsStartIndex, errorsStartIndex + errorsItemsPerPage);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      
      {/* System Alerts Section */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div 
          onClick={() => setAlertsSectionExpanded(!alertsSectionExpanded)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.2rem', color: 'var(--text)' }}>
              {alertsSectionExpanded ? '▼' : '▶'}
            </span>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                System Alerts <span style={{ fontSize: '0.9rem', background: 'rgba(255, 68, 68, 0.2)', color: 'var(--error)', padding: '0.1rem 0.5rem', borderRadius: '12px' }}>{alerts.length}</span>
              </h2>
              <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                View authentication errors, invalid credentials, or exhausted credits flagged by the gateway.
              </p>
            </div>
          </div>
          {alerts.length > 0 && (
            <button 
              type="button" 
              className="danger" 
              onClick={handleClearAll}
              style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', fontWeight: 700 }}
            >
              Clear All Alerts
            </button>
          )}
        </div>

        {alertsSectionExpanded && (
          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
              <>
                {/* Search and Metadata strip */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Showing {alertsStartIndex + 1}-{Math.min(alertsStartIndex + alertsItemsPerPage, filteredAlerts.length)} of {filteredAlerts.length} items
                  </span>
                  <input 
                    type="text" 
                    placeholder="Search alerts (provider, type, message)..." 
                    value={alertsSearch} 
                    onChange={(e) => { setAlertsSearch(e.target.value); setAlertsPage(1); }} 
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', width: '280px', background: '#0a0a0f', color: '#fff', border: '1px solid var(--border)', borderRadius: '6px' }}
                  />
                </div>

                {/* Table representation */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem', width: '30px' }}></th>
                        <th style={{ padding: '0.5rem', width: '140px', color: 'var(--text-muted)' }}>Provider</th>
                        <th style={{ padding: '0.5rem', width: '150px', color: 'var(--text-muted)' }}>Error Type</th>
                        <th style={{ padding: '0.5rem', width: '150px', color: 'var(--text-muted)' }}>Timestamp</th>
                        <th style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>Message Preview (Click to expand)</th>
                        <th style={{ padding: '0.5rem', width: '140px', textAlign: 'right', color: 'var(--text-muted)' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedAlerts.map((alert) => {
                        const isExpanded = !!expandedAlertIds[alert.id];
                        return (
                          <React.Fragment key={alert.id}>
                            <tr 
                              onClick={() => setExpandedAlertIds(prev => ({ ...prev, [alert.id]: !prev[alert.id] }))}
                              style={{ 
                                borderBottom: '1px solid var(--border)', 
                                cursor: 'pointer',
                                background: isExpanded ? 'rgba(255, 68, 68, 0.04)' : 'transparent',
                                transition: 'background 0.2s'
                              }}
                              className="table-row-hover"
                            >
                              <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                {isExpanded ? '▼' : '▶'}
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', fontWeight: 700 }}>{alert.providerName}</td>
                              <td style={{ padding: '0.6rem 0.5rem' }}>
                                <span style={{
                                  fontSize: '0.7rem',
                                  padding: '0.15rem 0.4rem',
                                  borderRadius: '4px',
                                  background: 'rgba(255, 68, 68, 0.15)',
                                  color: 'var(--error)',
                                  fontWeight: 700
                                }}>
                                  {alert.errorType}
                                </span>
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', color: 'var(--text-muted)' }}>
                                {new Date(alert.timestamp).toLocaleString()}
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }}>
                                {alert.message}
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>
                                <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                                  <button 
                                    type="button" 
                                    onClick={(e) => { e.stopPropagation(); handleCopyAlert(alert.message); }}
                                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                  >
                                    Copy
                                  </button>
                                  <button 
                                    type="button" 
                                    className="danger" 
                                    onClick={(e) => handleRemoveAlert(alert.id, e)}
                                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={6} style={{ padding: '0.75rem 1rem', background: 'rgba(255, 68, 68, 0.08)', borderBottom: '1px solid var(--border)' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <div style={{
                                      fontFamily: 'monospace',
                                      fontSize: '0.85rem',
                                      color: 'var(--text)',
                                      background: '#0a0a0f',
                                      padding: '0.75rem',
                                      borderRadius: '6px',
                                      border: '1px solid var(--border)',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-all'
                                    }}>
                                      {alert.message}
                                    </div>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 600 }}>
                                      ⚠️ Notice: This provider has been automatically disabled. Please verify credentials/funds and re-enable it in the Setup tab.
                                    </span>
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

                {/* Pagination Controls */}
                {totalAlertsPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      disabled={currentAlertsPage === 1}
                      onClick={() => setAlertsPage(p => Math.max(p - 1, 1))}
                      style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      &lt; Previous
                    </button>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Page {currentAlertsPage} of {totalAlertsPages}
                    </span>
                    <button
                      type="button"
                      disabled={currentAlertsPage === totalAlertsPages}
                      onClick={() => setAlertsPage(p => Math.min(p + 1, totalAlertsPages))}
                      style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      Next &gt;
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Request Errors Section */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div 
          onClick={() => setErrorsSectionExpanded(!errorsSectionExpanded)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Recent Request Errors <span style={{ fontSize: '0.9rem', background: 'rgba(255, 170, 0, 0.15)', color: 'var(--warning)', padding: '0.1rem 0.5rem', borderRadius: '12px' }}>{errorHistory.length}</span>
            </h2>
            <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
              A detailed log of all failed API requests to help you troubleshoot model routing or provider issues.
            </p>
          </div>
        </div>

        {errorsSectionExpanded && (
          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
              <>
                {/* Search and Metadata strip */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Showing {errorsStartIndex + 1}-{Math.min(errorsStartIndex + errorsItemsPerPage, filteredErrors.length)} of {filteredErrors.length} items
                  </span>
                  <input 
                    type="text" 
                    placeholder="Search errors (model, provider, content)..." 
                    value={errorsSearch} 
                    onChange={(e) => { setErrorsSearch(e.target.value); setErrorsPage(1); }} 
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', width: '280px', background: '#0a0a0f', color: '#fff', border: '1px solid var(--border)', borderRadius: '6px' }}
                  />
                </div>

                {/* Table representation */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem', width: '30px' }}></th>
                        <th style={{ padding: '0.5rem', width: '180px', color: 'var(--text-muted)' }}>Model</th>
                        <th style={{ padding: '0.5rem', width: '110px', color: 'var(--text-muted)' }}>Provider</th>
                        <th style={{ padding: '0.5rem', width: '150px', color: 'var(--text-muted)' }}>Timestamp</th>
                        <th style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>Error Message (Click to expand)</th>
                        <th style={{ padding: '0.5rem', width: '90px', textAlign: 'right', color: 'var(--text-muted)' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedErrors.map((err, idx) => {
                        const globalIndex = errorsStartIndex + idx;
                        const isExpanded = !!expandedErrorIndices[globalIndex];
                        return (
                          <React.Fragment key={globalIndex}>
                            <tr 
                              onClick={() => setExpandedErrorIndices(prev => ({ ...prev, [globalIndex]: !prev[globalIndex] }))}
                              style={{ 
                                borderBottom: '1px solid var(--border)', 
                                cursor: 'pointer',
                                background: isExpanded ? 'rgba(255, 170, 0, 0.04)' : 'transparent',
                                transition: 'background 0.2s'
                              }}
                              className="table-row-hover"
                            >
                              <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                {isExpanded ? '▼' : '▶'}
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', fontWeight: 700, fontFamily: 'monospace' }}>{err.requestedModel}</td>
                              <td style={{ padding: '0.6rem 0.5rem' }}>
                                <span style={{
                                  fontSize: '0.75rem',
                                  padding: '0.15rem 0.4rem',
                                  borderRadius: '4px',
                                  background: 'rgba(255, 255, 255, 0.08)',
                                  color: 'var(--text)',
                                  fontWeight: 600
                                }}>
                                  {err.providerId}
                                </span>
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', color: 'var(--text-muted)' }}>
                                {new Date(err.timestamp).toLocaleString()}
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', color: 'var(--error)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }}>
                                {err.error}
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>
                                <button 
                                  type="button" 
                                  onClick={(e) => { e.stopPropagation(); handleCopyAlert(err.error || ''); }}
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                >
                                  Copy
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={6} style={{ padding: '0.75rem 1rem', background: 'rgba(255, 170, 0, 0.08)', borderBottom: '1px solid var(--border)' }}>
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
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {totalErrorsPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      disabled={currentErrorsPage === 1}
                      onClick={() => setErrorsPage(p => Math.max(p - 1, 1))}
                      style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      &lt; Previous
                    </button>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Page {currentErrorsPage} of {totalErrorsPages}
                    </span>
                    <button
                      type="button"
                      disabled={currentErrorsPage === totalErrorsPages}
                      onClick={() => setErrorsPage(p => Math.min(p + 1, totalErrorsPages))}
                      style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      Next &gt;
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
