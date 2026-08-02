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

export interface GatewayConfig {
  globalProxy: string;
  globalProxyEnabled: boolean;
  rateLimitQueueEnabled?: boolean;
  providers: Provider[];
  virtualModels: VirtualModel[];
  aliases?: Record<string, string>;
  semanticCacheEnabled?: boolean;
  semanticCacheThreshold?: number;
  stats: Stats;
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

export async function getCacheStats(): Promise<{ size: number }> {
  return fetchJson(`${API_BASE}/api/cache-stats`);
}

export async function clearCacheDatabase(): Promise<{ success: boolean; size: number }> {
  return fetchJson(`${API_BASE}/api/cache-clear`, { method: 'POST' });
}
