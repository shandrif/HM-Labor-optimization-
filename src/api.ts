export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

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
  if (!res.ok) {
    if (res.status === 401 && path !== "/login") window.dispatchEvent(new Event("hm:unauthorized"));
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export type Role = "admin" | "manager" | "viewer";
export type User = { id: number; username: string; name: string; role: Role };
