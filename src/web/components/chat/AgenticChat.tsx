import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  Plus,
  History,
  Copy,
  Check,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Brain,
  Wrench,
  Loader2,
  AlertCircle,
  RotateCcw,
  Zap,
  Terminal,
  ShieldCheck,
  X,
} from 'lucide-react';
import { sanitizeForClipboard } from '../../utils/clipboardSanitizer.js';
import { ChatHistoryDrawer, ChatSession } from './ChatHistoryDrawer.js';

export interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, any>;
  status: 'running' | 'success' | 'error';
  result?: any;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  thinking?: string;
  isThinking?: boolean;
  toolCalls?: ToolCallState[];
}

const STORAGE_SESSIONS_KEY = 'goalroute_chat_sessions_v1';
const STORAGE_MESSAGES_KEY_PREFIX = 'goalroute_chat_msgs_v1_';

export const AgenticChat: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [availableTools, setAvailableTools] = useState<Array<{ name: string; description: string; inputSchema: any }>>([]);
  
  // Message edit state
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editMsgDraft, setEditMsgDraft] = useState('');

  // Copy state tracker
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // Collapsible sections state
  const [expandedThinks, setExpandedThinks] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing]);

  // Load available MCP tools on mount
  useEffect(() => {
    fetch('/api/v1/mcp/tools')
      .then((res) => (res.ok ? res.json() : { tools: [] }))
      .then((data) => {
        if (Array.isArray(data.tools)) {
          setAvailableTools(data.tools);
        }
      })
      .catch(() => {});
  }, []);

  // Initialize or load sessions from localStorage
  useEffect(() => {
    try {
      const savedSessionsRaw = localStorage.getItem(STORAGE_SESSIONS_KEY);
      if (savedSessionsRaw) {
        const parsed: ChatSession[] = JSON.parse(savedSessionsRaw);
        if (parsed.length > 0) {
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
          return;
        }
      }
    } catch {}

    // Create initial session if none exists
    createNewSession();
  }, []);

  // Sync active session messages when activeSessionId changes
  useEffect(() => {
    if (!activeSessionId) return;
    try {
      const msgsRaw = localStorage.getItem(`${STORAGE_MESSAGES_KEY_PREFIX}${activeSessionId}`);
      if (msgsRaw) {
        setMessages(JSON.parse(msgsRaw));
      } else {
        const welcomeMsg: ChatMessage = {
          id: 'welcome-msg',
          role: 'assistant',
          content: 'Hello! I am your GoalRoute Agentic Copilot. I can monitor provider quotas, optimize LLM routing goals, probe live API key latencies, and mutate pool configurations via MCP. How can I assist you today?',
          timestamp: Date.now(),
        };
        setMessages([welcomeMsg]);
        localStorage.setItem(`${STORAGE_MESSAGES_KEY_PREFIX}${activeSessionId}`, JSON.stringify([welcomeMsg]));
      }
    } catch {
      setMessages([]);
    }
  }, [activeSessionId]);

  // Save current messages to localStorage
  const saveMessages = (sessionId: string, newMsgs: ChatMessage[]) => {
    setMessages(newMsgs);
    try {
      localStorage.setItem(`${STORAGE_MESSAGES_KEY_PREFIX}${sessionId}`, JSON.stringify(newMsgs));
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === sessionId) {
            const userMsg = newMsgs.find((m) => m.role === 'user');
            const title = userMsg ? userMsg.content.slice(0, 30) + (userMsg.content.length > 30 ? '...' : '') : s.title;
            return { ...s, title, updatedAt: Date.now(), messageCount: newMsgs.length };
          }
          return s;
        })
      );
    } catch {}
  };

  // Sync sessions list to localStorage
  useEffect(() => {
    if (sessions.length > 0) {
      try {
        localStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(sessions));
      } catch {}
    }
  }, [sessions]);

  const createNewSession = () => {
    const newId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newSession: ChatSession = {
      id: newId,
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 1,
    };
    const welcomeMsg: ChatMessage = {
      id: 'welcome-msg',
      role: 'assistant',
      content: 'Hello! I am your GoalRoute Agentic Copilot. I can inspect quotas, solve routing goals, probe keys, and run MCP actions for you. What would you like to build or inspect?',
      timestamp: Date.now(),
    };

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newId);
    setMessages([welcomeMsg]);
    try {
      localStorage.setItem(`${STORAGE_MESSAGES_KEY_PREFIX}${newId}`, JSON.stringify([welcomeMsg]));
    } catch {}
  };

  const handleRenameSession = (id: string, newTitle: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: newTitle, updatedAt: Date.now() } : s))
    );
  };

  const handleDeleteSession = (id: string) => {
    const updated = sessions.filter((s) => s.id !== id);
    setSessions(updated);
    try {
      localStorage.removeItem(`${STORAGE_MESSAGES_KEY_PREFIX}${id}`);
    } catch {}

    if (activeSessionId === id) {
      if (updated.length > 0) {
        setActiveSessionId(updated[0].id);
      } else {
        createNewSession();
      }
    }
  };

  // Execute MCP Tool call
  const executeMcpTool = async (toolName: string, args: Record<string, any>): Promise<any> => {
    const adminToken =
      sessionStorage.getItem('goalroute_admin_token') ||
      localStorage.getItem('goalroute_admin_token') ||
      'dev-admin-secret-token';

    const res = await fetch('/api/v1/mcp/call', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: toolName, arguments: args }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
      throw new Error(errData?.error?.message || errData?.message || `Tool call failed (${res.status})`);
    }

    return await res.json();
  };

  // Helper to parse <think> tags from text content
  const parseThinkingContent = (rawText: string) => {
    const thinkMatch = rawText.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      const thinking = thinkMatch[1].trim();
      const cleanContent = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      return { thinking, content: cleanContent };
    }
    return { thinking: undefined, content: rawText };
  };

  // Core Agent Execution Loop
  const handleSendMessage = async (textToSend?: string) => {
    const promptText = (textToSend || inputText).trim();
    if (!promptText || !activeSessionId || isProcessing) return;

    setInputText('');
    const userMsgId = `user_${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: promptText,
      timestamp: Date.now(),
    };

    const updatedMsgs = [...messages, userMsg];
    saveMessages(activeSessionId, updatedMsgs);
    setIsProcessing(true);

    const assistantMsgId = `asst_${Date.now()}`;
    let currentAssistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isThinking: true,
      thinking: 'Analyzing task and inspecting MCP capabilities...',
      toolCalls: [],
    };

    setMessages([...updatedMsgs, currentAssistantMsg]);

    try {
      const adminToken =
        sessionStorage.getItem('goalroute_admin_token') ||
        localStorage.getItem('goalroute_admin_token') ||
        'dev-admin-secret-token';

      // Check if user prompt requests tool execution
      const lowerPrompt = promptText.toLowerCase();
      let matchedTool: string | null = null;
      let toolArgs: Record<string, any> = {};

      if (lowerPrompt.includes('quota') || lowerPrompt.includes('health') || lowerPrompt.includes('limit')) {
        matchedTool = 'check_quota';
      } else if (lowerPrompt.includes('probe') || lowerPrompt.includes('test key') || lowerPrompt.includes('ping key')) {
        matchedTool = 'probe_provider_keys';
      } else if (lowerPrompt.includes('route') || lowerPrompt.includes('solve') || lowerPrompt.includes('optimal')) {
        matchedTool = 'solve_routing_goal';
        toolArgs = { task: lowerPrompt };
      } else if (lowerPrompt.includes('pool') || lowerPrompt.includes('mutate')) {
        matchedTool = 'mutate_pools';
        toolArgs = { action: lowerPrompt.includes('delete') ? 'delete' : 'create', name: 'Agent Pool' };
      }

      let toolResultData: any = null;

      if (matchedTool) {
        const callId = `call_${Date.now()}`;
        const initialToolCall: ToolCallState = {
          id: callId,
          name: matchedTool,
          args: toolArgs,
          status: 'running',
        };

        currentAssistantMsg.toolCalls = [initialToolCall];
        setMessages([...updatedMsgs, currentAssistantMsg]);

        try {
          toolResultData = await executeMcpTool(matchedTool, toolArgs);
          currentAssistantMsg.toolCalls = [
            {
              id: callId,
              name: matchedTool,
              args: toolArgs,
              status: 'success',
              result: toolResultData,
            },
          ];
        } catch (toolErr: any) {
          currentAssistantMsg.toolCalls = [
            {
              id: callId,
              name: matchedTool,
              args: toolArgs,
              status: 'error',
              error: toolErr.message || 'Tool execution error',
            },
          ];
        }
      }

      // Call GoalRoute OpenAI Chat Completions API
      const apiMessages = updatedMsgs.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      if (toolResultData) {
        apiMessages.push({
          role: 'system',
          content: `MCP Tool Execution Result for '${matchedTool}': ${JSON.stringify(toolResultData)}`,
        });
      }

      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          model: 'auto',
          messages: [
            {
              role: 'system',
              content:
                'You are GoalRoute Copilot, an expert AI routing agent. You analyze LLM capabilities, inspect provider quotas, solve latency constraints, and report MCP status cleanly.',
            },
            ...apiMessages,
          ],
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Gateway returned error HTTP ${res.status}: ${errorText.slice(0, 100)}`);
      }

      const data = await res.json();
      const rawResponseText = data.choices?.[0]?.message?.content || 'Task processed successfully.';

      const parsed = parseThinkingContent(rawResponseText);
      currentAssistantMsg.isThinking = false;
      currentAssistantMsg.thinking = parsed.thinking || (matchedTool ? `Evaluated ${matchedTool} results and formatted optimal recommendation.` : undefined);
      currentAssistantMsg.content = parsed.content;

      const finalMsgs = [...updatedMsgs, currentAssistantMsg];
      saveMessages(activeSessionId, finalMsgs);
    } catch (err: any) {
      currentAssistantMsg.isThinking = false;
      currentAssistantMsg.content = `⚠️ Agent execution encounter: ${err.message || 'Unable to connect to gateway'}`;
      const finalMsgs = [...updatedMsgs, currentAssistantMsg];
      saveMessages(activeSessionId, finalMsgs);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyMessage = (msgId: string, text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(sanitizeForClipboard(text));
    }
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId(null), 1800);
  };

  const handleDeleteMessage = (msgId: string) => {
    if (!activeSessionId) return;
    const updated = messages.filter((m) => m.id !== msgId);
    saveMessages(activeSessionId, updated);
  };

  const handleStartEditMessage = (msg: ChatMessage) => {
    setEditingMsgId(msg.id);
    setEditMsgDraft(msg.content);
  };

  const handleSaveEditMessage = (msgId: string) => {
    if (!activeSessionId || !editMsgDraft.trim()) return;
    const updated = messages.map((m) => (m.id === msgId ? { ...m, content: editMsgDraft.trim() } : m));
    saveMessages(activeSessionId, updated);
    setEditingMsgId(null);
    handleSendMessage(editMsgDraft.trim());
  };

  // Auto-focus input when processing finishes
  useEffect(() => {
    if (!isProcessing) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isProcessing]);

  // Auto-expand input height as text grows multi-line
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const newHeight = Math.min(Math.max(inputRef.current.scrollHeight, 44), 180);
      inputRef.current.style.height = `${newHeight}px`;
    }
  }, [inputText]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-rail)] relative overflow-hidden">
      {/* 1. Header Bar */}
      <div className="p-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-card)]/50 shrink-0">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-xs text-[var(--text-bright)] truncate">
              {activeSession?.title || 'Agentic Copilot'}
            </h2>
            <div className="flex items-center space-x-1.5 text-[10px] text-[var(--text-muted)] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--signal-mint)]" />
              <span>{availableTools.length} MCP Tools Ready</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          <button
            onClick={() => setIsHistoryDrawerOpen(true)}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-bright)] hover:bg-[var(--bg-card-active)] transition-colors"
            title="Chat History"
          >
            <History className="w-4 h-4" />
          </button>
          <button
            onClick={createNewSession}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-bright)] hover:bg-[var(--bg-card-active)] transition-colors"
            title="New Chat"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Message Thread */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const isCopied = copiedMsgId === msg.id;
          const isEditing = editingMsgId === msg.id;
          const isThinkExpanded = expandedThinks[msg.id] ?? false;

          return (
            <div
              key={msg.id}
              className={`flex flex-col space-y-2 group ${isUser ? 'items-end' : 'items-start'}`}
            >
              {/* Message Bubble */}
              <div
                className={`max-w-[92%] rounded-2xl p-3.5 text-xs shadow-md transition-all relative ${
                  isUser
                    ? 'bg-[var(--accent-primary)] text-white rounded-br-none'
                    : 'bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-bl-none'
                }`}
              >
                {/* Visual Thinking Block */}
                {!isUser && (msg.isThinking || msg.thinking) && (
                  <div className="mb-2.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] overflow-hidden">
                    <button
                      onClick={() =>
                        setExpandedThinks((prev) => ({ ...prev, [msg.id]: !isThinkExpanded }))
                      }
                      className="w-full p-2 flex items-center justify-between text-[11px] font-mono text-[var(--accent-primary)] bg-[var(--bg-well)]/80 hover:bg-[var(--bg-card-active)] transition-colors"
                    >
                      <span className="flex items-center gap-1.5 font-semibold">
                        <Brain className={`w-3.5 h-3.5 ${msg.isThinking ? 'animate-pulse text-[var(--signal-mint)]' : ''}`} />
                        {msg.isThinking ? 'Thinking...' : 'Reasoning Process'}
                      </span>
                      {isThinkExpanded ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
                    </button>

                    {(isThinkExpanded || msg.isThinking) && (
                      <div className="p-2.5 text-[11px] font-mono text-[var(--text-secondary)] border-t border-[var(--border-subtle)] leading-relaxed whitespace-pre-wrap bg-slate-950/30">
                        {msg.thinking || 'Evaluating routing policy, active pools, and quota budget...'}
                      </div>
                    )}
                  </div>
                )}

                {/* Tool Calls Cards */}
                {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mb-2.5 space-y-2">
                    {msg.toolCalls.map((tc) => {
                      const isToolExpanded = expandedTools[tc.id] ?? true;
                      return (
                        <div
                          key={tc.id}
                          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-well)] overflow-hidden"
                        >
                          <div className="p-2.5 flex items-center justify-between text-xs bg-[var(--bg-card-active)]/50">
                            <div className="flex items-center space-x-2">
                              <Wrench className="w-3.5 h-3.5 text-[var(--signal-mint)]" />
                              <span className="font-mono font-bold text-[var(--text-bright)]">
                                {tc.name}
                              </span>
                            </div>

                            <div className="flex items-center space-x-2">
                              {tc.status === 'running' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--signal-amber)] bg-[var(--signal-amber)]/10 border border-[var(--signal-amber)]/20 px-2 py-0.5 rounded-full">
                                  <Loader2 className="w-3 h-3 animate-spin" /> Running
                                </span>
                              )}
                              {tc.status === 'success' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--signal-mint)] bg-[var(--signal-mint)]/10 border border-[var(--signal-mint)]/20 px-2 py-0.5 rounded-full font-bold">
                                  <Check className="w-3 h-3" /> Success
                                </span>
                              )}
                              {tc.status === 'error' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--signal-coral)] bg-[var(--signal-coral)]/10 border border-[var(--signal-coral)]/20 px-2 py-0.5 rounded-full font-bold">
                                  <AlertCircle className="w-3 h-3" /> Error
                                </span>
                              )}
                              <button
                                onClick={() =>
                                  setExpandedTools((prev) => ({ ...prev, [tc.id]: !isToolExpanded }))
                                }
                                className="text-[var(--text-muted)] hover:text-[var(--text-bright)]"
                              >
                                {isToolExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                          {isToolExpanded && (
                            <div className="p-2.5 text-[11px] font-mono space-y-2 border-t border-[var(--border-subtle)] bg-slate-950/40">
                              {Object.keys(tc.args).length > 0 && (
                                <div>
                                  <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Arguments</div>
                                  <pre className="p-2 rounded bg-[var(--bg-well)] text-[var(--text-secondary)] overflow-x-auto">
                                    {JSON.stringify(tc.args, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {tc.result && (
                                <div>
                                  <div className="text-[9px] uppercase tracking-wider text-[var(--signal-mint)] mb-1">Execution Output</div>
                                  <pre className="p-2 rounded bg-[var(--bg-well)] text-[var(--signal-mint)]/90 overflow-x-auto max-h-40">
                                    {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {tc.error && (
                                <div>
                                  <div className="text-[9px] uppercase tracking-wider text-[var(--signal-coral)] mb-1">Error Trace</div>
                                  <div className="p-2 rounded bg-[var(--signal-coral)]/10 text-[var(--signal-coral)]">
                                    {tc.error}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Main Content / Edit Input */}
                {isEditing ? (
                  <div className="space-y-2 min-w-[240px]">
                    <textarea
                      value={editMsgDraft}
                      onChange={(e) => setEditMsgDraft(e.target.value)}
                      className="w-full p-2 bg-[var(--bg-well)] border border-[var(--accent-primary)] text-xs text-[var(--text-bright)] rounded-lg focus:outline-none resize-none font-sans"
                      rows={3}
                    />
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => setEditingMsgId(null)}
                        className="px-2.5 py-1 rounded text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-bright)]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSaveEditMessage(msg.id)}
                        className="px-3 py-1 rounded bg-[var(--accent-primary)] text-slate-950 font-bold text-[11px]"
                      >
                        Save &amp; Submit
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="leading-relaxed whitespace-pre-wrap font-sans">
                    {msg.content}
                  </div>
                )}

                {/* Timestamp */}
                <div
                  className={`text-[9px] font-mono mt-1 text-right ${
                    isUser ? 'text-white/70' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              {/* Action Toolbar on Hover */}
              {!isEditing && (
                <div
                  className={`flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity px-1 ${
                    isUser ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <button
                    onClick={() => handleCopyMessage(msg.id, msg.content)}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-bright)] hover:bg-[var(--bg-card-active)] transition-colors"
                    title="Copy message"
                  >
                    {isCopied ? <Check className="w-3 h-3 text-[var(--signal-mint)]" /> : <Copy className="w-3 h-3" />}
                  </button>

                  {isUser && (
                    <button
                      onClick={() => handleStartEditMessage(msg)}
                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-bright)] hover:bg-[var(--bg-card-active)] transition-colors"
                      title="Edit message"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  )}

                  <button
                    onClick={() => handleDeleteMessage(msg.id)}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--signal-coral)] hover:bg-[var(--bg-card-active)] transition-colors"
                    title="Delete message"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* 3. Input Box Footer */}
      <div className="p-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/40 space-y-2 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="relative flex items-end"
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Ask agent copilot or query MCP tools..."
            disabled={isProcessing}
            autoFocus
            className="w-full pr-12 pl-3 py-2.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] text-xs text-[var(--text-bright)] rounded-xl focus:outline-none resize-none transition-all custom-scrollbar leading-relaxed"
            style={{ minHeight: '44px', maxHeight: '180px' }}
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isProcessing}
            className="absolute right-2 bottom-2 p-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-slate-950 font-bold disabled:opacity-40 transition-all shadow-md active:scale-95"
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>

        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono px-1">
          <span>Press Enter to send • Shift+Enter for new line</span>
          <span className="text-[var(--signal-mint)]">MCP Active</span>
        </div>
      </div>

      {/* History Drawer Component */}
      <ChatHistoryDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => setActiveSessionId(id)}
        onNewChat={createNewSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
      />
    </div>
  );
};
