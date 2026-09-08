import { getConfig } from '../config.js';
import { AppError } from '../../shared/errors.js';

export interface ProviderRequestOptions {
  baseUrl: string;
  endpoint: string;
  apiKey: string;
  protocol?: 'openai' | 'anthropic' | 'gemini' | 'custom' | string;
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

export function parseRetryAfter(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (!trimmed) return undefined;

  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return isNaN(seconds) ? undefined : Math.max(0, seconds);
  }

  const parsedDateMs = Date.parse(trimmed);
  if (!isNaN(parsedDateMs)) {
    const diffSec = Math.ceil((parsedDateMs - Date.now()) / 1000);
    return Math.max(0, diffSec);
  }

  return undefined;
}

export function sanitizeErrorMessage(status: number, data: unknown, contentType: string): string {
  const isHtml = contentType.includes('text/html') || (typeof data === 'string' && /^\s*</.test(data));
  const rawText = typeof data === 'object' && data !== null && 'error' in (data as any)
    ? JSON.stringify((data as any).error)
    : String(data ?? '');

  const stripped = rawText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const snippet = stripped.slice(0, 60);

  return `[PROVIDER_ERROR] status=${status} type=${isHtml ? 'HTML' : 'JSON'} snippet=${snippet}`;
}

export async function callProviderEndpoint<T = unknown>(options: ProviderRequestOptions): Promise<ProviderResponse<T>> {
  const timeoutMs = options.timeoutMs || getConfig().DEFAULT_PROVIDER_TIMEOUT_MS;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/${options.endpoint.replace(/^\/+/, '')}`;
  const method = options.method || 'GET';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'GoalRoute-Gateway/1.0',
  };

  if (options.protocol === 'anthropic') {
    headers['x-api-key'] = options.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (options.protocol === 'gemini') {
    headers['x-goog-api-key'] = options.apiKey;
  } else {
    headers['Authorization'] = `Bearer ${options.apiKey}`;
  }

  if (options.headers) {
    Object.assign(headers, options.headers);
  }

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

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > 15 * 1024 * 1024) {
        throw new AppError('Upstream payload exceeds maximum safety limit (15MB)', 'PAYLOAD_TOO_LARGE', 502);
      }
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = parseRetryAfter(retryAfterHeader);
      const safeData = typeof data === 'string' && data.length > 64 * 1024 ? data.slice(0, 64 * 1024) : data;
      const sanitizedMsg = sanitizeErrorMessage(response.status, safeData, contentType);
      throw new AppError(sanitizedMsg, 'PROVIDER_HTTP_ERROR', response.status, undefined, retryAfterSeconds);
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
