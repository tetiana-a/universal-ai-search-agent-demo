export type ResearchKind = "investor" | "real_estate" | "company" | "person" | "general";

// accept  — relevant, shown as a normal result
// review  — plausible but under-evidenced: kept and shown as "Manual review"
// reject  — noise (event, job, IPO, news…) or unusable (no URL)
export type RelevanceTier = "accept" | "review" | "reject";

function text(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9а-яёіїєґ]+/gi, " ")
    .trim();
}

function join(values: unknown[]) {
  return values.map(text).filter(Boolean).join(" ");
}

function urlPath(value: unknown) {
  try { return new URL(String(value ?? "")).pathname.toLowerCase(); } catch { return ""; }
}

export function inferResearchKind(query: string): ResearchKind {
  const q = text(query);
  if (/investor|investors|venture capital|vc fund|angel investor|family office|private equity|инвестор|венчур|бизнес ангел|інвестор|фонд/.test(q)) return "investor";
  if (/land|plot|property|real estate|apartment|house|villa|недвиж|участ|квартир|дом|земел|вилл/.test(q)) return "real_estate";
  if (/company|companies|supplier|manufacturer|distributor|factory|vendor|компан|поставщик|производител|дистриб|фабрик|завод/.test(q)) return "company";
  if (/person|people|specialist|expert|broker|agent|manager|founder|lawyer|architect|человек|люди|специалист|эксперт|брокер|агент|основатель|юрист|архитектор/.test(q)) return "person";
  return "general";
}

// Signals that the page describes an investing entity (not just a startup or sector page).
const INVESTOR_ENTITY = /venture capital|\bvc\b|ventures\b|investment fund|investment firm|investment company|private equity|family office|angel investor|angel network|business angels?|\binvestor|\binvests?\b|invested in|\bfund\b|\bfunds\b|portfolio compan|our portfolio|capital partners|seed fund|growth equity|limited partners|венчурн|инвестиционн|инвестор|фонд|бизнес ангел|семейный офис|портфел/i;
// Words that name an investing firm. Generic "investor(s)" is deliberately absent: an
// "Investor Conference" is still a conference.
const INVESTOR_FIRM_NAME = /\bventures?\b|\bcapital\b|\bpartners\b|\bfund\b|\bvc\b|private equity|family office|angel network|business angels|\bholdings?\b|венчур|капитал|фонд/i;
// Pages that are about investors but are not an investor themselves.
const INVESTOR_NOISE_TITLE = /\b(events?|conference|summit|meetup|webinar|networking|programme|program|hackathon|jobs?|careers?|hiring|vacanc\w*|internship|ipo|initial public offering|stock price|share price|shares|listing|ticker|press release|news)\b|конференц|мероприят|нетворкинг|вакан|карьер|акци[ия]|листинг|новост|пресс-релиз/i;
const INVESTOR_NOISE_PATH = /\/(events?|event-calendar|conferences?|jobs?|careers?|vacancies|news|press|blog\/\d{4}|ipo|investor-relations|stock)(\/|$)/i;
const DIRECTORY_PAGE = /\b(top|best|list of|directory|database|\d{2,3})\b.*\b(investors?|vcs?|funds|venture capital firms|angels)\b|список|рейтинг|каталог/i;

// Sector words. They only matter when the query itself names a sector.
const SECTOR_TERMS = ["saas", "b2b", "enterprise", "software", "fintech", "proptech", "real estate", "healthtech", "medtech", "biotech", "climate", "cleantech", "energy", "ai", "artificial intelligence", "cyber", "security", "edtech", "ecommerce", "e commerce", "retail", "logistics", "mobility", "gaming", "deeptech", "hardware", "agritech", "foodtech", "crypto", "blockchain", "web3", "недвижимост", "финтех", "энергет", "логистик"];

