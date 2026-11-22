import { claimOnce, logAction } from "@/lib/scout/store";

// Postiz Cloud public REST API: https://docs.postiz.com/public-api
// This module intentionally does not grant access to Facebook Groups or
// accounts that the customer has not connected through Postiz OAuth.
const ROOT = "https://api.postiz.com/public/v1";
export type PostizChannel = {
  id: string; name: string; identifier: string; profile?: string; disabled?: boolean;
};
export type PostizMedia = { id: string; path: string };
export type PostizDraftResult = { ok: boolean; error?: string; status?: number; postId?: string; channel?: PostizChannel };
const DRAFT_TYPES = new Set(["telegram", "facebook", "linkedin", "linkedin-page", "instagram", "instagram-standalone", "tiktok", "threads", "bluesky", "mastodon", "vk", "pinterest"]);

export function postizConfigured() {
  return Boolean(String(process.env.POSTIZ_API_KEY || "").trim());
}
async function postiz(path: string, init: RequestInit = {}) {
  const key = String(process.env.POSTIZ_API_KEY || "").trim();
  if (!key) throw new Error("POSTIZ_NOT_CONFIGURED");
  const response = await fetch(ROOT + path, {
    ...init, headers: {
      "Authorization": key,
      "Content-Type": "application/json",
      ...init.headers,
    }, cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("POSTIZ_HTTP_" + response.status);
  return response.json();
}
export async function listPostizChannels(): Promise<PostizChannel[]> {
  const response: unknown = await postiz("/integrations");
  if (!Array.isArray(response)) throw new Error("POSTIZ_BAD_INTEGRATIONS_RESPONSE");
  return response.filter((x: any) => x && typeof x.id === "string" && typeof x.identifier === "string")
    .map((x: any) => ({ id: x.id, name: String(x.name || "").slice(0, 100), identifier: x.identifier, profile: String(x.profile || "").slice(0, 120), disabled: !!x.disabled }));
}
export function makePostizDraftPayload(channel: PostizChannel, text: string, media?: PostizMedia) {
  if (!DRAFT_TYPES.has(channel.identifier)) throw new Error("POSTIZ_UNSUPPORTED_CHANNEL");
  if (text.trim().length < 10 || text.length > 3500) throw new Error("POSTIZ_INVALID_CONTENT");
  return {
    type: "draft", date: new Date().toISOString(),
    shortLink: false, tags: [],
    posts: [{
      integration: { id: channel.id },
      value: [{ content: text.trim(), image: media ? [media] : [] }],
      settings: { __type: channel.identifier, ...((channel.identifier === "instagram" || channel.identifier === "instagram-standalone") ? { post_type: "post" } : {}) },
    }],
  };
}
function isHttpsPublicMedia(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname);
  } catch { return false; }
}
export async function createPostizDraft(args: { integrationId: string; content: string; mediaUrl?: string; requestId: string }): Promise<PostizDraftResult> {
  if (!postizConfigured()) return { ok: false, error: "POSTIZ_NOT_CONFIGURED" };
  const content = String(args.content || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(args.requestId)) return { ok: false, error: "INVALID_REQUEST_ID" };
  const channels = await listPostizChannels();
  const channel = channels.find((x) => x.id === args.integrationId && !x.disabled);
  if (!channel) return { ok: false, error: "CHANNEL_NOT_CONNECTED" };
  if (args.mediaUrl && !isHttpsPublicMedia(args.mediaUrl)) return { ok: false, error: "INVALID_MEDIA_URL" };
  // Also catches repeated n8n executions of the same user-confirmed request.
  if (!(await claimOnce("postiz-draft:" + args.requestId, 600))) return { ok: false, error: "DUPLICATE_REQUEST" };
  let media: PostizMedia | undefined;
  try {
    if (args.mediaUrl) {
      const uploaded: any = await postiz("/upload-from-url", { method: "POST", body: JSON.stringify({ url: args.mediaUrl }) });
      if (typeof uploaded?.id !== "string" || typeof uploaded?.path !== "string") throw new Error("POSTIZ_BAD_UPLOAD");
      media = { id: uploaded.id, path: uploaded.path };
    }
    const payload = makePostizDraftPayload(channel, content, media);
    const response: any = await postiz("/posts", { method: "POST", body: JSON.stringify(payload) });
    const postId = String((Array.isArray(response) ? response[0]?.postId : response?.postId) || "");
    if (!postId) throw new Error("POSTIZ_BAD_POST_RESPONSE");
    await logAction({ actor: "owner", action: "postiz.draft", detail: "Draft " + postId + " for " + channel.identifier + " (" + channel.name + ")" });
    return { ok: true, postId, channel };
  } catch (error) {
    const message = error instanceof Error ? error.message : "POSTIZ_UNKNOWN";
    await logAction({ actor: "agent", action: "postiz.draft_failed", detail: message.slice(0, 140) });
    return { ok: false, error: message };
  }
}
