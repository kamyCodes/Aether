export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`);
  return res.json() as Promise<T>;
}

export const get = <T>(p: string) => api<T>(p);
export const post = <T>(p: string, body?: unknown) =>
  api<T>(p, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
export const put = <T>(p: string, body: unknown) =>
  api<T>(p, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T>(p: string) => api<T>(p, { method: 'DELETE' });
