import { runKeylessSearch } from "@/lib/keyless-search";
import { configuredFallbackProviders, searchFallbackProviders } from "@/lib/provider-search";
import { configuredFeeds, idealistaSearch, placesAgencies, postToHit, readFeeds, readTelegramChannel } from "@/lib/scout/adapters";
import { loadSettings } from "@/lib/scout/config";
import { extractAgency, extractInvestor, extractObject, extractSource, type RawHit } from "@/lib/scout/extract";
import { buildFirstMessage, createDraft, isStopped } from "@/lib/scout/outreach";
import { dedupeById, dedupeObjects, findMatches, scoreInvestor, scoreObject } from "@/lib/scout/scoring";
import { addCandidates, approvedDomains, creditSources, markDeadSources, telegramHandle } from "@/lib/scout/sources";
import { listAll, logAction, putMany, setValue } from "@/lib/scout/store";
import { detectLang, nowIso } from "@/lib/scout/text";
import type { AgencyCard, DraftChannel, InvestorCard, Lang, Lead, Match, ObjectCard, PropertyType, ScanStats, ScoutSettings, ScoutSource, ScoutTarget, WatchItem } from "@/lib/scout/types";

// The daily run (spec 5): objects → investors & agencies → monitoring → matching →
// drafts for human approval. Hobby cron fires once a day, so the 06:00/07:00/08:00
// steps run back to back inside one time budget; queries rotate by day so that
// coverage grows over the week instead of hammering the same searches.

const TYPE_QUERY: Record<Lang, Partial<Record<PropertyType, string>>> = {
  es: { apartment: "piso en venta", penthouse: "ático en venta", house: "casa en venta", villa: "villa en venta", land: "terreno en venta", commercial: "local comercial en venta", hotel: "hotel en venta" },
  en: { apartment: "apartment for sale", penthouse: "penthouse for sale", house: "house for sale", villa: "villa for sale freehold", land: "land for sale", commercial: "commercial property for sale", hotel: "hotel for sale" },
  ru: { apartment: "квартира продажа", penthouse: "пентхаус продажа", house: "дом продажа", villa: "вилла продажа", land: "участок продажа", commercial: "коммерческая недвижимость продажа", hotel: "отель продажа" },
  uk: { apartment: "квартира продаж", penthouse: "пентхаус продаж", house: "будинок продаж", villa: "вілла продаж", land: "ділянка продаж", commercial: "комерційна нерухомість продаж", hotel: "готель продаж" },
};
const DEAL_QUERY: Record<Lang, string> = { es: "subasta inmueble", en: "urgent sale property", ru: "срочная продажа недвижимость", uk: "термінований продаж нерухомість" };

const CITY_EN: Record<string, string> = { "Валенсия": "Valencia", "Бали": "Bali", "Лимассол": "Limassol", "Пафос": "Paphos", "Ларнака": "Larnaca", "Аликанте": "Alicante", "Барселона": "Barcelona", "Мадрид": "Madrid", "Малага": "Malaga", "Дубай": "Dubai", "Лиссабон": "Lisbon" };
const COUNTRY_EN: Record<string, string> = { "Испания": "Spain", "Индонезия": "Indonesia", "Кипр": "Cyprus", "ОАЭ": "UAE", "Португалия": "Portugal", "Греция": "Greece" };

export function cityName(target: ScoutTarget) {
  return target.city ? CITY_EN[target.city] || target.city : COUNTRY_EN[target.country] || target.country;
}

function rotate<T>(items: T[], count: number, seed = dayOfYear()) {
  if (items.length <= count) return items;
  const start = (seed * count) % items.length;
  return Array.from({ length: count }, (_, i) => items[(start + i) % items.length]);
}

function dayOfYear(date = new Date()) {
  return Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
}

