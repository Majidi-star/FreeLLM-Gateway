import React, { useState, useEffect, useRef } from 'react';
import { 
  getGatewayModels, 
  askChatAssistant, 
  API_BASE 
} from '../utils/api';

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  traces?: { toolName: string; args: any }[];
}

export const Sandbox: React.FC = () => {
  const [chatMode, setChatMode] = useState<'agent' | 'direct'>('agent');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('strong-reasoning');
  
  // Custom Chat Proxy State
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');

  // Messages History
  const [messages, setMessages] = useState<Message[]>([
    { 
      role: 'assistant', 
      content: `Hello! I am your LLM Pool Gateway Agentic Assistant.
I can answer general questions, but I am also equipped with tools to control your gateway configuration!

Try asking me commands like:
- "What is the status of the gateway?"
- "Please sync the model list for Groq."
- "Show my active routing pools."
- "Add a custom provider named local-ollama with endpoint URL http://localhost:11434/v1"
- "Delete NLP Cloud from my database."`
    }
  ]);

  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch available models on mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await getGatewayModels();
        const cleanList = res.data.map(m => ({
          id: m.id,
          name: m.id
        }));
        setModels(cleanList);
        
        // Match default model if it exists
        if (cleanList.some(m => m.id === 'strong-reasoning')) {
          setSelectedModel('strong-reasoning');
        } else if (cleanList.length > 0) {
          setSelectedModel(cleanList[0].id);
        }
      } catch (err) {
        console.error('Error loading gateway models:', err);
      }
    };
    fetchModels();
  }, []);

  // Auto scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleClearChat = () => {
    setMessages([
      {
        role: 'assistant',
        content: chatMode === 'agent' 
          ? 'History cleared. Ask me anything or command me to sync, list, or CRUD providers!'
          : `History cleared. Direct connection playground active. Pointed to model: "${selectedModel}".`
      }
    ]);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPrompt.trim() || loading) return;

    const userMessageText = inputPrompt;
    setInputPrompt('');
    setLoading(true);

    const updatedMessages = [...messages, { role: 'user', content: userMessageText } as Message];
    setMessages(updatedMessages);

    try {
      if (chatMode === 'agent') {
        // --- AGENTIC MODE (Function Calling) ---
        // Exclude system message or formatting details from sending, keep user/assistant history
        const apiMessages = updatedMessages.map(m => ({
          role: m.role,
          content: m.content
        }));

        const res = await askChatAssistant({
          messages: apiMessages,
          model: selectedModel,
          proxyEnabled,
          proxyUrl
        });

        if (res.success) {
          setMessages([
            ...updatedMessages,
            { 
              role: 'assistant', 
              content: res.message.content || 'Action executed successfully.',
              traces: res.traces 
            }
          ]);
        } else {
          throw new Error('Completions returned failed status.');
        }
      } else {
        // --- DIRECT GATEWAY COMPLETIONS MODE ---
        // Normal direct completion call
        const apiMessages = updatedMessages.map(m => ({
          role: m.role,
          content: m.content
        }));

        const completionsUrl = `${API_BASE}/v1/chat/completions`;
        const payload: any = {
          model: selectedModel,
          messages: apiMessages,
          stream: false
        };

        if (proxyEnabled && proxyUrl) {
          payload._chatProxy = { proxyEnabled, proxyUrl };
        }

        // Direct request
        const res = await fetch(completionsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || 'Gateway completion failed.');
        }

        const text = data.choices[0].message.content;
        setMessages([
          ...updatedMessages,
          { role: 'assistant', content: text }
        ]);
      }
    } catch (err: any) {
      setMessages([
        ...updatedMessages,
        { 
          role: 'system', 
          content: `Error: ${err.message || 'Failed to complete message query.'}` 
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{
      display: 'grid',
      gridTemplateColumns: '1fr 300px',
      gap: '1.5rem',
      height: 'calc(100vh - 210px)',
      minHeight: '500px'
    }}>
      {/* Left Chat Window */}
      <div className="glass-panel" style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {/* Chat History Panel */}
        <div style={{
          flex: 1,
          padding: '1.5rem',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            const isSystem = msg.role === 'system';
            
            return (
              <div 
                key={idx} 
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem'
                }}
              >
                {/* Message Bubble */}
                <div style={{
                  padding: '1rem 1.25rem',
                  borderRadius: '12px',
                  background: isUser 
                    ? 'var(--accent-glow)' 
                    : isSystem 
                      ? 'var(--error-glow)' 
                      : 'oklch(18% 0.015 255.4 / 0.7)',
                  border: `1px solid ${
                    isUser 
                      ? 'var(--accent)' 
                      : isSystem 
                        ? 'var(--error)' 
                        : 'var(--border)'
                  }`,
                  color: isSystem ? 'var(--error)' : 'var(--text)',
                  fontSize: '0.92rem',
                  lineHeight: '1.5',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                }}>
                  {msg.content}
                </div>

                {/* Inline Tool Execution Logs (Traces) */}
                {msg.traces && msg.traces.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {msg.traces.map((trace, tIdx) => (
                      <div key={tIdx} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.75rem',
                        padding: '0.3rem 0.6rem',
                        borderRadius: '6px',
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid var(--border)',
                        color: 'var(--accent)',
                        alignSelf: 'flex-start',
                        fontFamily: 'monospace'
                      }}>
                        <span>🔧 Executed Tool:</span>
                        <strong>{trace.toolName}</strong>
                        {Object.keys(trace.args).length > 0 && (
                          <span style={{ color: 'var(--text-muted)' }}>
                            ({JSON.stringify(trace.args)})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          
          {loading && (
            <div style={{
              alignSelf: 'flex-start',
              padding: '0.75rem 1.25rem',
              borderRadius: '12px',
              background: 'oklch(18% 0.015 255.4 / 0.7)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
              color: 'var(--text-muted)'
            }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'bounce 0.6s infinite alternate'
              }} />
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'bounce 0.6s infinite alternate 0.2s'
              }} />
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'bounce 0.6s infinite alternate 0.4s'
              }} />
              <span>Gateway executing requests...</span>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSendMessage} style={{
          padding: '1rem',
          borderTop: '1px solid var(--border)',
          background: 'oklch(10% 0.01 255.4 / 0.5)',
          display: 'flex',
          gap: '0.75rem'
        }}>
          <input 
            type="text" 
            placeholder={chatMode === 'agent' 
              ? "Ask the gateway agent to take action (e.g. 'sync groq' or 'show status')..." 
              : "Send direct chat message to virtual pool..."}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            disabled={loading}
            style={{ flex: 1, fontSize: '0.95rem' }}
          />
          <button type="submit" className="primary" disabled={loading} style={{ padding: '0 1.5rem', fontWeight: 700 }}>
            Send
          </button>
        </form>
      </div>

      {/* Right Settings Pane */}
      <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '1rem' }}>Chat Configuration</h4>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Configure connection models and proxies.</p>
        </div>

        {/* Chat Mode Toggle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Chat Interface Mode</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
            <button 
              type="button" 
              className={chatMode === 'agent' ? 'primary' : ''}
              onClick={() => { setChatMode('agent'); handleClearChat(); }}
              style={{ fontSize: '0.75rem', padding: '0.4rem' }}
            >
              Agentic (MCP Tools)
            </button>
            <button 
              type="button" 
              className={chatMode === 'direct' ? 'primary' : ''}
              onClick={() => { setChatMode('direct'); handleClearChat(); }}
              style={{ fontSize: '0.75rem', padding: '0.4rem' }}
            >
              Direct Completions
            </button>
          </div>
        </div>

        {/* Model Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Backend Model</label>
          <select 
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            style={{ fontSize: '0.85rem' }}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
        </div>

        {/* Custom Proxy Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <input 
              type="checkbox" 
              id="chatProxyEnabled" 
              checked={proxyEnabled}
              onChange={(e) => setProxyEnabled(e.target.checked)}
            />
            <label htmlFor="chatProxyEnabled" style={{ fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
              Override Chat Proxy
            </label>
          </div>

          {proxyEnabled && (
            <input 
              type="text" 
              placeholder="e.g. socks5://127.0.0.1:1080"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '0.4rem' }}
            />
          )}
        </div>

        {/* Clear Chat Button */}
        <button 
          type="button" 
          onClick={handleClearChat}
          style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem', marginTop: 'auto' }}
        >
          Clear Chat History
        </button>
      </div>

      {/* Embedded keyframe bounces */}
      <style>{`
        @keyframes bounce {
          from { transform: translateY(0); }
          to { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
};
