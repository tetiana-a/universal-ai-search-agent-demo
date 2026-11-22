import { claimOnce, logAction } from "@/lib/scout/store";
import { isQuotaStatus, pauseProvider, providerPaused } from "@/lib/scout/provider-quota";

// Ayrshare (https://www.ayrshare.com/docs/apis/post/post) is an alternative to
// Postiz: one API for the owner's OWN connected Facebook Page, Instagram, TikTok
// and other profiles. It cannot post into third-party groups and is used only
// for an approved campaign with an explicit owner confirmation.
const PLATFORMS = new Set(["facebook", "instagram", "tiktok", "threads", "linkedin", "telegram", "x", "youtube", "pinterest", "bluesky"]);

export function ayrshareConfigured() {
  return Boolean(String(process.env.AYRSHARE_API_KEY || "").trim());
}

export function makeAyrsharePayload(content: string, platforms: string[], scheduledAt: string, mediaUrl?: string) {
  const list = [...new Set(platforms.map((p) => p.toLowerCase()))].filter((p) => PLATFORMS.has(p));
  if (!list.length) throw new Error("AYRSHARE_NO_PLATFORMS");
  if (content.trim().length < 10 || content.length > 3500) throw new Error("AYRSHARE_INVALID_CONTENT");
  if (mediaUrl && !/^https:\/\//i.test(mediaUrl)) throw new Error("INVALID_MEDIA_URL");
  if (list.some((p) => p === "instagram" || p === "tiktok") && !mediaUrl) throw new Error("AYRSHARE_MEDIA_REQUIRED");
  return { post: content.trim(), platforms: list, scheduleDate: new Date(scheduledAt).toISOString(), ...(mediaUrl ? { mediaUrls: [mediaUrl] } : {}) };
}

export async function scheduleAyrshareApproved(args: {
  content: string; platforms: string[]; mediaUrl?: string; requestId: string; scheduledAt: string; campaignId: string;
}): Promise<{ ok: boolean; error?: string; postId?: string; status?: number }> {
  if (!ayrshareConfigured() || process.env.AYRSHARE_ENABLE_SCHEDULE !== "on") return { ok: false, error: "AYRSHARE_SCHEDULE_DISABLED" };
  if (await providerPaused("ayrshare")) return { ok: false, error: "AYRSHARE_LIMIT_PAUSED" };
  const date = Date.parse(args.scheduledAt);
  if (!Number.isFinite(date) || date < Date.now() + 5 * 60 * 1000 || date > Date.now() + 30 * 86400000) return { ok: false, error: "AYRSHARE_INVALID_SCHEDULE_DATE" };
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(args.requestId)) return { ok: false, error: "INVALID_REQUEST_ID" };
  let payload;
  try { payload = makeAyrsharePayload(args.content, args.platforms, args.scheduledAt, args.mediaUrl); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "AYRSHARE_INVALID" }; }
  if (!(await claimOnce("ayrshare-schedule:" + args.requestId, 3600))) return { ok: false, error: "DUPLICATE_REQUEST" };
  try {
    const response = await fetch("https://api.ayrshare.com/api/post", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + String(process.env.AYRSHARE_API_KEY).trim() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (isQuotaStatus(response.status)) {
      await pauseProvider("ayrshare", "HTTP " + response.status);
      return { ok: false, error: "AYRSHARE_LIMIT_PAUSED", status: response.status };
    }
    const body: any = await response.json().catch(() => null);
    if (!response.ok || body?.status === "error") throw new Error("AYRSHARE_HTTP_" + response.status);
    const postId = String(body?.id || body?.posts?.[0]?.id || "");
    await logAction({ actor: "human", action: "ayrshare.scheduled", detail: args.campaignId + " · Ayrshare " + postId + " · " + payload.platforms.join(",") + " · " + payload.scheduleDate });
    return { ok: true, postId, status: 202 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AYRSHARE_UNKNOWN";
    await logAction({ actor: "agent", action: "ayrshare.schedule_failed", detail: message.slice(0, 160) });
    return { ok: false, error: message };
  }
}
