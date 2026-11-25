import { workerAlive } from "@/lib/jobs";
import { isCronRequest, unauthorized } from "@/lib/scout/auth";
import { runDaily } from "@/lib/scout/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily campaign run (Vercel Cron): liveness check → plan the day → partner tasks → bot posts → report.
export async function GET(request: Request) {
  if (!isCronRequest(request)) return unauthorized();
  // The background queue (worker/) owns this job while it is alive; this cron is the fallback.
  if (await workerAlive()) return Response.json({ ok: true, skipped: "worker" });
  return Response.json({ ok: true, ...(await runDaily(Date.now() + 280_000)) });
}
