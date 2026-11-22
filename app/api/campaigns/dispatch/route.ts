import { isCronRequest, unauthorized } from "@/lib/scout/auth";
import { dispatchBotTasks } from "@/lib/scout/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Dedicated, idempotent dispatch wave. An external scheduler (e.g. n8n) may
// call this endpoint several times a day, but only signed requests pass.
// Automatic posting MUST be explicitly opted in; the planner still requires
// human-approved campaigns, per-campaign eligible groups and Telegram rights.
export async function GET(request: Request) {
  if (!isCronRequest(request)) return unauthorized();
  if (process.env.CAMPAIGN_AUTOPOST !== "on") {
    return Response.json({ ok: true, disabled: true, sent: 0, failed: 0, left: 0 });
  }
  const stats = await dispatchBotTasks(undefined, Date.now() + 230_000);
  return Response.json({ ok: true, ...stats });
}