// Small alias table so that a geography named in Russian matches English pages and vice versa.
const GEO_ALIASES: string[][] = [
  ["amsterdam", "амстердам"], ["netherlands", "dutch", "holland", "nederland", "нидерланд", "голланд"],
  ["madrid", "мадрид"], ["spain", "spanish", "espana", "испани"], ["barcelona", "барселон"],
  ["italy", "italia", "italian", "итали"], ["rome", "roma", "рим"], ["milan", "milano", "милан"],
  ["cyprus", "кипр", "κυπρ", "limassol", "лимасол", "nicosia", "никоси"],
  ["germany", "deutschland", "german", "германи"], ["berlin", "берлин"], ["munich", "munchen", "мюнхен"],
  ["france", "french", "франци"], ["paris", "париж"], ["london", "лондон"], ["united kingdom", "uk", "britain", "великобритан", "англи"],
  ["china", "chinese", "китай", "китая"], ["shenzhen", "шэньчжэнь"], ["shanghai", "шанха"],
  ["portugal", "португал"], ["lisbon", "лиссабон"], ["dubai", "дубай"], ["uae", "emirates", "оаэ", "эмират"],
  ["usa", "united states", "america", "сша", "америк"], ["switzerland", "swiss", "швейцар"], ["czech", "czechia", "prague", "чех", "праг"],
  ["poland", "польш"], ["ukraine", "украин"], ["israel", "израил"], ["singapore", "сингапур"], ["estonia", "эстони"], ["tallinn", "таллин"],
];

// Short terms ("ai", "uk") must match a whole word; longer ones may be word stems ("недвижимост").
function termPattern(term: string) {
  return new RegExp("(^|\\s)" + term + (term.length <= 3 ? "(\\s|$)" : ""));
}

function querySectors(q: string) {
  return SECTOR_TERMS.filter((term) => termPattern(term).test(q));
}

export function queryGeographies(query: string, extra: string[] = []) {
  const q = text(query);
  const groups: string[][] = [];
  for (const aliases of GEO_ALIASES) {
    if (aliases.some((alias) => termPattern(alias).test(q))) groups.push(aliases);
  }
  for (const geo of extra) {
    const g = text(geo);
    if (!g) continue;
    const known = GEO_ALIASES.find((aliases) => aliases.some((alias) => g.includes(alias)));
    if (known && !groups.includes(known)) groups.push(known);
    else if (!known) groups.push([g]);
  }
  return groups;
}

function mentionsAny(body: string, terms: string[]) {
  return terms.some((term) => termPattern(term).test(body));
}

export type RelevanceDecision = {
  tier: RelevanceTier;
  accepted: boolean;
  score: number;
  reason: string;
};

function decision(tier: RelevanceTier, score: number, reason: string): RelevanceDecision {
  return { tier, accepted: tier !== "reject", score, reason };
}

export type RelevanceContext = { geography?: string[] };

