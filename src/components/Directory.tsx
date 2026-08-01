import React from 'react';
import type { Provider } from '../utils/api';

interface DirectoryProps {
  providers: Provider[];
}

export const Directory: React.FC<DirectoryProps> = ({ providers }) => {
  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Free LLM API Directory</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
          Explore permanent free tiers, trial credits, and custom local endpoints. Register keys at these links to configure them in the Setup tab.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '1rem', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>Provider Name</th>
              <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, width: '130px' }}>Category</th>
              <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>Free Credits / Plan</th>
              <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>Rate Limits Overview</th>
              <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, width: '130px', textAlign: 'center' }}>Account Signup</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((prov) => {
              const isFree = prov.category === 'Permanent Free';
              const isCustom = prov.category !== 'Permanent Free' && prov.category !== 'Trial Credits' && prov.category !== 'Paid Providers';
              
              // Resolve category pill styling
              let pillBg = 'var(--accent-glow)';
              let pillColor = 'var(--accent)';
              if (isFree) {
                pillBg = 'var(--success-glow)';
                pillColor = 'var(--success)';
              } else if (isCustom) {
                pillBg = 'rgba(255, 255, 255, 0.08)';
                pillColor = '#fff';
              }

              return (
                <tr key={prov.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  {/* Name */}
                  <td style={{ padding: '1rem 0.5rem', fontWeight: 700 }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span>{prov.name}</span>
                      {prov.website ? (
                        <a href={prov.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--accent)' }}>
                          {prov.website.replace('https://', '').replace('http://', '')} ↗
                        </a>
                      ) : (
                        <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>
                          Local Endpoint
                        </span>
                      )}
                    </div>
                  </td>
                  {/* Category */}
                  <td style={{ padding: '1rem 0.5rem' }}>
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      background: pillBg,
                      color: pillColor,
                      fontWeight: 700
                    }}>
                      {prov.category || 'Custom Provider'}
                    </span>
                  </td>
                  {/* Credits */}
                  <td style={{ padding: '1rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                    {prov.creditsDescription || 'Custom added provider details.'}
                  </td>
                  {/* Limits */}
                  <td style={{ padding: '1rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                    {prov.limitsDescription || 'User defined custom rates.'}
                  </td>
                  {/* Action Link */}
                  <td style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>
                    {prov.signupUrl ? (
                      <a href={prov.signupUrl} target="_blank" rel="noopener noreferrer">
                        <button type="button" className="primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', width: '100%', fontWeight: 700 }}>
                          Sign Up ↗
                        </button>
                      </a>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>None required</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
