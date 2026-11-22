import { geminiSearch } from "@/lib/gemini-search";
import { dataForSeoEnabled, dataForSeoSearch } from "@/lib/scout/dataforseo-groups";
import { tgStatEnabled, tgStatSearch } from "@/lib/scout/tgstat";
import { runKeylessSearch } from "@/lib/keyless-search";
import { isSafePublicUrl } from "@/lib/url-safety";
import { botHandle, loadSettings } from "@/lib/scout/config";
import { getOne, increment, listAll, logAction, putMany, putOne, readCounter } from "@/lib/scout/store";
import { botToken, resolveChatId, sendMessage, tgCall } from "@/lib/scout/telegram";
import { detectLang, nowIso, randomId, stableId } from "@/lib/scout/text";

// Group finder and compliant posting.
// - Finds public Telegram and Facebook groups/channels for a place and topic, using
//   search results and the groups' own public pages (no login, no scraping behind walls).
// - Posts with the official Bot API only into chats where an admin added the bot.
// - Everything else (Facebook, groups without the bot) goes into a queue that a real
//   person publishes from their own account, one confirmed post at a time.
// There is deliberately no account farm, no human imitation and no automated posting
// from personal accounts: those break Telegram/Facebook rules and get accounts banned.

export type Platform = "telegram" | "facebook" | "instagram" | "tiktok";
export type AdsPolicy = "allowed" | "paid" | "forbidden" | "unknown";
export type GroupStatus = "new" | "contacted" | "free" | "exchange" | "paid" | "declined";

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
  return "https://t.me/" + name;
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
  if (/прайс|price list|стоимость размещ|платн\w* размещ|по рекламе|по вопросам рекламы|реклама\s*[:—-]|for ads|advertising\s*[:—-]|ads\s*[:—-]|publicidad\s*[:—-]|tarifas/i.test(t)) return "paid";
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
export type PublicPost = { url: string; text: string; at?: string; views?: number };
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
    });
  }
  return out;
}

export const INACTIVE_DAYS = () => Math.max(1, Number(process.env.INACTIVE_DAYS || 30) || 30);

// Liveness from the dates of recent posts: last post and posts per week. Unknown when the page has no feed.
export function activityFromPosts(posts: PublicPost[], now = Date.now()) {
  const dates = posts.map((p) => Date.parse(p.at || "")).filter(Number.isFinite).sort((a, b) => b - a);
  if (!dates.length) return { activity: "unknown" as const };
  const last = dates[0];
  const spanDays = Math.max(1, (last - dates[dates.length - 1]) / 86_400_000);
  const postsPerWeek = Math.round((dates.length / spanDays) * 7 * 10) / 10;
  const activity: "active" | "inactive" = (now - last) / 86_400_000 > INACTIVE_DAYS() ? "inactive" : "active";
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
  const updated = await inBatches(stale, 10, async (g) => ({ ...g, ...activityFromPosts(await telegramFeed(g.url)), activityCheckedAt: nowIso() }));
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
};
export type PlatformQuery = { platform: Platform; query: string };

function placeOf(input: FindInput) {
  return [input.city, input.country].filter(Boolean).join(", ");
}

// One query per chosen platform is tried first, before second-round variants.
// This prevents a slow or blocked Telegram search from starving Instagram and
// TikTok results. We never use API access to users' private accounts.
export function platformSearchQueries(input: FindInput): PlatformQuery[] {
  const requested: Platform[] = (input.platforms?.length ? input.platforms : (["telegram", "instagram", "tiktok", "facebook"] as Platform[]))
    .filter((p, i, a) => (["telegram", "instagram", "tiktok", "facebook"] as Platform[]).includes(p) && a.indexOf(p) === i);
  const geo = placeOf(input);
  const polish = /поль|poland|polska|polsce|polski/i.test(geo);
  const es = /испан|spain|españa|espa|valencia|валенси|barcelona|барселон/i.test(geo);
  const topic = input.topic.trim().slice(0, 160);
  // Common multilingual variations; other topics still use the exact owner
  // keyword and the upstream LLM's approved translated campaign queries.
  const realEstate = /недвиж|квартир|жиль|inmobil|apartam|pisos?|real estate|property|mieszkan/i.test(topic);
  const flowers = /цвет|квіт|flor|flower|kwiat|букет/i.test(topic);
  const localTopic = realEstate ? (polish ? "nieruchomości mieszkania" : es ? "inmobiliaria pisos apartamentos" : "real estate apartments")
    : flowers ? (polish ? "kwiaty bukiety" : es ? "flores ramos" : "flowers bouquets") : topic;
  const phrase = [localTopic, geo].filter(Boolean).join(" ");
  const variants: Record<Platform, string[]> = {
    telegram: [
      "Telegram groups channels " + phrase + " t.me",
      (polish ? "grupy kanały" : es ? "grupos canales" : "groups communities") + " Telegram " + topic + " " + geo + " t.me",
    ],
    instagram: [
      "Instagram creators accounts " + phrase + " instagram.com",
      (polish ? "profile firmy" : es ? "cuentas creadores negocios" : "business creators profiles") + " Instagram " + topic + " " + geo,
    ],
    tiktok: [
      "TikTok creators profiles " + phrase + " tiktok.com/@",
      (polish ? "twórcy" : es ? "creadores cuentas" : "creators accounts") + " TikTok " + topic + " " + geo,
    ],
    facebook: [
      "Facebook groups " + phrase + " facebook.com/groups",
      (polish ? "grupy" : es ? "grupos" : "groups communities") + " Facebook " + topic + " " + geo,
    ],
  };
  return [0, 1].flatMap((round) => requested.map((platform) => ({
    platform, query: variants[platform][round].replace(/\s+/g, " ").trim(),
  })));
}

