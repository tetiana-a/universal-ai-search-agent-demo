import { canonicalUrl, domainOf, normalize, parseArea, parseBudget, parseMoney, parsePercent, stableId, nowIso } from "@/lib/scout/text";
import type { AgencyCard, Goal, InterestLevel, InvestorCard, InvestorKind, ObjectCard, ObjectStatus, PropertyType, ScoutSource, ScoutTarget, SourceKind } from "@/lib/scout/types";

// Rule-based extraction from search hits / feed items. It works with zero AI keys;
// when a model is configured the scan can enrich cards, but nothing depends on it.

export type RawHit = { title: string; url: string; snippet: string; domain?: string; image?: string; publishedAt?: string };

// City aliases in the languages listings are written in.
export const CITY_ALIASES: Record<string, string[]> = {
  "Валенсия": ["valencia", "valència", "валенсия", "валенсія", "ruzafa", "russafa", "el cabanyal", "benimaclet", "patacona", "alboraya"],
  "Бали": ["bali", "бали", "балі", "canggu", "ubud", "seminyak", "uluwatu", "denpasar", "pererenan", "sanur", "jimbaran", "tabanan"],
  "Лимассол": ["limassol", "lemesos", "лимассол", "лімасол", "germasogeia", "agios tychonas"],
  "Пафос": ["paphos", "pafos", "пафос", "peyia", "kissonerga"],
  "Ларнака": ["larnaca", "larnaka", "ларнака"],
  "Аликанте": ["alicante", "alacant", "аликанте", "torrevieja", "benidorm"],
  "Барселона": ["barcelona", "барселона"],
  "Мадрид": ["madrid", "мадрид"],
  "Малага": ["malaga", "málaga", "малага", "marbella", "марбелья", "estepona"],
  "Дубай": ["dubai", "дубай", "dubái"],
  "Лиссабон": ["lisbon", "lisboa", "лиссабон", "cascais"],
};

export const CITY_COUNTRY: Record<string, string> = { "Валенсия": "Испания", "Аликанте": "Испания", "Барселона": "Испания", "Мадрид": "Испания", "Малага": "Испания", "Бали": "Индонезия", "Лимассол": "Кипр", "Пафос": "Кипр", "Ларнака": "Кипр", "Дубай": "ОАЭ", "Лиссабон": "Португалия" };

export const COUNTRY_ALIASES: Record<string, string[]> = {
  "Испания": ["spain", "españa", "espana", "испания", "іспанія"],
  "Индонезия": ["indonesia", "индонезия", "індонезія", "bali", "бали"],
  "Кипр": ["cyprus", "chipre", "кипр", "кіпр"],
  "ОАЭ": ["uae", "dubai", "emirates", "оаэ", "дубай"],
  "Португалия": ["portugal", "португалия", "португалія"],
  "Греция": ["greece", "grecia", "греция"],
  "Черногория": ["montenegro", "черногория"],
  "Турция": ["turkey", "türkiye", "турция"],
};

const TYPE_WORDS: Array<[PropertyType, RegExp]> = [
  ["penthouse", /penthouse|[áa]tico|пентхаус/i],
  ["villa", /\bvilla\b|вилл|вілл/i],
  ["hotel", /\bhotel\b|guest ?house|hostal|отел|готел/i],
  ["land", /\bland\b|\bplot\b|parcela|solar\b|terreno|участ|земл|ділянк|tanah|\bare\b/i],
  ["commercial", /commercial|\blocal comercial|office|oficina|коммерч|комерц|retail|warehouse|\bnave\b/i],
  ["house", /\bhouse\b|\bcasa\b|chalet|townhouse|adosado|\bдом\b|будин|коттедж/i],
  ["apartment", /apartment|\bflat\b|\bpiso\b|apartamento|квартир|апартамент|studio|estudio/i],
];

const STATUS_WORDS: Array<[ObjectStatus, RegExp]> = [
  ["auction", /subasta|auction|торги|аукцион|аукціон|licitaci/i],
  ["bank", /\bbanco\b|bank[- ]owned|repossess|залог|застав|\breo\b|activo bancario/i],
  ["off_market", /off[- ]?market|офф[- ]?маркет|venta privada|discreet sale/i],
  ["urgent", /urgent|urge\b|срочн|терміново|motivated seller|reduced|rebajad|price drop|снижен/i],
];

