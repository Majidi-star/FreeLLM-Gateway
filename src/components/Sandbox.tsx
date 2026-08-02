import React, { useState, useEffect, useRef } from 'react';
import { 
  getGatewayModels, 
  askChatAssistant
} from '../utils/api';

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  traces?: { toolName: string; args: any }[];
}

interface SandboxProps {
  onConfigChange?: () => void;
}

export const Sandbox: React.FC<SandboxProps> = ({ onConfigChange }) => {
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('strong-reasoning');
  
  // Custom Chat Proxy State
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');

  // Messages History
  const [messages, setMessages] = useState<Message[]>([
    { 
      role: 'assistant', 
      content: `Hello! I am your global gateway assistant.
I can answer general questions, or perform dashboard operations!

Examples:
- "What is the status of the gateway?"
- "Please sync Groq."
- "Show my active routing pools."
- "Add a custom provider named local-ollama with base URL http://localhost:11434/v1"
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
        content: 'History cleared. Ask me anything or command me to sync, list, or CRUD providers!'
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

        // If any tools were run, trigger state reload on active dashboard tab!
        if (res.traces && res.traces.length > 0) {
          onConfigChange?.();
        }
      } else {
        throw new Error('Completions returned failed status.');
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
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden'
    }}>
      {/* Header compact config row */}
      <div style={{
        padding: '0.75rem 1rem',
        borderBottom: '1px solid var(--border)',
        background: 'oklch(12% 0.015 255.4 / 0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text)' }}>
            💬 Assistant Chat
          </span>
          <button 
            type="button" 
            onClick={handleClearChat}
            style={{ padding: '0.15rem 0.4rem', fontSize: '0.65rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            Clear Chat
          </button>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', alignItems: 'center' }}>
          {/* Model Selector */}
          <select 
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            style={{ fontSize: '0.75rem', padding: '0.2rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '4px', width: '100%' }}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
          
          {/* Proxy Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', justifyContent: 'flex-end' }}>
            <input 
              type="checkbox" 
              id="chatProxyEnabled" 
              checked={proxyEnabled}
              onChange={(e) => setProxyEnabled(e.target.checked)}
              style={{ cursor: 'pointer', margin: 0 }}
            />
            <label htmlFor="chatProxyEnabled" style={{ fontSize: '0.7rem', cursor: 'pointer', color: 'var(--text-muted)', userSelect: 'none' }}>
              Custom Proxy
            </label>
          </div>
        </div>
        
        {proxyEnabled && (
          <input 
            type="text" 
            placeholder="socks5://127.0.0.1:1080"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            style={{ fontSize: '0.75rem', padding: '0.25rem', background: '#0a0a0f', color: '#c5c9db', border: '1px solid var(--border)', borderRadius: '4px', width: '100%', outline: 'none' }}
          />
        )}
      </div>

      {/* Chat History Panel */}
      <div style={{
        flex: 1,
        padding: '1rem',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.8rem',
        background: 'oklch(8% 0.005 255.4 / 0.2)'
      }}>
        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          const isSystem = msg.role === 'system';
          
          return (
            <div 
              key={idx} 
              style={{
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                maxWidth: '90%',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem'
              }}
            >
              <div style={{
                padding: '0.75rem 0.9rem',
                borderRadius: '10px',
                background: isUser 
                  ? 'var(--accent-glow)' 
                  : isSystem 
                    ? 'var(--error-glow)' 
                    : 'oklch(15% 0.01 255.4 / 0.8)',
                border: `1px solid ${
                  isUser 
                    ? 'var(--accent)' 
                    : isSystem 
                      ? 'var(--error)' 
                      : 'var(--border)'
                }`,
                color: isSystem ? 'var(--error)' : 'var(--text)',
                fontSize: '0.85rem',
                lineHeight: '1.45',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                {msg.content}
              </div>

              {/* Inline Tool Execution Logs (Traces) */}
              {msg.traces && msg.traces.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {msg.traces.map((trace, tIdx) => (
                    <div key={tIdx} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontSize: '0.7rem',
                      padding: '0.2rem 0.4rem',
                      borderRadius: '4px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid var(--border)',
                      color: 'var(--accent)',
                      alignSelf: 'flex-start',
                      fontFamily: 'monospace'
                    }}>
                      <span>🔧 Tool:</span>
                      <strong>{trace.toolName}</strong>
                      {Object.keys(trace.args).length > 0 && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
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
            padding: '0.6rem 0.9rem',
            borderRadius: '10px',
            background: 'oklch(15% 0.01 255.4 / 0.8)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.8rem',
            color: 'var(--text-muted)'
          }}>
            <div style={{
              width: '4px',
              height: '4px',
              borderRadius: '50%',
              background: 'var(--accent)',
              animation: 'bounce 0.6s infinite alternate'
            }} />
            <div style={{
              width: '4px',
              height: '4px',
              borderRadius: '50%',
              background: 'var(--accent)',
              animation: 'bounce 0.6s infinite alternate 0.2s'
            }} />
            <div style={{
              width: '4px',
              height: '4px',
              borderRadius: '50%',
              background: 'var(--accent)',
              animation: 'bounce 0.6s infinite alternate 0.4s'
            }} />
            <span>Thinking...</span>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <form onSubmit={handleSendMessage} style={{
        padding: '0.75rem',
        borderTop: '1px solid var(--border)',
        background: 'oklch(10% 0.01 255.4 / 0.5)',
        display: 'flex',
        gap: '0.5rem'
      }}>
        <textarea 
          placeholder="Ask or command assistant..."
          value={inputPrompt}
          onChange={(e) => setInputPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage(e as any);
            }
          }}
          disabled={loading}
          rows={Math.min(5, Math.max(1, inputPrompt.split('\n').length))}
          style={{ 
            flex: 1, 
            fontSize: '0.85rem', 
            padding: '0.4rem 0.6rem', 
            border: '1px solid var(--border)', 
            background: '#07070a', 
            color: '#c5c9db', 
            borderRadius: '6px', 
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
            lineHeight: '1.4'
          }}
        />
        <button type="submit" className="primary" disabled={loading} style={{ padding: '0 0.8rem', fontSize: '0.8rem', fontWeight: 600, height: '32px', borderRadius: '6px' }}>
          Send
        </button>
      </form>

      {/* Embedded keyframe bounces */}
      <style>{`
        @keyframes bounce {
          from { transform: translateY(0); }
          to { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
};
