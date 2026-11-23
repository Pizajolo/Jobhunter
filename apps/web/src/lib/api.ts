import { QueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function csrfToken(): string | null {
  const m = /(?:^|; )jh_csrf=([^;]+)/u.exec(document.cookie);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, credentials: 'same-origin', headers };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const csrf = csrfToken();
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(url, init);
  if (res.status === 401 && !url.startsWith('/api/auth') && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; details?: unknown };
    throw new ApiError(res.status, e.error ?? res.statusText, e.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
});
