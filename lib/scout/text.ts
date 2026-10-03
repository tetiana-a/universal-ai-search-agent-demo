import type { Lang } from "@/lib/scout/types";

export function nowIso() {
  return new Date().toISOString();
}

export function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9а-яёіїєґ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// FNV-1a: short, stable ids for dedupe keys and record ids.
export function stableId(prefix: string, value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return prefix + "_" + (hash >>> 0).toString(36);
}

export function randomId(prefix: string) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function domainOf(url: unknown) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// Canonical URL for dedupe: no tracking params, hash, trailing slash or "www".
export function canonicalUrl(url: string) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of Array.from(u.searchParams.keys())) if (/^(utm_|fbclid|gclid|ref|source)/i.test(key)) u.searchParams.delete(key);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + (u.search ? u.search : "")).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function tokens(value: string) {
  return new Set(normalize(value).split(" ").filter((t) => t.length > 2));
}

export function jaccard(a: string, b: string) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

const ES_WORDS = /\b(el|la|los|las|que|para|con|una|precio|venta|piso|vivienda|hola|gracias|quiero|busco|presupuesto|inversion|inversión)\b/i;

// Language auto-detection for the four dialogue languages (spec 6).
export function detectLang(text: string, fallback: Lang = "en"): Lang {
  const value = String(text || "");
  if (/[іїєґІЇЄҐ]/.test(value)) return "uk";
  if (/[а-яёА-ЯЁ]/.test(value)) return /\b(що|як|дякую|будь ласка|бюджет у|хочу купити)\b/i.test(value) ? "uk" : "ru";
  if (/[ñ¿¡]/i.test(value) || ES_WORDS.test(value)) return "es";
  if (/[a-z]/i.test(value)) return "en";
  return fallback;
}

const CURRENCY_SIGNS: Array<[RegExp, string]> = [
  [/€|eur\b|euro|евро|євро/i, "EUR"],
  [/\$|usd\b|dollar|доллар|долар/i, "USD"],
  [/£|gbp\b/i, "GBP"],
  [/aed\b|dirham|дирхам/i, "AED"],
  [/idr\b|rupiah|рупи/i, "IDR"],
];

function multiplier(word: string) {
  const w = word.toLowerCase();
  if (/^(k|к|тыс|тис|mil)/.test(w)) return 1e3;
  if (/^(m|mm|mln|млн|million|millones|мільйон)/.test(w)) return 1e6;
  if (/^(b|bn|млрд|billion)/.test(w)) return 1e9;
  return 1;
}

function toNumber(raw: string) {
  // "280 000", "280.000", "280,000", "1,2", "1.25"
  let s = raw.replace(/[\s  ']/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
  else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const NUM = "(\\d{1,3}(?:[\\s\\u00a0\\u202f.,']\\d{3})+|\\d+(?:[.,]\\d+)?)";
const MULT = "(k|к|тыс\\.?|тис\\.?|mil|m|mm|mln|млн|million|millones|мільйон\\w*|bn|b|млрд|billion)?";
const CUR = "(€|eur|euro|евро|євро|\\$|usd|£|gbp|aed|idr)";

// Finds the first price-like amount with a currency. Returns null when there is none.
export function parseMoney(text: string): { amount: number; currency: string } | null {
  const value = String(text || "");
  const patterns = [
    new RegExp(CUR + "\\s?" + NUM + "\\s?" + MULT + "(?![a-zа-я])", "i"),
    new RegExp(NUM + "\\s?" + MULT + "\\s?" + CUR, "i"),
  ];
  let best: { amount: number; currency: string; index: number } | null = null;
  for (const [i, pattern] of patterns.entries()) {
    const m = pattern.exec(value);
    if (!m) continue;
    const curRaw = i === 0 ? m[1] : m[3];
    const numRaw = i === 0 ? m[2] : m[1];
    const multRaw = i === 0 ? m[3] : m[2];
    const n = toNumber(numRaw) * multiplier(multRaw || "");
    if (!Number.isFinite(n) || n <= 0) continue;
    const currency = CURRENCY_SIGNS.find(([re]) => re.test(curRaw))?.[1] || "EUR";
    if (!best || m.index < best.index) best = { amount: Math.round(n), currency, index: m.index };
  }
  return best ? { amount: best.amount, currency: best.currency } : null;
}

// Budget ranges like "300-500k €", "от 1 до 3 млн евро", "up to 2M".
export function parseBudget(text: string): { min?: number; max?: number; currency?: string } | null {
  const value = String(text || "");
  const range = new RegExp(NUM + "\\s?" + MULT + "\\s?(?:-|–|—|to|до|a|hasta)\\s?" + NUM + "\\s?" + MULT + "\\s?" + CUR + "?", "i").exec(value);
  const currency = CURRENCY_SIGNS.find(([re]) => re.test(value))?.[1];
  if (range) {
    const mult2 = multiplier(range[4] || "");
    const mult1 = range[2] ? multiplier(range[2]) : mult2;
    const min = toNumber(range[1]) * mult1;
    const max = toNumber(range[3]) * mult2;
    if (min > 0 && max >= min) return { min: Math.round(min), max: Math.round(max), currency };
  }
  const money = parseMoney(value);
  if (!money) return null;
  const upTo = /(up to|до|hasta|max|не более|максимум)/i.test(value);
  const from = /(from|от|від|desde|min|минимум)/i.test(value) && !upTo;
  return upTo ? { max: money.amount, currency: money.currency } : from ? { min: money.amount, currency: money.currency } : { min: Math.round(money.amount * 0.8), max: Math.round(money.amount * 1.2), currency: money.currency };
}

export function parseArea(text: string): number | null {
  const value = String(text || "");
  const sqm = new RegExp(NUM + "\\s?(m²|m2|кв\\.?\\s?м|м²|м2|sqm|sq\\.?\\s?m\\b|metros)", "i").exec(value);
  if (sqm) return Math.round(toNumber(sqm[1]));
  const sqft = new RegExp(NUM + "\\s?(sq\\.?\\s?ft|sqft|ft²)", "i").exec(value);
  if (sqft) return Math.round(toNumber(sqft[1]) * 0.0929);
  const are = new RegExp(NUM + "\\s?(are|ares|соток|сотки|сотка)(?![a-zа-я])", "i").exec(value);
  if (are) return Math.round(toNumber(are[1]) * 100);
  const ha = new RegExp(NUM + "\\s?(ha|га|hectares?|гектар\\w*)(?![a-zа-я])", "i").exec(value);
  if (ha) return Math.round(toNumber(ha[1]) * 10000);
  return null;
}

export function parsePercent(text: string, words: RegExp): number | null {
  const value = String(text || "");
  const m = new RegExp("(?:" + words.source + ")[^\\d%]{0,24}(\\d+(?:[.,]\\d+)?)\\s?%", "i").exec(value)
    || new RegExp("(\\d+(?:[.,]\\d+)?)\\s?%[^.]{0,20}(?:" + words.source + ")", "i").exec(value);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

export function formatMoney(amount?: number, currency = "EUR") {
  if (!amount) return "—";
  const sign = currency === "EUR" ? " €" : currency === "USD" ? " $" : " " + currency;
  return amount.toLocaleString("ru-RU").replace(/ /g, " ") + sign;
}

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
