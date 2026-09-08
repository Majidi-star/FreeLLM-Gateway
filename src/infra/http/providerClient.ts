import { getConfig } from '../config.js';
import { AppError } from '../../shared/errors.js';

export interface ProviderRequestOptions {
  baseUrl: string;
  endpoint: string;
  apiKey: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface ProviderResponse<T = unknown> {
  statusCode: number;
  data: T;
  latencyMs: number;
}

export async function callProviderEndpoint<T = unknown>(options: ProviderRequestOptions): Promise<ProviderResponse<T>> {
  const timeoutMs = options.timeoutMs || getConfig().DEFAULT_PROVIDER_TIMEOUT_MS;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/${options.endpoint.replace(/^\/+/, '')}`;
  const method = options.method || 'GET';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'GoalRoute-Gateway/1.0',
    Authorization: `Bearer ${options.apiKey}`,
    ...options.headers,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startTime;
    clearTimeout(timer);

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errMsg = typeof data === 'object' && data !== null && 'error' in (data as any)
        ? JSON.stringify((data as any).error)
        : String(data);
      throw new AppError(`Provider returned HTTP ${response.status}: ${errMsg}`, 'PROVIDER_HTTP_ERROR', response.status);
    }

    return {
      statusCode: response.status,
      data: data as T,
      latencyMs,
    };
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new AppError(`Provider request timed out after ${timeoutMs}ms`, 'PROVIDER_TIMEOUT', 408);
    }
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(`Provider HTTP call failed: ${err.message}`, 'PROVIDER_FETCH_FAILED', 502);
  }
}
