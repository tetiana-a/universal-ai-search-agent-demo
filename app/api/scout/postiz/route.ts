import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { createPostizDraft, listPostizChannels, postizConfigured } from "@/lib/scout/postiz";
import { isPolishWineCampaign } from "@/lib/scout/wine-compliance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The only supported write is POSTIZ type=draft; no unattended publishing.
export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  if (!postizConfigured()) return Response.json({ ok: false, configured: false, error: "POSTIZ_NOT_CONFIGURED", channels: [] }, { status: 503 });
  try {
    const channels = await listPostizChannels();
    return Response.json({ ok: true, configured: true, channels });
  } catch (error) {
    return Response.json({ ok: false, configured: true, error: error instanceof Error ? error.message : "POSTIZ_ERROR" }, { status: 502 });
  }
}
export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const data: any = await request.json().catch(() => null);
  if (!data || data.action !== "draft") return Response.json({ ok: false, error: "ONLY_DRAFT_ALLOWED" }, { status: 400 });
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
