/**
 * Centralized API client and token manager for GoalRoute Cockpit.
 */

const TOKEN_STORAGE_KEY = 'goalroute_admin_token';

// In-memory token cache to support desktop preload bridge seamlessly
let inMemoryToken: string | null = null;

export function getAdminToken(): string {
  if (inMemoryToken) {
    return inMemoryToken;
  }
  try {
    const local = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (local && local.trim()) return local.trim();
  } catch {}
  try {
    const session = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (session && session.trim()) return session.trim();
  } catch {}

  const envToken = (import.meta as any).env?.VITE_ADMIN_API_TOKEN;
  if (envToken && typeof envToken === 'string' && envToken.trim()) {
    return envToken.trim();
  }

  return '';
}

export function setAdminToken(token: string | null): void {
  const clean = token ? token.trim() : '';
  inMemoryToken = clean || null;
  try {
    if (clean) {
      localStorage.setItem(TOKEN_STORAGE_KEY, clean);
      sessionStorage.setItem(TOKEN_STORAGE_KEY, clean);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {}
}

export interface ApiErrorPayload {
  message: string;
  code?: string;
  status: number;
  data?: any;
}

export class ApiError extends Error {
  public status: number;
  public code?: string;
  public error?: any;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = payload.status;
    this.code = payload.code;
    this.error = payload.data;
  }
}

export async function apiFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const headers = new Headers(init?.headers || {});

  if (token && !headers.has('authorization') && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (init?.body && typeof init.body === 'string' && !headers.has('content-type') && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await window.fetch(url, {
    ...init,
    headers,
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
  }

  let bodyData: any = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      bodyData = await res.json();
    } catch {
      bodyData = null;
    }
  } else {
    try {
      bodyData = await res.text();
    } catch {
      bodyData = null;
    }
  }

  if (!res.ok) {
    const errorObj = typeof bodyData === 'object' && bodyData !== null ? bodyData : null;
    const extractedMessage =
      errorObj?.error?.message ||
      errorObj?.message ||
      (typeof errorObj?.error === 'string' ? errorObj.error : null) ||
      (typeof bodyData === 'string' && bodyData ? bodyData : `Request failed with HTTP ${res.status}`);

    const code = errorObj?.error?.code || errorObj?.code;

    throw new ApiError({
      message: extractedMessage,
      code,
      status: res.status,
      data: errorObj,
    });
  }

  return bodyData as T;
}
