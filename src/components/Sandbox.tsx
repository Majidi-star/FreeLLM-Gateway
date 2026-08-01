import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, getGatewayModels } from '../utils/api';

interface ModelOption {
  id: string;
  type: 'virtual' | 'direct';
  owned_by: string;
}

export const Sandbox: React.FC = () => {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [stream, setStream] = useState(true);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState('');
  
  // Terminal routing trace events
  const [traces, setTraces] = useState<{ message: string; details: string; timestamp: string }[]>([]);
  const traceEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadModels() {
      try {
        const res = await getGatewayModels();
        setModels(res.data);
        if (res.data.length > 0) {
          setSelectedModel(res.data[0].id);
        }
      } catch (err) {
        console.error('Failed to load models:', err);
      }
    }
    loadModels();
  }, []);

  useEffect(() => {
    if (traceEndRef.current) {
      traceEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [traces]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !selectedModel) return;

    setLoading(true);
    setResponse('');
    setTraces([]);

    // 1. Establish SSE event listener for the routing traces
    const eventSource = new EventSource(`${API_BASE}/api/events`);
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setTraces((prev) => [
          ...prev,
          {
            message: data.message,
            details: typeof data.details === 'object' ? JSON.stringify(data.details) : data.details,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    };

    try {
      const payload = {
        model: selectedModel,
        messages: [{ role: 'user', content: prompt }],
        stream,
      };

      const res = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || err.message || `Server returned ${res.status}`);
      }

      if (stream) {
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) return;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.trim().startsWith('data:')) {
              const dataText = line.substring(5).trim();
              if (dataText === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dataText);
                // Handle standard OpenAI vs Anthropic format in stream chunk
                const content = parsed.choices?.[0]?.delta?.content || parsed.delta?.text || '';
                setResponse((prev) => prev + content);
              } catch (e) {
                // Ignore parsing errors for incomplete stream lines
              }
            }
          }
        }
      } else {
        const data = await res.json();
        setResponse(data.choices?.[0]?.message?.content || '');
      }
    } catch (err: any) {
      setResponse(`Error: ${err.message}`);
    } finally {
      setLoading(false);
      // Close SSE connection after request finishes
      setTimeout(() => eventSource.close(), 1000);
    }
  };

  return (
    <div className="animate-fade-in" style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '1.5rem',
      height: 'calc(100vh - 220px)',
      minHeight: '450px'
    }}>
      {/* Left Column: Chat Playground */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ margin: 0, borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>Chat Playground</h3>
        
        {/* Controls */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Target Pool / Model</label>
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.id} ({m.type === 'virtual' ? 'Pool' : m.owned_by})
                </option>
              ))}
            </select>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', marginTop: '1rem', gap: '0.5rem' }}>
            <input type="checkbox" id="stream" checked={stream} onChange={(e) => setStream(e.target.checked)} />
            <label htmlFor="stream" style={{ fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>Stream Output</label>
          </div>
        </div>

        {/* Output Area */}
        <div style={{
          flex: 1,
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '1rem',
          background: 'oklch(12% 0.012 255.4 / 0.8)',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          fontFamily: 'monospace',
          fontSize: '0.9rem',
          color: response ? 'var(--text)' : 'var(--text-muted)'
        }}>
          {response || (loading ? 'Waiting for endpoint response...' : 'Run a query below to test the priority fallback pool routing.')}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem' }}>
          <input 
            type="text" 
            placeholder="Type your message here..." 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className="primary" disabled={loading || !prompt.trim()}>
            {loading ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>

      {/* Right Column: Execution Trace Terminal */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'oklch(14% 0.015 255.4 / 0.95)' }}>
        <h3 style={{ margin: 0, borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', color: 'var(--accent)', fontFamily: 'monospace' }}>
          Execution Trace Terminal
        </h3>

        {/* Terminal logs */}
        <div style={{
          flex: 1,
          background: '#040406',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '1rem',
          overflowY: 'auto',
          fontFamily: 'Consolas, Courier New, monospace',
          fontSize: '0.82rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem'
        }}>
          {traces.length === 0 ? (
            <div style={{ color: '#4d4d5a', fontStyle: 'italic' }}>
              Terminal idle. Tracing logs will stream here automatically during requests.
            </div>
          ) : (
            traces.map((trace, idx) => {
              const isError = trace.message.includes('ERROR') || trace.message.includes('FAIL');
              const isSuccess = trace.message.includes('succeeded') || trace.message.includes('Success');
              let color = '#a6accd'; // default text
              if (isError) color = 'var(--error)';
              else if (isSuccess) color = 'var(--success)';
              else if (trace.message.includes('Routing')) color = 'var(--accent)';
              
              return (
                <div key={idx} style={{ borderBottom: '1px solid #111116', paddingBottom: '0.35rem' }}>
                  <span style={{ color: '#565f89', marginRight: '0.5rem' }}>[{trace.timestamp}]</span>
                  <span style={{ color, fontWeight: 600 }}>{trace.message}</span>
                  {trace.details && (
                    <div style={{ color: '#737aa2', fontSize: '0.75rem', marginTop: '0.15rem', paddingLeft: '1rem' }}>
                      &gt; {trace.details}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={traceEndRef} />
        </div>
      </div>
    </div>
  );
};
