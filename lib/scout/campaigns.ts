import { runStructuredExtraction } from "@/lib/free-ai";
import { geminiTranscribe } from "@/lib/gemini-audio";
import { geminiSearch, geminiSearchKey } from "@/lib/gemini-search";
import { DEFAULT_DAILY_LIMIT, findGroups, listGroups, refreshActivity, telegramFeed, messageLink, PLATFORM_LABEL, platformOfUrl, sendPhoto, type GroupCard, type Platform, type PostLog, type QueueItem } from "@/lib/scout/groups";
import { claimOnce, getOne, increment, listAll, logAction, putMany, putOne, removeMany } from "@/lib/scout/store";
import { botToken, controlIds, reportChatId, sendMessage, tgCall } from "@/lib/scout/telegram";
import { escapeHtml, nowIso, randomId, stableId } from "@/lib/scout/text";
import { isPolishWineCampaign, POLISH_WINE_B2B_QUERIES } from "@/lib/scout/wine-compliance";

// Advertising campaigns (client TZ "AI Social Agent", Nov 2026):
// owner sends a text or voice task to the bot → AI turns it into a campaign (ad text, topic, region,
// languages, up to 40 keywords) → owner approves → every day the planner spreads the campaign over
// placements that gave permission, toward the daily target (default 300):
//   • Telegram chats where an admin added the bot → the bot posts (official Bot API);
//   • partners (admins of Facebook/Instagram/TikTok/Telegram groups who agreed) → the bot sends them a task,
//     they publish by hand and reply /proof <link>, the owner confirms;
//   • other permitted groups → manual queue for the owner's own account, one click per post.
// No account farms, no posting from personal accounts by a script, no posting where nobody agreed.

// draft → owner approves keywords → search → ready → owner starts placement → approved (running) → stopped
export type CampaignStatus = "draft" | "searching" | "ready" | "approved" | "stopped";
export type Campaign = {
  id: string;
  title: string;
  adText: string;
  topic: string;
  region: string;
  languages: string[];
  keywords: string[];
  // Adjacent audiences: classifieds, expats, city and district communities, flea markets…
  adjacent: string[];
  queries: string[];
  exclusions: string[];
  questions: string[];
  translations: Record<string, string>;
  platforms: Platform[];
  dailyTarget: number;
  photo?: string;
  status: CampaignStatus;
  ownerId?: string;
  source: "text" | "voice" | "web";
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  found?: { total: number; core: number; adjacent: number; inactive: number; at: string; notes?: string[] };
  // Authoritative per-campaign audience. Never route a campaign to every group
  // in the global CRM merely because one common keyword happens to match.
  searchGroupIds?: string[];
};

export type TaskMode = "bot" | "partner" | "manual";
export type TaskStatus = "scheduled" | "sent" | "failed" | "notified" | "proof" | "verified" | "skipped" | "cancelled";
export type CampaignTask = {
  id: string;
  campaignId: string;
  campaignTitle: string;
  groupId: string;
  groupName: string;
  platform: Platform;
  url: string;
  day: string;
  mode: TaskMode;
  status: TaskStatus;
  partnerId?: string;
  link?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type Mention = { id: string; campaignId: string; platform: Platform; url: string; title: string; author?: string; views?: number; at?: string; foundAt: string };

export const DEFAULT_DAILY_TARGET = Number(process.env.DAILY_TARGET || 300) || 300;
const ALL_PLATFORMS: Platform[] = ["telegram", "facebook", "instagram", "tiktok"];
const DONE: TaskStatus[] = ["sent", "verified"];

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

// ---- Task → campaign (AI with a rule-based fallback) ------------------------------------

const STOP = new Set("и в во на по для из с со от до за к о об а но или что это как the and for with from in on of to a an de la el en y para con los las del".split(" "));
const PROMPT_WORDS = new Set("разместить размещение разместить опубликовать опубликовать публикация опубликуй объявление объявления объявлений оголошення розмістити реклама рекламу продаже продажа нарушая законов соблюдать законы нелегально легально польша польше польшу польши".split(" "));

export function cleanKeywords(list: unknown[], limit = 40) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const k = String(raw ?? "").replace(/^[#\s"'«]+|[\s"'»,.;]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    const key = k.toLowerCase();
    if (k.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= limit) break;
  }
  return out;
}

export function detectPlatforms(text: string): Platform[] {
  const t = text.toLowerCase();
  const found = ALL_PLATFORMS.filter((p) => ({ telegram: /telegram|телеграм|тг\b/, facebook: /facebook|фейсбук|фб\b/, instagram: /instagram|инстаграм|инст/, tiktok: /tiktok|тикток|тик-ток/ })[p].test(t));
  return found.length ? found : ALL_PLATFORMS;
}

export function ruleCampaign(text: string): Omit<Campaign, "id" | "status" | "createdAt" | "updatedAt" | "source"> {
  const clean = text.replace(/^\/\w+(@\w+)?\s*/, "").trim();
  const firstLine = clean.split(/\n|[.!?](\s|$)/)[0]?.trim() || clean;
  const words = clean.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w) && !PROMPT_WORDS.has(w));
  const region = /(?:в|во|in|en)\s+([A-ZА-ЯЁ][\p{L}-]+(?:\s+[A-ZА-ЯЁ][\p{L}-]+)?)/u.exec(clean)?.[1] || "";
  const polishWine = isPolishWineCampaign({ region, adText: clean });
  const target = /(\d{2,4})\s*(?:постов|публикац|размещени|posts|placements)/i.exec(clean);
  return {
    title: firstLine.slice(0, 80),
    adText: clean.slice(0, 3500),
    topic: polishWine ? "importerzy wina Polska" : words.slice(0, 3).join(" "),
    region,
    languages: /[а-яё]/i.test(clean) ? ["ru"] : ["en"],
    keywords: cleanKeywords(polishWine ? POLISH_WINE_B2B_QUERIES : words, 40),
    adjacent: [],
    queries: [],
    exclusions: [],
    questions: [...(region ? [] : ["В каком городе или стране искать сообщества?"]), ...(clean.length < 60 ? ["Пришлите текст объявления (и фото, если есть)."] : [])],
    translations: {},
    platforms: detectPlatforms(clean),
    dailyTarget: target ? Math.min(2000, Number(target[1])) : DEFAULT_DAILY_TARGET,
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "short campaign name, max 80 chars" },
    ad_text: { type: "string", description: "ready-to-publish ad text in the task's language; keep facts, prices and contacts exactly" },
    topic: { type: "string" },
    region: { type: "string", description: "country / city, empty if none" },
    languages: { type: "array", items: { type: "string", description: "ISO 639-1" } },
    keywords: { type: "array", items: { type: "string" }, description: "40 keywords for finding communities on the topic: word forms, synonyms, translations into the languages of the region and of the target audience" },
    adjacent_keywords: { type: "array", items: { type: "string" }, description: "8-15 phrases for ADJACENT communities where the same audience gathers and such an ad is appropriate (classifieds, flea markets, expats and relocants, city and district communities), with the city, in local languages" },
    questions: { type: "array", items: { type: "string" }, description: "clarifying questions in the owner's language for missing essentials (region, ad text, platforms); empty if the task is clear" },
    translations: { type: "array", items: { type: "object", properties: { lang: { type: "string" }, text: { type: "string" } } }, description: "the ad text adapted to each target language (ISO 639-1)" },
    platforms: { type: "array", items: { type: "string", enum: ALL_PLATFORMS } },
    daily_target: { type: "number" },
  },
  required: ["title", "ad_text", "topic", "region", "languages", "keywords", "platforms"],
};