export function groupQueries(input: FindInput) {
  return platformSearchQueries(input).map((q) => q.query);
}

function listPrompt(input: FindInput) {
  const wanted = (input.platforms?.length ? input.platforms : ["telegram", "instagram", "tiktok", "facebook"]).join(", ");
  return "Find existing PUBLIC topic-relevant community/profile URLs for " + input.topic +
    " in " + (placeOf(input) || "the requested location") + " on " + wanted +
    ". Telegram groups/channels use t.me links. Instagram accounts use instagram.com/username. TikTok creators use tiktok.com/@username. Facebook groups use facebook.com/groups/id." +
    " Return names and direct real URLs only, do not invent URLs or claim access to private groups. Public profile is NOT permission to advertise.";
}

export type FindOutcome = { found: GroupCard[]; added: number; checked: number; notes: string[] };

export async function findGroups(input: FindInput, deadlineAt = Date.now() + 45_000): Promise<FindOutcome> {
  const notes: string[] = [];
  const selected: Platform[] = input.platforms?.length ? [...new Set(input.platforms)] : ["telegram", "instagram", "tiktok", "facebook"];
  const descriptors = platformSearchQueries({ ...input, platforms: selected });
  const queries = descriptors.map((q) => q.query);
  const polish = /поль|poland|polska|polsce|polski/i.test(placeOf(input));
  const onePerPlatform = descriptors.filter((d, i) => descriptors.findIndex((v) => v.platform === d.platform) === i);
  const paidQueries = onePerPlatform.slice(0, 4); // billing limit per search run
  const [paid, keyless, tgstat] = await Promise.all([
    dataForSeoEnabled()
      ? Promise.all(paidQueries.map((d) => dataForSeoSearch(d.query, input.country || input.city || "", polish ? "pl" : "en")))
      : Promise.resolve([]),
    runKeylessSearch(queries, polish ? "pl" : "en", Math.min(deadlineAt, Date.now() + 19_000)).catch(() => []),
    selected.includes("telegram") && tgStatEnabled()
      ? tgStatSearch(input.topic, input.country || "")
      : Promise.resolve({ ok: false, urls: [], source: "tgstat" as const }),
  ]);
  for (const result of paid) if (!result.ok && result.message) notes.push(result.message);
  const paidHits = paid.flatMap((result, i) => result.hits.map((h) => ({ ...h, sourceQuery: paidQueries[i].query })));
  const keylessHits = keyless.flatMap((result) => result.hits.map((h) => ({ ...h, sourceQuery: result.query || "" })));
  const visibleHits = [...paidHits, ...keylessHits];
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
    : await Promise.all(fallbackQueries.map((q) => geminiSearch(q.query, polish ? "pl" : input.language || "en", listPrompt(input))));
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
  const topicWords = (input.topic + " " + (input.city || "") + " " + (input.country || "")).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
  const relevant = (text: string) => { const t = text.toLowerCase(); return topicWords.some((w) => t.includes(w)); };
  const base = { country: input.country || undefined, city: input.city || undefined, topic: input.topic, status: "new" as GroupStatus, foundAt: now, updatedAt: now, relevance: input.relevance || "core", foundBy: [input.topic, placeOf(input)].filter(Boolean).join(" · ") };
  const excluded = (text: string) => { const t = text.toLowerCase(); return (input.exclusions || []).some((x) => x && t.includes(x.toLowerCase())); };

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
    const live = feed.length ? { ...activityFromPosts(feed), activityCheckedAt: now } : { activity: "unknown" as const };
    return { ...base, ...live, foundBy: meta.sourceQuery, verification: "public_page", id: stableId("grp", url.toLowerCase()), platform: "telegram", kind: preview.kind, url, name: preview.title, members: preview.members, description: preview.description.slice(0, 600), ads: detectAdsPolicy(text), adminContact: detectAdminContact(preview.description, url), language: detectLang(preview.title + " " + preview.description + " " + feed.slice(0, 3).map((p) => p.text).join(" "), (input.language as any) || "en") };
  });

  const fbList = [...facebook.entries()].slice(0, 30);
  const fbCards = await inBatches(fbList, 10, async ([url, meta]): Promise<GroupCard | null> => {
    const preview = Date.now() < deadlineAt ? parseFacebookPreview(await fetchHtml(url, 6000)) : null;
    const name = preview?.title || meta.title.replace(/\s*[|·-]\s*Facebook.*$/i, "").trim();
    if (!name) return null;
    const text = (preview?.description || "") + "\n" + meta.snippet;
    if (excluded(name + " " + text)) return null;
    return { ...base, foundBy: meta.sourceQuery, verification: preview ? "public_page" : "indexed_candidate", activity: "unknown", language: detectLang(name + " " + text, (input.language as any) || "en"), id: stableId("grp", url.toLowerCase()), platform: "facebook", kind: "group", url, name, members: preview?.members ?? parseMembers(meta.snippet), description: text.trim().slice(0, 600), ads: detectAdsPolicy(text), adminContact: detectAdminContact(text, url) };
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
        language: detectLang(name + " " + meta.snippet, (input.language as any) || "en"),
      }];
    });
  const instagramCards = makeProfiles("instagram", instagram);
  const tiktokCards = makeProfiles("tiktok", tiktok);
  const found = [...tgCards, ...fbCards, ...instagramCards, ...tiktokCards].filter(Boolean) as GroupCard[];
  const saved = await upsertGroups(found);
  if (!found.length && !notes.length) notes.push("Поиск не вернул публичных групп. Попробуйте другую формулировку темы или город на местном языке.");
  await logAction({ actor: "agent", action: "groups.find", detail: input.topic + " · " + placeOf(input) + " → " + found.length + " (новых " + saved.added + ")" });
  return { found: saved.cards.sort((a, b) => (b.members || 0) - (a.members || 0)), added: saved.added, checked: telegram.size + facebook.size + instagram.size + tiktok.size, notes };
}