export function objectQueries(settings: ScoutSettings, domains: string[]) {
  const out: Array<{ q: string; target: ScoutTarget }> = [];
  for (const target of settings.targets) {
    const words = TYPE_QUERY[target.lang] || TYPE_QUERY.en;
    const place = cityName(target);
    const typed = target.types.map((type) => ({ q: (words[type] || TYPE_QUERY.en[type]) + " " + place, target }));
    out.push(...rotate(typed, 2));
    out.push({ q: DEAL_QUERY[target.lang] + " " + place, target });
    for (const domain of rotate(domains, 1)) out.push({ q: "site:" + domain + " " + place + " " + (words[target.types[0]] || ""), target });
  }
  return out;
}

export function investorQueries(settings: ScoutSettings) {
  const countries = Array.from(new Set(settings.targets.map((t) => COUNTRY_EN[t.country] || t.country)));
  const all = countries.flatMap((c) => [
    "family office real estate investment " + c,
    "real estate investment fund " + c + " acquisitions",
    "private investor buying property " + c,
  ]);
  all.push("инвестор недвижимость " + settings.targets.map((t) => t.country).join(" "), "family office инвестиции в недвижимость Европа");
  return rotate(all, 3);
}

export function agencyQueries(settings: ScoutSettings) {
  return rotate(settings.targets.flatMap((t) => [
    (t.lang === "es" ? "inmobiliaria " : "real estate agency ") + cityName(t),
    (t.lang === "es" ? "nueva oficina inmobiliaria " : "new real estate agency office ") + cityName(t),
  ]), 3);
}

export function monitorQueries(settings: ScoutSettings, watch: WatchItem[]) {
  const keywords = Array.from(new Set([...settings.monitorKeywords, ...watch.filter((w) => w.kind === "keyword").map((w) => w.value)]));
  const countries = Array.from(new Set(settings.targets.map((t) => COUNTRY_EN[t.country] || t.country)));
  const groups = keywords.map((k) => "t.me " + k);
  const platforms = countries.flatMap((c) => ["real estate crowdfunding platform " + c + " launch " + new Date().getUTCFullYear(), "proptech platform " + c + " new"]);
  return [...rotate(groups, 2), ...rotate(platforms, 1), "ECSP crowdfunding licence real estate " + new Date().getUTCFullYear()];
}

// Results are aligned with the queries (an empty list for a query that failed).
export type SearchOutput = { results: RawHit[][]; errors: string[] };
type SearchFn = (queries: string[], lang: string, deadlineAt: number) => Promise<SearchOutput>;

// Paid search keys (if any) are used first; otherwise keyless DuckDuckGo/SearXNG.
export const defaultSearch: SearchFn = async (queries, lang, deadlineAt) => {
  const results: RawHit[][] = [];
  const errors: string[] = [];
  const paid = configuredFallbackProviders().length > 0;
  for (const q of queries) {
    if (Date.now() > deadlineAt - 3000) break;
    if (paid) {
      results.push((await searchFallbackProviders(q, lang)).map((h) => ({ title: h.title, url: h.url, snippet: h.snippet, domain: h.domain, publishedAt: h.publishedAt })));
      continue;
    }
    const outcomes = await runKeylessSearch([q], lang, deadlineAt);
    const ok = outcomes.find((o) => o.ok);
    results.push(ok ? ok.hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet, domain: h.domain })) : []);
    if (!ok) {
      errors.push(outcomes.map((o) => o.message).filter(Boolean)[0] || "search failed");
      // A keyless engine asking for a human check will keep refusing: stop instead of hammering it.
      if (outcomes.some((o) => o.status === "rate_limited") && !process.env.SEARXNG_URL) break;
    }
  }
  return { results, errors };
};

export type ScanOptions = { deadlineAt?: number; search?: SearchFn; createDrafts?: boolean; actor?: "cron" | "bot" | "human" };