export async function parseCampaign(text: string, deadlineAt = Date.now() + 70_000) {
  const base = ruleCampaign(text);
  const ai = await runStructuredExtraction({
    system: "You turn an owner's free-form task (often a voice transcript) into an advertising campaign for publishing in social media communities. Never invent prices, addresses or contacts. If the task contains a ready ad text, keep it. Return JSON only.",
    user: "TASK:\n" + text.slice(0, 6000),
    schema: SCHEMA,
    deadlineAt,
    maxTokens: 6000,
    perCallTimeoutMs: 30_000,
    prefer: "gemini",
  }).catch(() => null);
  const p = ai?.parsed;
  if (!p) return { ...base, ai: false };
  const platforms = (Array.isArray(p.platforms) ? p.platforms : []).filter((x: string) => ALL_PLATFORMS.includes(x as Platform)) as Platform[];
  return {
    title: String(p.title || base.title).slice(0, 80),
    adText: String(p.ad_text || base.adText).slice(0, 3500),
    topic: String(p.topic || base.topic).slice(0, 80),
    region: String(p.region || base.region).slice(0, 80),
    languages: cleanKeywords(Array.isArray(p.languages) ? p.languages : base.languages, 5),
    keywords: cleanKeywords([...(Array.isArray(p.keywords) ? p.keywords : []), ...base.keywords], 40),
    adjacent: cleanKeywords(Array.isArray(p.adjacent_keywords) ? p.adjacent_keywords : [], 15),
    queries: [],
    exclusions: [],
    questions: (Array.isArray(p.questions) ? p.questions : []).map((q: unknown) => String(q).slice(0, 200)).filter(Boolean).slice(0, 4),
    translations: Object.fromEntries((Array.isArray(p.translations) ? p.translations : []).filter((t: any) => t?.lang && t?.text).map((t: any) => [String(t.lang).slice(0, 5).toLowerCase(), String(t.text).slice(0, 3500)])),
    platforms: platforms.length ? platforms : base.platforms,
    dailyTarget: Number(p.daily_target) > 0 ? Math.min(2000, Math.round(Number(p.daily_target))) : base.dailyTarget,
    ai: true,
  };
}

export async function createCampaign(text: string, source: Campaign["source"], ownerId?: string, photo?: string) {
  const parsed = await parseCampaign(text);
  const now = nowIso();
  const { ai, ...fields } = parsed;
  const campaign: Campaign = { id: randomId("cmp").slice(-12), ...fields, photo, status: "draft", ownerId, source, createdAt: now, updatedAt: now };
  await putOne("campaigns", campaign);
  await logAction({ actor: "agent", action: "campaign.draft", detail: campaign.title + (ai ? "" : " (без ИИ, по правилам)") });
  return { campaign, ai };
}

