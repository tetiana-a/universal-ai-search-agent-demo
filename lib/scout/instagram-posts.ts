import { claimOnce, getOne, listAll, logAction, putOne } from "@/lib/scout/store";
import { extraSettings, listPostizChannels, listRecentPostizPosts } from "@/lib/scout/postiz";
import { botToken, tgCall } from "@/lib/scout/telegram";

const BASE = "https://api.postiz.com/public/v1";
const LIMIT = 10 * 1024 * 1024;
const VIDEO_LIMIT = 20 * 1024 * 1024; // Telegram bots can download files up to 20 MB
const IG = new Set(["instagram", "instagram-standalone"]);

export type InstagramJob = {
  id: string; createdAt: string; updatedAt: string;
  ownerId: string; integrationId: string; channelName: string;
  caption: string; scheduledAt: string; postId?: string; releaseURL?: string; campaignId?: string;
  status: "scheduled" | "published" | "unknown" | "cancelled"; error?: string;
};
// Jobs share one collection; the id prefix tells the platform (tt- TikTok, fb- Facebook, ig- Instagram).
const PLATFORM_BY_PREFIX: Record<string, string> = { tt: "TikTok", fb: "Facebook", ig: "Instagram" };
export const jobPlatform = (job: Pick<InstagramJob, "id">) => PLATFORM_BY_PREFIX[job.id.slice(0, 2)] || "Instagram";
const STATUS_RU: Record<InstagramJob["status"], string> = { published: "✅ опубликовано", scheduled: "🗓 в расписании", cancelled: "⏹ отменено", unknown: "⚠️ Postiz не принял" };
export const jobStatusRu = (status: InstagramJob["status"]) => STATUS_RU[status] || STATUS_RU.unknown;
export type InstagramRequest = {
  requestId: string; ownerId: string; integrationId?: string;
  caption: string; scheduledAt: string; mediaUrl?: string; telegramFileId?: string;
  platform?: "instagram" | "tiktok" | "facebook";
};
/** "сейчас" / "now" → in 6 minutes (Postiz needs a little lead time); anything else is passed through. */
export function resolveWhen(value: string) {
  return /^(сейчас|now|зараз)$/i.test(value.trim()) ? new Date(Date.now() + 6 * 60_000).toISOString() : value.trim();
}
export function instagramSchedulingEnabled() {
  return process.env.POSTIZ_ENABLE_SCHEDULE === "on" && process.env.INSTAGRAM_AUTOPOST === "on";
}
export function validateInstagramRequest(args: InstagramRequest): string | null {
  if (!/^[\w-]{8,80}$/.test(args.requestId)) return "INVALID_REQUEST_ID";
  if (args.caption.trim().length < 5 || args.caption.length > 2200) return "INVALID_CAPTION";
  // Facebook Page posts may be text only; Instagram and TikTok need exactly one file.
  const textOnly = args.platform === "facebook" && !args.mediaUrl && !args.telegramFileId;
  if (!textOnly && Boolean(args.mediaUrl) === Boolean(args.telegramFileId)) return "ONE_MEDIA_REQUIRED";
  if (args.mediaUrl) {
    try {
      const u = new URL(args.mediaUrl);
      if (u.protocol !== "https:" || u.username || u.password || u.port ||
        !/\.(jpe?g|png|mp4)$/i.test(u.pathname) ||
        /^(localhost|.*\.localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)) return "INVALID_PUBLIC_MEDIA_URL";
    } catch { return "INVALID_PUBLIC_MEDIA_URL"; }
  }
  if (args.telegramFileId && !/^[\w-]{10,250}$/.test(args.telegramFileId)) return "INVALID_TELEGRAM_FILE_ID";
  const at = Date.parse(args.scheduledAt);
  if (!Number.isFinite(at) || at < Date.now() + 5 * 60_000 || at > Date.now() + 30 * 86400000) return "SCHEDULE_DATE_NOT_ALLOWED";
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(args.scheduledAt)) return "TIMEZONE_REQUIRED";
  return null;
}
async function postizRequest(path: string, init: RequestInit, timeoutMs = 25_000) {
  const key = String(process.env.POSTIZ_API_KEY || "").trim();
  if (!key) throw new Error("POSTIZ_NOT_CONFIGURED");
  const res = await fetch(BASE + path, {
    ...init, headers: { Authorization: key, ...init.headers },
    signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
  });
  if (!res.ok) throw new Error("POSTIZ_HTTP_" + res.status + " " + (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160));
  return res.json();
}
async function uploadMedia(args: InstagramRequest): Promise<{id: string;path: string}> {
  let result: any;
  if (args.mediaUrl) {
    result = await postizRequest("/upload-from-url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: args.mediaUrl }),
    });
  } else {
    const token = botToken();
    if (!token) throw new Error("TELEGRAM_NOT_CONFIGURED");
    const file: any = await tgCall("getFile", { file_id: args.telegramFileId });
    // Telegram refuses getFile for anything over 20 MB ("file is too big").
    if (!file?.ok || !file?.result?.file_path) throw new Error(/too big/i.test(String(file?.description || "")) ? "MEDIA_TOO_LARGE" : "TELEGRAM_FILE_UNAVAILABLE");
    const video = args.platform === "tiktok";
    const max = video ? VIDEO_LIMIT : LIMIT;
    if (Number(file.result.file_size || 0) > max) throw new Error("MEDIA_TOO_LARGE");
    const path = String(file.result.file_path);
    if (!(video ? /^[\w/-]+\.mp4$/i : /^[\w/-]+\.(jpe?g|png)$/i).test(path) || path.includes("..")) throw new Error(video ? "UNSUPPORTED_TELEGRAM_VIDEO" : "UNSUPPORTED_TELEGRAM_IMAGE");
    const response = await fetch("https://api.telegram.org/file/bot" + token + "/" + path, {
      signal: AbortSignal.timeout(video ? 60_000 : 20_000), cache: "no-store",
    });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > max) throw new Error("TELEGRAM_DOWNLOAD_FAILED");
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > max) throw new Error("MEDIA_TOO_LARGE");
    const form = new FormData();
    const [mime, name] = mediaType(video, path);
    form.append("file", new Blob([bytes], { type: mime }), name);
    // A 20 MB video takes longer to reach Postiz than a photo.
    result = await postizRequest("/upload", { method: "POST", body: form }, video ? 90_000 : 25_000);
  }
  if (typeof result?.id !== "string" || typeof result?.path !== "string" ||
    !result.path.startsWith("https://")) throw new Error("POSTIZ_UPLOAD_INVALID_RESPONSE");
  return { id: result.id, path: result.path };
}

