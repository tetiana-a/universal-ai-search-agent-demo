import type { CampaignTask } from "@/lib/scout/campaigns";
import { geminiSearch } from "@/lib/gemini-search";
import { dataForSeoEnabled, dataForSeoSearch } from "@/lib/scout/dataforseo-groups";
import { apifyEnabled, apifySearch } from "@/lib/scout/apify-search";
import { tgStatEnabled, tgStatSearch } from "@/lib/scout/tgstat";
import { runKeylessSearch } from "@/lib/keyless-search";
import { restrictedTopic } from "@/lib/scout/restricted";
import { isSafePublicUrl } from "@/lib/url-safety";
import { botHandle, loadSettings } from "@/lib/scout/config";
import { getOne, getValue, increment, listAll, logAction, putMany, putOne, readCounter, removeMany, setValue } from "@/lib/scout/store";
import { botToken, resolveChatId, sendMessage, tgCall } from "@/lib/scout/telegram";
import { detectLanguage, nowIso, randomId, stableId } from "@/lib/scout/text";
import { runStructuredExtraction } from "@/lib/free-ai";
import { detectCountry } from "@/lib/source-map";
import { styleSheet } from "@/lib/xlsx-style";

// Group finder and compliant posting.
// - Finds public Telegram and Facebook groups/channels for a place and topic, using
//   search results and the groups' own public pages (no login, no scraping behind walls).
// - Posts with the official Bot API only into chats where an admin added the bot.
// - Everything else (Facebook, groups without the bot) goes into a queue that a real
//   person publishes from their own account, one confirmed post at a time.
// There is deliberately no account farm, no human imitation and no automated posting
// from personal accounts: those break Telegram/Facebook rules and get accounts banned.

export type Platform = "telegram" | "facebook" | "instagram" | "tiktok";
export type AdsPolicy = "allowed" | "admin" | "paid" | "forbidden" | "unknown";
export type GroupStatus = "new" | "contacted" | "replied" | "free" | "exchange" | "paid" | "declined";

export type GroupCard = {
  id: string;
  platform: Platform;
  kind?: "group" | "channel" | "profile" | "page";
  // Indexed public profiles are search candidates, not proof of live activity
  // or permission to publish on third-party accounts.
  verification?: "public_page" | "indexed_candidate";
  url: string;
  name: string;
  members?: number;
  description?: string;
  ads: AdsPolicy;
  adminContact?: string;
  country?: string;
  city?: string;
  topic?: string;
  status: GroupStatus;
  price?: number;
  currency?: string;
  notes?: string;
  chatId?: string;
  botConnected?: boolean;
  postingEnabled?: boolean;
  dailyLimit?: number;
  // Partner network: the admin who agreed to publish by hand gets tasks from the bot and replies /proof.
  partnerTelegramId?: string;
  // Minimum days between two posts in this group, as the admin allowed (default 1).
  minDaysBetween?: number;
  permissionNote?: string;
  // Who recorded the admin's agreement and when; without it an "agreed" status gets no manual/partner tasks.
  permissionConfirmedAt?: string;
  permissionConfirmedBy?: string;
  // Admin request: when we sent it and when the admin answered.
  requestSentAt?: string;
  repliedAt?: string;
  // TZ 1.2: language, relevance (core topic or adjacent audience), which query found it, liveness.
  language?: string;
  relevance?: "core" | "adjacent";
  foundBy?: string;
  activity?: "active" | "inactive" | "unknown";
  lastPostAt?: string;
  postsPerWeek?: number;
  activityCheckedAt?: string;
  foundAt: string;
  updatedAt: string;
};

export type PostLog = {
  id: string;
  at: string;
  groupId: string;
  groupName: string;
  platform: Platform;
  mode: "bot" | "manual";
  status: "sent" | "failed" | "published" | "skipped";
  text: string;
  error?: string;
  link?: string;
  by?: string;
};

export type QueueItem = {
  id: string;
  groupId: string;
  groupName: string;
  platform: Platform;
  url: string;
  text: string;
  photoUrl?: string;
  status: "pending" | "published" | "skipped";
  createdAt: string;
  doneAt?: string;
  doneBy?: string;
};

export const DEFAULT_DAILY_LIMIT = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; AureliusResearchBot/2.1; +https://universal-ai-search-agent-demo.vercel.app)";
const TG_RESERVED = new Set(["s", "share", "addstickers", "addemoji", "iv", "proxy", "socks", "setlanguage", "joinchat", "login", "addlist", "boost", "c", "contact", "telegram", "durov"]);

// ---- Parsing helpers (pure, tested) -------------------------------------------

