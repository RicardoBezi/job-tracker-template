export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login") window.dispatchEvent(new Event("gcn:unauthorized"));
    throw new ApiError(response.status, payload.error ?? `Request failed (${response.status})`);
  }
  return payload as T;
}

export const session = () => api<{ authenticated: boolean }>("/auth/session");
export const login = (password: string) => api<{ authenticated: true }>("/auth/login", {
  method: "POST",
  body: JSON.stringify({ password }),
});
export const logout = () => api("/auth/logout", { method: "POST", body: "{}" });