// Keeps what the user already filled in (status, price, notes, posting switch, bot link).
export async function upsertGroups(cards: GroupCard[]) {
  let added = 0;
  const out: GroupCard[] = [];
  for (const card of cards) {
    const prev = await getOne<GroupCard>("groups", card.id);
    if (!prev) added += 1;
    out.push(prev ? { ...card, relevance: prev.relevance === "core" ? "core" : card.relevance, foundBy: prev.foundBy || card.foundBy, partnerTelegramId: prev.partnerTelegramId, minDaysBetween: prev.minDaysBetween, permissionNote: prev.permissionNote, status: prev.status, price: prev.price, currency: prev.currency, notes: prev.notes, chatId: prev.chatId, botConnected: prev.botConnected, postingEnabled: prev.postingEnabled, dailyLimit: prev.dailyLimit, adminContact: prev.adminContact || card.adminContact, foundAt: prev.foundAt } : card);
  }
  await putMany("groups", out);
  return { cards: out, added };
}

export async function listGroups() {
  return (await listAll<GroupCard>("groups")).sort((a, b) => Number(Boolean(b.botConnected)) - Number(Boolean(a.botConnected)) || (b.members || 0) - (a.members || 0));
}

const STATUSES = new Set<GroupStatus>(["new", "contacted", "free", "exchange", "paid", "declined"]);

