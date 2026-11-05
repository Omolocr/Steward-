import { API_URL } from './config';
import { getLang } from './i18n';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, raw?: { contentType: string; headers?: Record<string, string> }, extra?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        'Content-Type': raw ? raw.contentType : 'application/json',
        'X-Lang': getLang(), // the server answers (errors, SMS, notifications) in the person's language
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(raw?.headers ?? {}),
        ...(extra ?? {}),
      },
      body: body === undefined ? undefined : raw ? (body as Blob) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the church server. Check your internet connection and try again.');
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'Request failed (' + res.status + ')');
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  /** `headers` is for the offline outbox (X-Idempotency-Key). */
  post: <T>(path: string, body: unknown = {}, headers?: Record<string, string>) => request<T>('POST', path, body, undefined, headers),
  /** Sends a file as the raw request body (used for sermon recordings). */
  upload: <T>(path: string, file: Blob, contentType: string, headers: Record<string, string> = {}) =>
    request<T>('POST', path, file, { contentType, headers }),
};
