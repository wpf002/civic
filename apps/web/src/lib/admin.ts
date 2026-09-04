import { cookies } from "next/headers";

/**
 * v0 admin auth: a single shared secret held in an httpOnly cookie.
 *
 * This is NOT real auth and the roadmap says so — it must be replaced before the
 * pilot. It is here so the review surface exists at all, and it is deliberately
 * server-only: the token never reaches the browser as readable state, and every
 * admin call is made from the server.
 */
export const ADMIN_COOKIE = "civic_admin";
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function adminToken(): Promise<string | null> {
  return (await cookies()).get(ADMIN_COOKIE)?.value ?? null;
}

export async function adminFetch<T>(
  path: string,
  init?: RequestInit & { reviewer?: string },
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const token = await adminToken();
  if (!token) return { ok: false, status: 401, error: "no token" };

  const res = await fetch(`${BASE}/admin${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.reviewer ? { "x-reviewer": init.reviewer } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) {
    let error = body;
    try {
      const j = JSON.parse(body);
      error = [j.error, j.why].filter(Boolean).join(" — ");
    } catch {}
    return { ok: false, status: res.status, error: error || res.statusText };
  }
  return { ok: true, data: (body ? JSON.parse(body) : null) as T };
}
