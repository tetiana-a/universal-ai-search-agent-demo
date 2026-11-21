import { timingSafeEqual } from "node:crypto";

// Dashboard access. With SCOUT_ADMIN_KEY set, every read and write needs the key
// (the CRM holds personal data). Without it the dashboard runs in open demo mode.

export function publicDashboardEnabled() {
  return String(process.env.SCOUT_PUBLIC_DASHBOARD || "").trim().toLowerCase() === "on";
}

export function adminKeyConfigured() {
  return Boolean(String(process.env.SCOUT_ADMIN_KEY || "").trim());
}

function same(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

// Fail closed for CRM/API data and all mutations, including on demo deployments.
// Public pages may remain visible; a public flag never grants access to private API state.
export function isAuthorized(request: Request) {
  const key = String(process.env.SCOUT_ADMIN_KEY || "").trim();
  if (!key) return false;
  const given = request.headers.get("x-scout-key") || "";
  return Boolean(given) && same(given, key);
}

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
// A forged User-Agent must never start campaigns. Vercel supplies a Bearer
// CRON_SECRET header when the secret is configured in the project environment.
export function isCronRequest(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  return same(request.headers.get("authorization") || "", "Bearer " + secret);
}

export function unauthorized() {
  return Response.json({ ok: false, error: "Нужен ключ доступа (SCOUT_ADMIN_KEY)." }, { status: 401 });
}