export async function runScan(options: ScanOptions = {}): Promise<ScanStats> {
  const deadlineAt = options.deadlineAt || Date.now() + 50_000;
  const search = options.search || defaultSearch;
  const settings = await loadSettings();
  const stats: ScanStats = { startedAt: nowIso(), queries: 0, hits: 0, objectsNew: 0, objectsMerged: 0, investorsNew: 0, agenciesNew: 0, sourcesDiscovered: 0, watchPosts: 0, watchContacts: 0, matchesNew: 0, errors: [], adapters: {} };
  const timeLeft = (reserve: number) => deadlineAt - Date.now() > reserve;

  const [existingObjects, existingInvestors, existingAgencies, sources, watch, existingMatches] = await Promise.all([
    listAll<ObjectCard>("objects"), listAll<InvestorCard>("investors"), listAll<AgencyCard>("agencies"),
    listAll<ScoutSource>("sources"), listAll<WatchItem>("watch"), listAll<Match>("matches"),
  ]);
  const domains = Array.from(new Set([...approvedDomains(sources), ...watch.filter((w) => w.kind === "domain").map((w) => w.value)]));
  const usefulDomains = new Map<string, number>();
  const credit = (domain: string) => usefulDomains.set(domain, (usefulDomains.get(domain) || 0) + 1);

  // ---- Module 1: objects -----------------------------------------------------
  const objectCandidates: ObjectCard[] = [];
  for (const target of settings.targets) {
    if (!timeLeft(30_000)) break;
    try {
      const fromApi = await idealistaSearch(target, settings.priceMin, settings.priceMax);
      if (fromApi.length) stats.adapters.idealista = "ok: " + fromApi.length;
      objectCandidates.push(...fromApi);
    } catch (error) {
      stats.adapters.idealista = error instanceof Error ? error.message : "error";
    }
  }
  const feeds = configuredFeeds();
  if (feeds.length && timeLeft(30_000)) {
    const feedHits = await readFeeds(feeds);
    stats.adapters.feeds = "items: " + feedHits.length;
    for (const hit of feedHits) for (const target of settings.targets) { const card = extractObject(hit, target); if (card) { objectCandidates.push(card); break; } }
  }
  const oq = objectQueries(settings, domains);
  const byLang = new Map<string, typeof oq>();
  for (const item of oq) byLang.set(item.target.lang, [...(byLang.get(item.target.lang) || []), item]);
  for (const [lang, items] of byLang) {
    if (!timeLeft(25_000)) break;
    const { results, errors } = await search(items.map((i) => i.q), lang, deadlineAt - 22_000);
    stats.errors.push(...errors);
    results.forEach((hits, index) => {
      stats.queries += 1;
      stats.hits += hits.length;
      for (const hit of hits) { const card = extractObject(hit, items[index].target); if (card) objectCandidates.push(card); }
    });
  }

  // ---- Module 5.1: watchlist persons / groups (public Telegram channels) ------
  const watchUpdates: WatchItem[] = [];
  for (const item of watch.filter((w) => w.kind === "person" || w.kind === "group")) {
    if (!timeLeft(20_000)) break;
    const handle = telegramHandle(item.value);
    if (!handle) continue;
    const posts = await readTelegramChannel(handle);
    const fresh = posts.filter((p) => !item.lastHitAt || (p.at && p.at > item.lastHitAt));
    stats.watchPosts += fresh.length;
    for (const post of fresh) for (const target of settings.targets) { const card = extractObject(postToHit(post), { ...target, city: undefined }); if (card && card.city) { objectCandidates.push(card); break; } }
    if (fresh.length) watchUpdates.push({ ...item, hits: item.hits + fresh.length, lastHitAt: fresh.map((p) => p.at || "").sort().pop() || nowIso() });
  }
  stats.adapters.telegram_public = watch.some((w) => telegramHandle(w.value)) ? "posts: " + stats.watchPosts : "нет каналов в watchlist";

  const scored = objectCandidates.map((o) => scoreObject(o, settings));
  const { all: objects, added, merged, duplicates } = dedupeObjects(existingObjects, scored);
  stats.objectsNew = added.length;
  stats.objectsMerged = duplicates;
  for (const o of added) credit(o.sourceDomain);

  // ---- Module 2 + 3: investors and agencies -----------------------------------
  const investorCandidates: InvestorCard[] = [];
  const agencyCandidates: AgencyCard[] = [];
  if (timeLeft(18_000)) {
    const iq = investorQueries(settings);
    const { results, errors } = await search(iq, "en", deadlineAt - 14_000);
    stats.errors.push(...errors);
    results.forEach((hits) => { stats.queries += 1; stats.hits += hits.length; for (const hit of hits) { const inv = extractInvestor(hit, "web: " + (hit.domain || "")); if (inv) investorCandidates.push(scoreInvestor(inv, settings)); } });
  }
  const cities = settings.targets.map((t) => t.city).filter(Boolean) as string[];
  if (timeLeft(14_000)) {
    for (const target of settings.targets) {
      if (!target.city || !timeLeft(14_000)) continue;
      const places = await placesAgencies(target.city, target.country).catch(() => []);
      if (places.length) stats.adapters.places = "ok";
      agencyCandidates.push(...places);
    }
    const aq = agencyQueries(settings);
    const { results, errors } = await search(aq, "en", deadlineAt - 10_000);
    stats.errors.push(...errors);
    results.forEach((hits) => { stats.queries += 1; stats.hits += hits.length; for (const hit of hits) { const ag = extractAgency(hit, cities, "web: " + (hit.domain || "")); if (ag) agencyCandidates.push(ag); } });
  }
  const newInvestors = dedupeById(existingInvestors, investorCandidates);
  const newAgencies = dedupeById(existingAgencies, agencyCandidates);
  stats.investorsNew = newInvestors.length;
  stats.agenciesNew = newAgencies.length;

  // ---- Module 5.2–5.4: new groups, platforms, sites ---------------------------
  const discovered: ScoutSource[] = [];
  if (timeLeft(9_000)) {
    const mq = monitorQueries(settings, watch);
    const { results, errors } = await search(mq, "en", deadlineAt - 6_000);
    stats.errors.push(...errors);
    const focus = settings.targets.map((t) => t.country);
    results.forEach((hits) => { stats.queries += 1; stats.hits += hits.length; for (const hit of hits) { const src = extractSource(hit, focus); if (src && src.recommendation !== "ignore") discovered.push(src); } });
  }
  const freshSources = await addCandidates(discovered.slice(0, 25));
  stats.sourcesDiscovered = freshSources.length;

  // ---- Self-learning: credit approved sources, mark dead ones ------------------
  const allSources = [...sources, ...freshSources];
  const { sources: learned, dead } = markDeadSources(creditSources(allSources, usefulDomains));
  if (dead.length) await logAction({ actor: "agent", action: "sources.dead", detail: dead.map((d) => d.name).join(", ") });

  // ---- Matching ------------------------------------------------------------
  const investors = [...existingInvestors, ...newInvestors];
  const knownMatchIds = new Set(existingMatches.map((m) => m.id));
  const matches = findMatches(objects, investors).filter((m) => !knownMatchIds.has(m.id)).slice(0, 50);
  stats.matchesNew = matches.length;

  await Promise.all([
    putMany("objects", [...added, ...merged]),
    putMany("investors", newInvestors),
    putMany("agencies", newAgencies),
    putMany("sources", learned.filter((s) => s.state === "approved" || s.state === "dead")),
    putMany("matches", matches),
    putMany("watch", watchUpdates),
  ]);

  if (options.createDrafts !== false) await draftFirstContacts(settings, newInvestors, newAgencies, added);
  await processReminders(settings);

  stats.errors = Array.from(new Set(stats.errors)).slice(0, 5);
  stats.finishedAt = nowIso();
  await setValue("last-scan", stats);
  await logAction({ actor: options.actor || "cron", action: "scan", detail: `objects +${stats.objectsNew}, investors +${stats.investorsNew}, agencies +${stats.agenciesNew}, sources +${stats.sourcesDiscovered}, queries ${stats.queries}` });
  return stats;
}

