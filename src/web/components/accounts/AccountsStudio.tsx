import React, { useEffect, useState } from 'react';
import { Users, Key, Plus, Trash2, RotateCw, Copy, Check, Shield, AlertTriangle, CheckCircle2, ChevronRight, Terminal, Cpu, Code } from 'lucide-react';
import { getAdminToken } from '../settings/EndpointsManager.js';
import { sanitizeForClipboard } from '../../utils/clipboardSanitizer.js';

export interface AccountItem {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'suspended' | 'deleted';
  defaultPoolId: string | null;
  defaultGoalId: string | null;
  activeKeyCount: number;
  maxKeys: number;
  createdAt: number;
}

export interface ApiKeyItem {
  id: string;
  accountId: string;
  name: string;
  keyPrefix: string;
  pinnedPoolId: string | null;
  pinnedGoalId: string | null;
  status: 'active' | 'revoked';
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface CreatedKeyResult {
  id: string;
  key: string; // Plaintext key returned only upon creation
  name: string;
  keyPrefix: string;
  pinnedPoolId: string | null;
}

interface PoolOption {
  id: string;
  name: string;
}

export const AccountsStudio: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountItem | null>(null);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [pools, setPools] = useState<PoolOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  const [createdKeyResult, setCreatedKeyResult] = useState<CreatedKeyResult | null>(null);

