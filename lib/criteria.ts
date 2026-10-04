// Numeric criteria named in a task ("от 10 000 м²", "at least 2 ha", "до 500 000 €") and
// the matching values found on a page. A result that states a value outside the range is
// dropped; a result that states none stays, marked for manual review.

export type NumericCriteria = { minAreaM2?: number; maxAreaM2?: number; minPrice?: number; maxPrice?: number };

const AREA_UNIT = "(м²|м2|кв\\.?\\s*м(?:етр\\p{L}*)?|квадратн\\p{L}*\\s+метр\\p{L}*|m²|m2|sq\\.?\\s*m|sqm|square\\s+met(?:er|re)s?|га|гектар\\p{L}*|ha|hectares?|hect[aá]reas?|сот(?:ок|ки|ка|ых)?|acres?)";
const NUMBER = "(\\d[\\d\\s.,']*)\\s*(тыс\\.?|тысяч\\p{L}*|k|млн\\.?|миллион\\p{L}*|million|mln|m(?![²2\\p{L}]))?";
const MIN_WORDS = "(?:от|не менее|минимум|более|больше|свыше|min(?:imum)?|at least|over|more than|from|>=|≥|>)";
const MAX_WORDS = "(?:до|не более|максимум|менее|меньше|max(?:imum)?|up to|under|less than|below|<=|≤|<)";
const CURRENCY = "(€|eur(?:o|os)?|евро|\\$|usd|долл\\p{L}*|£|gbp|фунт\\p{L}*|руб\\p{L}*|₽|aed|дирхам\\p{L}*)";

