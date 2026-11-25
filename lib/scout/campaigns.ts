import { captureException } from "@sentry/core";
import { runStructuredExtraction } from "@/lib/free-ai";
import { geminiTranscribe } from "@/lib/gemini-audio";
import { geminiSearch, geminiSearchKey } from "@/lib/gemini-search";
import { canonicalCommunityUrl, permissionConfirmed, DEFAULT_DAILY_LIMIT, detectAdsPolicy, detectAdminContact, findGroups, listGroups, refreshActivity, telegramFeed, telegramLiveness, upsertGroups, messageLink, PLATFORM_LABEL, platformOfUrl, sendPhoto, type GroupCard, type Platform, type PostLog, type QueueItem } from "@/lib/scout/groups";
import { claimOnce, getOne, getValue, increment, listAll, logAction, putMany, putOne, removeMany, setValue } from "@/lib/scout/store";
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
  // Control-list communities added by /recall: placeable, but kept out of the recall base so recall
  // measures only what independent search found.
  controlGroupIds?: string[];
  // Where the next search continues in the full (keyword × language) list, so all approved keywords get used.
  searchCursor?: { core: number; adjacent: number };
  // TZ 1.2 §2 "расписание": publishing hours and weekdays in the campaign time zone, optional end date.
  schedule?: Schedule;
  // TZ 1.2 §5 monitoring parameters beyond keywords: object type words and price range.
  watch?: Watch;
  // TZ 1.2 §9 completeness: the last check against the client's manual control list.
  recall?: RecallResult;
};

export type Schedule = { hours: number[]; days: number[]; until?: string; tz: string };
export type Watch = { types: string[]; minPrice?: number; maxPrice?: number };
export type RecallResult = { at: string; control: number; live: number; found: number; percent: number; missing: string[]; dead: string[]; learned: string[] };

// Groups a campaign may post to: what its own search found plus the client's control list.
export function audienceIds(c: Pick<Campaign, "searchGroupIds" | "controlGroupIds">) {
  return [...new Set([...(c.searchGroupIds || []), ...(c.controlGroupIds || [])])];
}
const hasTargets = (c: Campaign) => (c.found?.total || 0) > 0 && audienceIds(c).length > 0;

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
  // Local hour (campaign time zone) from which the bot may publish this task.
  slot?: number;
  link?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type Mention = { id: string; campaignId: string; platform: Platform; url: string; title: string; author?: string; views?: number; reactions?: number; price?: number; at?: string; foundAt: string };

export const DEFAULT_DAILY_TARGET = Number(process.env.DAILY_TARGET || 300) || 300;
const ALL_PLATFORMS: Platform[] = ["telegram", "facebook", "instagram", "tiktok"];
const DONE: TaskStatus[] = ["sent", "verified"];

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

// ---- Schedule (TZ 1.2 §2) -------------------------------------------------------------------

export const DEFAULT_TZ = process.env.SCHEDULE_TZ || "Europe/Madrid";
const DAY_WORDS: Array<[RegExp, number[]]> = [
  [/ежедневно|каждый день|daily|все дни/i, [1, 2, 3, 4, 5, 6, 7]],
  [/будни|пн\s*-\s*пт|weekdays|mon\s*-\s*fri/i, [1, 2, 3, 4, 5]],
  [/выходные|сб\s*-\s*вс|weekend/i, [6, 7]],
];
const DAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

// "9,13,18 будни до 2026-12-15" | "10 14 20 пн,ср,пт" | "off"
export function parseSchedule(raw: string, tz = DEFAULT_TZ, year = new Date().getUTCFullYear()): Schedule | null {
  const text = raw.trim().toLowerCase();
  if (!text || /^(off|нет|выкл|сразу)$/.test(text)) return null;
  const untilIso = /до\s+(\d{4}-\d{2}-\d{2})|until\s+(\d{4}-\d{2}-\d{2})/.exec(text);
  const untilDm = /до\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/.exec(text);
  const until = untilIso ? untilIso[1] || untilIso[2] : untilDm ? (untilDm[3] || String(year)) + "-" + untilDm[2].padStart(2, "0") + "-" + untilDm[1].padStart(2, "0") : undefined;
  const body = text.replace(/(до|until)\s+[\d.\-]+/g, " ");
  const hours = [...new Set([...body.matchAll(/(?<![\d.])(\d{1,2})(?::00)?(?![\d.])/g)].map((m) => Number(m[1])).filter((h) => h >= 0 && h <= 23))].sort((a, b) => a - b);
  let days = DAY_WORDS.find(([re]) => re.test(body))?.[1];
  if (!days) { const named = DAY_SHORT.map((d, i) => (new RegExp("(^|[^а-я])" + d + "([^а-я]|$)").test(body) ? i + 1 : 0)).filter(Boolean); days = named.length ? named : [1, 2, 3, 4, 5, 6, 7]; }
  return { hours: hours.length ? hours : [9], days, until, tz };
}

