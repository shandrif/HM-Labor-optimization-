export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const cache = new Map<string, { at: number; p: Promise<any> }>();

/** GET with a short shared cache, so pages don't refetch the same data on every navigation. */
export function cachedApi<T = any>(path: string, ttlMs = 20000): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p;
  const p = api<T>(path).catch((e) => {
    cache.delete(path);
    throw e;
  });
  cache.set(path, { at: Date.now(), p });
  return p;
}
export const clearApiCache = () => cache.clear();

export async function api<T = any>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...init } = opts;
  const headers = new Headers(init.headers);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...init,
    headers,
    body: json !== undefined ? JSON.stringify(json) : init.body,
  });
  const data: any = await res.json().catch(() => ({}));
  // any successful change invalidates cached reads
  if (res.ok && (init.method ?? "GET").toUpperCase() !== "GET") cache.clear();
  if (!res.ok) {
    if (res.status === 401 && path !== "/login") window.dispatchEvent(new Event("hm:unauthorized"));
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export type Role = "admin" | "manager" | "viewer";
export type User = { id: number; username: string; name: string; role: Role };