function channelFor(contact?: string): DraftChannel {
  if (!contact) return "other";
  if (/@/.test(contact) && !/^@/.test(contact)) return "email";
  if (/^@|t\.me\//.test(contact)) return "telegram";
  if (/linkedin\.com/.test(contact)) return "linkedin";
  if (/^\+?\d[\d\s-]{8,}$/.test(contact)) return "whatsapp";
  return "other";
}

// Drafts only — a human approves each one (spec 6: human-in-the-loop before first touch).
async function draftFirstContacts(settings: ScoutSettings, investors: InvestorCard[], agencies: AgencyCard[], objects: ObjectCard[]) {
  const topInvestors = investors.filter((i) => i.score >= 50).sort((a, b) => b.score - a.score).slice(0, 5);
  for (const inv of topInvestors) {
    const contact = inv.channel;
    if (await isStopped(contact)) continue;
    const lang: Lang = inv.comment ? detectLang(inv.comment.text, "ru") : "en";
    const city = settings.targets.find((t) => inv.interest.geography.includes(t.country))?.city || settings.targets[0]?.city;
    await createDraft({ target: { type: "investor", id: inv.id, name: inv.name, contact }, channel: channelFor(contact), lang, templateId: "investor_first", kind: "first_contact", text: buildFirstMessage(settings, "investor_first", lang, { name: inv.name, source: inv.sourceUrl || inv.source, city }) });
  }
  for (const ag of agencies.slice(0, 5)) {
    const contact = ag.email || ag.website;
    if (!contact || (await isStopped(contact))) continue;
    const target = settings.targets.find((t) => t.city === ag.city);
    const lang: Lang = target?.lang === "es" ? "es" : "en";
    await createDraft({ target: { type: "agency", id: ag.id, name: ag.name, contact }, channel: channelFor(contact), lang, templateId: "agency_partnership", kind: "partnership", text: buildFirstMessage(settings, "agency_partnership", lang, { name: ag.name, source: ag.source, city: ag.city }) });
  }
  for (const obj of objects.filter((o) => o.sellerContact && o.score >= 60).slice(0, 3)) {
    const target = settings.targets.find((t) => t.country === obj.country);
    const lang: Lang = target?.lang === "es" ? "es" : "en";
    await createDraft({ target: { type: "seller", id: obj.id, name: obj.title, contact: obj.sellerContact }, channel: channelFor(obj.sellerContact), lang, templateId: "seller_object", kind: "first_contact", text: buildFirstMessage(settings, "seller_object", lang, { object: obj.title, source: obj.url, city: obj.city }) });
  }
}

// Reminders: not more than once per `reminderDays`, at most `maxReminders` (spec 5.4).
export function dueForReminder(lead: Lead, settings: Pick<ScoutSettings, "reminderDays" | "maxReminders">, now = Date.now()) {
  if (lead.state !== "in_progress" || lead.remindersSent >= settings.maxReminders) return false;
  const lastFromAgent = [...lead.transcript].reverse()[0]?.from === "agent";
  return lastFromAgent && now - Date.parse(lead.lastContactAt) >= settings.reminderDays * 86400000;
}

async function processReminders(settings: ScoutSettings) {
  const { sendDirect } = await import("@/lib/scout/telegram");
  const leads = await listAll<Lead>("leads");
  const updated: Lead[] = [];
  for (const lead of leads.filter((l) => dueForReminder(l, settings))) {
    const text = buildFirstMessage(settings, "reminder", lead.lang, { name: lead.name });
    const at = nowIso();
    // People who wrote to the bot first can be reminded by the bot; anyone else gets a draft.
    if (lead.contact?.startsWith("tg:")) {
      const ok = await sendDirect(lead.contact.slice(3), text);
      if (!ok) continue;
    } else {
      await createDraft({ target: { type: lead.type === "investor" ? "investor" : "seller", id: lead.id, name: lead.name, contact: lead.contact }, channel: channelFor(lead.contact), lang: lead.lang, templateId: "reminder", kind: "reminder", text });
    }
    updated.push({ ...lead, remindersSent: lead.remindersSent + 1, lastContactAt: at, transcript: [...lead.transcript, { from: "agent", text, at }] });
  }
  await putMany("leads", updated);
}