// Pages that talk about real estate but are not a listing (the "generic article" problem).
const ARTICLE_SIGNS = /\b(blog|news|noticias|новост|статья|guide|guía|how to|como comprar|top \d+|\d+ best|best \d+|tips|consejos|market report|forecast|prognosis|прогноз|обзор рынка|wikipedia)\b/i;
const LISTING_URL = /(idealista\.com\/(inmueble|en\/inmueble)|fotocasa\.es\/.+\/(vivienda|d)|habitaclia\.com\/.+\.htm|kyero\.com\/.+\/property|thinkspain\.com\/property|spainhouses\.net|bazaraki\.com\/adv|buysellcyprus\.com\/property|rumah123\.com\/properti|lamudi\.co\.id|balirealty|property-for-sale|\/property\/|\/listing\/|\/inmueble\/|\/propiedad\/|\/villa-|\/land-for-sale)/i;

export function detectType(text: string, fallback: PropertyType = "other"): PropertyType {
  for (const [type, re] of TYPE_WORDS) if (re.test(text)) return type;
  return fallback;
}

export function detectStatus(text: string): ObjectStatus {
  for (const [status, re] of STATUS_WORDS) if (re.test(text)) return status;
  return "regular";
}

// Cyrillic names inflect ("в Испании", "в Валенсии"): match on the stem.
function stem(alias: string) {
  const a = normalize(alias);
  return /[а-яёіїєґ]$/.test(a) && a.length > 4 ? a.slice(0, -1) : a;
}

export function matchCity(text: string, cities: string[]): string | undefined {
  const value = " " + normalize(text) + " ";
  for (const city of cities) {
    const aliases = CITY_ALIASES[city] || [city];
    if (aliases.some((alias) => value.includes(" " + stem(alias)))) return city;
  }
  return undefined;
}

export function matchCountries(text: string): string[] {
  const value = " " + normalize(text) + " ";
  return Object.entries(COUNTRY_ALIASES).filter(([, aliases]) => aliases.some((a) => value.includes(" " + stem(a)))).map(([c]) => c);
}

const DISTRICTS: Record<string, string[]> = {
  "Валенсия": ["Ruzafa", "Russafa", "El Cabanyal", "Benimaclet", "Patacona", "Alboraya", "Ciutat Vella", "El Carmen", "Campanar"],
  "Бали": ["Canggu", "Ubud", "Seminyak", "Uluwatu", "Pererenan", "Sanur", "Jimbaran", "Tabanan", "Berawa"],
  "Лимассол": ["Germasogeia", "Agios Tychonas", "Mouttagiaka", "Old Town"],
};

function district(text: string, city?: string) {
  if (!city) return undefined;
  const value = " " + normalize(text) + " ";
  return (DISTRICTS[city] || []).find((d) => value.includes(" " + normalize(d) + " "));
}

function contactFrom(text: string) {
  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(text)?.[0];
  if (email) return email;
  const phone = /(\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3}[\s-]?\d{2,4}[\s-]?\d{0,4}/.exec(text)?.[0];
  return phone && phone.replace(/\D/g, "").length >= 9 ? phone.trim() : undefined;
}

export function looksLikeListing(hit: RawHit) {
  const text = hit.title + " " + hit.snippet;
  if (ARTICLE_SIGNS.test(text) && !LISTING_URL.test(hit.url)) return false;
  const hasPrice = Boolean(parseMoney(text));
  const hasArea = Boolean(parseArea(text));
  const listingWords = /for sale|en venta|se vende|продаж|продается|продається|sale|venta|в продаже|freehold|leasehold/i.test(text);
  return LISTING_URL.test(hit.url) || (hasPrice && (hasArea || listingWords)) || (hasArea && listingWords);
}

export function extractObject(hit: RawHit, target: ScoutTarget): ObjectCard | null {
  if (!hit.url || !looksLikeListing(hit)) return null;
  const text = hit.title + " " + hit.snippet;
  const city = matchCity(text + " " + hit.url, target.city ? [target.city] : Object.keys(CITY_ALIASES)) || (target.city && matchCity(hit.url, [target.city]));
  // A listing outside the requested city is noise, not a result.
  if (target.city && !city) return null;
  const money = parseMoney(text);
  const area = parseArea(text) || undefined;
  const now = nowIso();
  const price = money?.amount;
  return {
    id: stableId("obj", canonicalUrl(hit.url)),
    title: hit.title.replace(/\s+[|·–-]\s+[^|·–-]+$/, "").slice(0, 140),
    url: hit.url,
    urls: [hit.url],
    photo: hit.image,
    price,
    currency: money?.currency,
    areaM2: area,
    pricePerM2: price && area && area > 10 ? Math.round(price / area) : undefined,
    country: (city && CITY_COUNTRY[city]) || target.country,
    city: city || target.city,
    district: district(text, city || target.city),
    type: detectType(text, target.types[0] || "other"),
    status: detectStatus(text),
    yieldPct: parsePercent(text, /yield|rentabilidad|доходност|дохідн|roi|rental return/) || undefined,
    sellerContact: contactFrom(hit.snippet),
    publishedAt: hit.publishedAt,
    sourceDomain: hit.domain || domainOf(hit.url),
    score: 0,
    scoreReasons: [],
    checklist: {},
    firstSeenAt: now,
    lastSeenAt: now,
    state: "new",
  };
}

