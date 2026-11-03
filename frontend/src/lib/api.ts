/* Thin fetch client: same-origin cookies, CSRF double-submit header, typed errors. */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)finlex_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function parse(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function errMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d))
      return d
        .map((e: { loc?: unknown[]; msg?: string }) => {
          const field = Array.isArray(e.loc) ? String(e.loc[e.loc.length - 1]) : "";
          return field && field !== "body" ? `${field}: ${e.msg}` : e.msg;
        })
        .join("; ");
  }
  if (status === 401) return "Please sign in.";
  if (status === 429) return "Too many requests — please wait a moment.";
  if (status >= 500) return "Server error. Please try again.";
  return `Request failed (${status})`;
}

export async function request<T = unknown>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (method !== "GET") headers["X-CSRF-Token"] = csrf();
  const res = await fetch(url, { method, headers, body: payload, credentials: "same-origin", ...init });
  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, errMessage(data, res.status));
  return data as T;
}

export const api = {
  get: <T = unknown>(url: string) => request<T>("GET", url),
  post: <T = unknown>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T = unknown>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  patch: <T = unknown>(url: string, body?: unknown) => request<T>("PATCH", url, body ?? {}),
  del: <T = unknown>(url: string) => request<T>("DELETE", url),
  upload: <T = unknown>(url: string, form: FormData) => request<T>("POST", url, form),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}