export async function updateGroup(id: string, patch: Partial<Pick<GroupCard, "status" | "price" | "currency" | "notes" | "adminContact" | "postingEnabled" | "dailyLimit" | "partnerTelegramId" | "minDaysBetween" | "permissionNote">>) {
  const card = await getOne<GroupCard>("groups", id);
  if (!card) return null;
  const next: GroupCard = { ...card, updatedAt: nowIso() };
  if (patch.status && STATUSES.has(patch.status)) next.status = patch.status;
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

// A placement added by hand: an Instagram/TikTok/Facebook partner or a Telegram chat the admin agreed on.
export async function addGroupManually(input: { url: string; pending?: boolean; name?: string; partnerTelegramId?: string; dailyLimit?: number; minDaysBetween?: number; permissionNote?: string; topic?: string; city?: string; country?: string }) {
  const found = platformOfUrl(input.url);
  if (!found) return null;
  const now = nowIso();
  const id = stableId("grp", found.url.toLowerCase());
  const prev = await getOne<GroupCard>("groups", id);
  const card: GroupCard = { ...(prev || { id, platform: found.platform, url: found.url, name: input.name || found.url.split("/").pop() || found.url, ads: "allowed", status: "free", foundAt: now }), updatedAt: now } as GroupCard;
  if (input.name) card.name = input.name.slice(0, 120);
  // Self-registered partner: nothing goes there until the owner confirms (status → free).
  if (input.pending && (!prev || ["new", "contacted", "declined"].includes(prev.status))) { card.status = "contacted"; card.ads = "unknown"; }
  for (const k of ["topic", "city", "country"] as const) if (input[k]) card[k] = String(input[k]).slice(0, 80);
  await putOne("groups", card);
  return updateGroup(id, { partnerTelegramId: input.partnerTelegramId, dailyLimit: input.dailyLimit, minDaysBetween: input.minDaysBetween, permissionNote: input.permissionNote });
}

// ---- Admin outreach drafts -------------------------------------------------------

export type OutreachKind = "free" | "exchange" | "paid";
type OLang = "ru" | "en" | "es";

const OUTREACH: Record<OLang, Record<OutreachKind, string>> = {
  ru: {
    free: "Здравствуйте! Я {sender} из {company}. Мы публикуем проверенные объявления о недвижимости ({topic}, {place}). Можно ли иногда размещать их в «{group}»? Готовы соблюдать правила группы и частоту, которую вы укажете. Если удобно, вы можете добавить нашего бота {bot} — он будет публиковать только согласованное.",
    exchange: "Здравствуйте! Я {sender} из {company}. Предлагаем взаимный обмен: мы публикуем анонс «{group}» в наших каналах, а вы — наши объявления о недвижимости ({topic}, {place}). Частоту и формат согласуем, правила группы соблюдаем.",
    paid: "Здравствуйте! Я {sender} из {company}. Интересует платное размещение объявлений о недвижимости ({topic}, {place}) в «{group}». Подскажите, пожалуйста, стоимость одного поста и пакета на месяц и есть ли требования к оформлению.",
  },
  en: {
    free: "Hello! I'm {sender} from {company}. We share verified real-estate listings ({topic}, {place}). Could we post them in \"{group}\" from time to time? We'll follow your rules and the frequency you set. If convenient, you can add our bot {bot} — it only posts what we agree on.",
    exchange: "Hello! I'm {sender} from {company}. We'd like to propose a cross-promotion: we feature \"{group}\" in our channels and you share our real-estate listings ({topic}, {place}). We'll agree on frequency and format and follow your rules.",
    paid: "Hello! I'm {sender} from {company}. We're interested in paid placement of real-estate listings ({topic}, {place}) in \"{group}\". Could you share the price per post and for a monthly package, and any format requirements?",
  },
  es: {
    free: "¡Hola! Soy {sender} de {company}. Publicamos anuncios inmobiliarios verificados ({topic}, {place}). ¿Podríamos compartirlos de vez en cuando en «{group}»? Respetaremos las normas y la frecuencia que nos indique. Si le resulta cómodo, puede añadir nuestro bot {bot}: solo publica lo acordado.",
    exchange: "¡Hola! Soy {sender} de {company}. Le proponemos un intercambio: anunciamos «{group}» en nuestros canales y usted comparte nuestros anuncios inmobiliarios ({topic}, {place}). Acordamos frecuencia y formato, respetando las normas.",
    paid: "¡Hola! Soy {sender} de {company}. Nos interesa publicar anuncios inmobiliarios de pago ({topic}, {place}) en «{group}». ¿Podría indicarnos el precio por publicación y por un paquete mensual, y si hay requisitos de formato?",
  },
};

export async function outreachDrafts(card: GroupCard, lang: OLang = "ru") {
  const settings = await loadSettings();
  const bot = botHandle();
  const fill = (tpl: string) => tpl
    .replace(/\{sender\}/g, settings.senderName || "—")
    .replace(/\{company\}/g, settings.companyName || "нашей компании")
    .replace(/\{topic\}/g, card.topic || "недвижимость")
    .replace(/\{place\}/g, [card.city, card.country].filter(Boolean).join(", ") || "ваш город")
    .replace(/\{group\}/g, card.name)
    .replace(/\{bot\}/g, bot);
  const set = OUTREACH[lang] || OUTREACH.ru;
  return { free: fill(set.free), exchange: fill(set.exchange), paid: fill(set.paid), contactUrl: contactUrl(card) };
}

export function contactUrl(card: GroupCard) {
  const c = card.adminContact || "";
  if (/^@\w+$/.test(c)) return "https://t.me/" + c.slice(1);
  if (/@/.test(c)) return "mailto:" + c;
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
  const groups = (await listGroups()).filter((g) => (groupIds === "all" ? !(g.botConnected && g.postingEnabled) && g.status !== "declined" && g.ads !== "forbidden" : groupIds.includes(g.id)));
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
const ADS_LABEL: Record<AdsPolicy, string> = { allowed: "разрешены", paid: "платно / через админа", forbidden: "запрещены", unknown: "не указано" };
const STATUS_LABEL: Record<GroupStatus, string> = { new: "новая", contacted: "написали админу", free: "бесплатно", exchange: "обмен", paid: "платно", declined: "отказ" };
export { ADS_LABEL, STATUS_LABEL };

export async function groupsXlsx(groups: GroupCard[], posts: PostLog[] = []) {
  const mod: any = await import("exceljs");
  const ExcelJS: any = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AURELIUS";
  const safe = (v: unknown) => { const s = String(v ?? ""); return /^[=+\-@]/.test(s) ? "'" + s : s; };
  const ws = wb.addWorksheet("Группы");
  ws.columns = [
    { header: "Платформа", key: "platform", width: 11 }, { header: "Тип", key: "kind", width: 9 }, { header: "Название", key: "name", width: 36 }, { header: "Ссылка", key: "url", width: 42 },
    { header: "Участники", key: "members", width: 11 }, { header: "Реклама по правилам", key: "ads", width: 20 }, { header: "Контакт админа", key: "admin", width: 24 },
    { header: "Страна", key: "country", width: 12 }, { header: "Город", key: "city", width: 14 }, { header: "Тема", key: "topic", width: 18 },
    { header: "Статус", key: "status", width: 16 }, { header: "Цена поста", key: "price", width: 11 }, { header: "Валюта", key: "currency", width: 8 },
    { header: "Бот в группе", key: "bot", width: 12 }, { header: "Заметки", key: "notes", width: 30 },
  ];
  for (const g of groups) ws.addRow({ platform: PLATFORM_LABEL[g.platform], kind: g.kind === "channel" ? "канал" : g.kind === "profile" ? "профиль" : g.kind === "page" ? "страница" : "группа", name: safe(g.name), url: g.url ? { text: g.url, hyperlink: g.url } : "", members: g.members ?? "", ads: ADS_LABEL[g.ads], admin: safe(g.adminContact || ""), country: safe(g.country || ""), city: safe(g.city || ""), topic: safe(g.topic || ""), status: STATUS_LABEL[g.status] || g.status, price: g.price ?? "", currency: g.currency || (g.price ? "EUR" : ""), bot: g.botConnected ? (g.postingEnabled ? "да, постинг вкл." : "да") : "", notes: safe(g.notes || "") });
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "O1" };
  if (posts.length) {
    const log = wb.addWorksheet("Журнал публикаций");
    log.columns = [{ header: "Время (UTC)", key: "at", width: 20 }, { header: "Группа", key: "group", width: 32 }, { header: "Платформа", key: "platform", width: 11 }, { header: "Способ", key: "mode", width: 14 }, { header: "Статус", key: "status", width: 12 }, { header: "Ссылка", key: "link", width: 36 }, { header: "Текст", key: "text", width: 50 }, { header: "Ошибка", key: "error", width: 30 }];
    for (const p of posts) log.addRow({ at: p.at.replace("T", " ").slice(0, 19), group: safe(p.groupName), platform: p.platform, mode: p.mode === "bot" ? "бот" : "вручную", status: { sent: "отправлено", failed: "ошибка", published: "опубликовано", skipped: "пропущено" }[p.status], link: p.link || "", text: safe(p.text), error: safe(p.error || "") });
    log.getRow(1).font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