export function scheduleText(s?: Schedule) {
  if (!s) return "сразу, раз в день";
  const days = s.days.length === 7 ? "ежедневно" : s.days.map((d) => DAY_SHORT[d - 1]).join(",");
  return s.hours.map((h) => String(h).padStart(2, "0") + ":00").join(", ") + " · " + days + (s.until ? " · до " + s.until : "") + " (" + s.tz + ")";
}

// Local date / hour / ISO weekday in a time zone.
export function localClock(tz = DEFAULT_TZ, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(at).map((p) => [p.type, p.value]));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { day: parts.year + "-" + parts.month + "-" + parts.day, hour: Number(parts.hour), weekday };
}

export function scheduleAllows(s: Schedule | undefined, day: string) {
  if (!s) return true;
  if (s.until && day > s.until) return false;
  const weekday = ((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  return s.days.includes(weekday);
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
    languages: { type: "array", items: { type: "string", description: "ISO 639-1" }, description: "target languages: the local language(s) of the region plus the owner's language and the audience's language; the task may be written or spoken in any language" },
    keywords: { type: "array", items: { type: "string" }, description: "40 keywords for finding communities on the topic: word forms, synonyms, translations into the languages of the region and of the target audience" },
    adjacent_keywords: { type: "array", items: { type: "string" }, description: "8-15 phrases for ADJACENT communities where the same audience gathers and such an ad is appropriate (classifieds, flea markets, expats and relocants, city and district communities), with the city, in local languages" },
    questions: { type: "array", items: { type: "string" }, description: "clarifying questions in the owner's language for missing essentials (region, ad text, platforms); empty if the task is clear" },
    translations: { type: "array", items: { type: "object", properties: { lang: { type: "string" }, text: { type: "string" } } }, description: "the ad text adapted to each target language (ISO 639-1)" },
    platforms: { type: "array", items: { type: "string", enum: ALL_PLATFORMS } },
    daily_target: { type: "number" },
    schedule_hours: { type: "array", items: { type: "number" }, description: "local hours 0-23 to publish at, if the owner named a schedule; empty otherwise" },
    schedule_days: { type: "array", items: { type: "number" }, description: "ISO weekdays 1=Mon..7=Sun if the owner named them; empty otherwise" },
    schedule_until: { type: "string", description: "YYYY-MM-DD end date if named, else empty" },
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
    ...(() => {
      const hours = (Array.isArray(p.schedule_hours) ? p.schedule_hours : []).map(Number).filter((h: number) => Number.isInteger(h) && h >= 0 && h <= 23);
      const days = (Array.isArray(p.schedule_days) ? p.schedule_days : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 1 && d <= 7);
      const until = /^\d{4}-\d{2}-\d{2}$/.test(String(p.schedule_until || "")) ? String(p.schedule_until) : undefined;
      return hours.length || days.length || until ? { schedule: { hours: hours.length ? [...new Set<number>(hours)].sort((a, b) => a - b) : [9], days: days.length ? [...new Set<number>(days)].sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7], until, tz: DEFAULT_TZ } } : {};
    })(),
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

export async function updateCampaign(id: string, patch: Partial<Pick<Campaign, "title" | "adText" | "keywords" | "adjacent" | "queries" | "exclusions" | "dailyTarget" | "platforms" | "region" | "topic">> & { schedule?: Schedule | null; watch?: Watch | null }) {
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
  if (patch.schedule !== undefined) next.schedule = patch.schedule || undefined;
  if (patch.watch !== undefined) next.watch = patch.watch || undefined;
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
  if (status === "approved" && !hasTargets(c)) {
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
    await import("@/lib/scout/instagram-posts").then((m) => m.cancelScheduledPostiz(id)).catch(() => null);
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
  // Every keyword in every campaign language; each run takes the next window, so across runs the whole
  // approved list is covered (40 keywords × 2 languages ≈ 8 daily runs), then it starts over.
  const langs = c.languages?.length ? c.languages : [undefined];
  const pairs = (list: string[], relevance: "core" | "adjacent") => list.flatMap((topic) => langs.map((language) => ({ topic, relevance, language })));
  const window = <T,>(all: T[], from: number, n: number) => all.length <= n ? all : Array.from({ length: n }, (_, i) => all[(from + i) % all.length]);
  const coreAll = pairs(core, "core");
  const adjAll = pairs(adjacent, "adjacent");
  // Interleave: most of the budget on the topic, at least a third on adjacent audiences.
  const adjacentRuns = adjAll.length ? Math.max(1, Math.round(maxRuns / 3)) : 0;
  const adjList = window(adjAll, c.searchCursor?.adjacent || 0, Math.min(adjacentRuns, adjAll.length));
  const coreList = window(coreAll, c.searchCursor?.core || 0, maxRuns - adjList.length);
  // Interleaved (core, core, adjacent, …) so a run cut short by the time limit still covers both kinds.
  const out: Array<{ topic: string; relevance: "core" | "adjacent"; language?: string }> = [];
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
  const done = { core: 0, adjacent: 0 };
  // One query at a time, preserving the budget and provider rate limits.
  for (let i = 0; i < plan.length && Date.now() < deadlineAt - 20_000; i += 1) {
    attempted += 1;
    done[plan[i].relevance] += 1;
    const batch = plan.slice(i, i + 1);
    const results = await Promise.all(batch.map((q) => findGroups({ ...place, topic: q.topic, relevance: q.relevance, exclusions: c.exclusions, language: q.language || c.languages[0], platforms: c.platforms }, Math.min(deadlineAt - 10_000, Date.now() + 90_000)).catch(() => null)));
    for (const r of results) {
      if (!r) continue;
      r.notes.forEach((n) => notes.add(n));
      for (const g of r.found) if (c.platforms.includes(g.platform) && (!seen.has(g.id) || g.relevance === "core")) seen.set(g.id, g);
    }
  }
  const fresh = (await getOne<Campaign>("campaigns", id)) || c;
  // Each run searches a slice of the keywords, so the audience is this run plus what earlier runs found.
  const prevIds = new Set(fresh.searchGroupIds || []);
  for (const g of prevIds.size ? await listAll<GroupCard>("groups") : []) if (prevIds.has(g.id) && !seen.has(g.id) && c.platforms.includes(g.platform)) seen.set(g.id, g);
  const all = [...seen.values()];
  const found = { notes: [...notes].slice(0, 3), total: all.length, core: all.filter((g) => g.relevance !== "adjacent").length, adjacent: all.filter((g) => g.relevance === "adjacent").length, inactive: all.filter((g) => g.activity === "inactive").length, at: nowIso() };
  const cursor = { core: (fresh.searchCursor?.core || 0) + done.core, adjacent: (fresh.searchCursor?.adjacent || 0) + done.adjacent };
  const next: Campaign = { ...fresh, status: fresh.status === "stopped" ? "stopped" : fresh.status === "approved" ? "approved" : "ready", found, searchGroupIds: all.map((g) => g.id), searchCursor: cursor, updatedAt: nowIso() };
  await putOne("campaigns", next);
  await logAction({ actor: "agent", action: "campaign.search", detail: c.title + ": " + found.total + " сообществ (профильных " + found.core + ", смежных " + found.adjacent + ", неактивных " + found.inactive + ")" });
  return { campaign: next, groups: all, notes: [...notes], queries: attempted };
}

// ---- Daily planner -----------------------------------------------------------------------

export function modeFor(g: GroupCard): TaskMode | null {
  if (g.status === "declined" || g.ads === "forbidden" || g.activity === "inactive") return null;
  if (g.platform === "telegram" && g.botConnected && g.postingEnabled && g.chatId) return "bot";
  // Only a recorded agreement (who and when) authorizes partner or manual publication.
  const agreed = permissionConfirmed(g);
  if (g.partnerTelegramId && agreed) return "partner";
  if (agreed) return "manual";
  return null; // no permission yet: outreach first
}

const campaignWords = (c: Campaign) => [c.topic, c.region, ...c.keywords].join(" ").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
const groupText = (g: GroupCard) => [g.name, g.topic, g.city, g.country, g.description].filter(Boolean).join(" ").toLowerCase();

export function matchesCampaign(g: GroupCard, c: Campaign) {
  if (!c.platforms.includes(g.platform)) return false;
  const words = campaignWords(c);
  // Groups added by the bot or by hand often carry no topic: the admin's consent is what counts.
  if (!g.topic && !g.city && !g.country) return true;
  const own = groupText(g);
  return !words.length || words.some((w) => own.includes(w));
}

// A consented place the campaign's own search did not find still gets it, but only on a real
// topic/region hit (title, partner's topics), never on an empty card, so unrelated chats stay out.
export function topicHit(g: GroupCard, c: Campaign) {
  if (!c.platforms.includes(g.platform)) return false;
  const own = groupText(g);
  return campaignWords(c).some((w) => own.includes(w));
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
  for (const c of campaigns.filter((x) => x.status === "approved" && !isPolishWineCampaign(x) && hasTargets(x))) {
    if (!scheduleAllows(c.schedule, day)) continue;
    const eligible = new Set(audienceIds(c));
    let count = live.filter((t) => t.campaignId === c.id && t.day === day).length;
    for (const g of groups) {
      if (count >= c.dailyTarget) break;
      const mode = modeFor(g);
      if (!mode) continue;
      if (eligible.has(g.id) ? !matchesCampaign(g, c) : !topicHit(g, c)) continue;
      const id = stableId("ct", c.id + "|" + g.id + "|" + day);
      if (ids.has(id)) continue;
      if ((dayLoad.get(g.id) || 0) >= (g.dailyLimit ?? DEFAULT_DAILY_LIMIT)) continue;
      const last = lastDay.get(g.id);
      if (last && daysBetween(last, day) < (g.minDaysBetween || 1)) continue;
      // Spread the day's volume evenly over the campaign's publishing hours.
      const slot = c.schedule?.hours.length ? c.schedule.hours[count % c.schedule.hours.length] : undefined;
      out.push({ id, campaignId: c.id, campaignTitle: c.title, groupId: g.id, groupName: g.name, platform: g.platform, url: g.url, day, mode, status: "scheduled", partnerId: mode === "partner" ? g.partnerTelegramId : undefined, ...(slot !== undefined ? { slot } : {}), createdAt: now, updatedAt: now });
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
  return c?.status === "approved" && !isPolishWineCampaign(c) && hasTargets(c) ? c : null;
}

const SENT_KEY = "campaign-sent:";
// The post log id comes from the task, so a retried save never writes a second log line.
async function saveSent(task: CampaignTask, group: GroupCard, campaign: Campaign, link: string | undefined, at: string) {
  await putOne("campaign_tasks", { ...task, status: "sent", link, error: undefined, updatedAt: nowIso() });
  await putOne("group_posts", { id: stableId("post", task.id), at, groupId: group.id, groupName: group.name, platform: "telegram", mode: "bot", status: "sent", text: campaign.adText.slice(0, 300), by: "кампания: " + campaign.title, link } satisfies PostLog);
}

// Bot tasks: only chats where an admin added the bot, ~3 s apart, daily limit shared with /post.
export async function dispatchBotTasks(day = today(), deadlineAt = Date.now() + 240_000, pauseMs = 3000) {
  // Explicit opt-in only: a missing environment flag can never start bulk posting.
  if (process.env.CAMPAIGN_AUTOPOST !== "on") return { sent: 0, failed: 0, left: 0, disabled: true };
  if (!botToken()) return { sent: 0, failed: 0, left: 0, disabled: true };
  const tasks = (await listAll<CampaignTask>("campaign_tasks")).filter((t) => t.day === day && t.mode === "bot" && t.status === "scheduled");
  let sent = 0, failed = 0, left = 0;
  for (const [index, task] of tasks.entries()) {
    if (Date.now() > deadlineAt) { left += tasks.length - index; break; }
    // Already sent in an earlier wave whose save failed: record it, never send twice.
    const marker = await getValue<{ link?: string; at: string }>(SENT_KEY + task.id);
    if (marker) {
      const [c0, g0] = await Promise.all([getOne<Campaign>("campaigns", task.campaignId), getOne<GroupCard>("groups", task.groupId)]);
      if (c0 && g0) await saveSent(task, g0, c0, marker.link, marker.at).catch(() => null);
      continue;
    }
    const campaign = await activeCampaign(task.campaignId);
    const group = await getOne<GroupCard>("groups", task.groupId);
    if (!campaign || !group?.botConnected || !group.postingEnabled || !group.chatId) { await putOne("campaign_tasks", { ...task, status: "cancelled", updatedAt: nowIso() }); continue; }
    // Not yet its hour: stays scheduled for the next dispatch wave (hourly scheduler).
    if (task.slot !== undefined && localClock(campaign.schedule?.tz || DEFAULT_TZ).hour < task.slot) { left += 1; continue; }
    // Two cron workers may overlap. A distributed NX lock prevents duplicate
    // sends for the same scheduled campaign/group/day item.
    if (!(await claimOnce("campaign-dispatch:" + task.id, 60 * 60))) continue;
    const text = textFor(campaign, group.language);
    const result = campaign.photo ? await sendPhoto(group.chatId, campaign.photo, text) : await sendMessage(group.chatId, escapeHtml(text)).then((r) => ({ ok: r.ok, result: { message_id: r.messageId }, description: r.error }));
    const link = result?.ok ? messageLink(group, result?.result?.message_id) : undefined;
    const error = result?.ok ? undefined : String(result?.description || "ошибка").slice(0, 200);
    if (result?.ok) {
      sent += 1;
      // Durable "sent" mark first (3 days, outlives the 1 h lock); the records can then be rebuilt from it.
      const at = nowIso();
      await setValue(SENT_KEY + task.id, { link, at }, 3 * 24 * 3600).catch(() => null);
      await saveSent(task, group, campaign, link, at).catch(async () => { await new Promise((r) => setTimeout(r, 1000)); await saveSent(task, group, campaign, link, at).catch(() => null); });
      await increment("grp-post:" + group.id + ":" + day, 2 * 24 * 3600).catch(() => null);
    } else {
      await putOne("campaign_tasks", { ...task, status: "failed", error, updatedAt: nowIso() });
      await putOne("group_posts", { id: randomId("post"), at: nowIso(), groupId: group.id, groupName: group.name, platform: "telegram", mode: "bot", status: "failed", text: campaign.adText.slice(0, 300), by: "кампания: " + campaign.title, error } satisfies PostLog);
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
  const target = campaigns.filter((c) => c.status === "approved" && !isPolishWineCampaign(c) && hasTargets(c)).reduce((s, c) => s + c.dailyTarget, 0);
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

// Heartbeat of the scheduled dispatch (GitHub Actions every 15 min): the daily report flags silence.
const DISPATCH_KEY = "campaign-dispatch:last";
export async function markDispatch(at = Date.now()) { await setValue(DISPATCH_KEY, at).catch(() => null); }
export function dispatchWarning(last: number | null, campaigns: Campaign[], now = Date.now()) {
  if (process.env.CAMPAIGN_AUTOPOST !== "on" || !campaigns.some((c) => c.status === "approved")) return "";
  const hours = last ? Math.floor((now - last) / 3_600_000) : null;
  if (hours !== null && hours < 3) return "";
  return "\n⚠️ <b>Публикации по расписанию " + (hours === null ? "ещё ни разу не запускались" : "не запускались " + hours + " ч") + "</b>: GitHub → Actions → «Campaign dispatch» и секрет CRON_SECRET.";
}

export async function digestText(day = today()) {
  const [groups, campaigns0, all, mentions, ownPosts, lastDispatch] = await Promise.all([listGroups(), listCampaigns(), listAll<CampaignTask>("campaign_tasks"), listAll<Mention>("mentions"), listAll<{ status?: string; updatedAt?: string }>("instagram_posts"), getValue<number>(DISPATCH_KEY)]);
  const cap = capacityOf(groups, all, campaigns0, day);
  const campaigns = campaigns0.filter((c) => c.status === "approved");
  const tasks = all.filter((t) => t.day === day);
  const lines = campaigns.map((c) => { const own = tasks.filter((t) => t.campaignId === c.id); return "• " + escapeHtml(c.title) + ": " + own.filter((t) => DONE.includes(t.status)).length + " / " + c.dailyTarget + " (в работе " + own.filter((t) => ["scheduled", "notified", "proof"].includes(t.status)).length + ")"; });
  const failed = tasks.filter((t) => t.status === "failed");
  const blocked = failed.filter((t) => /kicked|not a member|chat not found|rights|banned|forbidden/i.test(t.error || ""));
  const rejected = failed.filter((t) => /отклонено/.test(t.error || ""));
  return "📊 <b>Отчёт за " + day + "</b>" +
    "\nНайдено сообществ: " + groups.filter((g) => g.foundAt.startsWith(day)).length + " (всего в базе " + groups.length + ", неактивных " + groups.filter((g) => g.activity === "inactive").length + ")" +
    dispatchWarning(lastDispatch, campaigns0) +
    "\nРазмещено в чужих группах и у партнёров: <b>" + cap.verified + "</b> · отклонено " + rejected.length + " · ошибок " + (failed.length - blocked.length - rejected.length) + " · удалили бота / блокировки " + blocked.length +
    "\nСвои аккаунты (Postiz, считаются отдельно): " + ownPosts.filter((p) => p.status === "published" && (p.updatedAt || "").startsWith(day)).length +
    "\nОтклики партнёров (прислали ссылку): " + tasks.filter((t) => t.status === "proof" || (t.mode === "partner" && t.status === "verified")).length +
    "\nНайдено публикаций мониторингом: " + mentions.filter((m) => m.foundAt.startsWith(day)).length +
    (() => {
      const top = mentions.filter((m) => m.foundAt.startsWith(day) && engagement(m) > 0).sort((a, b) => engagement(b) - engagement(a)).slice(0, 5);
      return top.length ? "\n<b>Самые вовлекающие</b>\n" + top.map((m) => "• <a href=\"" + escapeHtml(m.url) + "\">" + escapeHtml((m.title || m.url).slice(0, 60)) + "</a>" + (m.author ? " — " + escapeHtml(m.author) : "") + (m.reactions ? " · ❤️ " + m.reactions : "") + (m.views ? " · 👁 " + m.views.toLocaleString("ru-RU") : "") + (m.price ? " · " + m.price.toLocaleString("ru-RU") : "")).join("\n") : "";
    })() +
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

// First price in a post: "250 000 €", "€250,000", "1.200 EUR", "95000$", "300 000 руб".
export function parsePrice(text: string): number | undefined {
  const cur = "(?:€|eur|euro|евро|\\$|usd|долл\\w*|zł|pln|руб\\w*|₽|грн|uah)";
  const m = new RegExp("(\\d[\\d\\s.,\\u00a0\\u202f]{0,14}\\d|\\d)\\s*(k|к|тыс\\.?)?\\s*" + cur, "i").exec(text) || new RegExp(cur + "\\s*(\\d[\\d\\s.,\\u00a0\\u202f]{0,14}\\d|\\d)\\s*(k|к|тыс\\.?)?", "i").exec(text);
  if (!m) return undefined;
  let digits = m[1].replace(/[\s\u00a0\u202f]/g, "");
  // 250.000 / 250,000 → thousands separators; 1,5 → decimal
  digits = /^\d{1,3}([.,]\d{3})+$/.test(digits) ? digits.replace(/[.,]/g, "") : digits.replace(",", ".");
  const value = Number(digits) * (m[2] ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

export function matchesPost(text: string, c: Pick<Campaign, "keywords" | "topic" | "region"> & { watch?: Watch }) {
  const t = text.toLowerCase();
  const stems = cleanKeywords([c.topic, ...c.keywords], 40).map((k) => k.toLowerCase().slice(0, Math.max(4, Math.min(7, k.length - 1))));
  if (!stems.some((k) => k.length >= 3 && t.includes(k))) return false;
  const w = c.watch;
  if (!w) return true;
  if (w.types.length && !w.types.some((x) => t.includes(x.toLowerCase().slice(0, Math.max(4, x.length - 1))))) return false;
  if (w.minPrice !== undefined || w.maxPrice !== undefined) {
    // With a price filter set, a post without a recognisable price is not a match.
    const price = parsePrice(text);
    if (price === undefined || (w.minPrice !== undefined && price < w.minPrice) || (w.maxPrice !== undefined && price > w.maxPrice)) return false;
  }
  return true;
}

// "/cwatch <id> квартира, дом 100000-300000" → types + price range; "off" clears.
export function parseWatch(raw: string): Watch | null {
  const text = raw.trim();
  if (!text || /^(off|нет|выкл)$/i.test(text)) return null;
  const range = /(\d[\d\s.]*)\s*(?:-|–|до)\s*(\d[\d\s.]*)/.exec(text);
  const from = /(?:от|from|min)\s*(\d[\d\s.]*)/i.exec(text);
  const to = /(?:до|to|max)\s*(\d[\d\s.]*)/i.exec(text);
  const num = (v?: string) => (v ? Number(v.replace(/[\s.]/g, "")) || undefined : undefined);
  const minPrice = range ? num(range[1]) : num(from?.[1]);
  const maxPrice = range ? num(range[2]) : num(to?.[1]);
  const types = cleanKeywords(text.replace(/(?:от|до|from|to|min|max)?\s*\d[\d\s.]*(?:\s*(?:-|–|до)\s*\d[\d\s.]*)?\s*(€|eur|евро|\$)?/gi, " ").split(/[,;]/).map((x) => x.trim()), 10);
  return { types, ...(minPrice !== undefined ? { minPrice } : {}), ...(maxPrice !== undefined ? { maxPrice } : {}) };
}

export function watchText(w?: Watch) {
  if (!w) return "только ключевые слова";
  return [w.types.length ? "тип: " + w.types.join(", ") : "", w.minPrice !== undefined || w.maxPrice !== undefined ? "цена " + (w.minPrice ?? 0).toLocaleString("ru-RU") + " – " + (w.maxPrice !== undefined ? w.maxPrice.toLocaleString("ru-RU") : "∞") : ""].filter(Boolean).join(" · ") || "только ключевые слова";
}

// Engagement score: reactions weigh more than views (views are passive).
export function engagement(m: Pick<Mention, "views" | "reactions">) {
  return (m.reactions || 0) * 20 + (m.views || 0);
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
    for (const { g, posts } of feeds) for (const post of posts) if (matchesPost(post.text, c)) add({ platform: "telegram", url: post.url, title: post.text.slice(0, 200), author: g.name, views: post.views, reactions: post.reactions, price: parsePrice(post.text), at: post.at });
  }
  let limited = "";
  if (geminiSearchKey() && Date.now() < deadlineAt - 25_000) {
    const terms = [c.topic, ...c.keywords.slice(0, 2)].join(" ");
    const queries = c.platforms.filter((p) => p !== "telegram").map((p) => ({ facebook: "facebook.com", instagram: "instagram.com", tiktok: "tiktok.com" } as Record<string, string>)[p] + " " + terms + " " + c.region);
    // One language per day in turn, so a multi-language campaign is monitored in all of them without extra requests.
    const lang = c.languages.length ? c.languages[Math.floor(Date.now() / 86_400_000) % c.languages.length] : "en";
    const outcomes = await Promise.all(queries.slice(0, 3).map((q) => geminiSearch(q, lang)));
    limited = outcomes.find((o) => !o.ok)?.message || "";
    for (const hit of outcomes.flatMap((o) => o.hits)) { const platform = looksLikePost(hit.url); if (platform && (!c.watch || matchesPost(hit.title + " " + (hit.snippet || ""), c))) add({ platform, url: hit.url, title: hit.title.slice(0, 200), price: parsePrice(hit.title + " " + (hit.snippet || "")) }); }
  }
  await putMany("mentions", fresh);
  const top = (await listAll<Mention>("mentions")).filter((m) => m.campaignId === c.id).sort((a, b) => engagement(b) - engagement(a)).slice(0, 10);
  return { ok: true, found, added: fresh.length, top, message: "Найдено публикаций: " + found + " (новых " + fresh.length + "). Проверено каналов Telegram: " + channels.length + ". Facebook, Instagram и TikTok — только то, что видно в поиске; закрытые группы не видны." + (limited ? " " + limited : "") };
}

// ---- Completeness check against the client's manual control list (TZ 1.2 §9) ----------------
// The client finds communities by hand for the same topic and region and sends the links.
// Recall = live control communities the bot already had / all live control communities.
// Dead or missing pages do not count (the criterion is about LIVE communities).
// Every miss is added to the campaign's control audience (placeable, but never counted as "found"
// in the next check) and its name becomes a new search query, so the next search learns where the bot was blind.
export async function recallCheck(id: string, links: string[], deadlineAt = Date.now() + 200_000) {
  const c = await getOne<Campaign>("campaigns", id);
  if (!c) return null;
  const control = [...new Map(links.map((l) => canonicalCommunityUrl(l)).filter(Boolean).map((x) => [x!.url.toLowerCase(), x!])).values()].slice(0, 300);
  const base = new Set<string>();
  for (const gid of c.searchGroupIds || []) { const g = await getOne<GroupCard>("groups", gid); if (g?.url) base.add(canonicalCommunityUrl(g.url)?.url.toLowerCase() || g.url.toLowerCase()); }
  const now = nowIso();
  const place = splitRegion(c.region);
  const dead: string[] = [];
  const missing: string[] = [];
  const learnedNames: string[] = [];
  const addCards: GroupCard[] = [];
  let found = 0;
  for (const item of control) {
    const key = item.url.toLowerCase();
    let name = item.url.split("/").pop() || item.url;
    let card: Partial<GroupCard> = { activity: "unknown" };
    if (item.platform === "telegram" && Date.now() < deadlineAt) {
      const live = await telegramLiveness(item.url).catch(() => null);
      if (live && (live.status === "missing" || live.status === "inactive")) { dead.push(item.url); continue; }
      if (live?.preview) { name = live.preview.title; card = { ...live.live, activityCheckedAt: now, kind: live.preview.kind, members: live.preview.members, description: live.preview.description.slice(0, 600), ads: detectAdsPolicy(live.preview.description), adminContact: detectAdminContact(live.preview.description, item.url) }; }
    }
    if (base.has(key)) { found += 1; continue; }
    missing.push(item.url);
    learnedNames.push(name);
    addCards.push({ ads: "unknown", ...card, id: stableId("grp", key), platform: item.platform, url: item.url, name, status: "new", relevance: "core", foundBy: "контрольный список заказчика", topic: c.topic, city: place.city || undefined, country: place.country || undefined, verification: item.platform === "telegram" ? "public_page" : "indexed_candidate", foundAt: now, updatedAt: now } as GroupCard);
  }
  const live = control.length - dead.length;
  const percent = live ? Math.round((found / live) * 1000) / 10 : 0;
  if (addCards.length) await upsertGroups(addCards);
  // Learning: names of missed communities become campaign queries for the next search.
  const learned = cleanKeywords(learnedNames.map((n) => n.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ")).filter((n) => n.length >= 4 && !/[_\d]/.test(n)), 20)
    .filter((q) => !c.queries.some((x) => x.toLowerCase() === q.toLowerCase()));
  const recall: RecallResult = { at: now, control: control.length, live, found, percent, missing: missing.slice(0, 100), dead: dead.slice(0, 100), learned };
  const fresh = (await getOne<Campaign>("campaigns", id)) || c;
  await putOne("campaigns", { ...fresh, recall, queries: cleanKeywords([...fresh.queries, ...learned], 20), controlGroupIds: [...new Set([...(fresh.controlGroupIds || []), ...addCards.map((g) => g.id)])], updatedAt: now });
  await logAction({ actor: "agent", action: "campaign.recall", detail: c.title + ": " + found + "/" + live + " = " + percent + "% (контроль " + control.length + ", мёртвых " + dead.length + ")" });
  return recall;
}

export function recallText(r: RecallResult) {
  const ok = r.percent >= 90;
  return (ok ? "✅" : "⚠️") + " <b>Полнота поиска: " + r.percent + "%</b> (цель — 90%)\nВ контрольном списке: " + r.control + " · живых: " + r.live + " · бот уже нашёл: " + r.found +
    (r.dead.length ? "\n💤 Неактивные или удалённые (не считаются): " + r.dead.length : "") +
    (r.missing.length ? "\n\n<b>Бот не нашёл (" + r.missing.length + ")</b> — добавлены в базу кампании:\n" + r.missing.slice(0, 15).map((u) => "• " + escapeHtml(u)).join("\n") : "") +
    (r.learned.length ? "\n\n🧠 Новые запросы для следующего поиска: " + escapeHtml(r.learned.join(", ")) : "") +
    (ok ? "" : "\n\nНажмите «🔎 Искать ещё», затем пришлите тот же список снова, чтобы перепроверить.");
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

// Each step runs on its own: one failing step (a provider down, the database busy) does not
// stop the rest, and the owner gets one alert with what failed instead of a silent night.
export async function runDaily(deadlineAt = Date.now() + 270_000) {
  const day = today();
  const errors: string[] = [];
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(name + ": " + message);
      console.error("[daily] " + name + " failed: " + message);
      captureException(error, { tags: { daily_step: name } });
      return null;
    }
  };
  await step("проверка активности", () => refreshActivity(30));
  const plan = await step("план дня", () => planDay(day));
  const partners = await step("задания партнёрам", () => notifyPartners(day));
  const bot = await step("публикации бота", () => dispatchBotTasks(day, deadlineAt - 90_000));
  // Daily monitoring of running campaigns (TZ 1.2 §5), within the remaining time budget.
  const running = (await step("список кампаний", () => listCampaigns()))?.filter((c) => c.status === "approved") || [];
  for (const c of running) {
    if (Date.now() > deadlineAt - 70_000) break; // leave time for the report and the archive
    await step("мониторинг «" + c.title + "»", () => monitorCampaign(c.id, Math.min(deadlineAt - 30_000, Date.now() + 60_000)));
  }
  const chat = await reportChatId();
  const digest = await step("отчёт", () => digestText(day));
  if (chat && digest) await sendMessage(chat, digest);
  // Instagram is scheduled in Postiz; one daily check tracks actual external
  // links without claiming success merely because Postiz accepted a schedule.
  const instagram = await step("Instagram / Postiz", () => import("@/lib/scout/instagram-posts").then((m) => m.refreshInstagramJobs()));
  // Only jobs that changed in the last two days, so an old failed attempt is not repeated every morning.
  const fresh = instagram?.filter((j) => Date.now() - Date.parse(j.updatedAt) < 2 * 86_400_000) || [];
  if (chat && fresh.length) {
    const { jobPlatform, jobStatusRu } = await import("@/lib/scout/instagram-posts");
    const rows = fresh.slice(0, 6).map((j) => {
      let line = "• " + jobPlatform(j) + " · " + escapeHtml(j.channelName) + " · " + jobStatusRu(j.status);
      if (j.releaseURL) line += "\n  " + escapeHtml(j.releaseURL);
      else if (j.status === "scheduled") line += "\n  выйдет " + escapeHtml(j.scheduledAt.slice(0, 16).replace("T", " ")) + " UTC";
      if (j.status === "unknown" && j.error) line += "\n  причина: " + escapeHtml(j.error.slice(0, 120));
      return line;
    });
    await sendMessage(chat, "📸 <b>Ваши публикации через Postiz</b> (Instagram, TikTok, Facebook)\n" + rows.join("\n"));
  }
  await step("дубли сообществ", () => upsertGroups([]));
  // Daily archive to Supabase (when connected): the long-term history outside Redis.
  const archive = await import("@/lib/archive");
  if (archive.archiveConfigured()) {
    const synced = await step("архив Supabase", async () => { const r = await archive.syncArchive(); if (!r.ok) throw new Error(r.error); return r; });
    if (synced) await logAction({ actor: "agent", action: "archive.sync", detail: synced.total + " записей" }).catch(() => null);
  }
  if (errors.length) {
    await logAction({ actor: "agent", action: "daily.errors", detail: errors.join(" | ").slice(0, 900) }).catch(() => null);
    if (chat) await sendMessage(chat, "⚠️ <b>Ежедневный запуск: ошибки</b>\n" + errors.map((e) => "• " + escapeHtml(e.slice(0, 200))).join("\n") + "\n\nОстальные шаги выполнены. Следующий запуск — завтра автоматически.");
  }
  return { plan, partners, bot, errors };
}