  // Form states
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountDesc, setNewAccountDesc] = useState('');

  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyPinnedPoolId, setNewKeyPinnedPoolId] = useState('');

  // Copy state
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const adminToken = getAdminToken();

  const getAuthHeaders = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (adminToken) {
      headers['authorization'] = `Bearer ${adminToken}`;
    }
    return headers;
  };

  const fetchAccounts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/accounts', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAccounts(data);
      if (data.length > 0 && !selectedAccount) {
        setSelectedAccount(data[0]);
      }
    } catch (err: any) {
      setError(`Failed to load accounts: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPools = async () => {
    try {
      const res = await fetch('/api/v1/pools', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPools(data);
      }
    } catch {}
  };

  const fetchKeys = async (accountId: string) => {
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}/keys`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setKeys(data);
    } catch (err: any) {
      setError(`Failed to load API keys: ${err.message}`);
    }
  };

  useEffect(() => {
    fetchAccounts();
    fetchPools();
  }, []);

  useEffect(() => {
    if (selectedAccount) {
      fetchKeys(selectedAccount.id);
    }
  }, [selectedAccount]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccountName.trim()) return;
    try {
      const res = await fetch('/api/v1/accounts', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: newAccountName.trim(),
          description: newAccountDesc.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      setNewAccountName('');
      setNewAccountDesc('');
      setIsCreateAccountOpen(false);
      await fetchAccounts();
      setSelectedAccount(created);
    } catch (err: any) {
      setError(`Failed to create account: ${err.message}`);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('Are you sure you want to delete this account?')) return;
    try {
      const res = await fetch(`/api/v1/accounts/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelectedAccount(null);
      fetchAccounts();
    } catch (err: any) {
      setError(`Failed to delete account: ${err.message}`);
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount || !newKeyName.trim()) return;
    try {
      const res = await fetch(`/api/v1/accounts/${selectedAccount.id}/keys`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: newKeyName.trim(),
          pinnedPoolId: newKeyPinnedPoolId || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created: CreatedKeyResult = await res.json();
      setNewKeyName('');
      setNewKeyPinnedPoolId('');
      setIsCreateKeyOpen(false);
      setCreatedKeyResult(created);
      fetchKeys(selectedAccount.id);
      fetchAccounts();
    } catch (err: any) {
      setError(`Failed to create API key: ${err.message}`);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!selectedAccount || !confirm('Are you sure you want to revoke this API key?')) return;
    try {
      const res = await fetch(`/api/v1/accounts/${selectedAccount.id}/keys/${keyId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchKeys(selectedAccount.id);
      fetchAccounts();
    } catch (err: any) {
      setError(`Failed to revoke key: ${err.message}`);
    }
  };

  const copyToClipboard = (text: string, label?: string) => {
    const safe = sanitizeForClipboard(text);
    navigator.clipboard.writeText(safe);
    if (label) {
      setCopiedSnippet(label);
      setTimeout(() => setCopiedSnippet(null), 2000);
    } else {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-2">
            <Users className="w-5 h-5 text-[var(--accent-primary)]" />
            Accounts & Client API Keys
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Manage tenant accounts and issue scoped API keys for Cline, Cursor, Claude Code, and custom LLM clients.
          </p>
        </div>
        <button
          onClick={() => setIsCreateAccountOpen(true)}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-[var(--accent-primary)] text-white text-xs font-semibold hover:opacity-90 transition-all shadow-md shadow-[var(--accent-primary)]/20 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Account</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Grid: Accounts List & Keys Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Accounts List */}
        <div className="lg:col-span-1 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] px-1">
            Accounts ({accounts.length})
          </div>
          <div className="space-y-2">
            {accounts.length === 0 ? (
              <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center text-xs text-[var(--text-muted)]">
                No accounts created yet. Click "New Account" to get started.
              </div>
            ) : (
              accounts.map((account) => (
                <div
                  key={account.id}
                  onClick={() => setSelectedAccount(account)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2 ${
                    selectedAccount?.id === account.id
                      ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-md'
                      : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-[var(--text-primary)] truncate">
                      {account.name}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-[var(--signal-mint)]/10 text-[var(--signal-mint)]">
                      {account.status}
                    </span>
                  </div>
                  {account.description && (
                    <p className="text-xs text-[var(--text-muted)] line-clamp-1">{account.description}</p>
                  )}
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono pt-1">
                    <span>{account.activeKeyCount} / {account.maxKeys} Active Keys</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* API Keys Inspector for Selected Account */}
        <div className="lg:col-span-2 space-y-4">
          {selectedAccount ? (
            <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)]">
                <div>
                  <h3 className="font-bold text-base text-[var(--text-primary)] flex items-center gap-2">
                    <Key className="w-4.5 h-4.5 text-[var(--signal-mint)]" />
                    {selectedAccount.name} — API Keys
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
                    Account ID: {selectedAccount.id}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setIsCreateKeyOpen(true)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] border border-[var(--signal-mint)]/30 text-xs font-semibold hover:bg-[var(--signal-mint)]/20 transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Issue API Key</span>
                  </button>
                  <button
                    onClick={() => handleDeleteAccount(selectedAccount.id)}
                    className="p-1.5 rounded-xl text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                    title="Delete Account"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Keys Table */}
              <div className="space-y-3">
                {keys.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border-subtle)] rounded-xl">
                    No API keys issued for this account yet. Click "Issue API Key" to connect your agent clients.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {keys.map((k) => (
                      <div
                        key={k.id}
                        className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] flex items-center justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-xs text-[var(--text-primary)]">{k.name}</span>
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] text-[var(--accent-primary)] font-bold">
                              {k.keyPrefix}...
                            </span>
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.2 rounded uppercase ${
                                k.status === 'active'
                                  ? 'bg-[var(--signal-mint)]/10 text-[var(--signal-mint)]'
                                  : 'bg-red-500/10 text-red-400'
                              }`}
                            >
                              {k.status}
                            </span>
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] font-mono flex items-center gap-3">
                            <span>Pinned Pool: {k.pinnedPoolId || 'Auto / Default'}</span>
                            <span>Created: {new Date(k.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>

                        {k.status === 'active' && (
                          <button
                            onClick={() => handleRevokeKey(k.id)}
                            className="px-2.5 py-1 rounded-lg text-red-400 hover:bg-red-500/10 text-xs font-semibold transition-all cursor-pointer"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center text-xs text-[var(--text-muted)]">
              Select an account on the left to view and manage its client API keys.
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create Account */}
      {isCreateAccountOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-[var(--text-primary)]">Create New Account</h3>
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Account Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Development Team"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Keys used for local dev enclaves and Cursor"
                  value={newAccountDesc}
                  onChange={(e) => setNewAccountDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateAccountOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-well)] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[var(--accent-primary)] text-white text-xs font-semibold hover:opacity-90 transition-all"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Issue Key */}
      {isCreateKeyOpen && selectedAccount && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-[var(--text-primary)]">Issue API Key for {selectedAccount.name}</h3>
            <form onSubmit={handleCreateKey} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Key Label</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cursor IDE Key"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Pin to Pool (Optional)</label>
                <select
                  value={newKeyPinnedPoolId}
                  onChange={(e) => setNewKeyPinnedPoolId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                >
                  <option value="">Default / All Allowed Pools</option>
                  {pools.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateKeyOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-well)] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[var(--signal-mint)] text-slate-950 text-xs font-bold hover:opacity-90 transition-all"
                >
                  Generate Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Show Created Key ONCE & Quick Integration Snippets */}
      {createdKeyResult && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[var(--bg-card)] border border-[var(--signal-mint)]/40 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-[var(--signal-mint)]/10 text-[var(--signal-mint)]">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[var(--text-primary)]">API Key Created Successfully</h3>
                <p className="text-xs text-[var(--text-muted)]">Copy your key now. You will not be able to view it again!</p>
              </div>
            </div>

            {/* Key Banner */}
            <div className="p-4 rounded-xl bg-slate-950 border border-[var(--border-subtle)] space-y-2">
              <div className="text-[10px] uppercase font-bold text-[var(--signal-mint)] tracking-wider">Your API Key</div>
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-xs text-white break-all">{createdKeyResult.key}</code>
                <button
                  onClick={() => copyToClipboard(createdKeyResult.key)}
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 hover:opacity-90 transition-all cursor-pointer"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey ? 'Copied!' : 'Copy Key'}</span>
                </button>
              </div>
            </div>

            {/* Quick Setup Snippets for Cline, Cursor, Claude Code */}
            <div className="space-y-3 pt-2">
              <div className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-[var(--accent-primary)]" />
                <span>Client Setup Snippets</span>
              </div>

              {/* Cline */}
              <div className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[var(--text-primary)]">Cline / VS Code Extension</span>
                  <button
                    onClick={() => copyToClipboard(`Base URL: http://localhost:8788/v1\nAPI Key: ${createdKeyResult.key}`, 'cline')}
                    className="text-[11px] text-[var(--accent-primary)] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedSnippet === 'cline' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>Copy Config</span>
                  </button>
                </div>
                <div className="font-mono text-[11px] text-[var(--text-muted)] space-y-0.5">
                  <div>Provider: OpenAI Compatible</div>
                  <div>Base URL: <span className="text-[var(--signal-mint)]">http://localhost:8788/v1</span></div>
                  <div>API Key: <span className="text-[var(--signal-mint)]">{createdKeyResult.key}</span></div>
                </div>
              </div>

              {/* Cursor */}
              <div className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[var(--text-primary)]">Cursor IDE</span>
                  <button
                    onClick={() => copyToClipboard(`Base URL: http://localhost:8788/v1\nAPI Key: ${createdKeyResult.key}`, 'cursor')}
                    className="text-[11px] text-[var(--accent-primary)] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedSnippet === 'cursor' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>Copy Config</span>
                  </button>
                </div>
                <div className="font-mono text-[11px] text-[var(--text-muted)] space-y-0.5">
                  <div>Settings → OpenAI API Key → Override Base URL: <span className="text-[var(--signal-mint)]">http://localhost:8788/v1</span></div>
                  <div>API Key: <span className="text-[var(--signal-mint)]">{createdKeyResult.key}</span></div>
                </div>
              </div>

              {/* Claude Code */}
              <div className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[var(--text-primary)]">Claude Code CLI</span>
                  <button
                    onClick={() => copyToClipboard(`export ANTHROPIC_BASE_URL="http://localhost:8789"\nexport ANTHROPIC_API_KEY="${createdKeyResult.key}"\nclaude`, 'claude')}
                    className="text-[11px] text-[var(--accent-primary)] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedSnippet === 'claude' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>Copy Commands</span>
                  </button>
                </div>
                <div className="font-mono text-[11px] text-[var(--signal-mint)] bg-slate-950 p-2 rounded-lg">
                  export ANTHROPIC_BASE_URL="http://localhost:8789"<br />
                  export ANTHROPIC_API_KEY="{createdKeyResult.key}"<br />
                  claude
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setCreatedKeyResult(null)}
                className="px-5 py-2 rounded-xl bg-[var(--accent-primary)] text-white text-xs font-semibold hover:opacity-90 transition-all cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
