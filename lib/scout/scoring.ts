import { clamp, jaccard } from "@/lib/scout/text";
import type { InvestorCard, Match, ObjectCard, PropertyType, ScoutSettings } from "@/lib/scout/types";
import { stableId, nowIso } from "@/lib/scout/text";

// ---- Object "interest" score (module 1) ------------------------------------

export function scoreObject(object: ObjectCard, settings: ScoutSettings): ObjectCard {
  const reasons: string[] = [];
  let score = 0;

  const reference = object.city ? settings.marketPricePerM2[object.city] : undefined;
  let discountPct: number | undefined;
  if (reference && object.pricePerM2 && object.currency === "EUR" && object.type !== "land") {
    discountPct = Math.round(((reference - object.pricePerM2) / reference) * 100);
    if (discountPct >= settings.minDiscountPct) {
      score += 35 + Math.min(15, discountPct - settings.minDiscountPct);
      reasons.push("ниже рынка на " + discountPct + "% (" + object.pricePerM2 + " €/м² при ~" + reference + ")");
    } else if (discountPct > 0) {
      score += Math.round((discountPct / settings.minDiscountPct) * 20);
      reasons.push("немного ниже рынка: −" + discountPct + "%");
    } else {
      reasons.push("цена на уровне или выше рынка (" + object.pricePerM2 + " €/м²)");
    }
  }

  if (object.yieldPct) {
    const pts = object.yieldPct >= 7 ? 20 : object.yieldPct >= 5 ? 12 : 5;
    score += pts;
    reasons.push("доходность " + object.yieldPct + "%");
  }

  const liquidity: Partial<Record<PropertyType, number>> = { apartment: 15, penthouse: 15, villa: 12, house: 10, land: 8, commercial: 8, hotel: 8 };
  score += liquidity[object.type] || 4;

  if (object.price) {
    const inRange = (!settings.priceMin || object.price >= settings.priceMin) && (!settings.priceMax || object.price <= settings.priceMax);
    if (inRange) score += 10;
    else { score -= 15; reasons.push("вне ценового диапазона"); }
  }

  if (object.status !== "regular") {
    score += 10;
    reasons.push({ auction: "торги", bank: "банковский залог", urgent: "срочная продажа", off_market: "off-market", regular: "" }[object.status]);
  }

  const completeness = [object.price, object.areaM2, object.sellerContact, object.photo].filter(Boolean).length;
  score += completeness * 2.5;
  if (!object.price) reasons.push("цена не указана — уточнить");

  return { ...object, discountPct, score: Math.round(clamp(score)), scoreReasons: reasons };
}

// ---- Investor score (module 2 + 5.1) ----------------------------------------

export function scoreInvestor(investor: InvestorCard, settings: ScoutSettings): InvestorCard {
  let score = { family_office: 30, fund: 25, company: 15, private: 15 }[investor.kind];
  if (investor.comment?.level === "explicit") score += 40;
  else if (investor.comment?.level === "general") score += 20;
  if (investor.interest.budgetMin || investor.interest.budgetMax) score += 15;
  const targetCountries = settings.targets.map((t) => t.country);
  if (investor.interest.geography.some((g) => targetCountries.includes(g))) score += 15;
  if (investor.interest.goals.length) score += 5;
  if (investor.channel) score += 5;
  return { ...investor, score: Math.round(clamp(score)) };
}

// ---- Dedupe (one object is often on 5 portals and 3 groups) -----------------

function closeEnough(a?: number, b?: number, tolerance = 0.02) {
  if (!a || !b) return false;
  return Math.abs(a - b) / Math.max(a, b) <= tolerance;
}

export function isSameObject(a: ObjectCard, b: ObjectCard) {
  if (a.id === b.id) return true;
  if (a.urls.some((u) => b.urls.includes(u))) return true;
  if (a.city !== b.city || a.type !== b.type) return false;
  if (!closeEnough(a.price, b.price)) return false;
  if (a.areaM2 && b.areaM2) return closeEnough(a.areaM2, b.areaM2, 0.03);
  return jaccard(a.title, b.title) >= 0.5;
}

