import { decodeEntities } from "@/lib/keyless-search";
import { isSafePublicUrl } from "@/lib/url-safety";
import { canonicalUrl, domainOf, nowIso, stableId } from "@/lib/scout/text";
import { CITY_ALIASES } from "@/lib/scout/extract";
import type { RawHit } from "@/lib/scout/extract";
import type { AgencyCard, ObjectCard, PropertyType, ScoutTarget } from "@/lib/scout/types";

// Level-A sources (spec 4). Each adapter is off until its key/feed exists and
// reports why. Nothing here bypasses a login, CAPTCHA or access control.

export type AdapterInfo = { id: string; label: string; enabled: boolean; needs: string; note: string };

export function adapterStatus(): AdapterInfo[] {
  const env = process.env;
  return [
    { id: "web", label: "Открытый веб-поиск (DuckDuckGo / SearXNG)", enabled: env.KEYLESS_SEARCH !== "off", needs: "—", note: "Работает без ключей; SEARXNG_URL делает его стабильнее." },
    { id: "telegram_public", label: "Публичные Telegram-каналы (t.me/s)", enabled: env.SCOUT_TELEGRAM_PUBLIC !== "off", needs: "—", note: "Читает новые посты каналов из watchlist. Закрытые чаты — только если бот добавлен админом." },
    { id: "feeds", label: "RSS / XML-фиды порталов", enabled: Boolean(env.SCOUT_FEEDS), needs: "SCOUT_FEEDS", note: "Партнёрские фиды Fotocasa, Habitaclia, Kyero, порталов Бали/Кипра/ОАЭ — URL через запятую." },
    { id: "idealista", label: "Idealista API", enabled: Boolean(env.IDEALISTA_API_KEY && env.IDEALISTA_API_SECRET), needs: "IDEALISTA_API_KEY, IDEALISTA_API_SECRET", note: "Официальный API (Испания, Португалия, Италия). Ключ выдаёт Idealista по заявке." },
    { id: "places", label: "Google Places API (агентства)", enabled: Boolean(env.GOOGLE_PLACES_API_KEY), needs: "GOOGLE_PLACES_API_KEY", note: "Сбор агентств по целевым городам." },
    { id: "mls", label: "MLS (InmoMLS, AMPSI, Inmovilla)", enabled: false, needs: "подписка агентства заказчика", note: "Подключается фидом через SCOUT_FEEDS, когда заказчик даст доступ." },
    { id: "linkedin", label: "LinkedIn Sales Navigator", enabled: false, needs: "аккаунт заказчика", note: "Официальный экспорт → импорт CSV в дашборде; отправка — вручную." },
    { id: "calendar", label: "Google Calendar (двусторонний)", enabled: false, needs: "OAuth заказчика", note: "Сейчас: файл .ics и ссылка «Добавить в Google Календарь»." },
  ];
}