function mediaType(video: boolean, path: string): [string, string] {
  if (video) return ["video/mp4", "video.mp4"];
  return /\.png$/i.test(path) ? ["image/png", "image.png"] : ["image/jpeg", "image.jpg"];
}
const PLATFORMS = {
  instagram: { prefix: "ig-", match: (id: string) => IG.has(id), missing: "SELECT_CONNECTED_INSTAGRAM_ACCOUNT", allowEnv: "INSTAGRAM_ALLOWED_CHANNEL_IDS" },
  tiktok: { prefix: "tt-", match: (id: string) => id.startsWith("tiktok"), missing: "SELECT_CONNECTED_TIKTOK_ACCOUNT", allowEnv: "TIKTOK_ALLOWED_CHANNEL_IDS" },
  facebook: { prefix: "fb-", match: (id: string) => id === "facebook", missing: "SELECT_CONNECTED_FACEBOOK_PAGE", allowEnv: "FACEBOOK_ALLOWED_CHANNEL_IDS" },
};
// The owner's connected Postiz channel for this platform, limited by the optional allowlist.
async function pickChannel(args: InstagramRequest): Promise<{ channel?: Awaited<ReturnType<typeof listPostizChannels>>[number]; error?: string }> {
  const p = PLATFORMS[args.platform || "instagram"];
  const channels = (await listPostizChannels()).filter(x => p.match(x.identifier) && !x.disabled);
  const single = channels.length === 1 ? channels[0] : undefined;
  const channel = args.integrationId ? channels.find(x => x.id === args.integrationId) : single;
  if (!channel) return { error: p.missing };
  // Do not allow posting to a different customer's channel by accident.
  const allow = String(process.env[p.allowEnv] || "").split(",").map(x=>x.trim()).filter(Boolean);
  if (allow.length && !allow.includes(channel.id)) return { error: "ACCOUNT_NOT_ALLOWLISTED" };
  return { channel };
}
export async function scheduleInstagram(args: InstagramRequest): Promise<{ok: boolean; error?: string; job?: InstagramJob}> {
  if (!instagramSchedulingEnabled()) return { ok: false, error: "INSTAGRAM_AUTOPOST_DISABLED" };
  args = { ...args, scheduledAt: resolveWhen(args.scheduledAt) };
  const problem = validateInstagramRequest(args);
  if (problem) return {ok:false,error:problem};
  const picked = await pickChannel(args);
  if (!picked.channel) return { ok: false, error: picked.error };
  const channel = picked.channel;
  const id = PLATFORMS[args.platform || "instagram"].prefix + args.requestId;
  const existing = await getOne<InstagramJob>("instagram_posts", id);
  if (existing) return {ok:true,job:existing};
  if (!(await claimOnce("instagram-schedule:" + args.requestId, 86400 * 7))) return {ok:false,error:"ALREADY_PROCESSING"};
  const now = new Date().toISOString();
  try {
    const media = args.mediaUrl || args.telegramFileId ? await uploadMedia(args) : null;
    const body = {
      type: "schedule", date: new Date(args.scheduledAt).toISOString(), shortLink: false, tags: [],
      posts: [{
        integration: {id:channel.id},
        value: [{ content:args.caption.trim(), image:media ? [media] : [] }],
        settings: IG.has(channel.identifier) ? { __type:channel.identifier, post_type:"post", is_trial_reel:false, collaborators:[] } : { __type:channel.identifier, ...extraSettings(channel.identifier) },
      }],
    };
    const response: any = await postizRequest("/posts", {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body),
    });
    const postId = String(Array.isArray(response) ? response[0]?.postId || "" : response?.postId || "");
    if (!postId) throw new Error("POSTIZ_SCHEDULE_UNCONFIRMED");
    const job: InstagramJob = {
      id, ownerId:args.ownerId, integrationId:channel.id, channelName:channel.name,
      caption:args.caption.trim(), scheduledAt:body.date, postId,
      createdAt:now, updatedAt:now, status:"scheduled",
    };
    await putOne("instagram_posts", job);
    await logAction({actor:"human",action:(args.platform || "instagram")+".scheduled",detail:id+" · "+channel.name+" · "+body.date});
    return {ok:true,job};
  } catch (error) {
    // Postiz may already have accepted a timed-out POST. Do not auto-retry,
    // since creating a second request could publish a duplicate.
    const reason = error instanceof Error ? error.message : "INSTAGRAM_SCHEDULE_FAILED";
    const job:InstagramJob = {
      id, ownerId:args.ownerId, integrationId:channel.id, channelName:channel.name,
      caption:args.caption.trim(), scheduledAt:new Date(args.scheduledAt).toISOString(),
      createdAt:now, updatedAt:new Date().toISOString(), status:"unknown", error:reason,
    };
    await putOne("instagram_posts", job);
    await logAction({actor:"agent",action:"instagram.schedule_unconfirmed",detail:id+" · "+reason.slice(0,90)});
    return {ok:false,error:reason,job};
  }
}
export async function listInstagramJobs() {
  return (await listAll<InstagramJob>("instagram_posts")).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function refreshInstagramJobs() {
  const jobs = await listInstagramJobs();
  if (!jobs.length) return jobs;
  const posts = await listRecentPostizPosts();
  const byId = new Map(posts.map(p=>[p.id,p]));
  for (const job of jobs) {
    if (job.status !== "scheduled" || !job.postId) continue;
    const evidence = byId.get(job.postId);
    if (evidence?.verification === "linked" && evidence.releaseURL) {
      const next:InstagramJob={...job,status:"published",releaseURL:evidence.releaseURL,updatedAt:new Date().toISOString()};
      await putOne("instagram_posts",next);
      Object.assign(job,next);
    }
  }
  return jobs;
}
// Kill switch: deletes every still-future scheduled Postiz post (all, or one campaign's).
export async function cancelScheduledPostiz(campaignId?: string) {
  const jobs = (await listInstagramJobs()).filter((j) => j.status === "scheduled" && j.postId && Date.parse(j.scheduledAt) > Date.now() && (!campaignId || j.campaignId === campaignId));
  let cancelled = 0; const failed: string[] = [];
  for (const j of jobs) {
    const r = await cancelInstagramJob(j.id).catch(() => ({ ok: false }));
    if (r.ok) cancelled += 1; else failed.push(j.channelName || j.id);
  }
  return { cancelled, failed };
}
export async function cancelInstagramJob(jobId:string) {
  const job = await getOne<InstagramJob>("instagram_posts",jobId);
  if (!job || !job.postId || job.status !== "scheduled" || Date.parse(job.scheduledAt) <= Date.now())
    return {ok:false,error:"NOT_CANCELLABLE"};
  // Cancellation applies to the scheduled Postiz record only, and is
  // reversible only by submitting a NEW owner-approved task.
  await postizRequest("/posts/" + encodeURIComponent(job.postId),{method:"DELETE"});
  await putOne("instagram_posts",{...job,status:"cancelled" as const,updatedAt:new Date().toISOString()});
  await logAction({actor:"human",action:"instagram.cancelled",detail:jobId});
  return {ok:true};
}