export function parseNumber(raw: string, scale?: string) {
  let s = String(raw || "").replace(/[\s']/g, "").replace(/[.,]$/, "");
  // 10.000 or 10,000 or 1.250.000 → thousands separators; 2,5 or 2.5 → decimal.
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
  else s = s.replace(",", ".");
  let n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  const sc = String(scale || "").toLowerCase();
  if (/^(тыс|тысяч|k)/.test(sc)) n *= 1_000;
  else if (/^(млн|миллион|million|mln|m)$/.test(sc.replace(/\.$/, "")) || /^(млн|миллион)/.test(sc)) n *= 1_000_000;
  return n;
}

export function toSquareMetres(value: number, unit: string) {
  const u = unit.toLowerCase();
  if (/^(га|гектар|ha|hect)/.test(u)) return value * 10_000;
  if (/^сот/.test(u)) return value * 100;
  if (/^acre/.test(u)) return value * 4046.86;
  return value;
}

export function parseNumericCriteria(query: string): NumericCriteria {
  const q = String(query || "").toLowerCase();
  const out: NumericCriteria = {};
  const area = (words: string) => new RegExp(words + "\\s*" + NUMBER + "\\s*" + AREA_UNIT, "giu");
  for (const m of q.matchAll(area(MIN_WORDS))) {
    const v = toSquareMetres(parseNumber(m[1], m[2]), m[3]);
    if (v > 0) out.minAreaM2 = Math.max(out.minAreaM2 || 0, v);
  }
  for (const m of q.matchAll(area(MAX_WORDS))) {
    const v = toSquareMetres(parseNumber(m[1], m[2]), m[3]);
    if (v > 0 && (!out.minAreaM2 || v > out.minAreaM2)) out.maxAreaM2 = v;
  }
  // "площадью 10 000 м² и более" / "10 000 m2+"
  const after = new RegExp(NUMBER + "\\s*" + AREA_UNIT + "\\s*(?:\\+|и более|или более|и больше|or more|and more|minimum|min)", "giu");
  for (const m of q.matchAll(after)) {
    const v = toSquareMetres(parseNumber(m[1], m[2]), m[3]);
    if (v > 0) out.minAreaM2 = Math.max(out.minAreaM2 || 0, v);
  }
  const priceMax = new RegExp(MAX_WORDS + "\\s*" + CURRENCY + "?\\s*" + NUMBER + "\\s*" + CURRENCY, "giu");
  for (const m of q.matchAll(priceMax)) {
    const v = parseNumber(m[2], m[3]);
    if (v > 0) out.maxPrice = v;
  }
  const priceMin = new RegExp(MIN_WORDS + "\\s*" + CURRENCY + "?\\s*" + NUMBER + "\\s*" + CURRENCY, "giu");
  for (const m of q.matchAll(priceMin)) {
    const v = parseNumber(m[2], m[3]);
    if (v > 0) out.minPrice = v;
  }
  return out;
}

export function hasNumericCriteria(c: NumericCriteria) {
  return Boolean(c.minAreaM2 || c.maxAreaM2 || c.minPrice || c.maxPrice);
}

// All areas stated in a text, in square metres.
export function areasInText(text: string) {
  const re = new RegExp(NUMBER + "\\s*" + AREA_UNIT, "giu");
  const out: number[] = [];
  for (const m of String(text || "").toLowerCase().matchAll(re)) {
    const v = toSquareMetres(parseNumber(m[1], m[2]), m[3]);
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

export function pricesInText(text: string) {
  const re = new RegExp("(?:" + CURRENCY + "\\s*" + NUMBER + ")|(?:" + NUMBER + "\\s*" + CURRENCY + ")", "giu");
  const out: number[] = [];
  for (const m of String(text || "").toLowerCase().matchAll(re)) {
    const v = m[2] ? parseNumber(m[2], m[3]) : parseNumber(m[4], m[5]);
    if (Number.isFinite(v) && v >= 100) out.push(v);
  }
  return out;
}

export type CriteriaCheck = { verdict: "pass" | "fail" | "unknown"; reason: string; areaM2?: number; price?: number };

// The area/price of a result: its own field first, then the title, then the page text.
export function checkNumericCriteria(c: NumericCriteria, item: { area?: string; price?: string; title?: string }, pageText = ""): CriteriaCheck {
  if (!hasNumericCriteria(c)) return { verdict: "pass", reason: "" };
  const reasons: string[] = [];
  let unknown = false;
  let areaM2: number | undefined;
  let price: number | undefined;
  if (c.minAreaM2 || c.maxAreaM2) {
    const candidates = [areasInText(String(item.area || "")), areasInText(String(item.title || "")), areasInText(pageText.slice(0, 3000))].find((list) => list.length);
    if (!candidates) unknown = true;
    else {
      areaM2 = candidates[0];
      if (c.minAreaM2 && areaM2 < c.minAreaM2 * 0.98) reasons.push("area " + Math.round(areaM2) + " m² < " + Math.round(c.minAreaM2) + " m²");
      if (c.maxAreaM2 && areaM2 > c.maxAreaM2 * 1.02) reasons.push("area " + Math.round(areaM2) + " m² > " + Math.round(c.maxAreaM2) + " m²");
    }
  }
  if (c.minPrice || c.maxPrice) {
    const candidates = [pricesInText(String(item.price || "")), pricesInText(String(item.title || "")), pricesInText(pageText.slice(0, 3000))].find((list) => list.length);
    if (!candidates) unknown = true;
    else {
      price = candidates[0];
      if (c.maxPrice && price > c.maxPrice * 1.02) reasons.push("price " + price + " > " + c.maxPrice);
      if (c.minPrice && price < c.minPrice * 0.98) reasons.push("price " + price + " < " + c.minPrice);
    }
  }
  if (reasons.length) return { verdict: "fail", reason: reasons.join("; "), areaM2, price };
  return { verdict: unknown ? "unknown" : "pass", reason: unknown ? "value_not_stated" : "", areaM2, price };
}

export function describeCriteria(c: NumericCriteria, lang: "ru" | "en") {
  const fmt = (n: number) => Math.round(n).toLocaleString(lang === "ru" ? "ru-RU" : "en-US");
  const parts: string[] = [];
  if (c.minAreaM2) parts.push((lang === "ru" ? "площадь ≥ " : "area ≥ ") + fmt(c.minAreaM2) + " m²");
  if (c.maxAreaM2) parts.push((lang === "ru" ? "площадь ≤ " : "area ≤ ") + fmt(c.maxAreaM2) + " m²");
  if (c.minPrice) parts.push((lang === "ru" ? "цена ≥ " : "price ≥ ") + fmt(c.minPrice));
  if (c.maxPrice) parts.push((lang === "ru" ? "цена ≤ " : "price ≤ ") + fmt(c.maxPrice));
  return parts.join(", ");
}