const INVESTOR_SIGNS = /family office|\bfund\b|fondo|фонд|investor|inversor|инвестор|інвестор|capital|holding|private equity|\breit\b|socimi|angel|asset management|wealth/i;

export function classifyInvestorKind(text: string): InvestorKind {
  if (/family office|семейн\w* офис|сімейн\w* офіс/i.test(text)) return "family_office";
  if (/\bfund\b|fondo|фонд|\breit\b|socimi|private equity|asset management|capital partners/i.test(text)) return "fund";
  if (/\b(ltd|llc|s\.?l\.?|s\.?a\.?|gmbh|holding|group|ооо)\b/i.test(text)) return "company";
  return "private";
}

export function detectGoals(text: string): Goal[] {
  const goals: Goal[] = [];
  if (/yield|income|rental|доход|аренд|оренд|сдач|сдава|здава|rentabil|alquiler|cash ?flow/i.test(text)) goals.push("income");
  if (/golden visa|residen|внж|пмж|гражданств|громадянств|residencia|citizenship|relocat|переезд/i.test(text)) goals.push("residency");
  if (/preserv|сохран|збереж|wealth|capital protection|refugio/i.test(text)) goals.push("preservation");
  if (/flip|resale|перепрод|спекул|development|desarrollo|redevelop/i.test(text)) goals.push("speculation");
  return goals;
}

export function detectSegments(text: string): PropertyType[] {
  const out = new Set<PropertyType>();
  for (const [type, re] of TYPE_WORDS) if (re.test(text)) out.add(type);
  if (/residential|жиль|житл|vivienda|residencial/i.test(text)) { out.add("apartment"); out.add("house"); }
  if (/hospitality|hotel|отел/i.test(text)) out.add("hotel");
  return Array.from(out);
}

export function extractInvestor(hit: RawHit, source: string): InvestorCard | null {
  const text = hit.title + " " + hit.snippet;
  if (!INVESTOR_SIGNS.test(text) || !/real estate|property|propert|недвиж|нерухом|inmobili|inmueble|realty/i.test(text)) return null;
  if (ARTICLE_SIGNS.test(text) && !/family office|\bfund\b|фонд/i.test(hit.title)) return null;
  const name = hit.title.split(/\s+[|·–—-]\s+/)[0].trim().slice(0, 100);
  if (!name || name.length < 3) return null;
  const budget = parseBudget(text);
  const now = nowIso();
  return {
    id: stableId("inv", normalize(name) + "|" + domainOf(hit.url)),
    name,
    company: name,
    kind: classifyInvestorKind(text),
    country: matchCountries(text)[0],
    channel: hit.url,
    interest: { segments: detectSegments(text), budgetMin: budget?.min, budgetMax: budget?.max, currency: budget?.currency, geography: matchCountries(text), goals: detectGoals(text) },
    source,
    sourceUrl: hit.url,
    score: 0,
    checklist: {},
    firstSeenAt: now,
    lastSeenAt: now,
    state: "new",
  };
}

const NETWORKS = ["RE/MAX", "Engel & Völkers", "Century 21", "Coldwell Banker", "Sotheby's", "Keller Williams", "Lucas Fox", "Knight Frank", "Savills", "Tecnocasa", "Fine & Country", "Christie's"];
const AGENCY_SIGNS = /agency|agencia|inmobiliaria|immobiliaria|real estate|realty|realtor|broker|агентств|агенці|риэлт|ріелт|estate agent|properties/i;

export function extractAgency(hit: RawHit, cities: string[], source: string): AgencyCard | null {
  const text = hit.title + " " + hit.snippet;
  if (!AGENCY_SIGNS.test(text) || ARTICLE_SIGNS.test(hit.title)) return null;
  // Portals and aggregators are sources, not agencies.
  if (/idealista|fotocasa|habitaclia|kyero|rightmove|zillow|yelp|tripadvisor|facebook|linkedin|wikipedia/i.test(hit.url)) return null;
  const name = hit.title.split(/\s+[|·–—-]\s+/)[0].trim().slice(0, 90);
  if (!name) return null;
  const domain = hit.domain || domainOf(hit.url);
  const network = NETWORKS.find((n) => normalize(text).includes(normalize(n)));
  return {
    id: stableId("ag", domain || normalize(name)),
    name,
    city: matchCity(text + " " + hit.url, cities),
    country: matchCountries(text)[0],
    website: hit.url,
    domain,
    phone: /(\+\d{1,3}[\s-]?)?\d{2,4}[\s-]?\d{3}[\s-]?\d{3,4}/.exec(hit.snippet)?.[0],
    email: /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(hit.snippet)?.[0],
    network,
    source,
    isNew: /new office|nueva oficina|opens|abre|открыл|відкри|launch|inaugur/i.test(text),
    firstSeenAt: nowIso(),
    state: "new",
  };
}

