const PORT = 3000;
export const API_BASE = import.meta.env.DEV ? `http://localhost:${PORT}` : '';

export async function fetchJson(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `API error: ${res.status}`);
  }
  return res.json();
}

export interface Model {
  id: string;
  name: string;
  defaultLimits?: any;
  limits?: any;
}

export interface ProviderKey {
  id: string;
  key: string;
  weight: number;
  enabled: boolean;
}

export interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  apiKeys?: ProviderKey[];
  baseUrl: string;
  proxyEnabled: boolean;
  proxyUrl: string;
  models: Model[];
  limits?: any;
  category?: string;
  website?: string;
  signupUrl?: string;
  creditsDescription?: string;
  limitsDescription?: string;
}

export interface VirtualModelTarget {
  providerId: string;
  modelId: string;
}

export interface VirtualModel {
  id: string;
  name: string;
  targets: VirtualModelTarget[];
}

export interface Stats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  tokensSaved: number;
  approximateCostSaved: number;
}

export interface VirtualKey {
  id: string;
  name: string;
  enabled: boolean;
  limits: { rpm: number; rpd: number };
  usage?: { requests: number[] };
}

export interface GatewayConfig {
  globalProxy: string;
  globalProxyEnabled: boolean;
  rateLimitQueueEnabled?: boolean;
  providers: Provider[];
  virtualModels: VirtualModel[];
  aliases?: Record<string, string>;
  semanticCacheEnabled?: boolean;
  semanticCacheThreshold?: number;
  virtualKeys?: VirtualKey[];
  stats: Stats;
  metadata?: {
    port: number;
    mcpPath: string;
  };
}

export interface LogItem {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'ROUTING';
  message: string;
  details: string;
}

export async function getConfig(): Promise<GatewayConfig> {
  return fetchJson(`${API_BASE}/api/config`);
}

export async function saveConfig(config: GatewayConfig): Promise<{ success: boolean }> {
  return fetchJson(`${API_BASE}/api/config`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function getStats(): Promise<{ stats: Stats; limits: any }> {
  return fetchJson(`${API_BASE}/api/stats`);
}

export async function getLogs(): Promise<LogItem[]> {
  return fetchJson(`${API_BASE}/api/logs`);
}

export async function clearLogs(): Promise<{ success: boolean }> {
  return fetchJson(`${API_BASE}/api/logs/clear`, {
    method: 'POST',
  });
}

export interface TestProviderPayload {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  proxyEnabled: boolean;
  proxyUrl: string;
  testModelId: string;
}

export async function testProvider(payload: TestProviderPayload): Promise<{ success: boolean; message: string }> {
  return fetchJson(`${API_BASE}/api/test-provider`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getGatewayModels(): Promise<{ object: string; data: any[] }> {
  return fetchJson(`${API_BASE}/v1/models`);
}

export async function syncProviderModels(
  providerId: string,
  payload: { apiKey: string; baseUrl: string; proxyEnabled: boolean; proxyUrl: string }
): Promise<{ success: boolean; models: Model[] }> {
  return fetchJson(`${API_BASE}/api/providers/${providerId}/sync-models`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function askChatAssistant(
  payload: { messages: any[]; model: string; proxyEnabled: boolean; proxyUrl: string }
): Promise<{ success: boolean; message: any; traces: any[] }> {
  return fetchJson(`${API_BASE}/api/chat-assistant`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Streaming version of chat assistant.
 * Calls onStep(text) for each STEP: line, then resolves with the final RESULT.
 */
export async function streamChatAssistant(
  payload: { messages: any[]; model: string; proxyEnabled: boolean; proxyUrl: string },
  onStep: (step: string) => void
): Promise<{ success: boolean; message: any; traces: any[]; error?: string }> {
  const res = await fetch(`${API_BASE}/api/chat-assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.body) throw new Error('No response body for streaming.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('STEP:')) {
        onStep(line.slice(5));
      } else if (line.startsWith('RESULT:')) {
        return JSON.parse(line.slice(7));
      } else if (line.startsWith('ERROR:')) {
        return JSON.parse(line.slice(6));
      }
    }
  }
  // Handle any remaining buffer content
  if (buffer.startsWith('RESULT:')) return JSON.parse(buffer.slice(7));
  if (buffer.startsWith('ERROR:')) return JSON.parse(buffer.slice(6));
  throw new Error('Stream ended without a result.');
}

// ─── Chat Session API ──────────────────────────────

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  steps: string[];
  createdAt: string;
}

export async function getSessions(): Promise<ChatSession[]> {
  return fetchJson(`${API_BASE}/api/chat-sessions`);
}

export async function createSession(): Promise<ChatSession> {
  return fetchJson(`${API_BASE}/api/chat-sessions`, { method: 'POST' });
}

export async function updateSessionTitle(id: string, title: string): Promise<ChatSession> {
  return fetchJson(`${API_BASE}/api/chat-sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function deleteSession(id: string): Promise<{ success: boolean }> {
  return fetchJson(`${API_BASE}/api/chat-sessions/${id}`, { method: 'DELETE' });
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  return fetchJson(`${API_BASE}/api/chat-sessions/${sessionId}/messages`);
}

export async function saveMessage(
  sessionId: string,
  role: string,
  content: string,
  steps: string[] = []
): Promise<ChatMessage> {
  return fetchJson(`${API_BASE}/api/chat-sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content, steps }),
  });
}

export async function truncateMessages(sessionId: string, fromIndex: number): Promise<{ success: boolean }> {
  return fetchJson(`${API_BASE}/api/chat-sessions/${sessionId}/messages-from/${fromIndex}`, {
    method: 'DELETE',
  });
}

export async function getCacheStats(): Promise<{ size: number }> {
  return fetchJson(`${API_BASE}/api/cache-stats`);
}

export async function clearCacheDatabase(): Promise<{ success: boolean; size: number }> {
  return fetchJson(`${API_BASE}/api/cache-clear`, { method: 'POST' });
}

export interface PlaygroundResult {
  response: any;
  latencyMs: number;
  cacheStatus: string;
  providerName: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function runPlaygroundCompletion(payload: {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}): Promise<PlaygroundResult> {
  const startTime = performance.now();
  
  const res = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: false }),
  });

  const latencyMs = Math.round(performance.now() - startTime);
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API error: ${res.status}`);
  }

  const data = await res.json();
  const cacheStatus = res.headers.get('x-gateway-cache') || 'miss';
  const providerName = res.headers.get('x-gateway-provider') || 'Unknown';
  const usage = data.usage || {};

  return {
    response: data,
    latencyMs,
    cacheStatus,
    providerName,
    model: data.model || payload.model,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  };
}