export function normalizeTelegramUrl(raw: string): string {
  const m = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?(\+[\w-]{8,}|joinchat\/[\w-]{8,}|[a-z][\w]{3,31})/i.exec(raw);
  if (!m) return "";
  const name = m[1];
  if (!name.startsWith("+") && !/^joinchat\//i.test(name)) {
    if (TG_RESERVED.has(name.toLowerCase()) || /bot$/i.test(name)) return "";
  }
  // t.me/joinchat/X and t.me/+X are the same invite link.
  return "https://t.me/" + name.replace(/^joinchat\//i, "+");
}

export function normalizeFacebookGroupUrl(raw: string): string {
  const m = /(?:https?:\/\/)?(?:www\.|m\.|web\.)?facebook\.com\/groups\/([\w.-]{3,80})/i.exec(raw);
  if (!m || /^(feed|discover|search|joins|create|your_groups|category)$/i.test(m[1])) return "";
  return "https://www.facebook.com/groups/" + m[1];
}

// Normalize PUBLIC profile URLs only. Individual Instagram posts/reels, TikTok
// search/hashtags and internal URLs are not community/profile targets.
export function normalizeInstagramProfileUrl(raw: string): string {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : "https://" + raw.trim()); } catch { return ""; }
  if (!["instagram.com", "www.instagram.com", "m.instagram.com"].includes(url.hostname.toLowerCase())) return "";
  const pieces = url.pathname.split("/").filter(Boolean);
  if (!pieces.length || pieces.length > 1 || !/^[a-zA-Z0-9._]{2,30}$/.test(pieces[0])) return "";
  if (/^(p|reel|reels|tv|stories|explore|accounts|direct|about|developer|api|directory|tags)$/i.test(pieces[0])) return "";
  return "https://www.instagram.com/" + pieces[0].toLowerCase();
}
export function normalizeTikTokProfileUrl(raw: string): string {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : "https://" + raw.trim()); } catch { return ""; }
  if (!["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(url.hostname.toLowerCase())) return "";
  const pieces = url.pathname.split("/").filter(Boolean);
  if (!pieces.length || !/^@[a-zA-Z0-9._]{2,24}$/.test(pieces[0])) return "";
  if (pieces.length > 1 && (pieces.length < 3 || pieces[1] !== "video")) return "";
  return "https://www.tiktok.com/" + pieces[0].toLowerCase();
}

export function extractGroupLinks(text: string) {
  const telegram = new Set<string>();
  const facebook = new Set<string>();
  for (const m of text.matchAll(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/[^\s"'<>)\]]+/gi)) { const u = normalizeTelegramUrl(m[0]); if (u) telegram.add(u); }
  for (const m of text.matchAll(/(?:https?:\/\/)?(?:www\.|m\.|web\.)?facebook\.com\/groups\/[^\s"'<>)\]]+/gi)) { const u = normalizeFacebookGroupUrl(m[0]); if (u) facebook.add(u); }
  return { telegram: [...telegram], facebook: [...facebook] };
}

// "12 345 members", "1.2K members", "3,4 тыс. участников", "15 mil miembros".
export function parseMembers(text: string): number | undefined {
  const m = /(\d[\d\s.,  ]*)\s*(k|m|тыс\.?|млн|mil)?\s*(members|subscribers|участник\w*|подписчик\w*|miembros|seguidores|membres|abonnés|Mitglieder)/i.exec(text);
  if (!m) return undefined;
  const unit = (m[2] || "").toLowerCase();
  let digits = m[1].replace(/[\s  ]/g, "");
  if (unit) digits = digits.replace(",", ".");
  else digits = digits.replace(/[.,]/g, "");
  const value = Number(digits);
  if (!Number.isFinite(value)) return undefined;
  const mult = unit.startsWith("k") || unit.startsWith("тыс") || unit === "mil" ? 1000 : unit.startsWith("m") ? 1_000_000 : 1;
  return Math.round(value * mult);
}

export function detectAdsPolicy(text: string): AdsPolicy {
  const t = text.toLowerCase();
  if (/без рекламы|реклама запрещ|рекламу не|no ads|no advertis|no spam|no promotion|sin publicidad|prohibid\w* (la )?publicidad|no se permite (la )?publicidad|pas de pub/i.test(t)) return "forbidden";
  if (/прайс|price list|стоимость размещ|платн\w* (размещ|реклам)|paid (ads|post)|tarifas|precio (de )?publicidad/i.test(t)) return "paid";
  // TZ 1.2: "through the admin" — a contact for ad questions, no price list.
  if (/по рекламе|по вопросам рекламы|реклама\s*[:—-]|реклама через|согласовать с админ|for ads|advertising\s*[:—-]|ads\s*[:—-]|contact (the )?admin|publicidad\s*[:—-]/i.test(t)) return "admin";
  if (/объявлени|размещайте|можно публиковать|ads allowed|post your (ads|listings)|anuncios|se permite publicar|compra|продажа|аренда|sale|rent|alquiler|venta/i.test(t)) return "allowed";
  return "unknown";
}

// The contact named for ads/admin questions, else the first handle or email in the text.
export function detectAdminContact(text: string, ownUrl = ""): string | undefined {
  const own = ownUrl.split("/").pop()?.toLowerCase() || "";
  const handles = (line: string) => [...line.matchAll(/(?:@|t\.me\/)([a-z][\w]{3,31})/gi)].map((m) => m[1]).filter((h) => h.toLowerCase() !== own);
  const emails = (line: string) => [...line.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].map((m) => m[0]);
  const lines = text.split(/\n|\. |·|\|/);
  for (const line of lines) {
    if (!/реклам|админ|admin|ads|advert|contact|связь|вопрос|publicidad|contacto|owner|владел/i.test(line)) continue;
    const found = handles(line)[0];
    if (found) return "@" + found;
    const mail = emails(line)[0];
    if (mail) return mail;
  }
  const mail = emails(text)[0];
  if (mail) return mail;
  const first = handles(text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " "))[0];
  return first ? "@" + first : undefined;
}

function decode(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// t.me public preview page: title, "N members"/"N subscribers", description.
export function parseTelegramPreview(html: string) {
  const title = decode(/<div class="tgme_page_title"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] || "");
  const extra = decode(/<div class="tgme_page_extra"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] || "");
  const description = decode(/<div class="tgme_page_description[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] || "");
  if (!title) return null;
  const kind: "group" | "channel" | null = /members|участник/i.test(extra) ? "group" : /subscribers|подписчик/i.test(extra) ? "channel" : null;
  if (!kind) return null; // a person's profile or a bot, not a group
  return { title, kind, members: parseMembers(extra), description };
}

export function parseFacebookPreview(html: string) {
  const meta = (name: string) => decode(new RegExp('<meta[^>]+property="' + name + '"[^>]+content="([^"]*)"', "i").exec(html)?.[1] || "");
  const title = meta("og:title");
  const description = meta("og:description");
  if (!title || /log in|войдите|iniciar sesi/i.test(title)) return null;
  return { title, description, members: parseMembers(description) };
}

// t.me/s/<channel> lists the latest public posts with dates and views.
export type PublicPost = { url: string; text: string; at?: string; views?: number; reactions?: number };
function parseViews(raw: string) {
  const m = /([\d.,]+)\s*([KM])?/i.exec(raw.trim());
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  return Math.round(n * (m[2]?.toUpperCase() === "M" ? 1e6 : m[2] ? 1e3 : 1));
}
export function parseTelegramPosts(html: string): PublicPost[] {
  const out: PublicPost[] = [];
  for (const block of html.split(/<div class="tgme_widget_message_wrap/).slice(1)) {
    const post = /data-post="([\w]+\/\d+)"/.exec(block)?.[1];
    if (!post) continue;
    out.push({
      url: "https://t.me/" + post,
      text: decode(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1] || "").slice(0, 1500),
      at: /<time[^>]+datetime="([^"]+)"/.exec(block)?.[1],
      views: parseViews(decode(/<span class="tgme_widget_message_views">([^<]*)</.exec(block)?.[1] || "")),
      reactions: [...block.matchAll(/<span class="tgme_reaction[^"]*">([\s\S]*?)<\/span>/g)].reduce((n, m) => n + (parseViews(decode(m[1])) || 0), 0) || undefined,
    });
  }
  return out;
}

export const INACTIVE_DAYS = () => Math.max(1, Number(process.env.INACTIVE_DAYS || 30) || 30);
export const MIN_POSTS_PER_WEEK = () => Math.max(0, Number(process.env.MIN_POSTS_PER_WEEK ?? 0.5) || 0);
export type ActivityThreshold = { days: number; minPerWeek: number };
const ACTIVITY_KEY = "settings:activity";

// The owner can change the liveness threshold from the bot (/activity 30 0.5); env vars are the default.
export async function activityThreshold(): Promise<ActivityThreshold> {
  const saved = await getValue<Partial<ActivityThreshold>>(ACTIVITY_KEY).catch(() => null);
  return { days: Math.max(1, Number(saved?.days) || INACTIVE_DAYS()), minPerWeek: Math.max(0, Number(saved?.minPerWeek ?? MIN_POSTS_PER_WEEK()) || 0) };
}
export async function setActivityThreshold(days: number, minPerWeek: number) {
  const value = { days: Math.max(1, Math.min(365, Math.round(days) || 30)), minPerWeek: Math.max(0, Math.min(100, minPerWeek || 0)) };
  await setValue(ACTIVITY_KEY, value);
  return value;
}

// Liveness from the dates of recent posts: last post and posts per week. Unknown when the page has no feed.
// Inactive = no post for `days`, or posting rarer than `minPerWeek` (TZ 1.2: date of last posts and frequency).
export function activityFromPosts(posts: PublicPost[], now = Date.now(), th: ActivityThreshold = { days: INACTIVE_DAYS(), minPerWeek: MIN_POSTS_PER_WEEK() }) {
  const dates = posts.map((p) => Date.parse(p.at || "")).filter(Number.isFinite).sort((a, b) => b - a);
  if (!dates.length) return { activity: "unknown" as const };
  const last = dates[0];
  const spanDays = Math.max(1, (now - dates[dates.length - 1]) / 86_400_000);
  const postsPerWeek = Math.round((dates.length / spanDays) * 7 * 10) / 10;
  const stale = (now - last) / 86_400_000 > th.days;
  const rare = th.minPerWeek > 0 && postsPerWeek < th.minPerWeek;
  const activity: "active" | "inactive" = stale || rare ? "inactive" : "active";
  return { activity, lastPostAt: new Date(last).toISOString(), postsPerWeek };
}

export async function telegramFeed(url: string) {
  const name = /t\.me\/([a-z][\w]{3,31})$/i.exec(url)?.[1];
  if (!name) return [];
  return parseTelegramPosts(await fetchHtml("https://t.me/s/" + name, 6000));
}

// Re-checks liveness of Telegram groups not checked for a day (cron); Facebook needs a login, so stays unknown.
export async function refreshActivity(limit = 40) {
  const stale = (await listGroups()).filter((g) => g.platform === "telegram" && g.url && !g.url.includes("/+") && (!g.activityCheckedAt || Date.now() - Date.parse(g.activityCheckedAt) > 20 * 3600_000)).slice(0, limit);
  const th = await activityThreshold();
  const updated = await inBatches(stale, 10, async (g) => ({ ...g, ...activityFromPosts(await telegramFeed(g.url), Date.now(), th), activityCheckedAt: nowIso() }));
  await putMany("groups", updated);
  return updated.length;
}

// ---- Fetching -------------------------------------------------------------------

async function fetchHtml(url: string, timeoutMs = 7000) {
  if (!isSafePublicUrl(url)) return "";
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) return "";
    return (await response.text()).slice(0, 400_000);
  } catch { return ""; }
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export type FindInput = {
  country?: string; city?: string; topic: string;
  relevance?: "core" | "adjacent"; exclusions?: string[]; language?: string;
  platforms?: Platform[];
  broadPage?: number;
  skipApify?: boolean;
  // The topic in the place's local language (second search round), filled by findGroups.
  localTopic?: string;
};
export type PlatformQuery = { platform: Platform; query: string };

// An ordinary text request may name several platforms. The bot need not
// ask the owner to specify them in a separate form.
export function inferredSearchPlatforms(input: FindInput): Platform[] {
  const all: Platform[] = ["telegram", "instagram", "tiktok", "facebook"];
  if (input.platforms?.length) return [...new Set(input.platforms)].filter((p) => all.includes(p));
  const text = input.topic.toLowerCase();
  const matches: Platform[] = all.filter((p) =>
    ({ telegram: /telegram|телеграм|телегр|телеграмм/,
       instagram: /instagram|инстаграм|інстаграм|инста\b|insta\b/,
       tiktok: /tiktok|tik.?tok|тикток|тік.?ток|тик.?ток/,
       facebook: /facebook|фейсбук|фейсбу|фб\b/ } as Record<Platform, RegExp>)[p].test(text)
  );
  return matches.length ? matches : all;
}

function placeOf(input: FindInput) {
  return [input.city, input.country].filter(Boolean).join(", ");
}

// One query per chosen platform is tried first, before second-round variants.
// This prevents a slow or blocked Telegram search from starving Instagram and
// TikTok results. We never use API access to users' private accounts.
// A broad query scans categories in pages. Public search indexes cannot list
// every community worldwide or guarantee coverage of private communities.
// Two categories per page keeps API costs and query latency bounded.
export const BROAD_DISCOVERY_CATEGORIES = [
  "городские сообщества местные новости",
  "работа вакансии карьера",
  "покупка продажа барахолка",
  "жилье аренда соседи",
  "бизнес предприниматели услуги",
  "образование языки студенты",
  "спорт фитнес путешествия",
  "еда рестораны кулинария",
  "культура события музыка",
  "семья родители дети",
  "животные природа экология",
  "технологии игры IT",
  "здоровье благополучие",
  "духовные практики медитация",
  "знакомства общение клубы",
  "автомобили транспорт",
] as const;
export const BROAD_DISCOVERY_PAGE_SIZE = 2;
export const BROAD_DISCOVERY_PAGES = Math.ceil(BROAD_DISCOVERY_CATEGORIES.length / BROAD_DISCOVERY_PAGE_SIZE);

export function isBroadDiscoveryTopic(topic: string) {
  const value = String(topic || "").trim().toLowerCase().replace(/[.,!?]+$/g, "");
  return !value || /^(?:\*|все(?:\s+(?:публичные|доступные|активные))?\s+(?:группы|сообщества|категории|темы|тематики|каналы|площадки)(?:\s+в\s+.+)?|любые\s+(?:группы|сообщества|темы|тематики)(?:\s+в\s+.+)?|все\s+тематики|all\s+(?:public\s+)?(?:topics|groups|communities|categories)|any\s+(?:topics|communities|groups)|усі\s+(?:групи|спільноти|теми)|всі\s+(?:групи|спільноти|теми))$/iu.test(value);
}

export function platformSearchQueries(input: FindInput): PlatformQuery[] {
  const requested = inferredSearchPlatforms(input);
  const geo = placeOf(input);
  const broad = isBroadDiscoveryTopic(input.topic);
  const topicText = input.topic.trim().replace(/(?:telegram|телеграм\w*|instagram|инстаграм\w*|інстаграм\w*|tiktok|tik.?tok|тикток\w*|тік.?ток\w*|facebook|фейсбук\w*)/giu, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  const page = Math.max(0, Math.min(BROAD_DISCOVERY_PAGES - 1, Math.trunc(input.broadPage || 0)));
  const topics = broad ? [...BROAD_DISCOVERY_CATEGORIES].slice(page * BROAD_DISCOVERY_PAGE_SIZE, (page + 1) * BROAD_DISCOVERY_PAGE_SIZE) : [topicText || input.topic.trim()];
  const local = !broad && input.localTopic?.trim() ? input.localTopic.trim().slice(0, 160) : "";
  const polish = /поль|poland|polska|polsce|polski/i.test(geo);
  const spanish = /испан|spain|españa|valencia|валенси|barcelona|барселон/i.test(geo);
  const searchWords: Record<Platform, [string, string]> = {
    telegram: ["Telegram public groups channels", polish ? "grupy kanały" : spanish ? "grupos canales" : "groups communities"],
    instagram: ["Instagram public creator profiles business accounts", polish ? "profile firmy twórcy" : spanish ? "cuentas creadores negocios" : "profiles creators business"],
    tiktok: ["TikTok public creator profiles", polish ? "twórcy profile" : spanish ? "creadores perfiles" : "creators profiles"],
    facebook: ["Facebook public groups", polish ? "grupy społeczności" : spanish ? "grupos comunidades" : "groups communities"],
  };
  const domains: Record<Platform, string> = {
    telegram: "t.me", instagram: "instagram.com", tiktok: "tiktok.com/@", facebook: "facebook.com/groups",
  };
  // Every round runs each requested platform before moving to the next
  // category or synonym query. New topics never need a code edit.
  return [0, 1].flatMap((round) => topics.flatMap((topic) => requested.map((platform) => {
    const prefix = searchWords[platform][round];
    // Round 2 searches in the local language: «вино» in Valencia also finds «vino» groups.
    const query = [prefix, round === 1 && local ? local : topic, geo, domains[platform]].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return { platform, query };
  })));
}

export function groupQueries(input: FindInput) {
  return platformSearchQueries(input).map((q) => q.query);
}

function listPrompt(input: FindInput) {
  const wanted = (input.platforms?.length ? input.platforms : ["telegram", "instagram", "tiktok", "facebook"]).join(", ");
  return "Find existing PUBLIC community/profile URLs for " + (isBroadDiscoveryTopic(input.topic) ? "diverse community categories" : input.topic) +
    " in " + (placeOf(input) || "the requested location") + " on " + wanted +
    ". Telegram groups/channels use t.me links. Instagram accounts use instagram.com/username. TikTok creators use tiktok.com/@username. Facebook groups use facebook.com/groups/id." +
    " Return names and direct real URLs only, do not invent URLs or claim access to private groups. Public profile is NOT permission to advertise.";
}

export type FindOutcome = { found: GroupCard[]; added: number; checked: number; notes: string[] };

// Adult and escort communities never belong in a client's ad base, whatever the topic or place.
// NFKC turns decorative letters (𝐒𝐥𝐮𝐭) into plain ones before matching.
const ADULT = [
  /18\s*\+|\bxxx\b|porn|порн|nsfw|onlyfans|escort|эскорт|интим/i,
  /\bsex|секс|\borgi[ae]s?\b|\borg(y|ies)\b|оргия|оргии|slut|шлюх|проститут/i,
  /nude|naked|голые|erotic|эрот|hentai|хентай|camgirl/i,
  /fetish|фетиш|bdsm|бдсм|interracial|milf|public agent/i,
];
export const isAdult = (text: string) => { const t = text.normalize("NFKC"); return ADULT.some((re) => re.test(t)); };

// True when the text mentions any topic word (short stems, so word forms match: вино → винные). No topic = everything is on topic.
export function onTopic(topic: string, text: string) {
  const words = topic.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, w.length <= 5 ? w.length - 1 : 5));
  const t = text.toLowerCase();
  return !words.length || words.some((w) => t.includes(w));
}

// The topic as words in the place's local language and in English, from the free AI, cached for
// a month. Typed or spoken in any language, «вино» in Valencia becomes vino / wine, so search and
// the on-topic check work across languages. No AI key: the topic is used as typed.
export async function topicTranslations(topic: string, place: string, deadlineAt = Date.now() + 12_000): Promise<{ lang: string; local: string; variants: string[] }> {
  const clean = topic.trim().slice(0, 160);
  const known = detectCountry(place)?.lang || "";
  if (!clean) return { lang: known, local: "", variants: [] };
  const key = "topic-tr:" + stableId("t", (place + "|" + clean).toLowerCase());
  const cached = await getValue<{ lang: string; local: string; variants: string[] }>(key).catch(() => null);
  if (cached) return cached;
  const ai = await runStructuredExtraction({
    system: "You translate a search topic for finding social media communities. Return JSON only.",
    user: "Topic (any language): " + clean + "\nPlace: " + (place || "not given") + "\nGive the main local language of the place (ISO 639-1; the topic's own language if no place), the topic as people there would write it in that language (1-4 words), and up to 4 short variants: the English term and local synonyms.",
    schema: { type: "object", properties: { lang: { type: "string" }, local: { type: "string" }, variants: { type: "array", items: { type: "string" } } }, required: ["lang", "local", "variants"] },
    deadlineAt: Math.min(deadlineAt, Date.now() + 12_000), maxTokens: 300, perCallTimeoutMs: 10_000, prefer: "gemini",
  }).catch(() => null);
  const p = ai?.parsed;
  if (!p) return { lang: known, local: "", variants: [] };
  const lang = /^[a-z]{2}$/.test(String(p.lang || "").toLowerCase()) ? String(p.lang).toLowerCase() : known;
  const local = String(p.local || "").trim().slice(0, 80);
  const variants = [...new Set([local, ...(Array.isArray(p.variants) ? p.variants : [])].map((v) => String(v || "").trim().slice(0, 60)).filter((v) => v && v.toLowerCase() !== clean.toLowerCase()))].slice(0, 5);
  const out = { lang, local: local.toLowerCase() === clean.toLowerCase() ? "" : local, variants };
  await setValue(key, out, 30 * 86400).catch(() => {});
  return out;
}

export async function findGroups(input: FindInput, deadlineAt = Date.now() + 45_000): Promise<FindOutcome> {
  const notes: string[] = [];
  const selected = inferredSearchPlatforms(input);
  const broad = isBroadDiscoveryTopic(input.topic);
  // Campaigns already pass keywords in each target language; a direct search gets translated here.
  const tr = broad || input.language ? { lang: input.language || "", local: "", variants: [] as string[] } : await topicTranslations(input.topic, placeOf(input), deadlineAt - 30_000);
  const topicsAll = [input.topic, ...tr.variants];
  if (tr.variants.length) notes.push("Тема на других языках: " + tr.variants.join(", ") + ".");
  input = { ...input, localTopic: tr.local || undefined };
  const searchLang = /поль|poland|polska|polsce|polski/i.test(placeOf(input)) ? "pl" : tr.lang || input.language || "en";
  const broadPage = Math.max(0, Math.min(BROAD_DISCOVERY_PAGES - 1, Math.trunc(input.broadPage || 0)));
  if (broad) {
    const cats = BROAD_DISCOVERY_CATEGORIES.slice(broadPage * BROAD_DISCOVERY_PAGE_SIZE, (broadPage + 1) * BROAD_DISCOVERY_PAGE_SIZE);
    notes.push("Широкий поиск: подборка " + (broadPage + 1) + "/" + BROAD_DISCOVERY_PAGES +
      " (категории: " + cats.join("; ") + "). Это не исчерпывающий каталог; для следующей подборки нажмите «Следующие категории».");
  }
  const descriptors = platformSearchQueries({ ...input, platforms: selected, broadPage });
  const queries = descriptors.map((q) => q.query);
  const onePerPlatform = descriptors.filter((d, i) => descriptors.findIndex((v) => v.platform === d.platform) === i);
  const paidQueries = onePerPlatform.slice(0, 4); // billing limit per search run
  const budget = deadlineAt - Date.now();
  const [paid, keyless, tgstat, apify] = await Promise.all([
    dataForSeoEnabled()
      ? Promise.all(paidQueries.map((d) => dataForSeoSearch(d.query, input.country || input.city || "", searchLang, budget - 10_000)))
      : Promise.resolve([]),
    runKeylessSearch(queries, searchLang, Math.min(deadlineAt, Date.now() + 19_000)).catch(() => []),
    selected.includes("telegram") && !broad && tgStatEnabled()
      ? tgStatSearch(input.topic, input.country || "")
      : Promise.resolve({ ok: false, urls: [], source: "tgstat" as const }),
    apifyEnabled() && !input.skipApify
      ? apifySearch(paidQueries.map((d) => d.query), input.country || input.city || "", searchLang, budget - 15_000)
      : Promise.resolve<Awaited<ReturnType<typeof apifySearch>>>({ ok: false, hits: [] }),
  ]);
  for (const result of paid) if (!result.ok && result.message) notes.push(result.message);
  if (!apify.ok && apify.message && apifyEnabled() && !input.skipApify) notes.push(apify.message);
  const paidHits = paid.flatMap((result, i) => result.hits.map((h) => ({ ...h, sourceQuery: paidQueries[i].query })));
  const keylessHits = keyless.flatMap((result) => result.hits.map((h) => ({ ...h, sourceQuery: result.query || "" })));
  const apifyHits = apify.hits.map((h) => ({ ...h, sourceQuery: h.query }));
  const visibleHits = [...paidHits, ...apifyHits, ...keylessHits];
  const hitPlatform = (url: string): Platform | "" =>
    normalizeTelegramUrl(url) ? "telegram"
    : normalizeFacebookGroupUrl(url) ? "facebook"
    : normalizeInstagramProfileUrl(url) ? "instagram"
    : normalizeTikTokProfileUrl(url) ? "tiktok" : "";
  const discovered = new Set(visibleHits.map((h) => hitPlatform(h.url)).filter(Boolean));
  const missing = selected.filter((p) => !discovered.has(p));
  // Only use Gemini when indexed search missed a requested platform. Its
  // grounding may require billable access; 404 must not invent profile URLs.
  const fallbackQueries = descriptors.filter((q) => missing.includes(q.platform)).slice(0, 2);
  const gemini = !fallbackQueries.length || Date.now() > deadlineAt - 22_000
    ? []
    : await Promise.all(fallbackQueries.map((q) => geminiSearch(q.query, searchLang, listPrompt(input))));
  for (const g of gemini) if (!g.ok && g.message) notes.push(g.message);
  const geminiHits = gemini.flatMap((g, i) => g.hits.map((h) => ({ ...h, sourceQuery: fallbackQueries[i].query })));
  if (!visibleHits.length && !gemini.some((g) => g.ok && (g.hits.length || g.text))) {
    notes.push("Поисковые источники пока не подтвердили подходящих публичных ссылок. Ноль результатов не означает, что аккаунтов нет.");
  }

  const telegram = new Map<string, { snippet: string; trusted: boolean; sourceQuery: string }>();
  if (tgstat.ok) for (const link of tgstat.urls) {
    const url = normalizeTelegramUrl(link);
    if (url) telegram.set(url, { snippet: "TGStat API: " + input.topic, trusted: true, sourceQuery: "TGStat: " + input.topic });
  } else if (tgStatEnabled() && selected.includes("telegram") && "error" in tgstat && tgstat.error) notes.push(tgstat.error);
  const facebook = new Map<string, { title: string; snippet: string; sourceQuery: string }>();
  const instagram = new Map<string, { title: string; snippet: string; sourceQuery: string }>();
  const tiktok = new Map<string, { title: string; snippet: string; sourceQuery: string }>();
  const otherPages: string[] = [];
  const hits = [...visibleHits, ...geminiHits];
  for (const hit of hits) {
    const platform = hitPlatform(hit.url);
    if (platform && !selected.includes(platform)) continue;
    const url = platform === "telegram" ? normalizeTelegramUrl(hit.url)
      : platform === "facebook" ? normalizeFacebookGroupUrl(hit.url)
      : platform === "instagram" ? normalizeInstagramProfileUrl(hit.url)
      : platform === "tiktok" ? normalizeTikTokProfileUrl(hit.url) : "";
    const meta = { title: hit.title || "", snippet: hit.snippet || "", sourceQuery: hit.sourceQuery || input.topic };
    if (platform === "telegram") telegram.set(url, { snippet: meta.snippet, trusted: true, sourceQuery: meta.sourceQuery });
    else if (platform === "facebook") facebook.set(url, meta);
    else if (platform === "instagram") instagram.set(url, meta);
    else if (platform === "tiktok") tiktok.set(url, meta);
    else if (hit.url && selected.some((p) => p === "telegram" || p === "facebook")) otherPages.push(hit.url);
    // Only Telegram/Facebook links in indexed public snippets are considered;
    // not arbitrary Instagram/TikTok handles hallucinated in an LLM reply.
    const inText = extractGroupLinks(hit.title + " " + hit.snippet);
    if (selected.includes("telegram")) for (const u of inText.telegram) if (!telegram.has(u)) telegram.set(u, { snippet: "", trusted: true, sourceQuery: meta.sourceQuery });
    if (selected.includes("facebook")) for (const u of inText.facebook) if (!facebook.has(u)) facebook.set(u, { title: "", snippet: meta.snippet, sourceQuery: meta.sourceQuery });
  }
  // Gemini text is only a candidate for Telegram; a public Telegram preview
  // must exist before a result is saved. Never infer TikTok/IG profiles from text.
  if (selected.includes("telegram")) for (const g of gemini) for (const u of extractGroupLinks(g.text || "").telegram)
    if (!telegram.has(u)) telegram.set(u, { snippet: "", trusted: true, sourceQuery: input.topic });

  // Catalogue pages occasionally list additional public Telegram/Facebook
  // links. Access only public websites and validate every link.
  if (selected.includes("telegram") || selected.includes("facebook")) {
    const pages = await inBatches(otherPages.slice(0, 4), 4, (url) => fetchHtml(url, 5000));
    for (const html of pages) {
      const links = extractGroupLinks(html);
      if (selected.includes("telegram")) for (const u of links.telegram.slice(0, 25))
        if (!telegram.has(u)) telegram.set(u, { snippet: "", trusted: false, sourceQuery: "public catalogue" });
      if (selected.includes("facebook")) for (const u of links.facebook.slice(0, 15))
        if (!facebook.has(u)) facebook.set(u, { title: "", snippet: "", sourceQuery: "public catalogue" });
    }
  }

  const now = nowIso();
  const topicWords = ((broad ? "" : topicsAll.join(" ")) + " " + (input.city || "") + " " + (input.country || "")).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
  const relevant = (text: string) => { const t = text.toLowerCase(); return topicWords.some((w) => t.includes(w)); };
  const base = { country: input.country || undefined, city: input.city || undefined, topic: broad ? "разные тематики" : input.topic, status: "new" as GroupStatus, foundAt: now, updatedAt: now, relevance: input.relevance || "core", foundBy: [input.topic, placeOf(input)].filter(Boolean).join(" · ") };
  let adultHidden = 0;
  const excluded = (text: string) => {
    const t = text.toLowerCase();
    if (isAdult(t)) { adultHidden++; return true; }
    return (input.exclusions || []).some((x) => x && t.includes(x.toLowerCase()));
  };

  const th = await activityThreshold();
  const tgList = [...telegram.entries()].slice(0, 60);
  const tgCards = await inBatches(tgList, 10, async ([url, meta]): Promise<GroupCard | null> => {
    if (Date.now() > deadlineAt) return null;
    const preview = parseTelegramPreview(await fetchHtml(url, 6000));
    if (!preview) return null;
    // Links lifted from catalogue pages are kept only when they match the topic or place.
    if (!meta.trusted && !relevant(preview.title + " " + preview.description)) return null;
    const text = preview.description + "\n" + meta.snippet;
    if (excluded(preview.title + " " + text)) return null;
    // Channels (and some groups) have a public feed: last post date and frequency.
    const feed = Date.now() < deadlineAt ? await telegramFeed(url) : [];
    const live = feed.length ? { ...activityFromPosts(feed, Date.now(), th), activityCheckedAt: now } : { activity: "unknown" as const };
    return { ...base, ...live, foundBy: meta.sourceQuery, verification: "public_page", id: stableId("grp", url.toLowerCase()), platform: "telegram", kind: preview.kind, url, name: preview.title, members: preview.members, description: preview.description.slice(0, 600), ads: detectAdsPolicy(text), adminContact: detectAdminContact(preview.description, url), language: detectLanguage(preview.title + " " + preview.description + " " + feed.slice(0, 3).map((p) => p.text).join(" "), input.language || "en") };
  });

  const fbList = [...facebook.entries()].slice(0, 30);
  const fbCards = await inBatches(fbList, 10, async ([url, meta]): Promise<GroupCard | null> => {
    const preview = Date.now() < deadlineAt ? parseFacebookPreview(await fetchHtml(url, 6000)) : null;
    const name = preview?.title || meta.title.replace(/\s*[|·-]\s*Facebook.*$/i, "").trim();
    if (!name) return null;
    const text = (preview?.description || "") + "\n" + meta.snippet;
    if (excluded(name + " " + text)) return null;
    return { ...base, foundBy: meta.sourceQuery, verification: preview ? "public_page" : "indexed_candidate", activity: "unknown", language: detectLanguage(name + " " + text, input.language || "en"), id: stableId("grp", url.toLowerCase()), platform: "facebook", kind: "group", url, name, members: preview?.members ?? parseMembers(meta.snippet), description: text.trim().slice(0, 600), ads: detectAdsPolicy(text), adminContact: detectAdminContact(text, url) };
  });

  // Instagram/TikTok are PUBLIC thematic creators or business profiles, not
  // Telegram-style communities. Search indexes are not reliable liveness,
  // follower-count, posting-rights, or account ownership verification.
  const makeProfiles = (platform: "instagram" | "tiktok", entries: Map<string, { title: string; snippet: string; sourceQuery: string }>): GroupCard[] =>
    [...entries.entries()].slice(0, 50).flatMap(([url, meta]) => {
      const handle = url.split("/").pop() || url;
      const name = meta.title.replace(/\s*[|·•-]\s*(Instagram|TikTok).*$/i, "").trim().slice(0, 120) || handle;
      if (excluded(name + " " + meta.snippet)) return [];
      return [{
        ...base, id: stableId("grp", url.toLowerCase()),
        platform, kind: "profile" as const, url, name, ads: "unknown" as const,
        activity: "unknown" as const, verification: "indexed_candidate" as const,
        description: meta.snippet.slice(0, 600),
        foundBy: meta.sourceQuery,
        language: detectLanguage(name + " " + meta.snippet, input.language || "en"),
      }];
    });
  const instagramCards = makeProfiles("instagram", instagram);
  const tiktokCards = makeProfiles("tiktok", tiktok);
  const found = [...tgCards, ...fbCards, ...instagramCards, ...tiktokCards].filter(Boolean) as GroupCard[];
  // Search engines match the city alone too: a card that never mentions the topic is kept, but as adjacent (🟡), below the on-topic ones.
  for (const g of found) if (!broad && !topicsAll.some((t) => onTopic(t, g.name + " " + (g.description || "")))) g.relevance = "adjacent";
  const saved = await upsertGroups(found);
  if (adultHidden) notes.push("Скрыто 18+: " + adultHidden + ".");
  const restricted = found.filter((g) => restrictedTopic(g.name + " " + (g.description || ""))).length;
  if (restricted) notes.push("⚠️ С ограниченной рекламой (алкоголь, табак, ставки и т. п.): " + restricted + " — сначала проверьте правила группы и закон страны.");
  if (!found.length && !notes.length) notes.push("Поиск не вернул публичных групп. Попробуйте другую формулировку темы или город на местном языке.");
  await logAction({ actor: "agent", action: "groups.find", detail: input.topic + " · " + placeOf(input) + " → " + found.length + " (новых " + saved.added + ")" });
  saved.cards.sort((a, b) => Number(a.relevance === "adjacent") - Number(b.relevance === "adjacent") || (b.members || 0) - (a.members || 0));
  return { found: saved.cards, added: saved.added, checked: telegram.size + facebook.size + instagram.size + tiktok.size, notes };
}

// The same community found twice: once by its public @username and once by an invite link
// (t.me/+…), or by two invite links. Same platform, same title and the same member count
// (±1%) means one community.
const twinName = (g: GroupCard) => String(g.name || "").toLowerCase().replace(/\s+/g, " ").trim();

export function sameCommunity(a: GroupCard, b: GroupCard) {
  if (a.id === b.id || a.platform !== b.platform) return false;
  if (a.url.toLowerCase() === b.url.toLowerCase()) return true;
  const key = twinName;
  if (key(a).length < 4 || key(a) !== key(b)) return false;
  if (!a.members || !b.members) return false;
  return Math.abs(a.members - b.members) <= Math.max(2, 0.01 * Math.max(a.members, b.members));
}

const isInvite = (url: string) => /t\.me\/\+/i.test(url);

// Which twin survives: the one the owner already worked with, then the public link, then the oldest.
function survivorRank(g: GroupCard) {
  return (g.botConnected ? 8 : 0) + (g.status && g.status !== "new" ? 4 : 0) + (isInvite(g.url) ? 0 : 2);
}

// Collapses twins: keeps one card per community, carries over the owner's fields, returns the ids to drop.
// Twins share a platform and either a URL or a title, so only cards in the same bucket are compared
// (linear in the number of groups, not quadratic).
export function collapseTwins(cards: GroupCard[]) {
  const keep: GroupCard[] = [];
  const dropped: string[] = [];
  const survivorOf: Record<string, string> = {};
  const buckets = new Map<string, GroupCard[]>();
  const keysOf = (g: GroupCard) => [g.platform + "|u|" + g.url.toLowerCase(), g.platform + "|n|" + twinName(g)];
  const ordered = [...cards].sort((a, b) => survivorRank(b) - survivorRank(a) || String(a.foundAt || "").localeCompare(String(b.foundAt || "")));
  for (const card of ordered) {
    const twin = keysOf(card).flatMap((k) => buckets.get(k) || []).find((k) => sameCommunity(k, card));
    if (!twin) { keep.push(card); for (const k of keysOf(card)) buckets.set(k, [...(buckets.get(k) || []), card]); continue; }
    dropped.push(card.id);
    survivorOf[card.id] = twin.id;
    if (!twin.permissionConfirmedAt && card.permissionConfirmedAt) Object.assign(twin, { status: card.status, permissionConfirmedAt: card.permissionConfirmedAt, permissionConfirmedBy: card.permissionConfirmedBy, permissionNote: twin.permissionNote || card.permissionNote, partnerTelegramId: twin.partnerTelegramId || card.partnerTelegramId });
    twin.adminContact = twin.adminContact || card.adminContact;
    twin.members = Math.max(twin.members || 0, card.members || 0) || twin.members;
    if (twin.relevance !== "core" && card.relevance === "core") twin.relevance = "core";
  }
  return { keep, dropped, survivorOf };
}

// Campaign audiences, tasks, the posting log and the manual queue point at group ids: move them to the survivor,
// so a merged-away twin never leaves a campaign without targets or a task without its group.
async function repointGroupIds(survivorOf: Record<string, string>) {
  const to = (id: string) => survivorOf[id] || id;
  const lists = (ids?: string[]) => (ids ? [...new Set(ids.map(to))] : ids);
  const campaigns = await listAll<{ id: string; searchGroupIds?: string[]; controlGroupIds?: string[] }>("campaigns");
  const touched = campaigns.filter((c) => [...(c.searchGroupIds || []), ...(c.controlGroupIds || [])].some((id) => survivorOf[id]));
  if (touched.length) await putMany("campaigns", touched.map((c) => ({ ...c, searchGroupIds: lists(c.searchGroupIds), controlGroupIds: lists(c.controlGroupIds) })));
  for (const col of ["campaign_tasks", "group_posts", "group_queue"] as const) {
    const rows = (await listAll<{ id: string; groupId?: string }>(col)).filter((r) => r.groupId && survivorOf[r.groupId]);
    if (rows.length) await putMany(col, rows.map((r) => ({ ...r, groupId: to(r.groupId!) })));
  }
}

// Keeps what the user already filled in (status, price, notes, posting switch, bot link).
export async function upsertGroups(cards: GroupCard[]) {
  const existing = await listAll<GroupCard>("groups");
  const byId = new Map(existing.map((g) => [g.id, g]));
  let added = 0;
  const merged: GroupCard[] = [];
  for (const card of cards) {
    const prev = byId.get(card.id);
    const twin = prev ? undefined : existing.find((g) => sameCommunity(g, card));
    if (!prev && !twin) added += 1;
    merged.push(prev ? { ...card, relevance: prev.relevance === "core" ? "core" : card.relevance, foundBy: prev.foundBy || card.foundBy, partnerTelegramId: prev.partnerTelegramId, minDaysBetween: prev.minDaysBetween, permissionNote: prev.permissionNote, permissionConfirmedAt: prev.permissionConfirmedAt, permissionConfirmedBy: prev.permissionConfirmedBy, requestSentAt: prev.requestSentAt, repliedAt: prev.repliedAt, status: prev.status, price: prev.price, currency: prev.currency, notes: prev.notes, chatId: prev.chatId, botConnected: prev.botConnected, postingEnabled: prev.postingEnabled, dailyLimit: prev.dailyLimit, adminContact: prev.adminContact || card.adminContact, foundAt: prev.foundAt } : card);
  }
  const incoming = new Set(merged.map((g) => g.id));
  const { keep, dropped, survivorOf } = collapseTwins([...merged, ...existing.filter((g) => !incoming.has(g.id))]);
  const keptIds = new Set(keep.map((g) => g.id));
  await putMany("groups", keep.filter((g) => incoming.has(g.id) || dropped.length));
  if (dropped.length) {
    await repointGroupIds(survivorOf);
    await removeMany("groups", dropped);
    await logAction({ actor: "agent", action: "groups.dedupe", detail: "убраны дубли: " + dropped.length });
    const archive = await import("@/lib/archive");
    await archive.removeFromArchive("groups", dropped).catch(() => null);
  }
  // Return the surviving card for every incoming one (a twin keeps its existing record).
  const out = merged.map((card) => (keptIds.has(card.id) ? keep.find((g) => g.id === card.id)! : keep.find((g) => sameCommunity(g, card)) || card));
  return { cards: [...new Map(out.map((g) => [g.id, g])).values()], added };
}

export async function listGroups() {
  // Adult cards saved before the filter existed never reach the page, exports or posting.
  return (await listAll<GroupCard>("groups")).filter((g) => !isAdult(g.name + " " + (g.description || ""))).sort((a, b) => Number(Boolean(b.botConnected)) - Number(Boolean(a.botConnected)) || (b.members || 0) - (a.members || 0));
}

// How many saved communities the 18+ filter hides from the page, exports and posting.
export async function adultHiddenCount() {
  return (await listAll<GroupCard>("groups")).filter((g) => isAdult(g.name + " " + (g.description || ""))).length;
}

const STATUSES = new Set<GroupStatus>(["new", "contacted", "replied", "free", "exchange", "paid", "declined"]);
const AGREED = new Set<GroupStatus>(["free", "exchange", "paid"]);

// An admin's consent is on record: the bot was added by the chat, or someone confirmed the agreement.
export function permissionConfirmed(g: GroupCard) {
  return AGREED.has(g.status) && Boolean(g.botConnected || g.permissionConfirmedAt || g.permissionNote);
}

export async function updateGroup(id: string, patch: Partial<Pick<GroupCard, "status" | "price" | "currency" | "notes" | "adminContact" | "postingEnabled" | "dailyLimit" | "partnerTelegramId" | "minDaysBetween" | "permissionNote">>, by = "owner") {
  const card = await getOne<GroupCard>("groups", id);
  if (!card) return null;
  const next: GroupCard = { ...card, updatedAt: nowIso() };
  if (patch.status && STATUSES.has(patch.status)) {
    next.status = patch.status;
    if (patch.status === "contacted" && !card.requestSentAt) next.requestSentAt = next.updatedAt;
    if (["replied", "free", "exchange", "paid", "declined"].includes(patch.status) && !card.repliedAt) next.repliedAt = next.updatedAt;
    if (!AGREED.has(patch.status)) { next.permissionConfirmedAt = undefined; next.permissionConfirmedBy = undefined; }
    else if (!AGREED.has(card.status) || !card.permissionConfirmedAt) { next.permissionConfirmedAt = next.updatedAt; next.permissionConfirmedBy = String(by).slice(0, 80); }
  }
  if (patch.price !== undefined) next.price = Number(patch.price) > 0 ? Number(patch.price) : undefined;
  if (patch.currency !== undefined) next.currency = String(patch.currency).slice(0, 6) || undefined;
  if (patch.notes !== undefined) next.notes = String(patch.notes).slice(0, 500);
  if (patch.adminContact !== undefined) next.adminContact = String(patch.adminContact).slice(0, 120) || undefined;
  if (patch.dailyLimit !== undefined) next.dailyLimit = Math.max(0, Math.min(10, Math.round(Number(patch.dailyLimit) || 0)));
  if (patch.partnerTelegramId !== undefined) next.partnerTelegramId = /^-?\d{4,20}$/.test(String(patch.partnerTelegramId).trim()) ? String(patch.partnerTelegramId).trim() : undefined;
  if (patch.minDaysBetween !== undefined) next.minDaysBetween = Math.max(1, Math.min(60, Math.round(Number(patch.minDaysBetween) || 1)));
  if (patch.permissionNote !== undefined) next.permissionNote = String(patch.permissionNote).slice(0, 300) || undefined;
  if (patch.postingEnabled !== undefined) next.postingEnabled = Boolean(patch.postingEnabled) && Boolean(card.botConnected);
  await putOne("groups", next);
  return next;
}

export function platformOfUrl(raw: string): { platform: Platform; url: string } | null {
  const tg = normalizeTelegramUrl(raw);
  if (tg) return { platform: "telegram", url: tg };
  const fb = /(?:https?:\/\/)?(?:www\.|m\.|web\.)?facebook\.com\/([\w./-]{3,120})/i.exec(raw);
  if (fb) return { platform: "facebook", url: "https://www.facebook.com/" + fb[1].replace(/\/+$/, "") };
  const ig = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([\w.]{2,40})/i.exec(raw);
  if (ig && !/^(p|reel|tv|explore|accounts)$/i.test(ig[1])) return { platform: "instagram", url: "https://www.instagram.com/" + ig[1] };
  const tt = /(?:https?:\/\/)?(?:www\.|m\.)?tiktok\.com\/(@[\w.]{2,40})/i.exec(raw);
  if (tt) return { platform: "tiktok", url: "https://www.tiktok.com/" + tt[1] };
  return null;
}

// One canonical URL per community, the same normalisation the search uses (control-list matching).
export function canonicalCommunityUrl(raw: string): { platform: Platform; url: string } | null {
  const value = raw.trim();
  const tg = normalizeTelegramUrl(value);
  if (tg) return { platform: "telegram", url: tg };
  const fb = normalizeFacebookGroupUrl(value);
  if (fb) return { platform: "facebook", url: fb };
  const ig = normalizeInstagramProfileUrl(value);
  if (ig) return { platform: "instagram", url: ig };
  const tt = normalizeTikTokProfileUrl(value);
  if (tt) return { platform: "tiktok", url: tt };
  return platformOfUrl(value);
}

// Public Telegram page: does it exist, and is it alive by the current threshold?
export async function telegramLiveness(url: string) {
  const preview = parseTelegramPreview(await fetchHtml(url, 6000));
  if (!preview) return { status: "missing" as const };
  const feed = await telegramFeed(url);
  const live = feed.length ? activityFromPosts(feed, Date.now(), await activityThreshold()) : { activity: "unknown" as const };
  return { status: live.activity, preview, live };
}

// A placement added by hand: an Instagram/TikTok/Facebook partner or a Telegram chat the admin agreed on.
export async function addGroupManually(input: { url: string; pending?: boolean; by?: string; name?: string; partnerTelegramId?: string; dailyLimit?: number; minDaysBetween?: number; permissionNote?: string; topic?: string; city?: string; country?: string }) {
  const found = platformOfUrl(input.url);
  if (!found) return null;
  const now = nowIso();
  const id = stableId("grp", found.url.toLowerCase());
  const prev = await getOne<GroupCard>("groups", id);
  const card: GroupCard = { ...(prev || { id, platform: found.platform, url: found.url, name: input.name || found.url.split("/").pop() || found.url, ads: "allowed", status: "free", foundAt: now }), updatedAt: now } as GroupCard;
  if (input.name) card.name = input.name.slice(0, 120);
  const note = String(input.permissionNote || "").trim();
  // Self-registered partner, or added without a note of the admin's consent: nothing goes there until
  // someone records the agreement (status → free on the card, or re-add with "как договорились").
  if ((input.pending || !note) && (!prev || ["new", "contacted", "declined"].includes(prev.status))) { card.status = "contacted"; card.ads = "unknown"; }
  else if (!input.pending && note && !card.permissionConfirmedAt) { card.permissionConfirmedAt = now; card.permissionConfirmedBy = String(input.by || "owner").slice(0, 80); }
  for (const k of ["topic", "city", "country"] as const) if (input[k]) card[k] = String(input[k]).slice(0, 80);
  await putOne("groups", card);
  return updateGroup(id, { partnerTelegramId: input.partnerTelegramId, dailyLimit: input.dailyLimit, minDaysBetween: input.minDaysBetween, permissionNote: input.permissionNote });
}

// ---- Admin outreach: one personal request per community -----------------------
// Each letter is built for that community: its name, platform (group/channel vs profile),
// the language its posts are written in, and the kind of deal. A person sends it from their
// own account (or e-mail); nothing here messages admins automatically.

export type OutreachKind = "free" | "exchange" | "paid";
type LetterTpl = { hi: string; me: string; community: string; profile: string; free: string; freeProfile: string; exchange: string; paid: string; join: string; bot: string; partner: string; bye: string };

const LETTERS: Record<string, LetterTpl> = {
  ru: { hi: "Здравствуйте!", me: "Меня зовут {sender}, я представляю {company}.", community: "Пишу по поводу вашего сообщества «{group}»{tp}.", profile: "Пишу по поводу вашего профиля «{group}»{tp}.", free: "Можно ли нам иногда публиковать там полезные для участников посты? Частоту и формат определяете вы, правила соблюдаем.", freeProfile: "Интересно ли вам сотрудничество: пост, сторис или коллаборация на близкую вашей аудитории тему? Формат и частоту определяете вы.", exchange: "Предлагаем взаимный обмен: мы рассказываем о вас в наших каналах, а вы — о нас. Формат и частоту согласуем.", paid: "Нас интересует платное размещение. Подскажите, пожалуйста, стоимость одной публикации и пакета на месяц и требования к оформлению.", join: "Также мы отправили запрос на вступление в группу.", bot: "Удобнее всего добавить нашего бота {bot}: он публикует только согласованное, убрать его можно в любой момент.", partner: "Если вы согласны, отметьте это по ссылке, там же можно указать частоту:", bye: "Спасибо! {sender}" },
  uk: { hi: "Добрий день!", me: "Мене звати {sender}, я представляю {company}.", community: "Пишу щодо вашої спільноти «{group}»{tp}.", profile: "Пишу щодо вашого профілю «{group}»{tp}.", free: "Чи можемо ми інколи публікувати там корисні для учасників дописи? Частоту й формат визначаєте ви, правил дотримуємося.", freeProfile: "Чи цікава вам співпраця: допис, сторіс або колаборація на близьку вашій аудиторії тему? Формат і частоту визначаєте ви.", exchange: "Пропонуємо взаємний обмін: ми розповідаємо про вас у наших каналах, а ви — про нас. Формат і частоту узгодимо.", paid: "Нас цікавить платне розміщення. Підкажіть, будь ласка, вартість однієї публікації та пакета на місяць і вимоги до оформлення.", join: "Також ми надіслали запит на вступ до групи.", bot: "Найзручніше додати нашого бота {bot}: він публікує лише погоджене, прибрати його можна будь-коли.", partner: "Якщо ви згодні, позначте це за посиланням, там же можна вказати частоту:", bye: "Дякуємо! {sender}" },
  en: { hi: "Hello!", me: "My name is {sender}, I represent {company}.", community: "I'm writing about your community \"{group}\"{tp}.", profile: "I'm writing about your profile \"{group}\"{tp}.", free: "Would it be possible for us to share occasional posts useful to your members? You set the frequency and format, and we follow your rules.", freeProfile: "Would you be open to a collaboration: a post, a story or a collab on a topic close to your audience? You set the format and frequency.", exchange: "We'd like to propose a cross-promotion: we feature you in our channels and you feature us. We'll agree on format and frequency.", paid: "We're interested in paid placement. Could you share the price per post and for a monthly package, and any format requirements?", join: "We've also sent a request to join the group.", bot: "The easiest way is to add our bot {bot}: it only posts what we agree on, and you can remove it any time.", partner: "If you agree, please confirm via this link, where you can also set the frequency:", bye: "Thank you! {sender}" },
  es: { hi: "¡Hola!", me: "Me llamo {sender} y represento a {company}.", community: "Le escribo sobre su comunidad «{group}»{tp}.", profile: "Le escribo sobre su perfil «{group}»{tp}.", free: "¿Podríamos compartir de vez en cuando publicaciones útiles para sus miembros? Usted decide la frecuencia y el formato, y respetamos las normas.", freeProfile: "¿Le interesaría colaborar: una publicación, una historia o un collab sobre un tema cercano a su audiencia? Usted decide el formato y la frecuencia.", exchange: "Le proponemos un intercambio: hablamos de usted en nuestros canales y usted de nosotros. Acordamos formato y frecuencia.", paid: "Nos interesa una publicación de pago. ¿Podría indicarnos el precio por publicación y por un paquete mensual, y los requisitos de formato?", join: "También hemos enviado una solicitud para unirnos al grupo.", bot: "Lo más cómodo es añadir nuestro bot {bot}: solo publica lo acordado y puede quitarlo cuando quiera.", partner: "Si está de acuerdo, confírmelo en este enlace, donde también puede fijar la frecuencia:", bye: "¡Gracias! {sender}" },
  cs: { hi: "Dobrý den!", me: "Jmenuji se {sender} a zastupuji {company}.", community: "Píšu ohledně vaší komunity „{group}“{tp}.", profile: "Píšu ohledně vašeho profilu „{group}“{tp}.", free: "Mohli bychom občas sdílet příspěvky užitečné pro vaše členy? Frekvenci a formát určujete vy, pravidla dodržujeme.", freeProfile: "Měli byste zájem o spolupráci: příspěvek, story nebo collab na téma blízké vašemu publiku? Formát a frekvenci určujete vy.", exchange: "Navrhujeme vzájemnou výměnu: my představíme vás v našich kanálech a vy nás. Formát a frekvenci domluvíme.", paid: "Máme zájem o placenou publikaci. Mohli byste nám sdělit cenu za jeden příspěvek a za měsíční balíček a požadavky na formát?", join: "Zároveň jsme poslali žádost o vstup do skupiny.", bot: "Nejjednodušší je přidat našeho bota {bot}: publikuje jen dohodnuté a můžete ho kdykoli odebrat.", partner: "Pokud souhlasíte, potvrďte to prosím přes tento odkaz, kde můžete nastavit i frekvenci:", bye: "Děkuji! {sender}" },
  de: { hi: "Hallo!", me: "Mein Name ist {sender}, ich vertrete {company}.", community: "Ich schreibe Ihnen wegen Ihrer Community „{group}“{tp}.", profile: "Ich schreibe Ihnen wegen Ihres Profils „{group}“{tp}.", free: "Dürften wir gelegentlich Beiträge teilen, die für Ihre Mitglieder nützlich sind? Häufigkeit und Format bestimmen Sie, Ihre Regeln halten wir ein.", freeProfile: "Hätten Sie Interesse an einer Zusammenarbeit: ein Beitrag, eine Story oder ein Collab zu einem Thema, das zu Ihrem Publikum passt? Format und Häufigkeit bestimmen Sie.", exchange: "Wir schlagen einen gegenseitigen Austausch vor: Wir stellen Sie in unseren Kanälen vor und Sie uns. Format und Häufigkeit stimmen wir ab.", paid: "Wir interessieren uns für eine bezahlte Veröffentlichung. Könnten Sie uns den Preis pro Beitrag und für ein Monatspaket sowie die Formatvorgaben nennen?", join: "Wir haben außerdem eine Beitrittsanfrage für die Gruppe gesendet.", bot: "Am einfachsten fügen Sie unseren Bot {bot} hinzu: Er veröffentlicht nur Abgesprochenes und lässt sich jederzeit entfernen.", partner: "Wenn Sie einverstanden sind, bestätigen Sie es bitte über diesen Link, dort können Sie auch die Häufigkeit festlegen:", bye: "Vielen Dank! {sender}" },
  it: { hi: "Buongiorno!", me: "Mi chiamo {sender} e rappresento {company}.", community: "Le scrivo a proposito della sua community «{group}»{tp}.", profile: "Le scrivo a proposito del suo profilo «{group}»{tp}.", free: "Potremmo condividere ogni tanto post utili per i suoi membri? Frequenza e formato li decide lei, e rispettiamo le regole.", freeProfile: "Le interesserebbe una collaborazione: un post, una storia o un collab su un tema vicino al suo pubblico? Formato e frequenza li decide lei.", exchange: "Le proponiamo uno scambio: noi parliamo di lei nei nostri canali e lei di noi. Concordiamo formato e frequenza.", paid: "Ci interessa una pubblicazione a pagamento. Potrebbe indicarci il prezzo per un post e per un pacchetto mensile, e i requisiti di formato?", join: "Abbiamo anche inviato una richiesta di adesione al gruppo.", bot: "Il modo più semplice è aggiungere il nostro bot {bot}: pubblica solo ciò che concordiamo e può rimuoverlo in qualsiasi momento.", partner: "Se è d'accordo, lo confermi a questo link, dove può anche indicare la frequenza:", bye: "Grazie! {sender}" },
  fr: { hi: "Bonjour !", me: "Je m'appelle {sender} et je représente {company}.", community: "Je vous écris au sujet de votre communauté « {group} »{tp}.", profile: "Je vous écris au sujet de votre profil « {group} »{tp}.", free: "Pourrions-nous partager de temps en temps des publications utiles à vos membres ? Vous fixez la fréquence et le format, et nous respectons vos règles.", freeProfile: "Seriez-vous intéressé(e) par une collaboration : une publication, une story ou un collab sur un thème proche de votre audience ? Vous fixez le format et la fréquence.", exchange: "Nous vous proposons un échange : nous vous présentons sur nos canaux et vous nous présentez. Nous convenons ensemble du format et de la fréquence.", paid: "Nous sommes intéressés par une publication payante. Pourriez-vous nous indiquer le prix par publication et pour un forfait mensuel, ainsi que les exigences de format ?", join: "Nous avons également envoyé une demande pour rejoindre le groupe.", bot: "Le plus simple est d'ajouter notre bot {bot} : il ne publie que ce qui est convenu et vous pouvez le retirer à tout moment.", partner: "Si vous êtes d'accord, confirmez-le via ce lien, où vous pouvez aussi fixer la fréquence :", bye: "Merci ! {sender}" },
  pt: { hi: "Olá!", me: "Chamo-me {sender} e represento a {company}.", community: "Escrevo sobre a sua comunidade «{group}»{tp}.", profile: "Escrevo sobre o seu perfil «{group}»{tp}.", free: "Poderíamos partilhar de vez em quando publicações úteis para os seus membros? Você define a frequência e o formato, e respeitamos as regras.", freeProfile: "Teria interesse numa colaboração: uma publicação, um story ou um collab sobre um tema próximo do seu público? Você define o formato e a frequência.", exchange: "Propomos uma troca: falamos de si nos nossos canais e você fala de nós. Combinamos formato e frequência.", paid: "Temos interesse numa publicação paga. Poderia indicar o preço por publicação e por um pacote mensal, e os requisitos de formato?", join: "Também enviámos um pedido para entrar no grupo.", bot: "O mais simples é adicionar o nosso bot {bot}: só publica o combinado e pode removê-lo a qualquer momento.", partner: "Se concordar, confirme neste link, onde também pode definir a frequência:", bye: "Obrigado! {sender}" },
  pl: { hi: "Dzień dobry!", me: "Nazywam się {sender} i reprezentuję {company}.", community: "Piszę w sprawie Państwa społeczności „{group}”{tp}.", profile: "Piszę w sprawie Państwa profilu „{group}”{tp}.", free: "Czy moglibyśmy od czasu do czasu udostępniać posty przydatne dla członków? Częstotliwość i format ustalają Państwo, a my przestrzegamy zasad.", freeProfile: "Czy byliby Państwo zainteresowani współpracą: post, relacja lub collab na temat bliski Państwa odbiorcom? Format i częstotliwość ustalają Państwo.", exchange: "Proponujemy wymianę: my polecamy Państwa w naszych kanałach, a Państwo nas. Format i częstotliwość uzgodnimy.", paid: "Interesuje nas płatna publikacja. Czy mogliby Państwo podać cenę jednego posta i pakietu miesięcznego oraz wymagania dotyczące formatu?", join: "Wysłaliśmy też prośbę o dołączenie do grupy.", bot: "Najprościej dodać naszego bota {bot}: publikuje tylko uzgodnione treści i można go w każdej chwili usunąć.", partner: "Jeśli się Państwo zgadzają, prosimy potwierdzić przez ten link, gdzie można też ustalić częstotliwość:", bye: "Dziękuję! {sender}" },
};
export const LETTER_LANGS = Object.keys(LETTERS);

// The community's own language when we have a letter for it, else English.
export function letterLang(card: Pick<GroupCard, "language">, wanted?: string) {
  const l = String(wanted || card.language || "").toLowerCase().slice(0, 2);
  return LETTERS[l] ? l : "en";
}

// Groups you can join (and so send a join request to); channels and profiles are followed, not joined.
export function joinUrl(card: Pick<GroupCard, "platform" | "kind" | "url">) {
  if (card.platform === "telegram" && card.kind !== "channel") return card.url || undefined;
  if (card.platform === "facebook" && card.kind !== "page") return card.url || undefined;
  return undefined;
}

type LetterSettings = { senderName?: string; companyName?: string };

export function adminLetter(card: GroupCard, kind: OutreachKind = "free", settings: LetterSettings = {}, wanted?: string) {
  const lang = letterLang(card, wanted);
  const t = LETTERS[lang];
  const cyr = (s: string) => /[а-яёіїєґ]/i.test(s);
  // Topic and place were typed by us (often in Russian): mention them only when they read in the letter's script.
  const extra = [card.topic && card.topic !== "разные тематики" ? card.topic : "", [card.city, card.country].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const tp = extra && cyr(extra) === (lang === "ru" || lang === "uk") ? " (" + extra + ")" : "";
  const profile = card.platform === "instagram" || card.platform === "tiktok" || card.kind === "profile";
  const ask = kind === "exchange" ? t.exchange : kind === "paid" ? t.paid : profile ? t.freeProfile : t.free;
  const join = joinUrl(card) ? " " + t.join : "";
  const add = addBotUrl(card);
  const invite = card.platform === "telegram" ? t.bot + "\n" + add : t.partner + "\n" + add;
  const fill = (s: string) => s.replace(/\{sender\}/g, settings.senderName || "—").replace(/\{company\}/g, settings.companyName || "AURELIUS").replace(/\{group\}/g, card.name).replace(/\{tp\}/g, tp).replace(/\{bot\}/g, botHandle());
  const text = fill([t.hi + " " + t.me, (profile ? t.profile : t.community) + " " + ask + join, invite, t.bye].join("\n\n"));
  return { lang, text, contactUrl: contactUrl(card, text), joinUrl: joinUrl(card), addBotUrl: add };
}

export async function outreachDrafts(card: GroupCard, lang?: string) {
  const settings = await loadSettings();
  const free = adminLetter(card, "free", settings, lang);
  return { lang: free.lang, langs: LETTER_LANGS, free: free.text, exchange: adminLetter(card, "exchange", settings, lang).text, paid: adminLetter(card, "paid", settings, lang).text, contactUrl: free.contactUrl, joinUrl: free.joinUrl, addBotUrl: free.addBotUrl };
}

// One-tap link for the group's own admin: Telegram opens "add to group/channel" with posting rights pre-ticked.
// Other networks have no bots in groups, so the admin gets the partner sign-up (consent + limits) instead.
// With the card's id the partner link is personal: the admin taps it and their community is filled in.
export function addBotUrl(card: Pick<GroupCard, "platform" | "kind"> & { id?: string }) {
  const base = "https://t.me/" + botHandle().replace(/^@/, "");
  if (card.platform !== "telegram") return base + "?start=partner" + (card.id && /^[\w-]{1,50}$/.test(card.id) ? "_" + card.id : "");
  return card.kind === "channel" ? base + "?startchannel=true&admin=post_messages" : base + "?startgroup=true&admin=post_messages";
}

// Where the person opens a chat with the admin: a named contact first, else the network's own DM/admin page.
export function contactUrl(card: GroupCard, text = "") {
  const c = (card.adminContact || "").trim();
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(c)) return "mailto:" + c + "?subject=" + encodeURIComponent(card.name) + (text ? "&body=" + encodeURIComponent(text) : "");
  const handle = /^@([\w.]{2,32})$/.exec(c)?.[1];
  const slug = card.url.replace(/\/+$/, "").split("/").pop() || "";
  if (card.platform === "instagram") return "https://ig.me/m/" + (handle || slug);
  if (card.platform === "tiktok") return handle ? "https://www.tiktok.com/@" + handle : card.url;
  if (handle) return "https://t.me/" + handle;
  if (card.platform === "facebook") return card.kind === "page" ? "https://m.me/" + slug : card.url.replace(/\/+$/, "") + "/members/admins";
  return card.url;
}

// ---- Bot added to / removed from a chat ------------------------------------------

export async function handleMyChatMember(update: any) {
  const chat = update?.chat;
  const status = String(update?.new_chat_member?.status || "");
  if (!chat || !["group", "supergroup", "channel"].includes(chat.type)) return null;
  const chatId = String(chat.id);
  const url = chat.username ? "https://t.me/" + chat.username : "";
  const id = url ? stableId("grp", url.toLowerCase()) : stableId("grp", "tg:" + chatId);
  const prev = await getOne<GroupCard>("groups", id);
  const now = nowIso();
  const connected = ["member", "administrator"].includes(status);
  // Posting starts on its own only when a group admin (or channel admin) added the bot.
  let adderIsAdmin = chat.type === "channel";
  if (connected && !adderIsAdmin && update?.from?.id) {
    const member = await tgCall("getChatMember", { chat_id: chatId, user_id: update.from.id });
    adderIsAdmin = ["creator", "administrator"].includes(String(member?.result?.status || ""));
  }
  const card: GroupCard = {
    ...(prev || { id, platform: "telegram", url: url || "", name: chat.title || chatId, ads: "unknown", status: "free", foundAt: now }),
    id, kind: chat.type === "channel" ? "channel" : "group", name: chat.title || prev?.name || chatId, chatId,
    botConnected: connected, postingEnabled: connected ? (prev?.postingEnabled ?? adderIsAdmin) : false,
    status: connected && (!prev || prev.status === "new" || prev.status === "contacted") ? "free" : prev?.status || "free",
    ...(connected && adderIsAdmin && !prev?.permissionConfirmedAt ? { permissionConfirmedAt: now, permissionConfirmedBy: "админ добавил бота" } : {}),
    updatedAt: now,
  } as GroupCard;
  await putOne("groups", card);
  await logAction({ actor: "bot", action: connected ? "groups.bot_added" : "groups.bot_removed", detail: card.name + (connected && !card.postingEnabled ? " (добавил не админ — постинг выключен, включите вручную после согласия админа)" : "") });
  return card;
}

// Explicit registration for already-connected Telegram groups.
// Telegram's my_chat_member event may predate the active webhook, so this
// owner-only command verifies BOTH administrator roles before saving a group.
export async function registerOwnedTelegramGroup(
  chat: { id: string | number; type: string; title?: string; username?: string },
  actorId: string,
): Promise<{ ok: boolean; message: string; group?: GroupCard }> {
  if (!["group", "supergroup", "channel"].includes(chat.type)) {
    return { ok: false, message: "Отправьте /connect внутри Telegram-группы, где бот администратор." };
  }
  const bot = await tgCall("getMe", {});
  const botId = bot?.result?.id;
  if (!bot?.ok || !botId) return { ok: false, message: "Не удалось проверить аккаунт бота через Telegram API." };
  const [owner, member] = await Promise.all([
    tgCall("getChatMember", { chat_id: chat.id, user_id: actorId }),
    tgCall("getChatMember", { chat_id: chat.id, user_id: botId }),
  ]);
  const ownerStatus = String(owner?.result?.status || "");
  const botStatus = String(member?.result?.status || "");
  if (!owner?.ok || !["creator", "administrator"].includes(ownerStatus))
    return { ok: false, message: "Только администратор этой группы может подключить её к публикациям." };
  if (!member?.ok || botStatus !== "administrator")
    return { ok: false, message: "AURELIUS пока не администратор этой группы. Назначьте его администратором и повторите /connect." };
  const card = await handleMyChatMember({
    chat,
    from: { id: Number(actorId) },
    new_chat_member: { status: "administrator" },
  });
  if (!card || !card.botConnected) return { ok: false, message: "Telegram-группа не зарегистрирована. Проверьте webhook и Redis." };
  return { ok: true, message: card.postingEnabled
    ? "✅ Группа зарегистрирована. Постинг разрешён только после тестового подтверждения владельца."
    : "✅ Группа зарегистрирована, но постинг выключен. Включите его в панели только после подтверждения прав.", group: card };
}

// ---- Posting through the Bot API ---------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function postingTargets() {
  return (await listGroups()).filter((g) => g.platform === "telegram" && g.botConnected && g.postingEnabled && g.chatId);
}

export async function sendPhoto(chatId: string, photo: string, caption: string) {
  return tgCall("sendPhoto", { chat_id: await resolveChatId(chatId), photo, caption: caption.slice(0, 1024) });
}

export function messageLink(card: GroupCard, messageId?: number) {
  if (!messageId) return undefined;
  if (card.url && !card.url.includes("/+")) return card.url + "/" + messageId;
  const id = String(card.chatId || "").replace(/^-100/, "");
  return /^\d+$/.test(id) ? "https://t.me/c/" + id + "/" + messageId : undefined;
}

// Sends one post to every chat where an admin added the bot and posting is on.
// Paced at ~3 s per chat (Telegram allows about 20 messages a minute into groups) and capped per chat per day.
export async function postViaBot(text: string, photo?: string, by = "dashboard", deadlineAt = Date.now() + 270_000, pauseMs = 3000) {
  const body = text.trim().slice(0, 4000);
  if (!body) return { ok: false, sent: 0, failed: 0, skipped: 0, message: "Пустой текст." };
  if (!botToken()) return { ok: false, sent: 0, failed: 0, skipped: 0, message: "Бот не настроен (TELEGRAM_BOT_TOKEN)." };
  const targets = await postingTargets();
  let sent = 0, failed = 0, skipped = 0;
  for (const [index, card] of targets.entries()) {
    if (Date.now() > deadlineAt) { skipped += targets.length - index; break; }
    const key = "grp-post:" + card.id + ":" + today();
    const limit = card.dailyLimit ?? DEFAULT_DAILY_LIMIT;
    if ((await readCounter(key)) >= limit) { skipped += 1; continue; }
    const result = photo ? await sendPhoto(card.chatId!, photo, body) : await sendMessage(card.chatId!, body).then((r) => ({ ok: r.ok, result: { message_id: r.messageId }, description: r.error }));
    const entry: PostLog = { id: randomId("post"), at: nowIso(), groupId: card.id, groupName: card.name, platform: "telegram", mode: "bot", status: result?.ok ? "sent" : "failed", text: body.slice(0, 300), by };
    if (result?.ok) { sent += 1; await increment(key, 2 * 24 * 3600); entry.link = messageLink(card, result?.result?.message_id); }
    else {
      failed += 1;
      entry.error = String(result?.description || "ошибка").slice(0, 200);
      // Removed from the chat or lost rights: stop posting there.
      if (/kicked|not a member|chat not found|have no rights|not enough rights/i.test(entry.error)) await putOne("groups", { ...card, botConnected: false, postingEnabled: false, updatedAt: nowIso() });
    }
    await putOne("group_posts", entry);
    if (pauseMs && index < targets.length - 1) await new Promise((r) => setTimeout(r, pauseMs));
  }
  await logAction({ actor: by === "dashboard" ? "human" : "bot", action: "groups.post", detail: "отправлено " + sent + ", ошибок " + failed + ", пропущено (лимит) " + skipped });
  return { ok: true, sent, failed, skipped, message: targets.length ? "Отправлено: " + sent + ", ошибок: " + failed + (skipped ? ", пропущено по дневному лимиту: " + skipped : "") : "Нет групп, куда бот может публиковать. Попросите админов добавить бота и включите «Постинг»." };
}

// ---- Manual queue (client's own real accounts) -------------------------------------

export async function queueManual(text: string, groupIds: string[] | "all", photoUrl?: string) {
  const body = text.trim().slice(0, 4000);
  if (!body) return { ok: false, added: 0, message: "Пустой текст." };
  // Publicly indexed IG/TikTok profiles and discovered groups are NOT
  // advertising permissions. Never create even a manual placement task before
  // an owner has recorded the administrator/partner agreement.
  const groups = (await listGroups()).filter((g) =>
    (groupIds === "all" || groupIds.includes(g.id)) &&
    !(g.botConnected && g.postingEnabled) &&
    permissionConfirmed(g) &&
    g.ads !== "forbidden"
  );
  const now = nowIso();
  const items: QueueItem[] = groups.map((g) => ({ id: randomId("q"), groupId: g.id, groupName: g.name, platform: g.platform, url: g.url, text: body, photoUrl: photoUrl || undefined, status: "pending", createdAt: now }));
  await putMany("group_queue", items);
  await logAction({ actor: "human", action: "groups.queue", detail: items.length + " постов в очереди" });
  return { ok: true, added: items.length, message: items.length ? "В очереди " + items.length + " постов. Публикуйте по одному: «Открыть группу» → вставить текст → «Опубликовал»." : "Нет подходящих групп для очереди." };
}

export async function listQueue() {
  return (await listAll<QueueItem>("group_queue")).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function markQueued(id: string, status: "published" | "skipped", by = "dashboard") {
  const item = await getOne<QueueItem>("group_queue", id);
  if (!item || item.status !== "pending") return null;
  const done: QueueItem = { ...item, status, doneAt: nowIso(), doneBy: by };
  await putOne("group_queue", done);
  // Campaign tasks reuse the queue item id, so the campaign report sees the same result.
  const task = await getOne<{ id: string; status: string }>("campaign_tasks", id);
  if (task) await putOne("campaign_tasks", { ...task, status: status === "published" ? "verified" : "skipped", updatedAt: nowIso() });
  await putOne("group_posts", { id: randomId("post"), at: done.doneAt!, groupId: item.groupId, groupName: item.groupName, platform: item.platform, mode: "manual", status, text: item.text.slice(0, 300), by } satisfies PostLog);
  return done;
}

// ---- Log and report -----------------------------------------------------------------

export async function listPosts(limit = 300) {
  return (await listAll<PostLog>("group_posts")).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export async function postingSummary() {
  const posts = await listPosts(2000);
  const day = today();
  const todays = posts.filter((p) => p.at.startsWith(day));
  const count = (pred: (p: PostLog) => boolean) => todays.filter(pred).length;
  const groups = await listGroups();
  const queue = await listQueue();
  return {
    today: { bot: count((p) => p.mode === "bot" && p.status === "sent"), manual: count((p) => p.mode === "manual" && p.status === "published"), failed: count((p) => p.status === "failed") },
    groups: { total: groups.length, telegram: groups.filter((g) => g.platform === "telegram").length, facebook: groups.filter((g) => g.platform === "facebook").length, botReady: groups.filter((g) => g.botConnected && g.postingEnabled).length, paid: groups.filter((g) => g.status === "paid").length },
    queuePending: queue.filter((q) => q.status === "pending").length,
  };
}

// ---- Excel ---------------------------------------------------------------------------

export const PLATFORM_LABEL: Record<Platform, string> = { telegram: "Telegram", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok" };
const ADS_LABEL: Record<AdsPolicy, string> = { allowed: "разрешена", admin: "через админа", paid: "платно", forbidden: "запрещена", unknown: "не указано" };
export const ACTIVITY_LABEL: Record<"active" | "inactive" | "unknown", string> = { active: "активна", inactive: "неактивна — исключена из размещения", unknown: "не проверено (нет публичной ленты)" };
const STATUS_LABEL: Record<GroupStatus, string> = { new: "новая", contacted: "запрос отправлен", replied: "админ ответил", free: "бесплатно", exchange: "обмен", paid: "платно", declined: "отказ" };
export { ADS_LABEL, STATUS_LABEL };

export async function groupsXlsx(groups: GroupCard[], posts: PostLog[] = [], tasks: CampaignTask[] = []) {
  const mod: any = await import("exceljs");
  const ExcelJS: any = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AURELIUS";
  const safe = (v: unknown) => { const s = String(v ?? ""); return /^[=+\-@]/.test(s) ? "'" + s : s; };
  // Summary first: what is in the file and how to read it.
  const sum = wb.addWorksheet("Сводка", { views: [{ showGridLines: false }] });
  sum.columns = [{ key: "k", width: 34 }, { key: "v", width: 70 }];
  const count = (f: (g: GroupCard) => boolean) => groups.filter(f).length;
  const summaryRows: Array<[string, string | number]> = [
    ["AURELIUS · база сообществ", "выгружено " + new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    ["Сообществ всего", groups.length],
    ...(["telegram", "facebook", "instagram", "tiktok"] as Platform[]).map((p): [string, number] => ["  " + PLATFORM_LABEL[p], count((g) => g.platform === p)]),
    ["Профильных / смежных", count((g) => g.relevance !== "adjacent") + " / " + count((g) => g.relevance === "adjacent")],
    ["Активных / неактивных / не проверено", count((g) => g.activity === "active") + " / " + count((g) => g.activity === "inactive") + " / " + count((g) => !g.activity || g.activity === "unknown")],
    ["Реклама разрешена / через админа / платно / запрещена", count((g) => g.ads === "allowed") + " / " + count((g) => g.ads === "admin") + " / " + count((g) => g.ads === "paid") + " / " + count((g) => g.ads === "forbidden")],
    ["Бот подключён (публикует сам)", count((g) => Boolean(g.botConnected && g.postingEnabled))],
    ["Записей в журнале публикаций", posts.length],
    ["Размещений кампаний", tasks.length],
    ["", ""],
    ["Как читать", "Лист «Группы» — база. Фильтр стоит на каждом столбце (стрелка в заголовке)."],
    ["Цвета", "Зелёный — можно / активно / опубликовано. Жёлтый — нужно согласование или не проверено. Красный — нельзя, неактивно или ошибка."],
    ["Неактивные", "Исключены из размещения автоматически. «Не проверено» — у группы нет публичной ленты (закрытые группы, Facebook, Instagram, TikTok)."],
  ];
  for (const [k, v] of summaryRows) sum.addRow({ k, v: String(v) });
  sum.pageSetup = { fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  sum.getRow(1).font = { bold: true, size: 14 };
  sum.eachRow((row: any, n: number) => { if (n > 1) { row.getCell(1).font = { bold: true, size: 10 }; row.getCell(2).alignment = { wrapText: true, vertical: "top" }; } });
  const ws = wb.addWorksheet("Группы");
  // TZ 1.2 §3 order: what it is, where, how alive, ad rules, then our work fields.
  ws.columns = [
    { header: "Платформа", key: "platform", width: 13 }, { header: "Название", key: "name", width: 34 }, { header: "Ссылка", key: "url", width: 36 },
    { header: "Тип", key: "kind", width: 10 }, { header: "Язык", key: "language", width: 9 }, { header: "Страна", key: "country", width: 13 }, { header: "Город", key: "city", width: 14 },
    { header: "Участники", key: "members", width: 13, style: { numFmt: "#,##0" } }, { header: "Активность", key: "activity", width: 22 }, { header: "Последний пост", key: "lastPost", width: 15 }, { header: "Постов в неделю", key: "perWeek", width: 12 },
    { header: "Реклама по правилам", key: "ads", width: 16 }, { header: "Контакт админа", key: "admin", width: 20 },
    { header: "Релевантность", key: "relevance", width: 16 }, { header: "Найдено по запросу", key: "foundBy", width: 28 }, { header: "Тема", key: "topic", width: 18 },
    { header: "Статус работы", key: "status", width: 16 }, { header: "Бот в группе", key: "bot", width: 13 }, { header: "Цена поста", key: "price", width: 11 }, { header: "Валюта", key: "currency", width: 10 },
    { header: "Заметки", key: "notes", width: 30 },
  ];
  for (const g of groups) ws.addRow({ platform: PLATFORM_LABEL[g.platform], kind: g.kind === "channel" ? "канал" : g.kind === "profile" ? "профиль" : g.kind === "page" ? "страница" : "группа", name: safe(g.name), url: g.url ? { text: g.url, hyperlink: g.url } : "", members: g.members ?? "", ads: ADS_LABEL[g.ads], admin: safe(g.adminContact || ""), country: safe(g.country || ""), city: safe(g.city || ""), topic: safe(g.topic || ""), status: STATUS_LABEL[g.status] || g.status, price: g.price ?? "", currency: g.currency || (g.price ? "EUR" : ""), bot: g.botConnected ? (g.postingEnabled ? "да, постинг вкл." : "да") : "", notes: safe(g.notes || ""),
    language: g.language || "", relevance: g.relevance === "adjacent" ? "смежное" : g.relevance === "core" ? "профильное" : "", foundBy: safe(g.foundBy || ""),
    activity: ACTIVITY_LABEL[g.activity || "unknown"], lastPost: (g.lastPostAt || "").slice(0, 10), perWeek: g.postsPerWeek ?? "" });
  styleSheet(ws, { statusColumns: ["ads", "status", "relevance", "activity", "bot"], title: "база сообществ" });
  // One personal request per community, ready to copy, with where to send it and its status.
  const asks = groups.filter((g) => g.status !== "declined" && !g.botConnected);
  if (asks.length) {
    const settings = await loadSettings();
    const rq = wb.addWorksheet("Запросы админам");
    rq.columns = [{ header: "Платформа", key: "platform", width: 11 }, { header: "Сообщество", key: "name", width: 30 }, { header: "Язык письма", key: "lang", width: 8 }, { header: "Статус запроса", key: "status", width: 17 }, { header: "Отправлен", key: "sent", width: 11 }, { header: "Ответ", key: "replied", width: 11 }, { header: "Написать админу", key: "contact", width: 34 }, { header: "Вступить", key: "join", width: 30 }, { header: "Письмо", key: "text", width: 90 }];
    for (const g of asks) {
      const l = adminLetter(g, "free", settings);
      rq.addRow({ platform: PLATFORM_LABEL[g.platform], name: safe(g.name), lang: l.lang, status: STATUS_LABEL[g.status] || g.status, sent: (g.requestSentAt || "").slice(0, 10), replied: (g.repliedAt || "").slice(0, 10), contact: { text: l.contactUrl.slice(0, 80), hyperlink: l.contactUrl }, join: l.joinUrl ? { text: l.joinUrl, hyperlink: l.joinUrl } : "", text: safe(l.text) });
    }
    styleSheet(rq, { statusColumns: ["status"], title: "запросы админам" });
  }
  if (posts.length) {
    const log = wb.addWorksheet("Журнал публикаций");
    log.columns = [{ header: "Время (UTC)", key: "at", width: 20 }, { header: "Группа", key: "group", width: 32 }, { header: "Платформа", key: "platform", width: 11 }, { header: "Способ", key: "mode", width: 14 }, { header: "Статус", key: "status", width: 12 }, { header: "Ссылка", key: "link", width: 36 }, { header: "Текст", key: "text", width: 60 }, { header: "Ошибка", key: "error", width: 30 }];
    for (const p of posts) log.addRow({ at: p.at.replace("T", " ").slice(0, 19), group: safe(p.groupName), platform: p.platform, mode: p.mode === "bot" ? "бот" : "вручную", status: { sent: "отправлено", failed: "ошибка", published: "опубликовано", skipped: "пропущено" }[p.status], link: p.link || "", text: safe(p.text), error: safe(p.error || "") });
    styleSheet(log, { statusColumns: ["status"], title: "журнал публикаций" });
  }
  if (tasks.length) {
    const ct = wb.addWorksheet("Размещения кампаний");
    ct.columns = [{ header: "День", key: "day", width: 11 }, { header: "Кампания", key: "campaign", width: 30 }, { header: "Площадка", key: "group", width: 32 }, { header: "Платформа", key: "platform", width: 11 }, { header: "Способ", key: "mode", width: 12 }, { header: "Статус", key: "status", width: 14 }, { header: "Ссылка на пост", key: "proof", width: 40 }, { header: "Ссылка на площадку", key: "url", width: 40 }];
    const MODE: Record<string, string> = { bot: "бот", partner: "админ-партнёр", manual: "вручную" };
    const TASK_STATUS: Record<string, string> = { scheduled: "запланировано", sent: "опубликовано ботом", failed: "ошибка", notified: "ждёт партнёра", proof: "ждёт проверки", verified: "засчитано", skipped: "пропущено", cancelled: "отменено" };
    for (const t of [...tasks].sort((a, b) => b.day.localeCompare(a.day))) ct.addRow({ day: t.day, campaign: safe(t.campaignTitle), group: safe(t.groupName), platform: PLATFORM_LABEL[t.platform] || t.platform, mode: MODE[t.mode] || t.mode, status: TASK_STATUS[t.status] || t.status, proof: t.link || "", url: t.url || "" });
    styleSheet(ct, { statusColumns: ["status"], title: "размещения кампаний" });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Everything the TZ asks to export: communities base, publishing log, campaign placements.
// Spreadsheet-safe CSV cell: neutralises formula injection and quotes separators.
function csvCell(v: string | number) {
  const raw = String(v);
  const s = /^[=+\-@]/.test(raw) ? "'" + raw : raw;
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// CSV of the community base (TZ 1.2 §6: CSV / Google Sheets — File → Import in Sheets).
export function groupsCsv(groups: GroupCard[]) {
  const head = ["Платформа", "Тип", "Название", "Ссылка", "Язык", "Страна", "Город", "Участники", "Активность", "Последний пост", "Постов в неделю", "Реклама по правилам", "Контакт админа", "Релевантность", "Найдено по запросу", "Статус", "Бот в группе"];
  const cell = csvCell;
  const rows = groups.map((g) => [PLATFORM_LABEL[g.platform], g.kind === "channel" ? "канал" : g.kind === "profile" ? "профиль" : g.kind === "page" ? "страница" : "группа", g.name, g.url, g.language || "", g.country || "", g.city || "", g.members ?? "",
    ACTIVITY_LABEL[g.activity || "unknown"], (g.lastPostAt || "").slice(0, 10), g.postsPerWeek ?? "", ADS_LABEL[g.ads] || g.ads, g.adminContact || "", g.relevance === "adjacent" ? "смежное" : "профильное", g.foundBy || "", STATUS_LABEL[g.status] || g.status, g.botConnected ? "да" : ""]);
  // BOM so Excel and Google Sheets read Cyrillic correctly.
  return "\uFEFF" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export function postsCsv(posts: PostLog[]) {
  const cell = csvCell;
  const head = ["Время", "Группа", "Площадка", "Способ", "Статус", "Ссылка", "Ошибка", "Кто"];
  return "\uFEFF" + [head, ...posts.map((p) => [p.at, p.groupName, PLATFORM_LABEL[p.platform], p.mode === "bot" ? "бот" : "вручную/партнёр", p.status, p.link || "", p.error || "", p.by || ""])].map((r) => r.map(cell).join(",")).join("\r\n");
}

export async function fullExportXlsx() {
  return groupsXlsx(await listGroups(), await listPosts(2000), await listAll<CampaignTask>("campaign_tasks"));
}