// Module 5.1: commenters who reveal buying intent. Explicit > general > neutral.
export function classifyComment(text: string): InterestLevel {
  const t = String(text || "").toLowerCase();
  if (/сколько|скільки|цен[ауы]|ціна|в личк|в лс|в директ|напиш(у|ите) в|куплю|хочу купить|беру|how much|price\??|\bdm\b|\bpm\b|send (me )?details|cu[aá]nto|precio|me lo quedo|por privado|interested in buying|still available|ещё актуально|актуально\?/.test(t)) return "explicit";
  if (/интересн|цікав|interesting|interested|me interesa|wow|класс|супер|хотел[аи]? бы|would love|amazing/.test(t)) return "general";
  return "neutral";
}

export function detectSourceKind(hit: RawHit): SourceKind {
  const url = hit.url.toLowerCase();
  const text = (hit.title + " " + hit.snippet).toLowerCase();
  if (/t\.me\/|telegram/.test(url)) return /joinchat|\+[a-z0-9]{6,}/i.test(url) ? "group" : "channel";
  if (/facebook\.com\/groups|vk\.com|whatsapp/.test(url) || /\bgroup\b|группа|група|grupo|community|сообществ/.test(text)) return "group";
  if (/crowdfund|platform|plataforma|платформ|marketplace|proptech|tokeni|fractional/.test(text)) return "platform";
  if (/registry|registro|реестр|реєстр|cnmv|ecsp|licen/.test(text)) return "registry";
  if (/rss|feed|xml/.test(url)) return "feed";
  if (/news|press|noticias|новост/.test(text)) return "news";
  if (AGENCY_SIGNS.test(text)) return "agency_site";
  return "portal";
}

export function members(text: string): number | undefined {
  const m = /(\d{1,3}(?:[\s.,]\d{3})+|\d+(?:[.,]\d+)?\s?[kк]?)\s?(members|subscribers|участник|подписчик|підписник|учасник|miembros|seguidores|followers)/i.exec(text);
  if (!m) return undefined;
  const raw = m[1].trim();
  const k = /[kк]$/i.test(raw);
  const n = Number(raw.replace(/[kк]$/i, "").replace(/[\s.,](?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(k ? n * 1000 : n) : undefined;
}

// Module 5.2–5.3: a short brief on a newly found group / platform / site.
export function extractSource(hit: RawHit, focusCountries: string[]): ScoutSource | null {
  if (!hit.url) return null;
  const text = hit.title + " " + hit.snippet;
  if (!/real estate|property|propert|недвиж|нерухом|inmobili|invest|инвест|інвест|relocat|внж|realty|villa|земл/i.test(text)) return null;
  const domain = hit.domain || domainOf(hit.url);
  const kind = detectSourceKind(hit);
  const countries = matchCountries(text);
  const memberCount = members(text);
  const hasApi = /\bapi\b|developers|partner program|programa de socios|партнёрск|партнерськ|affiliate|white[- ]label|xml feed/i.test(text);
  const relevantCountry = !focusCountries.length || countries.some((c) => focusCountries.includes(c));
  const dealShare = /продаж|sale|venta|object|объект|deal|сделк|оферт|invest/i.test(text);
  const recommendation: ScoutSource["recommendation"] = !relevantCountry
    ? "ignore"
    : kind === "group" || kind === "channel"
      ? (memberCount === undefined || memberCount >= 300) && dealShare ? "join" : "ignore"
      : hasApi || kind === "portal" || kind === "platform" ? "connect" : "ignore";
  const key = kind === "channel" || kind === "group" ? canonicalUrl(hit.url) : domain;
  return {
    id: stableId("src", key),
    name: hit.title.split(/\s+[|·–—-]\s+/)[0].slice(0, 90) || domain,
    url: hit.url,
    domain,
    kind,
    country: countries[0],
    segment: detectSegments(text).join(", ") || undefined,
    hasApi,
    partnerProgram: /partner|socios|партн/i.test(text),
    members: memberCount,
    summary: hit.snippet.slice(0, 280),
    recommendation,
    state: "candidate",
    discoveredAt: nowIso(),
    usefulCount: 0,
    checkedCount: 0,
  };
}
