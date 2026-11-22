import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { createPostizDraft, listPostizChannels, listRecentPostizPosts, postizConfigured, schedulePostizApproved } from "@/lib/scout/postiz";
import { getOne } from "@/lib/scout/store";
import type { Campaign } from "@/lib/scout/campaigns";
import { isPolishWineCampaign } from "@/lib/scout/wine-compliance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The only supported write is POSTIZ type=draft; no unattended publishing.
export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  if (!postizConfigured()) return Response.json({ ok: false, configured: false, error: "POSTIZ_NOT_CONFIGURED", channels: [] }, { status: 503 });
  try {
    const view = new URL(request.url).searchParams.get("view");
    if (view === "posts") {
      const posts = await listRecentPostizPosts();
      return Response.json({ ok: true, configured: true, posts });
    }
    const channels = await listPostizChannels();
    return Response.json({ ok: true, configured: true, channels });
  } catch (error) {
    return Response.json({ ok: false, configured: true, error: error instanceof Error ? error.message : "POSTIZ_ERROR" }, { status: 502 });
  }
}
export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const data: any = await request.json().catch(() => null);
  if (data?.action === "schedule") {
    // Separate authorization gate: Postiz connected OAuth channel, approved
    // campaign, explicit per-request owner confirmation and Vercel opt-in.
    if (process.env.POSTIZ_ENABLE_SCHEDULE !== "on") {
      return Response.json({ ok: false, error: "POSTIZ_SCHEDULE_DISABLED" }, { status: 403 });
    }
    if (data.confirm !== "I_APPROVE_SCHEDULE") {
      return Response.json({ ok: false, error: "OWNER_CONFIRMATION_REQUIRED" }, { status: 403 });
    }
    const campaignId = String(data.campaignId || "").slice(0, 90);
    const campaign = await getOne<Campaign>("campaigns", campaignId);
    if (!campaign || campaign.status !== "approved" || !campaign.approvedAt) {
      return Response.json({ ok: false, error: "CAMPAIGN_NOT_APPROVED" }, { status: 403 });
    }
    if (isPolishWineCampaign(campaign)) {
      return Response.json({ ok: false, error: "POLAND_WINE_PUBLIC_ADS_RESTRICTED" }, { status: 403 });
    }
    const result = await schedulePostizApproved({
      integrationId: String(data.integrationId || "").slice(0, 100),
      content: campaign.adText,
      requestId: String(data.requestId || "").slice(0, 100),
      scheduledAt: String(data.scheduledAt || "").slice(0, 60),
      campaignId,
      mediaUrl: typeof data.mediaUrl === "string" ? data.mediaUrl.slice(0, 500) : undefined,
    }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "POSTIZ_UNKNOWN" }));
    return Response.json({
      ...result, statusLabel: result.ok ? "SCHEDULED_NOT_VERIFIED_PUBLISHED" : "FAILED",
    }, { status: result.ok ? 202 : 422 });
  }
  if (!data || data.action !== "draft") return Response.json({ ok: false, error: "ONLY_DRAFT_OR_APPROVED_SCHEDULE_ALLOWED" }, { status: 400 });
  const integrationId = String(data.integrationId || "").trim().slice(0, 100);
  const content = String(data.content || "").trim().slice(0, 3501);
  const requestId = String(data.requestId || "").trim().slice(0, 100);
  if (!integrationId || content.length < 10 || content.length > 3500 || !requestId) {
    return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }
  // Defend against routing regulated alcohol advertising to Postiz accounts.
  if (isPolishWineCampaign({ region: String(data.region || ""), adText: content })) {
    return Response.json({ ok: false, error: "POLAND_WINE_PUBLIC_ADS_RESTRICTED" }, { status: 403 });
  }
  try {
    const result = await createPostizDraft({
      integrationId, content, requestId,
      mediaUrl: typeof data.mediaUrl === "string" ? data.mediaUrl.trim() : undefined,
    });
    return Response.json(result, { status: result.ok ? 201 : result.error === "DUPLICATE_REQUEST" ? 409 : 422 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "POSTIZ_UNKNOWN" }, { status: 502 });
  }
}