export function mergeObject(existing: ObjectCard, incoming: ObjectCard): ObjectCard {
  return {
    ...existing,
    urls: Array.from(new Set([...existing.urls, ...incoming.urls])).slice(0, 12),
    photo: existing.photo || incoming.photo,
    price: existing.price || incoming.price,
    currency: existing.currency || incoming.currency,
    areaM2: existing.areaM2 || incoming.areaM2,
    pricePerM2: existing.pricePerM2 || incoming.pricePerM2,
    district: existing.district || incoming.district,
    yieldPct: existing.yieldPct || incoming.yieldPct,
    sellerContact: existing.sellerContact || incoming.sellerContact,
    status: existing.status === "regular" ? incoming.status : existing.status,
    lastSeenAt: incoming.lastSeenAt,
  };
}

// Returns every object, the ones added this run, the existing ones updated, and how many duplicates were collapsed.
export function dedupeObjects(existing: ObjectCard[], incoming: ObjectCard[]) {
  const all = [...existing];
  const addedIds = new Set<string>();
  const touched = new Set<string>();
  let duplicates = 0;
  for (const item of incoming) {
    const index = all.findIndex((o) => isSameObject(o, item));
    if (index >= 0) {
      all[index] = mergeObject(all[index], item);
      duplicates += 1;
      if (!addedIds.has(all[index].id)) touched.add(all[index].id);
    } else {
      all.push(item);
      addedIds.add(item.id);
    }
  }
  return { all, added: all.filter((o) => addedIds.has(o.id)), merged: all.filter((o) => touched.has(o.id)), duplicates };
}

export function dedupeById<T extends { id: string }>(existing: T[], incoming: T[]) {
  const ids = new Set(existing.map((e) => e.id));
  const added: T[] = [];
  for (const item of incoming) if (!ids.has(item.id)) { ids.add(item.id); added.push(item); }
  return added;
}

// ---- Object ↔ investor matching (spec 5: real-time matching) ----------------

// Countries where buying property can still lead to residency (2026; Spain's
// golden visa ended in April 2025).
const RESIDENCY_BY_PROPERTY = new Set(["Кипр", "Греция", "ОАЭ", "Турция"]);

function segmentFits(segments: PropertyType[], type: PropertyType) {
  if (!segments.length) return null;
  if (segments.includes(type)) return true;
  const family: Record<string, PropertyType[]> = { apartment: ["penthouse"], penthouse: ["apartment"], villa: ["house"], house: ["villa"] };
  return (family[type] || []).some((t) => segments.includes(t));
}

export function matchScore(object: ObjectCard, investor: InvestorCard): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const { geography, segments, budgetMin, budgetMax, goals } = investor.interest;

  if (geography.length) {
    if (!geography.includes(object.country)) return { score: 0, reasons: ["другая география"] };
    score += 30; reasons.push("география: " + object.country);
  } else score += 10;

  const seg = segmentFits(segments, object.type);
  if (seg === false) return { score: 0, reasons: ["другой тип объекта"] };
  score += seg ? 25 : 10;
  if (seg) reasons.push("тип объекта совпадает");

  if (object.price && (budgetMin || budgetMax)) {
    const fits = (!budgetMin || object.price >= budgetMin * 0.9) && (!budgetMax || object.price <= budgetMax * 1.1);
    if (!fits) return { score: 0, reasons: ["вне бюджета"] };
    score += 30; reasons.push("в бюджете");
  } else score += 10;

  if (goals.includes("income") && object.yieldPct) { score += 10; reasons.push("цель — доход, есть доходность"); }
  if (goals.includes("residency") && RESIDENCY_BY_PROPERTY.has(object.country)) { score += 10; reasons.push("подходит для ВНЖ"); }
  if (goals.includes("speculation") && (object.discountPct || 0) >= 10) { score += 10; reasons.push("дисконт под перепродажу"); }

  return { score: Math.min(100, score), reasons };
}

export function findMatches(objects: ObjectCard[], investors: InvestorCard[], threshold = 60): Match[] {
  const out: Match[] = [];
  for (const object of objects) {
    if (object.state === "rejected") continue;
    for (const investor of investors) {
      if (investor.state === "refused") continue;
      const { score, reasons } = matchScore(object, investor);
      if (score >= threshold) out.push({ id: stableId("m", object.id + "|" + investor.id), objectId: object.id, investorId: investor.id, score, reasons, createdAt: nowIso(), state: "proposed" });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
