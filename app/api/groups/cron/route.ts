import { workerAlive } from "@/lib/jobs";
import { isCronRequest, unauthorized } from "@/lib/scout/auth";
import { refreshOneCampaign, runProfileBatch } from "@/lib/scout/client-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily base refresh (Vercel Cron): next themes × regions of the client profile, then new
// communities for the active campaign searched longest ago.
export async function GET(request: Request) {
  if (!isCronRequest(request)) return unauthorized();
  // The background queue (worker/) owns this job while it is alive; this cron is the fallback.
  if (await workerAlive()) return Response.json({ ok: true, skipped: "worker" });
  const deadlineAt = Date.now() + 285_000;
  const profile = await runProfileBatch(Date.now() + 160_000);
  const campaign = await refreshOneCampaign(deadlineAt).catch(() => null);
  return Response.json({ ok: true, profile, campaign });
}