// NOSONAR - intentionally explicit per-kind rules; each branch is covered by regression tests.
export function evaluateResearchRelevance(item: any, query: string, context: RelevanceContext = {}): RelevanceDecision {
  const kind = inferResearchKind(query);
  const titleRaw = [item?.title, item?.organization].map((v) => String(v ?? "")).join(" ");
  const body = join([
    item?.title, item?.organization, item?.specialization, item?.geography, item?.location,
    item?.investment_type, item?.investmentType, item?.stage, item?.ticket, item?.why,
    item?.evidence, item?.evidence_quote, item?.evidenceQuote, item?.source, item?.url,
  ]);
  const q = text(query);

  if (!item?.url || !/^https?:\/\//i.test(String(item.url))) {
    return decision("reject", 0, "missing_valid_url");
  }

  const evidenceLength = Math.max(String(item?.evidence_quote ?? item?.evidenceQuote ?? "").trim().length, String(item?.evidence ?? "").trim().length);
  const thinEvidence = evidenceLength < 20;

  const geos = queryGeographies(query, context.geography);
  const geoMissing = geos.length > 0 && !geos.some((aliases) => mentionsAny(body, aliases));

  if (kind === "investor") {
    const entityInTitle = INVESTOR_ENTITY.test(titleRaw);
    const entityInBody = INVESTOR_ENTITY.test(body);
    const noiseTitle = INVESTOR_NOISE_TITLE.test(titleRaw);
    const noisePath = INVESTOR_NOISE_PATH.test(urlPath(item?.url));

    if (noiseTitle && !INVESTOR_FIRM_NAME.test(titleRaw.replace(new RegExp(INVESTOR_NOISE_TITLE.source, "gi"), " "))) return decision("reject", 10, "investor_query_noise");
    if (noisePath) return decision("reject", 15, "investor_query_noise_page");
    if (!entityInBody) return decision("reject", 15, "no_investor_signal");

    let score = 40 + (entityInTitle ? 20 : 0);
    const sectors = querySectors(q);
    const sectorMissing = sectors.length > 0 && !mentionsAny(body, sectors);
    if (!sectorMissing && sectors.length) score += 15;
    if (!geoMissing && geos.length) score += 15;
    if (item?.investment_type || item?.investmentType || item?.stage || item?.ticket) score += 10;

    if (DIRECTORY_PAGE.test(titleRaw)) return decision("review", Math.min(score, 50), "investor_directory_page");
    if (thinEvidence) return decision("review", Math.min(score, 45), "insufficient_evidence_text");
    if (geoMissing) return decision("review", Math.min(score, 50), "geography_not_confirmed");
    if (sectorMissing) return decision("review", Math.min(score, 55), "sector_not_confirmed");
    return decision(score >= 55 ? "accept" : "review", Math.min(100, score), score >= 55 ? "investor_relevance_confirmed" : "weak_investor_relevance");
  }

  if (thinEvidence) return decision("review", 30, "insufficient_evidence_text");

  if (kind === "real_estate") {
    const propertySignal = /land|plot|parcel|property|real estate|terrain|terreno|solar|finca|apartment|flat|house|villa|m2|sqm|hectare|участ|земел|недвиж|квартир|дом|гектар|сот/i.test(body);
    if (!propertySignal) return decision("reject", 10, "not_property_relevant");
    if (geoMissing) return decision("review", 45, "geography_not_confirmed");
    return decision("accept", 70, "property_relevance");
  }

  if (kind === "company") {
    const companySignal = /company|companies|supplier|manufacturer|factory|distributor|organization|corporate|ltd|llc|gmbh|inc|co\b|компан|поставщик|производител|завод|фабрик|организац/i.test(body);
    if (!companySignal) return decision("review", 35, "company_signal_not_confirmed");
    if (geoMissing) return decision("review", 45, "geography_not_confirmed");
    return decision("accept", 65, "company_relevance");
  }

  if (geoMissing) return decision("review", 45, "geography_not_confirmed");
  return decision("accept", 60, kind === "person" ? "person_relevance" : "general_research");
}

export type RelevanceRejection = { title: string; url: string; reason: string; score: number };

export function filterResearchResults(items: any[], query: string, context: RelevanceContext = {}) {
  const accepted: any[] = [];
  const review: any[] = [];
  const rejected: RelevanceRejection[] = [];

  for (const item of items) {
    const verdict = evaluateResearchRelevance(item, query, context);
    if (verdict.tier === "accept") {
      accepted.push({ ...item, relevanceScore: verdict.score, relevanceReason: verdict.reason, relevanceTier: "accept" });
    } else if (verdict.tier === "review") {
      review.push({ ...item, status: "Manual review", relevanceScore: verdict.score, relevanceReason: verdict.reason, relevanceTier: "review" });
    } else {
      rejected.push({
        title: String(item?.title || item?.organization || item?.source || "Unknown"),
        url: String(item?.url || ""),
        reason: verdict.reason,
        score: verdict.score,
      });
    }
  }

  return { accepted, review, rejected, kept: [...accepted, ...review] };
}