// The owner answered the clarifying questions: re-read the task with the answer and keep edits.
export async function answerCampaign(id: string, answer: string) {
  const c = await getOne<Campaign>("campaigns", id);
  if (!c) return null;
  const parsed = await parseCampaign("Задача: " + c.adText + "\nРегион: " + c.region + "\nДополнение владельца: " + answer);
  const { ai, ...fields } = parsed;
  const next: Campaign = { ...c, ...fields, adText: answer.length > 80 && /объявлени|текст|ad text/i.test(answer) ? answer.slice(0, 3500) : fields.adText, updatedAt: nowIso() };
  await putOne("campaigns", next);
  return next;
}

export async function listCampaigns() {
  return (await listAll<Campaign>("campaigns")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateCampaign(id: string, patch: Partial<Pick<Campaign, "title" | "adText" | "keywords" | "adjacent" | "queries" | "exclusions" | "dailyTarget" | "platforms" | "region" | "topic">>) {
  const c = await getOne<Campaign>("campaigns", id);
  if (!c) return null;
  const next: Campaign = { ...c, updatedAt: nowIso() };
  if (patch.title) next.title = String(patch.title).slice(0, 80);
  if (patch.adText) next.adText = String(patch.adText).slice(0, 3500);
  if (patch.topic !== undefined) next.topic = String(patch.topic).slice(0, 80);
  if (patch.region !== undefined) next.region = String(patch.region).slice(0, 80);
  if (Array.isArray(patch.keywords)) next.keywords = cleanKeywords(patch.keywords, 40);
  if (Array.isArray(patch.adjacent)) next.adjacent = cleanKeywords(patch.adjacent, 15);
  if (Array.isArray(patch.queries)) next.queries = cleanKeywords(patch.queries, 20);
  if (Array.isArray(patch.exclusions)) next.exclusions = cleanKeywords(patch.exclusions, 30);
  if (patch.dailyTarget !== undefined) next.dailyTarget = Math.max(1, Math.min(2000, Math.round(Number(patch.dailyTarget) || DEFAULT_DAILY_TARGET)));
  if (Array.isArray(patch.platforms)) { const p = patch.platforms.filter((x) => ALL_PLATFORMS.includes(x)); if (p.length) next.platforms = p; }
  await putOne("campaigns", next);
  return next;
}

export function textFor(c: Campaign, language?: string) {
  return (language && c.translations?.[language]) || c.adText;
}

export async function setCampaignStatus(id: string, status: "approved" | "stopped", by = "owner") {
  const c = await getOne<Campaign>("campaigns", id);
  if (!c) return null;
  if (status === "approved" && isPolishWineCampaign(c)) {
    await logAction({ actor: "agent", action: "campaign.compliance_block", detail: c.title + ": Poland wine public advertising" });
    return null;
  }
  if (status === "approved" && (!c.found?.total || !c.searchGroupIds?.length)) {
    await logAction({ actor: "agent", action: "campaign.no_verified_targets", detail: c.title + ": search/authorization missing" });
    return null;
  }
  const next: Campaign = { ...c, status, updatedAt: nowIso(), ...(status === "approved" ? { approvedAt: nowIso() } : {}) };
  await putOne("campaigns", next);
  if (status === "stopped") {
    // Kill switch: everything not yet published is cancelled and leaves the manual queue.
    const open = (await listAll<CampaignTask>("campaign_tasks")).filter((t) => t.campaignId === id && ["scheduled", "notified"].includes(t.status));
    await putMany("campaign_tasks", open.map((t) => ({ ...t, status: "cancelled" as TaskStatus, updatedAt: nowIso() })));
    await removeMany("group_queue", open.filter((t) => t.mode === "manual").map((t) => t.id));
    for (const t of open.filter((x) => x.mode === "partner" && x.status === "notified" && x.partnerId)) await sendMessage(t.partnerId!, "⏹ Задание <code>" + t.id + "</code> отменено владельцем. Публиковать не нужно.");
  }
  await logAction({ actor: "human", action: "campaign." + status, detail: c.title + " — " + by });
  return next;
}

// ---- Community search: many queries per task, core and adjacent, merged without duplicates ----

export function splitRegion(region: string) {
  const parts = region.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1 && /^(польша|польше|польши|poland|polska|polsce|polski)$/i.test(parts[0] || "")) {
    return { city: "", country: "Poland" };
  }
  return parts.length >= 2 ? { city: parts[0], country: parts.slice(1).join(", ") } : { city: parts[0] || "", country: "" };
}

export function searchPlan(c: Campaign, maxRuns = Number(process.env.CAMPAIGN_SEARCH_RUNS || 10) || 10) {
  const restricted = isPolishWineCampaign(c);
  // Wine trade in Poland: prioritize actual professional buyers and Polish
  // industry language; never search consumer/expat groups as advertising targets.
  const core = cleanKeywords(restricted
    ? [...c.queries, ...POLISH_WINE_B2B_QUERIES]
    : [c.topic, ...c.queries, ...c.keywords.filter((k) => !PROMPT_WORDS.has(k.toLowerCase()))], 40);
  const adjacent = restricted ? [] : c.adjacent;
  // Interleave: most of the budget on the topic, at least a third on adjacent audiences.
  const adjacentRuns = adjacent.length ? Math.max(1, Math.round(maxRuns / 3)) : 0;
  const coreList = core.slice(0, maxRuns - Math.min(adjacentRuns, adjacent.length)).map((topic) => ({ topic, relevance: "core" as const }));
  const adjList = adjacent.slice(0, adjacentRuns).map((topic) => ({ topic, relevance: "adjacent" as const }));
  // Interleaved (core, core, adjacent, …) so a run cut short by the time limit still covers both kinds.
  const out: Array<{ topic: string; relevance: "core" | "adjacent" }> = [];
  while (coreList.length || adjList.length) {
    out.push(...coreList.splice(0, 2));
    out.push(...adjList.splice(0, 1));
  }
  return out;
}

export async function findForCampaign(id: string, deadlineAt = Date.now() + 260_000) {
  const c = await getOne<Campaign>("campaigns", id);
  if (!c) return null;
  // An approved campaign keeps running while its base is refreshed (daily cron).
  if (c.status !== "approved") await putOne("campaigns", { ...c, status: "searching", updatedAt: nowIso() });
  const place = splitRegion(c.region);
  const plan = searchPlan(c);
  const seen = new Map<string, GroupCard>();
  const notes = new Set<string>();
  let attempted = 0;
  // One query at a time, preserving the budget and provider rate limits.
  for (let i = 0; i < plan.length && Date.now() < deadlineAt - 20_000; i += 1) {
    attempted += 1;
    const batch = plan.slice(i, i + 1);
    const results = await Promise.all(batch.map((q) => findGroups({ ...place, topic: q.topic, relevance: q.relevance, exclusions: c.exclusions, language: c.languages[0], platforms: c.platforms }, Math.min(deadlineAt - 10_000, Date.now() + 90_000)).catch(() => null)));
    for (const r of results) {
      if (!r) continue;
      r.notes.forEach((n) => notes.add(n));
      for (const g of r.found) if (c.platforms.includes(g.platform) && (!seen.has(g.id) || g.relevance === "core")) seen.set(g.id, g);
    }
  }
  const all = [...seen.values()];
  const found = { notes: [...notes].slice(0, 3), total: all.length, core: all.filter((g) => g.relevance !== "adjacent").length, adjacent: all.filter((g) => g.relevance === "adjacent").length, inactive: all.filter((g) => g.activity === "inactive").length, at: nowIso() };
  const fresh = (await getOne<Campaign>("campaigns", id)) || c;
  const next: Campaign = { ...fresh, status: fresh.status === "stopped" ? "stopped" : fresh.status === "approved" ? "approved" : "ready", found, searchGroupIds: all.map((g) => g.id), updatedAt: nowIso() };
  await putOne("campaigns", next);
  await logAction({ actor: "agent", action: "campaign.search", detail: c.title + ": " + found.total + " сообществ (профильных " + found.core + ", смежных " + found.adjacent + ", неактивных " + found.inactive + ")" });
  return { campaign: next, groups: all, notes: [...notes], queries: attempted };
}

// ---- Daily planner -----------------------------------------------------------------------

export function modeFor(g: GroupCard): TaskMode | null {
  if (g.status === "declined" || g.ads === "forbidden" || g.activity === "inactive") return null;
  if (g.platform === "telegram" && g.botConnected && g.postingEnabled && g.chatId) return "bot";
  const agreed = ["free", "exchange", "paid"].includes(g.status);
  if (g.partnerTelegramId && agreed) return "partner";
  // Only explicit agreements authorize partner or manual publication.
  if (agreed) return "manual";
  return null; // no permission yet: outreach first
}

export function matchesCampaign(g: GroupCard, c: Campaign) {
  if (!c.platforms.includes(g.platform)) return false;
  const words = [c.topic, c.region, ...c.keywords].join(" ").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
  const own = [g.name, g.topic, g.city, g.country, g.description].filter(Boolean).join(" ").toLowerCase();
  // Groups added by the bot or by hand often carry no topic: the admin's consent is what counts.
  if (!g.topic && !g.city && !g.country) return true;
  return !words.length || words.some((w) => own.includes(w));
}

export type PlanResult = { day: string; created: number; byMode: Record<TaskMode, number>; perCampaign: Record<string, number> };

export function planTasks(campaigns: Campaign[], groups: GroupCard[], existing: CampaignTask[], day: string): CampaignTask[] {
  const now = nowIso();
  const live = existing.filter((t) => t.status !== "cancelled" && t.status !== "skipped");
  const dayLoad = new Map<string, number>();
  const lastDay = new Map<string, string>();
  for (const t of live) {
    if (t.day === day) dayLoad.set(t.groupId, (dayLoad.get(t.groupId) || 0) + 1);
    else if (t.day < day && (!lastDay.get(t.groupId) || t.day > lastDay.get(t.groupId)!)) lastDay.set(t.groupId, t.day);
  }
  const ids = new Set(existing.map((t) => t.id));
  const out: CampaignTask[] = [];
  for (const c of campaigns.filter((x) => x.status === "approved" && !isPolishWineCampaign(x) && (x.found?.total || 0) > 0 && (x.searchGroupIds?.length || 0) > 0)) {
    const eligible = new Set(c.searchGroupIds);
    let count = live.filter((t) => t.campaignId === c.id && t.day === day).length;
    for (const g of groups) {
      if (count >= c.dailyTarget) break;
      if (!eligible.has(g.id)) continue;
      const mode = modeFor(g);
      if (!mode || !matchesCampaign(g, c)) continue;
      const id = stableId("ct", c.id + "|" + g.id + "|" + day);
      if (ids.has(id)) continue;
      if ((dayLoad.get(g.id) || 0) >= (g.dailyLimit ?? DEFAULT_DAILY_LIMIT)) continue;
      const last = lastDay.get(g.id);
      if (last && daysBetween(last, day) < (g.minDaysBetween || 1)) continue;
      out.push({ id, campaignId: c.id, campaignTitle: c.title, groupId: g.id, groupName: g.name, platform: g.platform, url: g.url, day, mode, status: "scheduled", partnerId: mode === "partner" ? g.partnerTelegramId : undefined, createdAt: now, updatedAt: now });
      ids.add(id);
      dayLoad.set(g.id, (dayLoad.get(g.id) || 0) + 1);
      count += 1;
    }
  }
  return out;
}

export async function planDay(day = today()): Promise<PlanResult> {
  const [campaigns, groups, existing] = await Promise.all([listCampaigns(), listGroups(), listAll<CampaignTask>("campaign_tasks")]);
  const tasks = planTasks(campaigns, groups, existing, day);
  await putMany("campaign_tasks", tasks);
  const byCampaign = new Map(campaigns.map((c) => [c.id, c]));
  const queue: QueueItem[] = tasks.filter((t) => t.mode === "manual").map((t) => ({ id: t.id, groupId: t.groupId, groupName: t.groupName, platform: t.platform, url: t.url, text: (() => { const c = byCampaign.get(t.campaignId); return c ? textFor(c, groups.find((g) => g.id === t.groupId)?.language) : ""; })(), status: "pending", createdAt: t.createdAt }));
  await putMany("group_queue", queue);
  const byMode = { bot: 0, partner: 0, manual: 0 } as Record<TaskMode, number>;
  const perCampaign: Record<string, number> = {};
  for (const t of tasks) { byMode[t.mode] += 1; perCampaign[t.campaignId] = (perCampaign[t.campaignId] || 0) + 1; }
  if (tasks.length) await logAction({ actor: "agent", action: "campaign.plan", detail: day + ": " + tasks.length + " (бот " + byMode.bot + ", партнёры " + byMode.partner + ", вручную " + byMode.manual + ")" });
  return { day, created: tasks.length, byMode, perCampaign };
}

// ---- Execution -----------------------------------------------------------------------------

async function activeCampaign(id: string) {
  const c = await getOne<Campaign>("campaigns", id);
  return c?.status === "approved" && !isPolishWineCampaign(c) && (c.found?.total || 0) > 0 && (c.searchGroupIds?.length || 0) > 0 ? c : null;
}

// Bot tasks: only chats where an admin added the bot, ~3 s apart, daily limit shared with /post.
export async function dispatchBotTasks(day = today(), deadlineAt = Date.now() + 240_000, pauseMs = 3000) {
  // Explicit opt-in only: a missing environment flag can never start bulk posting.
  if (process.env.CAMPAIGN_AUTOPOST !== "on") return { sent: 0, failed: 0, left: 0, disabled: true };
  if (!botToken()) return { sent: 0, failed: 0, left: 0, disabled: true };
  const tasks = (await listAll<CampaignTask>("campaign_tasks")).filter((t) => t.day === day && t.mode === "bot" && t.status === "scheduled");
  let sent = 0, failed = 0, left = 0;
  for (const [index, task] of tasks.entries()) {
    if (Date.now() > deadlineAt) { left = tasks.length - index; break; }
    const campaign = await activeCampaign(task.campaignId);
    const group = await getOne<GroupCard>("groups", task.groupId);
    if (!campaign || !group?.botConnected || !group.postingEnabled || !group.chatId) { await putOne("campaign_tasks", { ...task, status: "cancelled", updatedAt: nowIso() }); continue; }
    // Two cron workers may overlap. A distributed NX lock prevents duplicate
    // sends for the same scheduled campaign/group/day item.
    if (!(await claimOnce("campaign-dispatch:" + task.id, 60 * 60))) continue;
    const text = textFor(campaign, group.language);
    const result = campaign.photo ? await sendPhoto(group.chatId, campaign.photo, text) : await sendMessage(group.chatId, escapeHtml(text)).then((r) => ({ ok: r.ok, result: { message_id: r.messageId }, description: r.error }));
    const link = result?.ok ? messageLink(group, result?.result?.message_id) : undefined;
    const error = result?.ok ? undefined : String(result?.description || "ошибка").slice(0, 200);
    await putOne("campaign_tasks", { ...task, status: result?.ok ? "sent" : "failed", link, error, updatedAt: nowIso() });
    await putOne("group_posts", { id: randomId("post"), at: nowIso(), groupId: group.id, groupName: group.name, platform: "telegram", mode: "bot", status: result?.ok ? "sent" : "failed", text: campaign.adText.slice(0, 300), by: "кампания: " + campaign.title, link, error } satisfies PostLog);
    if (result?.ok) { sent += 1; await increment("grp-post:" + group.id + ":" + day, 2 * 24 * 3600); }
    else {
      failed += 1;
      if (/kicked|not a member|chat not found|have no rights|not enough rights/i.test(error || "")) await putOne("groups", { ...group, botConnected: false, postingEnabled: false, updatedAt: nowIso() });
    }
    if (pauseMs && index < tasks.length - 1) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { sent, failed, left, disabled: false };
}

export function partnerTaskText(task: CampaignTask, campaign: Campaign, language?: string) {
  return "📌 <b>Задание на публикацию</b> (по договорённости)\nПлощадка: " + escapeHtml(task.groupName) + " · " + PLATFORM_LABEL[task.platform] +
    (task.url ? "\n" + escapeHtml(task.url) : "") + "\n\nТекст:\n<code>" + escapeHtml(textFor(campaign, language).slice(0, 2800)) + "</code>" +
    (campaign.photo ? "\n\nС фото — оно в сообщении выше." : "") +
    "\n\nПосле публикации отправьте ссылку на пост:\n<code>/proof " + task.id + " https://…</code>";
}

export async function notifyPartners(day = today(), limit = 100) {
  const tasks = (await listAll<CampaignTask>("campaign_tasks")).filter((t) => t.day === day && t.mode === "partner" && t.status === "scheduled" && t.partnerId).slice(0, limit);
  let notified = 0;
  for (const task of tasks) {
    const campaign = await activeCampaign(task.campaignId);
    if (!campaign) { await putOne("campaign_tasks", { ...task, status: "cancelled", updatedAt: nowIso() }); continue; }
    if (campaign.photo) await tgCall("sendPhoto", { chat_id: task.partnerId, photo: campaign.photo });
    const group = await getOne<GroupCard>("groups", task.groupId);
    const r = await sendMessage(task.partnerId!, partnerTaskText(task, campaign, group?.language));
    await putOne("campaign_tasks", { ...task, status: r.ok ? "notified" : "failed", error: r.ok ? undefined : "партнёр не открыл чат с ботом (" + (r.error || "") + ")", updatedAt: nowIso() });
    if (r.ok) notified += 1;
  }
  return { notified };
}

export function proofMatches(platform: Platform, url: string) {
  const hosts: Record<Platform, RegExp> = { telegram: /^(t\.me|telegram\.me)$/, facebook: /^((www|m|web)\.)?facebook\.com$|^fb\.com$/, instagram: /^(www\.)?instagram\.com$/, tiktok: /^((www|m|vm)\.)?tiktok\.com$/ };
  try { const u = new URL(url.trim()); return u.protocol === "https:" && hosts[platform].test(u.hostname.toLowerCase()); } catch { return false; }
}

// /proof <task> <url> from the partner: the owner gets buttons to confirm or reject.
export async function submitProof(taskId: string, actorId: string, url: string) {
  const task = await getOne<CampaignTask>("campaign_tasks", taskId.trim());
  if (!task || task.mode !== "partner" || String(task.partnerId) !== String(actorId)) return { ok: false, message: "Задание не найдено или выдано не вам." };
  if (!["notified", "scheduled", "proof"].includes(task.status)) return { ok: false, message: "Задание уже закрыто (" + task.status + ")." };
  if (!(await activeCampaign(task.campaignId))) return { ok: false, message: "Кампания остановлена, публиковать не нужно." };
  if (!proofMatches(task.platform, url)) return { ok: false, message: "Нужна ссылка https на пост в " + PLATFORM_LABEL[task.platform] + "." };
  const next: CampaignTask = { ...task, status: "proof", link: url.trim().slice(0, 400), updatedAt: nowIso() };
  await putOne("campaign_tasks", next);
  const owners = [...controlIds()].filter((id) => /^\d+$/.test(id));
  const target = owners[0] || (await reportChatId());
  if (target) await sendMessage(target, "🧾 Партнёр прислал подтверждение\n" + escapeHtml(task.groupName) + " · " + PLATFORM_LABEL[task.platform] + "\nКампания: " + escapeHtml(task.campaignTitle) + "\n" + escapeHtml(next.link || ""), [[{ text: "✅ Засчитать", callback_data: "cp:ok:" + task.id }, { text: "✖️ Не засчитывать", callback_data: "cp:no:" + task.id }]]);
  return { ok: true, message: "Спасибо! Ссылка отправлена на проверку владельцу." };
}

export async function verifyProof(taskId: string, accept: boolean, by = "owner") {
  const task = await getOne<CampaignTask>("campaign_tasks", taskId);
  if (!task || task.status !== "proof") return null;
  const next: CampaignTask = { ...task, status: accept ? "verified" : "failed", error: accept ? undefined : "отклонено владельцем", updatedAt: nowIso() };
  await putOne("campaign_tasks", next);
  await putOne("group_posts", { id: randomId("post"), at: nowIso(), groupId: task.groupId, groupName: task.groupName, platform: task.platform, mode: "manual", status: accept ? "published" : "failed", text: "партнёр · " + task.campaignTitle, by, link: task.link } satisfies PostLog);
  if (task.partnerId) await sendMessage(task.partnerId, accept ? "✅ Публикация засчитана. Спасибо!" : "Публикация не засчитана владельцем. Если это ошибка, напишите ему.");
  return next;
}

// ---- Capacity and reports ------------------------------------------------------------------

export function capacityOf(groups: GroupCard[], tasks: CampaignTask[], campaigns: Campaign[], day = today()) {
  const byMode: Record<TaskMode, { places: number; peak: number; sustained: number }> = { bot: { places: 0, peak: 0, sustained: 0 }, partner: { places: 0, peak: 0, sustained: 0 }, manual: { places: 0, peak: 0, sustained: 0 } };
  for (const g of groups) {
    const mode = modeFor(g);
    if (!mode) continue;
    const limit = g.dailyLimit ?? DEFAULT_DAILY_LIMIT;
    byMode[mode].places += 1;
    byMode[mode].peak += limit;
    byMode[mode].sustained += limit / Math.max(1, g.minDaysBetween || 1);
  }
  const todays = tasks.filter((t) => t.day === day);
  const target = campaigns.filter((c) => c.status === "approved" && !isPolishWineCampaign(c) && (c.found?.total || 0) > 0 && (c.searchGroupIds?.length || 0) > 0).reduce((s, c) => s + c.dailyTarget, 0);
  const sum = (k: "places" | "peak" | "sustained") => Math.round(byMode.bot[k] + byMode.partner[k] + byMode.manual[k]);
  return {
    day,
    target,
    places: sum("places"),
    peak: sum("peak"),
    sustained: sum("sustained"),
    byMode,
    planned: todays.filter((t) => t.status !== "cancelled").length,
    verified: todays.filter((t) => DONE.includes(t.status)).length,
    awaiting: todays.filter((t) => ["scheduled", "notified", "proof"].includes(t.status)).length,
    failed: todays.filter((t) => t.status === "failed").length,
    withoutPermission: groups.filter((g) => !modeFor(g) && g.status !== "declined").length,
  };
}

export async function capacity(day = today()) {
  const [groups, tasks, campaigns] = await Promise.all([listGroups(), listAll<CampaignTask>("campaign_tasks"), listCampaigns()]);
  return capacityOf(groups, tasks, campaigns, day);
}

export function capacityText(c: ReturnType<typeof capacityOf>) {
  const gap = c.target - c.sustained;
  return "<b>Ёмкость сети на " + c.day + "</b>\nЦель кампаний: <b>" + c.target + "</b> в день\nПлощадок с разрешением: " + c.places +
    "\nМаксимум за день: " + c.peak + "\nУстойчиво в среднем: <b>" + c.sustained + "</b> в день" +
    "\n  бот " + Math.round(c.byMode.bot.sustained) + " · партнёры " + Math.round(c.byMode.partner.sustained) + " · вручную " + Math.round(c.byMode.manual.sustained) +
    "\n\n<b>Сегодня</b>: запланировано " + c.planned + ", опубликовано и подтверждено " + c.verified + ", ждут " + c.awaiting + ", ошибок " + c.failed +
    (gap > 0 ? "\n\n⚠️ До цели не хватает ~" + gap + " публикаций в день. Нужны новые площадки с согласием админов (" + c.withoutPermission + " групп ждут ответа)." : "");
}

export async function digestText(day = today()) {
  const [groups, campaigns0, all, mentions] = await Promise.all([listGroups(), listCampaigns(), listAll<CampaignTask>("campaign_tasks"), listAll<Mention>("mentions")]);
  const cap = capacityOf(groups, all, campaigns0, day);
  const campaigns = campaigns0.filter((c) => c.status === "approved");
  const tasks = all.filter((t) => t.day === day);
  const lines = campaigns.map((c) => { const own = tasks.filter((t) => t.campaignId === c.id); return "• " + escapeHtml(c.title) + ": " + own.filter((t) => DONE.includes(t.status)).length + " / " + c.dailyTarget + " (в работе " + own.filter((t) => ["scheduled", "notified", "proof"].includes(t.status)).length + ")"; });
  const failed = tasks.filter((t) => t.status === "failed");
  const blocked = failed.filter((t) => /kicked|not a member|chat not found|rights|banned|forbidden/i.test(t.error || ""));
  const rejected = failed.filter((t) => /отклонено/.test(t.error || ""));
  return "📊 <b>Отчёт за " + day + "</b>" +
    "\nНайдено сообществ: " + groups.filter((g) => g.foundAt.startsWith(day)).length + " (всего в базе " + groups.length + ", неактивных " + groups.filter((g) => g.activity === "inactive").length + ")" +
    "\nРазмещено: <b>" + cap.verified + "</b> · отклонено " + rejected.length + " · ошибок " + (failed.length - blocked.length - rejected.length) + " · удалили бота / блокировки " + blocked.length +
    "\nОтклики партнёров (прислали ссылку): " + tasks.filter((t) => t.status === "proof" || (t.mode === "partner" && t.status === "verified")).length +
    "\nНайдено публикаций мониторингом: " + mentions.filter((m) => m.foundAt.startsWith(day)).length +
    "\n\n" + (lines.join("\n") || "Нет запущенных кампаний.") + "\n\n" + capacityText(cap);
}

// ---- Monitoring of public posts (search index, partial by nature) ----------------------------

export function looksLikePost(url: string): Platform | null {
  const found = platformOfUrl(url);
  if (found) {
    const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } })();
    if (found.platform === "telegram" && /^\/(s\/)?[^/]+\/\d+\/?$/.test(path)) return "telegram";
    if (found.platform === "facebook" && /\/(posts|permalink|videos)\//.test(path)) return "facebook";
  }
  if (/instagram\.com\/(p|reel|tv)\//i.test(url)) return "instagram";
  if (/tiktok\.com\/@[\w.]+\/video\/\d+/i.test(url)) return "tiktok";
  return null;
}

export function matchesPost(text: string, c: Pick<Campaign, "keywords" | "topic" | "region">) {
  const t = text.toLowerCase();
  const stems = cleanKeywords([c.topic, ...c.keywords], 40).map((k) => k.toLowerCase().slice(0, Math.max(4, Math.min(7, k.length - 1))));
  return stems.some((k) => k.length >= 3 && t.includes(k));
}

// Monitoring (TZ §5): posts on the campaign's keywords inside the found public communities
// (Telegram feeds with views as engagement) plus public posts the search index knows.
export async function monitorCampaign(id: string, deadlineAt = Date.now() + 200_000) {
  const c = await getOne<Campaign>("campaigns", id);
  if (!c) return { ok: false, found: 0, added: 0, top: [] as Mention[], message: "Кампания не найдена." };
  const seen = new Set((await listAll<Mention>("mentions")).map((m) => m.id));
  const fresh: Mention[] = [];
  let found = 0;
  const add = (m: Omit<Mention, "id" | "foundAt" | "campaignId">) => {
    found += 1;
    const mid = stableId("mn", c.id + "|" + m.url.toLowerCase());
    if (seen.has(mid)) return;
    seen.add(mid);
    fresh.push({ ...m, id: mid, campaignId: c.id, foundAt: nowIso() });
  };
  const channels = (await listGroups()).filter((g) => g.platform === "telegram" && g.activity !== "inactive" && g.url && !g.url.includes("/+") && matchesCampaign(g, c)).slice(0, 40);
  for (let i = 0; i < channels.length && Date.now() < deadlineAt; i += 8) {
    const feeds = await Promise.all(channels.slice(i, i + 8).map(async (g) => ({ g, posts: await telegramFeed(g.url) })));
    for (const { g, posts } of feeds) for (const post of posts) if (matchesPost(post.text, c)) add({ platform: "telegram", url: post.url, title: post.text.slice(0, 200), author: g.name, views: post.views, at: post.at });
  }
  let limited = "";
  if (geminiSearchKey() && Date.now() < deadlineAt - 25_000) {
    const terms = [c.topic, ...c.keywords.slice(0, 2)].join(" ");
    const queries = c.platforms.filter((p) => p !== "telegram").map((p) => ({ facebook: "facebook.com", instagram: "instagram.com", tiktok: "tiktok.com" } as Record<string, string>)[p] + " " + terms + " " + c.region);
    const outcomes = await Promise.all(queries.slice(0, 3).map((q) => geminiSearch(q, c.languages[0] || "en")));
    limited = outcomes.find((o) => !o.ok)?.message || "";
    for (const hit of outcomes.flatMap((o) => o.hits)) { const platform = looksLikePost(hit.url); if (platform) add({ platform, url: hit.url, title: hit.title.slice(0, 200) }); }
  }
  await putMany("mentions", fresh);
  const top = (await listAll<Mention>("mentions")).filter((m) => m.campaignId === c.id).sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10);
  return { ok: true, found, added: fresh.length, top, message: "Найдено публикаций: " + found + " (новых " + fresh.length + "). Проверено каналов Telegram: " + channels.length + ". Facebook, Instagram и TikTok — только то, что видно в поиске; закрытые группы не видны." + (limited ? " " + limited : "") };
}

