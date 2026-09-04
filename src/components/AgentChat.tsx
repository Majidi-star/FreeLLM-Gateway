import React, { useState, useEffect, useRef } from 'react';
import {
  streamChatAssistant,
  getSessions,
  createSession,
  updateSessionTitle,
  deleteSession,
  getSessionMessages,
  saveMessage,
  truncateMessages,
} from '../utils/api';
import type { GatewayConfig, ChatSession } from '../utils/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AgentStep {
  text: string;
  done: boolean;
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  traces?: { toolName: string; args: any }[];
  steps?: AgentStep[];
  stepsCollapsed?: boolean;
}

interface AgentChatProps {
  config: GatewayConfig;
  onConfigChange?: () => void;
  sidebarWidth: number;
  onResizeStart: (e: React.MouseEvent) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Levenshtein + token-based similarity (no dependencies)
// ─────────────────────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
  return dp[m][n];
}

function stringSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

function tokenIntersection(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  ta.forEach(w => { if (tb.has(w)) shared++; });
  return shared / Math.max(ta.size, tb.size);
}

function isSimilarInput(a: string, b: string): boolean {
  return stringSimilarity(a, b) >= 0.75 || tokenIntersection(a, b) >= 0.75;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown Export
// ─────────────────────────────────────────────────────────────────────────────

function exportToMarkdown(messages: Message[], sessionTitle: string) {
  const lines: string[] = [
    `# ${sessionTitle}`,
    `> Exported from LLM Free Pool Gateway — ${new Date().toLocaleString()}`,
    '',
  ];

  messages.forEach((msg) => {
    if (msg.role === 'user') {
      lines.push(`## 🧑 You\n\n${msg.content}\n`);
    } else if (msg.role === 'assistant') {
      const cleanContent = msg.content
        .replace(/<!--STEPS_JSON:[\s\S]*?STEPS_JSON_END-->/g, '')
        .trim();
      lines.push(`## 🤖 Agent\n\n${cleanContent}\n`);
      if (msg.steps && msg.steps.length > 0) {
        lines.push('**Agent Steps:**\n');
        msg.steps.forEach((s, i) => {
          lines.push(`${i + 1}. ${s.text}`);
        });
        lines.push('');
      }
      if (msg.traces && msg.traces.length > 0) {
        lines.push('**Tool Calls:**\n');
        msg.traces.forEach(t => {
          lines.push(`- \`${t.toolName}\``);
          if (Object.keys(t.args).length > 0) {
            lines.push('  ```json');
            lines.push('  ' + JSON.stringify(t.args, null, 2).replace(/\n/g, '\n  '));
            lines.push('  ```');
          }
        });
        lines.push('');
      }
    } else if (msg.role === 'system') {
      lines.push(`> ⚠️ System: ${msg.content}\n`);
    }
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sessionTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Format message content (strip embedded step JSON from display)
// ─────────────────────────────────────────────────────────────────────────────

function parseStepsFromContent(content: string): { cleanContent: string; steps: AgentStep[] } {
  const match = content.match(/<!--STEPS_JSON:([\s\S]*?)STEPS_JSON_END-->/);
  if (match) {
    let steps: AgentStep[] = [];
    try { steps = JSON.parse(match[1]); } catch {}
    const cleanContent = content.replace(/<!--STEPS_JSON:[\s\S]*?STEPS_JSON_END-->/, '').trim();
    return { cleanContent, steps };
  }
  return { cleanContent: content, steps: [] };
}

function embedStepsInContent(content: string, steps: AgentStep[]): string {
  return `${content.trim()}\n<!--STEPS_JSON:${JSON.stringify(steps)}STEPS_JSON_END-->`;
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage helpers
// ─────────────────────────────────────────────────────────────────────────────

const LS_INPUT_KEY = () => `agentchat_input_${new Date().toISOString().slice(0, 10)}`;
const LS_SESSIONS_KEY = 'agentchat_sessions_mirror';
const LS_ACTIVE_KEY = 'agentchat_active_session';
const LS_MSGS_PREFIX = 'agentchat_msgs_';

function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}

function lsSet(key: string, value: any) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentChat Component
// ─────────────────────────────────────────────────────────────────────────────

export const AgentChat: React.FC<AgentChatProps> = ({ config, onConfigChange, sidebarWidth: _, onResizeStart }) => {
  const [selectedModel, setSelectedModel] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(() => lsGet('chat_proxy_enabled', false));
  const [proxyUrl, setProxyUrl] = useState(() => lsGet('chat_proxy_url', ''));

  useEffect(() => { lsSet('chat_proxy_enabled', proxyEnabled); }, [proxyEnabled]);
  useEffect(() => { lsSet('chat_proxy_url', proxyUrl); }, [proxyUrl]);

  // Sessions
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(lsGet(LS_ACTIVE_KEY, null));
  const [showHistory, setShowHistory] = useState(false);

  // Messages
  const [messages, setMessages] = useState<Message[]>([]);

  // Live agent steps (while streaming)
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);

  // Input
  const [inputPrompt, setInputPrompt] = useState<string>(() => lsGet(LS_INPUT_KEY(), ''));
  const [loading, setLoading] = useState(false);

  // Inline editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Model options ──
  const poolModels = (config.virtualModels || []).map(vm => ({ id: vm.id, label: vm.name || vm.id, group: 'pools' }));
  const providerModels: { id: string; label: string; group: string }[] = [];
  (config.providers || []).forEach(p => {
    if (p.enabled && p.models?.length > 0) {
      const seenModelIds = new Set<string>();
      p.models.forEach(m => {
        if (seenModelIds.has(m.id)) return;
        seenModelIds.add(m.id);
        providerModels.push({ id: m.id, label: m.id, group: p.name });
      });
    }
  });
  const providerGroups: Record<string, { id: string; label: string }[]> = {};
  providerModels.forEach(m => {
    if (!providerGroups[m.group]) providerGroups[m.group] = [];
    providerGroups[m.group].push({ id: m.id, label: m.label });
  });

  // ── Auto-select model ──
  useEffect(() => {
    const allIds = [...poolModels.map(m => m.id), ...providerModels.map(m => m.id)];
    if (!selectedModel || !allIds.includes(selectedModel)) {
      if (poolModels.length > 0) setSelectedModel(poolModels[0].id);
      else if (providerModels.length > 0) setSelectedModel(providerModels[0].id);
    }
  }, [config]);

  // ── Auto-scroll ──
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, liveSteps, loading]);

  // ── Auto-grow textarea ──
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = '48px';
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 48), 160)}px`;
  }, [inputPrompt]);

  // ── Persist input to localStorage ──
  useEffect(() => { lsSet(LS_INPUT_KEY(), inputPrompt); }, [inputPrompt]);

  // ── Load sessions from server + localStorage ──
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const serverSessions = await getSessions();
      setSessions(serverSessions);
      lsSet(LS_SESSIONS_KEY, serverSessions);

      // Restore or create active session
      const savedActiveId = lsGet<string | null>(LS_ACTIVE_KEY, null);
      const found = serverSessions.find(s => s.id === savedActiveId);
      if (found) {
        await switchToSession(found.id, serverSessions);
      } else if (serverSessions.length > 0) {
        await switchToSession(serverSessions[0].id, serverSessions);
      } else {
        await handleNewChat(serverSessions);
      }
    } catch {
      // Offline: restore from localStorage
      const lsSessions = lsGet<ChatSession[]>(LS_SESSIONS_KEY, []);
      setSessions(lsSessions);
      const savedActiveId = lsGet<string | null>(LS_ACTIVE_KEY, null);
      if (savedActiveId) {
        restoreMessagesFromLS(savedActiveId);
        setActiveSessionId(savedActiveId);
      } else {
        setMessages([getWelcomeMessage()]);
      }
    }
  };

  const switchToSession = async (sessionId: string, _sessionList?: ChatSession[]) => {
    setActiveSessionId(sessionId);
    lsSet(LS_ACTIVE_KEY, sessionId);
    // Try server, fall back to LS
    try {
      const serverMsgs = await getSessionMessages(sessionId);
      if (serverMsgs.length > 0) {
        const parsed: Message[] = serverMsgs.map(m => {
          const { cleanContent, steps } = parseStepsFromContent(m.content);
          return {
            role: m.role as Message['role'],
            content: cleanContent,
            steps,
            stepsCollapsed: steps.length > 0,
          };
        });
        setMessages(parsed);
        lsSet(LS_MSGS_PREFIX + sessionId, parsed);
        return;
      }
    } catch {}
    restoreMessagesFromLS(sessionId);
  };

  const restoreMessagesFromLS = (sessionId: string) => {
    const lsMsgs = lsGet<Message[]>(LS_MSGS_PREFIX + sessionId, []);
    setMessages(lsMsgs.length > 0 ? lsMsgs : [getWelcomeMessage()]);
  };

  const getWelcomeMessage = (): Message => ({
    role: 'assistant',
    content: `Hello! I'm your Gateway Agent.\nI can answer questions, manage pools/aliases/keys, sync providers, or perform dashboard operations!\n\nExamples:\n- "What is the status of the gateway?"\n- "Please sync Groq."\n- "Show my active routing pools."\n- "Add a provider named local-ollama with base URL http://localhost:11434/v1"`,
  });

  const handleNewChat = async (sessionList?: ChatSession[]) => {
    try {
      const newSession = await createSession();
      const updated = [newSession, ...(sessionList ?? sessions)];
      setSessions(updated);
      lsSet(LS_SESSIONS_KEY, updated);
      setActiveSessionId(newSession.id);
      lsSet(LS_ACTIVE_KEY, newSession.id);
      const welcome = getWelcomeMessage();
      setMessages([welcome]);
      lsSet(LS_MSGS_PREFIX + newSession.id, [welcome]);
    } catch {
      setMessages([getWelcomeMessage()]);
    }
    setShowHistory(false);
  };

  const handleDeleteSession = async (sessionId: string) => {
    try { await deleteSession(sessionId); } catch {}
    const updated = sessions.filter(s => s.id !== sessionId);
    setSessions(updated);
    lsSet(LS_SESSIONS_KEY, updated);
    if (sessionId === activeSessionId) {
      if (updated.length > 0) {
        await switchToSession(updated[0].id, updated);
      } else {
        await handleNewChat(updated);
      }
    }
  };

  // ── Persist messages to LS whenever they change ──
  useEffect(() => {
    if (activeSessionId && messages.length > 0) {
      lsSet(LS_MSGS_PREFIX + activeSessionId, messages);
    }
  }, [messages, activeSessionId]);

  // ── Auto-title session on first user message ──
  const autoTitleSession = async (userText: string) => {
    if (!activeSessionId) return;
    const session = sessions.find(s => s.id === activeSessionId);
    if (!session || session.title !== 'New Chat') return;
    const newTitle = userText.slice(0, 25) + (userText.length > 25 ? '...' : '');
    try {
      const updated = await updateSessionTitle(activeSessionId, newTitle);
      setSessions(prev => prev.map(s => s.id === activeSessionId ? updated : s));
    } catch {}
  };

  // ── Send message ──
  const handleSend = async (overridePrompt?: string) => {
    const promptText = (overridePrompt ?? inputPrompt).trim();
    if (!promptText || loading) return;

    // Dedup check
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser && isSimilarInput(lastUser.content, promptText)) {
      // Still allow send but just don't double-send identical
    }

    if (!overridePrompt) setInputPrompt('');
    setLoading(true);
    setLiveSteps([]);

    const userMsg: Message = { role: 'user', content: promptText };
    const updatedMsgs = [...messages, userMsg];
    setMessages(updatedMsgs);

    // Auto-title
    await autoTitleSession(promptText);

    // Save user message to server
    if (activeSessionId) {
      try { await saveMessage(activeSessionId, 'user', promptText); } catch {}
    }

    // Build API message history (strip steps embed)
    const apiMessages = updatedMsgs
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const result = await streamChatAssistant(
        { messages: apiMessages, model: selectedModel, proxyEnabled, proxyUrl },
        (step) => {
          setLiveSteps(prev => {
            const updated = prev.map(s => ({ ...s, done: true }));
            return [...updated, { text: step, done: false }];
          });
        }
      );

      const finalSteps = [...liveSteps.map(s => ({ ...s, done: true }))];

      if (result.success) {
        const rawContent = result.message?.content || 'Action executed successfully.';
        // Embed steps into content for persistence
        const contentWithSteps = finalSteps.length > 0
          ? embedStepsInContent(rawContent, finalSteps)
          : rawContent;

        const assistantMsg: Message = {
          role: 'assistant',
          content: rawContent,
          traces: result.traces,
          steps: finalSteps,
          stepsCollapsed: false, // expanded right after response
        };

        const finalMsgs = [...updatedMsgs, assistantMsg];
        setMessages(finalMsgs);
        setLiveSteps([]);

        // Persist to server
        if (activeSessionId) {
          try { await saveMessage(activeSessionId, 'assistant', contentWithSteps, finalSteps.map(s => s.text)); } catch {}
        }

        if (result.traces && result.traces.length > 0) onConfigChange?.();
      } else {
        throw new Error(result.error || 'Failed status.');
      }
    } catch (err: any) {
      setMessages([...updatedMsgs, { role: 'system', content: `Error: ${err.message || 'Failed to complete.'}` }]);
      setLiveSteps([]);
    } finally {
      setLoading(false);
    }
  };

  // ── Inline Edit ──
  const startEdit = (idx: number) => {
    setEditingIndex(idx);
    setEditText(messages[idx].content);
    setTimeout(() => editTextareaRef.current?.focus(), 50);
  };

  const cancelEdit = () => { setEditingIndex(null); setEditText(''); };

  const submitEdit = async (idx: number) => {
    const newText = editText.trim();
    if (!newText) return cancelEdit();

    // Truncate messages from this index
    const truncated = messages.slice(0, idx);
    setMessages(truncated);
    setEditingIndex(null);
    setEditText('');

    // Truncate on server
    if (activeSessionId) {
      try { await truncateMessages(activeSessionId, idx); } catch {}
    }

    // Re-send with new text
    await handleSend(newText);
  };

  // ── Retry ──
  const retryFrom = async (idx: number) => {
    const retryText = messages[idx].content;
    const truncated = messages.slice(0, idx);
    setMessages(truncated);

    if (activeSessionId) {
      try { await truncateMessages(activeSessionId, idx); } catch {}
    }

    await handleSend(retryText);
  };

  // ── Toggle step collapse ──
  const toggleSteps = (msgIdx: number) => {
    setMessages(prev => prev.map((m, i) =>
      i === msgIdx ? { ...m, stepsCollapsed: !m.stepsCollapsed } : m
    ));
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* Drag Handle */}
      <div
        onMouseDown={onResizeStart}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '5px',
          cursor: 'col-resize',
          zIndex: 10,
          background: 'transparent',
        }}
        title="Drag to resize"
      />

      {/* ── Header ── */}
      <div style={{
        padding: '0.65rem 1rem 0.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#05070f',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#e4e8f5' }}>
            🤖 <span style={{ background: 'linear-gradient(90deg,#7c8dff,#a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Gateway Agent</span>
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {/* + New Chat shortcut */}
            <HeaderIconBtn title="New Chat" onClick={() => handleNewChat()}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
            </HeaderIconBtn>

            {/* Export */}
            <HeaderIconBtn title="Export Chat as Markdown" onClick={() => exportToMarkdown(messages, activeSession?.title || 'Chat')}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 11v2h10v-2M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </HeaderIconBtn>

            {/* History toggle */}
            <HeaderIconBtn title="Chat History" onClick={() => setShowHistory(v => !v)} active={showHistory}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.8"/><path d="M8 5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </HeaderIconBtn>
          </div>
        </div>

        {/* Session title */}
        {activeSession && (
          <div style={{ fontSize: '0.68rem', color: '#6b7280', fontStyle: 'italic', paddingLeft: '0.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeSession.title}
          </div>
        )}

        {/* Model selector + proxy row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.45rem', alignItems: 'center' }}>
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            style={{ fontSize: '0.72rem', padding: '0.22rem 0.4rem', background: '#0b0f19', color: '#c5c9db', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', width: '100%', cursor: 'pointer' }}
          >
            {poolModels.length > 0 && (
              <optgroup label="🔀 Routing Pools">
                {poolModels.map(m => <option key={`pool-${m.id}`} value={m.id}>{m.label}</option>)}
              </optgroup>
            )}
            {Object.keys(providerGroups).map(g => (
              <optgroup key={g} label={`📡 ${g}`}>
                {providerGroups[g].map((m, index) => <option key={`${g}-${m.id}-${index}`} value={m.id}>{m.label}</option>)}
              </optgroup>
            ))}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
            <input type="checkbox" id="chatProxy" checked={proxyEnabled} onChange={e => setProxyEnabled(e.target.checked)} style={{ width: 'auto', cursor: 'pointer', margin: 0 }} />
            <label htmlFor="chatProxy" style={{ fontSize: '0.65rem', cursor: 'pointer', color: '#6b7280', userSelect: 'none' }}>Proxy</label>
          </div>
        </div>
        {proxyEnabled && (
          <input type="text" placeholder="socks5://127.0.0.1:1080" value={proxyUrl} onChange={e => setProxyUrl(e.target.value)}
            style={{ fontSize: '0.72rem', padding: '0.22rem 0.4rem', background: '#0b0f19', color: '#c5c9db', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', width: '100%', outline: 'none' }}
          />
        )}
      </div>

      {/* ── History Drawer ── */}
      {showHistory && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: '#07090f',
          zIndex: 20,
          display: 'flex', flexDirection: 'column',
          animation: 'slideInFromTop 0.22s cubic-bezier(0.4,0,0.2,1)',
        }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#05070f' }}>
            <span style={{ fontWeight: 700, fontSize: '0.83rem', color: '#e4e8f5' }}>💬 Chat History</span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" onClick={() => handleNewChat()} style={{ fontSize: '0.7rem', padding: '0.25rem 0.6rem', background: 'rgba(124,141,255,0.15)', border: '1px solid rgba(124,141,255,0.3)', borderRadius: '5px', color: '#7c8dff', cursor: 'pointer' }}>
                + New Chat
              </button>
              <button type="button" onClick={() => setShowHistory(false)} style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', color: '#6b7280', cursor: 'pointer' }}>
                ✕
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
            {sessions.length === 0 && (
              <div style={{ textAlign: 'center', color: '#4b5563', fontSize: '0.8rem', marginTop: '2rem' }}>No conversations yet.</div>
            )}
            {sessions.map(s => (
              <div key={s.id}
                onClick={() => { switchToSession(s.id); setShowHistory(false); }}
                style={{
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  marginBottom: '0.25rem',
                  cursor: 'pointer',
                  background: s.id === activeSessionId ? 'rgba(124,141,255,0.12)' : 'transparent',
                  border: `1px solid ${s.id === activeSessionId ? 'rgba(124,141,255,0.3)' : 'transparent'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (s.id !== activeSessionId) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if (s.id !== activeSessionId) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#c5c9db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                  <div style={{ fontSize: '0.65rem', color: '#4b5563' }}>{new Date(s.createdAt).toLocaleDateString()}</div>
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); handleDeleteSession(s.id); }}
                  style={{ flexShrink: 0, padding: '0.15rem 0.35rem', fontSize: '0.6rem', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '4px', color: '#ef4444', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      <div style={{ flex: 1, padding: '0.85rem 0.75rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.7rem', background: '#0b0f19' }}>
        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          const isSystem = msg.role === 'system';

          return (
            <div key={idx} style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '93%', display: 'flex', flexDirection: 'column', gap: '0.25rem', animation: 'chatMsgIn 0.25s cubic-bezier(0.4,0,0.2,1)' }}>

              {/* ── User bubble with inline edit ── */}
              {isUser && editingIndex === idx ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <textarea
                    ref={editTextareaRef}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(idx); } if (e.key === 'Escape') cancelEdit(); }}
                    rows={3}
                    style={{ fontSize: '0.83rem', padding: '0.55rem 0.75rem', background: '#131b2e', color: '#e4e8f5', border: '1px solid rgba(124,141,255,0.4)', borderRadius: '10px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: '1.45', width: '100%' }}
                  />
                  <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={cancelEdit} style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#6b7280', cursor: 'pointer' }}>Cancel</button>
                    <button type="button" onClick={() => submitEdit(idx)} style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', background: 'rgba(124,141,255,0.2)', border: '1px solid rgba(124,141,255,0.4)', borderRadius: '4px', color: '#7c8dff', cursor: 'pointer' }}>Submit</button>
                  </div>
                </div>
              ) : (
                <div style={{ position: 'relative', group: 'msg' } as any}>
                  <div style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    background: isUser ? 'rgba(124,141,255,0.18)' : isSystem ? 'rgba(239,68,68,0.1)' : '#131b2e',
                    border: `1px solid ${isUser ? 'rgba(124,141,255,0.35)' : isSystem ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    color: isSystem ? '#ef4444' : '#e4e8f5',
                    fontSize: '0.84rem',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {msg.content}
                  </div>

                  {/* User message action buttons */}
                  {isUser && !loading && (
                    <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', marginTop: '0.2rem' }}>
                      <MsgActionBtn onClick={() => startEdit(idx)}>✏️ Edit</MsgActionBtn>
                      <MsgActionBtn onClick={() => retryFrom(idx)}>🔄 Retry</MsgActionBtn>
                    </div>
                  )}
                </div>
              )}

              {/* ── Agent steps log (collapsible) ── */}
              {!isUser && msg.steps && msg.steps.length > 0 && (
                <div style={{ marginTop: '0.15rem' }}>
                  <button
                    type="button"
                    onClick={() => toggleSteps(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.3rem',
                      fontSize: '0.65rem', padding: '0.15rem 0.4rem',
                      background: 'rgba(124,141,255,0.08)',
                      border: '1px solid rgba(124,141,255,0.15)',
                      borderRadius: '4px', color: '#7c8dff', cursor: 'pointer',
                      marginBottom: '0.2rem',
                    }}
                  >
                    <span style={{ transform: msg.stepsCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', display: 'inline-block', transition: 'transform 0.2s' }}>▶</span>
                    {msg.steps.length} agent step{msg.steps.length !== 1 ? 's' : ''}
                  </button>

                  {!msg.stepsCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem', paddingLeft: '0.4rem', borderLeft: '2px solid rgba(124,141,255,0.2)' }}>
                      {msg.steps.map((step, si) => (
                        <div key={si} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', color: step.done ? '#6b7280' : '#7c8dff', fontFamily: 'monospace' }}>
                          <span>{step.done ? '✓' : '●'}</span>
                          <span style={{ textDecoration: step.done ? 'none' : 'none' }}>{step.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tool traces */}
              {!isUser && msg.traces && msg.traces.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem' }}>
                  {msg.traces.map((trace, ti) => (
                    <div key={ti} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#7c8dff', fontFamily: 'monospace' }}>
                      🔧 <strong>{trace.toolName}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Live streaming steps ── */}
        {loading && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '93%', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <div style={{ padding: '0.6rem 0.85rem', borderRadius: '12px 12px 12px 4px', background: '#131b2e', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', color: '#6b7280' }}>
              <span style={{ display: 'flex', gap: '3px' }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#7c8dff', display: 'inline-block', animation: `bounce 0.7s infinite ${i * 0.15}s` }} />
                ))}
              </span>
              <span>Agent working...</span>
            </div>

            {liveSteps.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem', paddingLeft: '0.4rem', borderLeft: '2px solid rgba(124,141,255,0.2)' }}>
                {liveSteps.map((step, si) => (
                  <div key={si} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', color: step.done ? '#4b5563' : '#7c8dff', fontFamily: 'monospace', animation: step.done ? 'none' : 'chatMsgIn 0.2s ease' }}>
                    <span>{step.done ? '✓' : '⟳'}</span>
                    <span>{step.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Bar ── */}
      <form
        onSubmit={e => { e.preventDefault(); handleSend(); }}
        style={{ padding: '0.65rem', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#05070f', display: 'flex', gap: '0.4rem', alignItems: 'flex-end', flexShrink: 0 }}
      >
        <textarea
          ref={textareaRef}
          placeholder="Ask the agent anything… (Shift+Enter for newline)"
          value={inputPrompt}
          onChange={e => setInputPrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          disabled={loading}
          style={{
            flex: 1,
            fontSize: '0.84rem',
            padding: '0.5rem 0.65rem',
            border: '1px solid rgba(255,255,255,0.08)',
            background: '#0b0f19',
            color: '#e4e8f5',
            borderRadius: '8px',
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
            lineHeight: '1.45',
            minHeight: '48px',
            maxHeight: '160px',
            overflowY: 'auto',
            transition: 'border-color 0.2s',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(124,141,255,0.45)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
        />
        <button
          type="submit"
          disabled={loading || !inputPrompt.trim()}
          style={{
            padding: '0 0.85rem',
            fontSize: '0.8rem',
            fontWeight: 700,
            height: '36px',
            borderRadius: '8px',
            background: loading || !inputPrompt.trim() ? 'rgba(124,141,255,0.1)' : 'rgba(124,141,255,0.8)',
            border: '1px solid rgba(124,141,255,0.3)',
            color: loading || !inputPrompt.trim() ? '#4b5563' : '#fff',
            cursor: loading || !inputPrompt.trim() ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            transition: 'all 0.2s',
          }}
        >
          {loading ? '…' : '↑'}
        </button>
      </form>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes chatMsgIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInFromTop {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Small sub-components
// ─────────────────────────────────────────────────────────────────────────────

const HeaderIconBtn: React.FC<{ title: string; onClick: () => void; active?: boolean; children: React.ReactNode }> = ({ title, onClick, active, children }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    style={{
      width: '26px', height: '26px', borderRadius: '6px',
      background: active ? 'rgba(124,141,255,0.18)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${active ? 'rgba(124,141,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
      color: active ? '#7c8dff' : '#6b7280',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 0, transition: 'all 0.15s',
    }}
    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#7c8dff'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,141,255,0.4)'; }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = active ? '#7c8dff' : '#6b7280'; (e.currentTarget as HTMLElement).style.borderColor = active ? 'rgba(124,141,255,0.4)' : 'rgba(255,255,255,0.08)'; }}
  >
    {children}
  </button>
);

const MsgActionBtn: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      fontSize: '0.62rem', padding: '0.1rem 0.35rem',
      background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '4px', color: '#4b5563', cursor: 'pointer', transition: 'all 0.15s',
    }}
    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#7c8dff'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,141,255,0.3)'; }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
  >
    {children}
  </button>
);