async function getText(url: string, timeoutMs = 9000) {
  if (!isSafePublicUrl(url)) return null;
  try {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; AureliusScout/1.0)", accept: "text/html,application/xml,application/rss+xml,*/*" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function stripTags(html: string) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// ---- Public Telegram channel preview (t.me/s/<handle>) ----------------------

export type ChannelPost = { url: string; text: string; at?: string; image?: string };

export function parseTelegramChannel(html: string, handle: string): ChannelPost[] {
  const posts: ChannelPost[] = [];
  const blocks = html.split(/<div class="tgme_widget_message_wrap/).slice(1);
  for (const block of blocks) {
    const post = /data-post="([^"]+)"/.exec(block)?.[1];
    const textHtml = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1];
    if (!post || !textHtml) continue;
    const at = /<time[^>]+datetime="([^"]+)"/.exec(block)?.[1];
    const image = /background-image:url\('([^']+)'\)/.exec(block)?.[1];
    posts.push({ url: "https://t.me/" + post, text: stripTags(textHtml), at, image });
  }
  return posts.filter((p) => p.url.toLowerCase().includes("/" + handle.toLowerCase() + "/"));
}

export async function readTelegramChannel(handle: string): Promise<ChannelPost[]> {
  if (process.env.SCOUT_TELEGRAM_PUBLIC === "off") return [];
  const html = await getText("https://t.me/s/" + encodeURIComponent(handle));
  return html ? parseTelegramChannel(html, handle) : [];
}

export function postToHit(post: ChannelPost): RawHit {
  const firstLine = post.text.split("\n").find((l) => l.trim().length > 8) || post.text.slice(0, 80);
  return { title: firstLine.slice(0, 140), url: post.url, snippet: post.text.slice(0, 900), domain: "t.me", image: post.image, publishedAt: post.at };
}

// ---- RSS / Atom / XML feeds -------------------------------------------------

export function parseFeed(xml: string): RawHit[] {
  const items = xml.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  return items.map((item) => {
    const pick = (tag: string) => {
      const m = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i").exec(item);
      return m ? stripTags(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")) : "";
    };
    const link = pick("link") || /<link[^>]+href="([^"]+)"/i.exec(item)?.[1] || "";
    const image = /<enclosure[^>]+url="([^"]+)"/i.exec(item)?.[1] || /<media:content[^>]+url="([^"]+)"/i.exec(item)?.[1];
    return { title: pick("title"), url: link.trim(), snippet: (pick("description") || pick("summary") || pick("content")).slice(0, 900), domain: domainOf(link), image, publishedAt: pick("pubDate") || pick("updated") || undefined };
  }).filter((hit) => hit.title && /^https?:\/\//.test(hit.url));
}

export async function readFeeds(urls: string[]): Promise<RawHit[]> {
  const out: RawHit[] = [];
  for (const url of urls.slice(0, 10)) {
    const xml = await getText(url, 10000);
    if (xml) out.push(...parseFeed(xml).slice(0, 60));
  }
  return out;
}

export function configuredFeeds() {
  return String(process.env.SCOUT_FEEDS || "").split(",").map((s) => s.trim()).filter((s) => /^https:\/\//.test(s));
}

// ---- Idealista official API -------------------------------------------------

const CITY_CENTER: Record<string, { lat: number; lng: number; country: string }> = {
  "Валенсия": { lat: 39.4699, lng: -0.3763, country: "es" },
  "Аликанте": { lat: 38.3452, lng: -0.481, country: "es" },
  "Барселона": { lat: 41.3874, lng: 2.1686, country: "es" },
  "Мадрид": { lat: 40.4168, lng: -3.7038, country: "es" },
  "Малага": { lat: 36.7213, lng: -4.4214, country: "es" },
  "Лиссабон": { lat: 38.7223, lng: -9.1393, country: "pt" },
};

const IDEALISTA_TYPE: Partial<Record<PropertyType, string>> = { apartment: "homes", penthouse: "homes", house: "homes", villa: "homes", commercial: "premises", land: "lands" };

export async function idealistaSearch(target: ScoutTarget, priceMin?: number, priceMax?: number): Promise<ObjectCard[]> {
  const key = process.env.IDEALISTA_API_KEY;
  const secret = process.env.IDEALISTA_API_SECRET;
  const center = target.city ? CITY_CENTER[target.city] : undefined;
  if (!key || !secret || !center) return [];
  const tokenResponse = await fetch("https://api.idealista.com/oauth/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(key + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=read",
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const token = (await tokenResponse?.json().catch(() => null))?.access_token;
  if (!token) throw new Error("Idealista: не удалось получить токен (проверьте ключи)");
  const out: ObjectCard[] = [];
  const kinds = Array.from(new Set(target.types.map((t) => IDEALISTA_TYPE[t]).filter(Boolean))) as string[];
  for (const propertyType of kinds) {
    const params = new URLSearchParams({ operation: "sale", propertyType, center: center.lat + "," + center.lng, distance: "6000", maxItems: "50", numPage: "1", order: "publicationDate", sort: "desc", locale: "es" });
    if (priceMin) params.set("minPrice", String(priceMin));
    if (priceMax) params.set("maxPrice", String(priceMax));
    const response = await fetch("https://api.idealista.com/3.5/" + center.country + "/search", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(), signal: AbortSignal.timeout(10000) }).catch(() => null);
    const data: any = await response?.json().catch(() => null);
    for (const el of Array.isArray(data?.elementList) ? data.elementList : []) {
      const url = String(el.url || "");
      if (!url) continue;
      const now = nowIso();
      const type: PropertyType = el.propertyType === "penthouse" ? "penthouse" : el.propertyType === "chalet" ? "house" : el.propertyType === "land" ? "land" : el.propertyType === "premises" ? "commercial" : "apartment";
      out.push({
        id: stableId("obj", canonicalUrl(url)),
        title: [el.suggestedTexts?.title, el.address].filter(Boolean).join(" · ").slice(0, 140) || "Idealista " + el.propertyCode,
        url, urls: [url], photo: el.thumbnail,
        price: Number(el.price) || undefined, currency: "EUR",
        areaM2: Number(el.size) || undefined, pricePerM2: Number(el.priceByArea) || undefined,
        country: target.country, city: target.city, district: el.district || el.neighborhood,
        type, status: "regular", sourceDomain: "idealista.com",
        score: 0, scoreReasons: [], checklist: {}, firstSeenAt: now, lastSeenAt: now, state: "new",
      });
    }
  }
  return out;
}

// ---- Google Places API (New): agencies by city ------------------------------

export async function placesAgencies(city: string, country: string): Promise<AgencyCard[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  const english = (CITY_ALIASES[city] || [city])[0];
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber" },
    body: JSON.stringify({ textQuery: "real estate agency in " + english, pageSize: 20 }),
    signal: AbortSignal.timeout(9000),
  }).catch(() => null);
  const data: any = await response?.json().catch(() => null);
  return (Array.isArray(data?.places) ? data.places : []).map((p: any): AgencyCard => ({
    id: stableId("ag", domainOf(p.websiteUri) || "place:" + p.id),
    name: String(p.displayName?.text || "Agency"),
    city, country,
    website: p.websiteUri, domain: domainOf(p.websiteUri) || undefined,
    phone: p.internationalPhoneNumber,
    source: "Google Places",
    isNew: false,
    firstSeenAt: nowIso(),
    state: "new",
  }));
}
