import { geminiSearch } from "@/lib/gemini-search";
import { runKeylessSearch } from "@/lib/keyless-search";
import { isSafePublicUrl } from "@/lib/url-safety";
import { botHandle, loadSettings } from "@/lib/scout/config";
import { getOne, increment, listAll, logAction, putMany, putOne, readCounter } from "@/lib/scout/store";
import { botToken, resolveChatId, sendMessage, tgCall } from "@/lib/scout/telegram";
import { nowIso, randomId, stableId } from "@/lib/scout/text";

// Group finder and compliant posting.
// - Finds public Telegram and Facebook groups/channels for a place and topic, using
//   search results and the groups' own public pages (no login, no scraping behind walls).
// - Posts with the official Bot API only into chats where an admin added the bot.
// - Everything else (Facebook, groups without the bot) goes into a queue that a real
//   person publishes from their own account, one confirmed post at a time.
// There is deliberately no account farm, no human imitation and no automated posting
// from personal accounts: those break Telegram/Facebook rules and get accounts banned.

export type Platform = "telegram" | "facebook";
export type AdsPolicy = "allowed" | "paid" | "forbidden" | "unknown";
export type GroupStatus = "new" | "contacted" | "free" | "exchange" | "paid" | "declined";

export type GroupCard = {
  id: string;
  platform: Platform;
  kind?: "group" | "channel";
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

export type FindInput = { country?: string; city?: string; topic: string };

function placeOf(input: FindInput) {
  return [input.city, input.country].filter(Boolean).join(", ");
}

export function groupQueries(input: FindInput) {
  const place = placeOf(input);
  return [
    "Telegram группы и каналы " + input.topic + " " + place + " t.me",
    "Telegram chats channels " + input.topic + " " + place + " t.me",
    "Facebook groups " + input.topic + " " + place,
    "site:facebook.com/groups " + input.topic + " " + (input.city || input.country || ""),
  ];
}

function listPrompt(input: FindInput) {
  return "Find public Telegram groups and channels and public Facebook groups about \"" + input.topic + "\" in " + (placeOf(input) || "any location") +
    ". List as many real ones as you can, each with its full link (https://t.me/... or https://www.facebook.com/groups/...), name and member count if known. Only real, existing groups.";
}

export type FindOutcome = { found: GroupCard[]; added: number; checked: number; notes: string[] };

export async function findGroups(input: FindInput, deadlineAt = Date.now() + 45_000): Promise<FindOutcome> {
  const notes: string[] = [];
  const queries = groupQueries(input);
  const [gemini, keyless] = await Promise.all([
    Promise.all([geminiSearch(queries[0], "ru", listPrompt(input)), geminiSearch(queries[2], "en", listPrompt(input))]),
    runKeylessSearch(queries, "en", Math.min(deadlineAt, Date.now() + 15_000)).catch(() => []),
  ]);
  for (const g of gemini) if (!g.ok && g.message) notes.push(g.message);

  const telegram = new Map<string, { snippet: string; trusted: boolean }>();
  const facebook = new Map<string, { title: string; snippet: string }>();
  const otherPages: string[] = [];
  const hits = [...gemini.flatMap((g) => g.hits), ...keyless.flatMap((k) => k.hits)] as Array<{ title: string; url: string; snippet: string }>;
  for (const hit of hits) {
    const tg = normalizeTelegramUrl(hit.url);
    const fb = normalizeFacebookGroupUrl(hit.url);
    if (tg) telegram.set(tg, { snippet: hit.snippet, trusted: true });
    else if (fb) facebook.set(fb, { title: hit.title, snippet: hit.snippet });
    else otherPages.push(hit.url);
    const inText = extractGroupLinks(hit.title + " " + hit.snippet);
    for (const u of inText.telegram) if (!telegram.has(u)) telegram.set(u, { snippet: "", trusted: true });
    for (const u of inText.facebook) if (!facebook.has(u)) facebook.set(u, { title: "", snippet: hit.snippet });
  }
  // Links the model wrote itself: Telegram ones are kept only after their public page confirms them.
  for (const g of gemini) for (const u of extractGroupLinks(g.text || "").telegram) if (!telegram.has(u)) telegram.set(u, { snippet: "", trusted: true });
  // Catalogue pages (tgstat, lists of chats) often hold the links; read a few of them.
  const pages = await inBatches(otherPages.slice(0, 6), 6, (url) => fetchHtml(url, 6000));
  for (const html of pages) {
    const links = extractGroupLinks(html);
    for (const u of links.telegram.slice(0, 40)) if (!telegram.has(u)) telegram.set(u, { snippet: "", trusted: false });
    for (const u of links.facebook.slice(0, 20)) if (!facebook.has(u)) facebook.set(u, { title: "", snippet: "" });
  }

  const now = nowIso();
  const topicWords = (input.topic + " " + (input.city || "") + " " + (input.country || "")).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
  const relevant = (text: string) => { const t = text.toLowerCase(); return topicWords.some((w) => t.includes(w)); };
  const base = { country: input.country || undefined, city: input.city || undefined, topic: input.topic, status: "new" as GroupStatus, foundAt: now, updatedAt: now };

  const tgList = [...telegram.entries()].slice(0, 60);
  const tgCards = await inBatches(tgList, 10, async ([url, meta]): Promise<GroupCard | null> => {
    if (Date.now() > deadlineAt) return null;
    const preview = parseTelegramPreview(await fetchHtml(url, 6000));
    if (!preview) return null;
    // Links lifted from catalogue pages are kept only when they match the topic or place.
    if (!meta.trusted && !relevant(preview.title + " " + preview.description)) return null;
    const text = preview.description + "\n" + meta.snippet;
    return { ...base, id: stableId("grp", url.toLowerCase()), platform: "telegram", kind: preview.kind, url, name: preview.title, members: preview.members, description: preview.description.slice(0, 600), ads: detectAdsPolicy(text), adminContact: detectAdminContact(preview.description, url) };
  });

  const fbList = [...facebook.entries()].slice(0, 30);
  const fbCards = await inBatches(fbList, 10, async ([url, meta]): Promise<GroupCard | null> => {
    const preview = Date.now() < deadlineAt ? parseFacebookPreview(await fetchHtml(url, 6000)) : null;
    const name = preview?.title || meta.title.replace(/\s*[|·-]\s*Facebook.*$/i, "").trim();
    if (!name) return null;
    const text = (preview?.description || "") + "\n" + meta.snippet;
    return { ...base, id: stableId("grp", url.toLowerCase()), platform: "facebook", kind: "group", url, name, members: preview?.members ?? parseMembers(meta.snippet), description: text.trim().slice(0, 600), ads: detectAdsPolicy(text), adminContact: detectAdminContact(text, url) };
  });

  const found = [...tgCards, ...fbCards].filter(Boolean) as GroupCard[];
  const saved = await upsertGroups(found);
  if (!found.length && !notes.length) notes.push("Поиск не вернул публичных групп. Попробуйте другую формулировку темы или город на местном языке.");
  await logAction({ actor: "agent", action: "groups.find", detail: input.topic + " · " + placeOf(input) + " → " + found.length + " (новых " + saved.added + ")" });
  return { found: saved.cards.sort((a, b) => (b.members || 0) - (a.members || 0)), added: saved.added, checked: telegram.size + facebook.size, notes };
}

// Keeps what the user already filled in (status, price, notes, posting switch, bot link).
export async function upsertGroups(cards: GroupCard[]) {
  let added = 0;
  const out: GroupCard[] = [];
  for (const card of cards) {
    const prev = await getOne<GroupCard>("groups", card.id);
    if (!prev) added += 1;
    out.push(prev ? { ...card, status: prev.status, price: prev.price, currency: prev.currency, notes: prev.notes, chatId: prev.chatId, botConnected: prev.botConnected, postingEnabled: prev.postingEnabled, dailyLimit: prev.dailyLimit, adminContact: prev.adminContact || card.adminContact, foundAt: prev.foundAt } : card);
  }
  await putMany("groups", out);
  return { cards: out, added };
}

export async function listGroups() {
  return (await listAll<GroupCard>("groups")).sort((a, b) => Number(Boolean(b.botConnected)) - Number(Boolean(a.botConnected)) || (b.members || 0) - (a.members || 0));
}

const STATUSES = new Set<GroupStatus>(["new", "contacted", "free", "exchange", "paid", "declined"]);

export async function updateGroup(id: string, patch: Partial<Pick<GroupCard, "status" | "price" | "currency" | "notes" | "adminContact" | "postingEnabled" | "dailyLimit">>) {
  const card = await getOne<GroupCard>("groups", id);
  if (!card) return null;
  const next: GroupCard = { ...card, updatedAt: nowIso() };
  if (patch.status && STATUSES.has(patch.status)) next.status = patch.status;
  if (patch.price !== undefined) next.price = Number(patch.price) > 0 ? Number(patch.price) : undefined;
  if (patch.currency !== undefined) next.currency = String(patch.currency).slice(0, 6) || undefined;
  if (patch.notes !== undefined) next.notes = String(patch.notes).slice(0, 500);
  if (patch.adminContact !== undefined) next.adminContact = String(patch.adminContact).slice(0, 120) || undefined;
  if (patch.dailyLimit !== undefined) next.dailyLimit = Math.max(0, Math.min(10, Math.round(Number(patch.dailyLimit) || 0)));
  if (patch.postingEnabled !== undefined) next.postingEnabled = Boolean(patch.postingEnabled) && Boolean(card.botConnected);
  await putOne("groups", next);
  return next;
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

// ---- Posting through the Bot API ---------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function postingTargets() {
  return (await listGroups()).filter((g) => g.platform === "telegram" && g.botConnected && g.postingEnabled && g.chatId);
}

async function sendPhoto(chatId: string, photo: string, caption: string) {
  return tgCall("sendPhoto", { chat_id: await resolveChatId(chatId), photo, caption: caption.slice(0, 1024) });
}

function messageLink(card: GroupCard, messageId?: number) {
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
  for (const g of groups) ws.addRow({ platform: g.platform === "telegram" ? "Telegram" : "Facebook", kind: g.kind === "channel" ? "канал" : "группа", name: safe(g.name), url: g.url ? { text: g.url, hyperlink: g.url } : "", members: g.members ?? "", ads: ADS_LABEL[g.ads], admin: safe(g.adminContact || ""), country: safe(g.country || ""), city: safe(g.city || ""), topic: safe(g.topic || ""), status: STATUS_LABEL[g.status] || g.status, price: g.price ?? "", currency: g.currency || (g.price ? "EUR" : ""), bot: g.botConnected ? (g.postingEnabled ? "да, постинг вкл." : "да") : "", notes: safe(g.notes || "") });
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