// ---- Voice → text (free Gemini) ----------------------------------------------------------------

export async function transcribeTelegramVoice(fileId: string) {
  if (!geminiSearchKey()) return { ok: false, text: "", message: "Для голосовых нужен GEMINI_API_KEY (бесплатный)." };
  const file = await tgCall("getFile", { file_id: fileId });
  const path = file?.result?.file_path;
  if (!path || Number(file?.result?.file_size || 0) > 15 * 1024 * 1024) return { ok: false, text: "", message: "Не удалось получить голосовое (до 15 МБ)." };
  try {
    const audio = await fetch("https://api.telegram.org/file/bot" + botToken() + "/" + path, { signal: AbortSignal.timeout(20000) });
    return geminiTranscribe(Buffer.from(await audio.arrayBuffer()).toString("base64"), /\.mp3$/i.test(path) ? "audio/mp3" : "audio/ogg");
  } catch (error) {
    return { ok: false, text: "", message: "Ошибка распознавания: " + (error instanceof Error ? error.message : "сеть") };
  }
}

// ---- One daily run (cron) ----------------------------------------------------------------------

export async function runDaily(deadlineAt = Date.now() + 270_000) {
  const day = today();
  await refreshActivity(30).catch(() => 0);
  const plan = await planDay(day);
  const partners = await notifyPartners(day);
  const bot = await dispatchBotTasks(day, deadlineAt - 15_000);
  const chat = await reportChatId();
  if (chat) await sendMessage(chat, await digestText(day));
  // Instagram is scheduled in Postiz; one daily check tracks actual external
  // links without claiming success merely because Postiz accepted a schedule.
  const instagram = await import("@/lib/scout/instagram-posts").then(m=>m.refreshInstagramJobs()).catch(()=>null);
  if (chat && instagram?.length) {
    const recent = instagram.slice(0, 6);
    const rows = recent.map(j=>j.channelName+" · "+j.status+
      (j.releaseURL ? " · "+j.releaseURL : " · ссылка на Instagram пока не подтверждена"));
    await sendMessage(chat, "📸 <b>Instagram · отчёт Postiz</b>\n"+rows.join("\n"));
  }
  return { plan, partners, bot };
}
