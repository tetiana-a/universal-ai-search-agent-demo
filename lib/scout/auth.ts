import { timingSafeEqual } from "node:crypto";

// Dashboard access. With SCOUT_ADMIN_KEY set, every read and write needs the key
// (the CRM holds personal data). Without it the dashboard runs in open demo mode.

export function publicDashboardEnabled() {
  return String(process.env.SCOUT_PUBLIC_DASHBOARD || "").trim().toLowerCase() === "on";
}

export function adminKeyConfigured() {
  return !publicDashboardEnabled() && Boolean(String(process.env.SCOUT_ADMIN_KEY || "").trim());
}

function same(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export function isAuthorized(request: Request) {
  if (publicDashboardEnabled()) return true;
  const key = String(process.env.SCOUT_ADMIN_KEY || "").trim();
  if (!key) return true;
  const given = request.headers.get("x-scout-key") || "";
  return Boolean(given) && same(given, key);
}

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
export function isCronRequest(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const auth = request.headers.get("authorization") || "";
  if (secret) return same(auth, "Bearer " + secret) || (adminKeyConfigured() && isAuthorized(request));
  return /vercel-cron/i.test(request.headers.get("user-agent") || "") || (adminKeyConfigured() && isAuthorized(request));
}

export function unauthorized() {
  return Response.json({ ok: false, error: "Нужен ключ доступа (SCOUT_ADMIN_KEY)." }, { status: 401 });
}
