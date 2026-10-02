export type ResearchKind = "investor" | "real_estate" | "company" | "person" | "general";

function text(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яёіїєґ]+/gi, " ")
    .trim();
}

function join(values: unknown[]) {
  return values.map(text).filter(Boolean).join(" ");
}

export function inferResearchKind(query: string): ResearchKind {
  const q = text(query);
  if (/investor|investors|venture capital|vc fund|angel investor|funds|venchurn|инвестор|инвесторы|венчур|фонд|бизнес ангел|інвестор|венчур/.test(q)) return "investor";
  if (/land|plot|property|real estate|apartment|house|недвиж|участ|квартир|дом|земел/.test(q)) return "real_estate";
  if (/company|companies|supplier|manufacturer|distributor|software vendor|компан|поставщик|производител|дистриб/.test(q)) return "company";
  if (/person|people|specialist|expert|broker|agent|manager|founder|человек|люди|специалист|эксперт|брокер|агент|основатель/.test(q)) return "person";
  return "general";
}

const INVESTOR_POSITIVE = /venture capital|vc fund|angel investor|investment fund|private equity|investor|investments|portfolio|portfolio companies|backed by|seed|series a|series b|growth capital|startup|saas|b2b|enterprise|software|technology|tech|инвест|венчур|ангел|портфел|стартап|saas|b2b|enterprise/i;
const INVESTOR_SECTOR = /saas|b2b|enterprise|software|technology|tech|startup|digital|cloud|cyber|fintech|ai|data|platform/i;
const INVESTOR_NOISE = /\b(event|events|conference|conferences|networking|programmes?|programme|webinar|meetup|jobs?|job|career|hiring|vacanc|ipo|initial public offering|stock price|share price|shares|listing|ticker|news)\b|конферен|мероприят|нетворкинг|ваканс|работ|ipo|акци|листинг|новост/i;

function hasCyprusSignal(value: string) {
  return /cyprus|κυπρ|кипр|кипре|κυπρος/i.test(value);
}

export type RelevanceDecision = {
  accepted: boolean;
  score: number;
  reason: string;
};

export function evaluateResearchRelevance(item: any, query: string): RelevanceDecision {
  const kind = inferResearchKind(query);
  const title = join([item?.title, item?.organization, item?.source]);
  const body = join([
    item?.title,
    item?.organization,
    item?.specialization,
    item?.geography,
    item?.investment_type,
    item?.stage,
    item?.ticket,
    item?.why,
    item?.evidence,
    item?.evidence_quote,
    item?.source,
    item?.url,
  ]);
  const q = text(query);

  if (!item?.url || !/^https?:\/\//i.test(String(item.url))) {
    return { accepted: false, score: 0, reason: "missing_valid_url" };
  }
  if (String(item?.evidence_quote || "").trim().length < 20 && String(item?.evidence || "").trim().length < 30) {
    return { accepted: false, score: 25, reason: "insufficient_evidence_text" };
  }

  if (kind === "investor") {
    let score = 0;
    if (INVESTOR_POSITIVE.test(title)) score += 30;
    if (INVESTOR_POSITIVE.test(body)) score += 25;
    if (INVESTOR_SECTOR.test(body)) score += 20;
    if (hasCyprusSignal(body) || hasCyprusSignal(q)) score += 15;
    if (item?.investment_type || item?.stage || item?.ticket) score += 10;

    const noise = INVESTOR_NOISE.test(title) || INVESTOR_NOISE.test(String(item?.evidence || "") + " " + String(item?.evidence_quote || ""));
    if (noise && !INVESTOR_POSITIVE.test(body)) {
      return { accepted: false, score: Math.min(score, 20), reason: "investor_query_noise" };
    }
    if (!INVESTOR_POSITIVE.test(body)) {
      return { accepted: false, score, reason: "no_investor_signal" };
    }
    if (!INVESTOR_SECTOR.test(body)) {
      return { accepted: false, score, reason: "no_target_sector_signal" };
    }
    if (hasCyprusSignal(q) && !hasCyprusSignal(body)) {
      return { accepted: false, score, reason: "no_cyprus_signal" };
    }

    return {
      accepted: score >= 55,
      score,
      reason: score >= 55 ? "investor_relevance_confirmed" : "weak_investor_relevance",
    };
  }

  if (kind === "real_estate") {
    const propertySignal = /land|plot|parcel|property|real estate|terrain|участ|земел|недвиж|parcelas?|solar/i.test(body);
    return propertySignal
      ? { accepted: true, score: 70, reason: "property_relevance" }
      : { accepted: false, score: 10, reason: "not_property_relevant" };
  }

  if (kind === "company") {
    const companySignal = /company|companies|supplier|manufacturer|distributor|organization|corporate|компан|поставщик|производител|организац/i.test(body);
    return companySignal
      ? { accepted: true, score: 65, reason: "company_relevance" }
      : { accepted: false, score: 15, reason: "not_company_relevant" };
  }

  return { accepted: true, score: 60, reason: "general_research" };
}

export function filterResearchResults(items: any[], query: string) {
  const accepted: any[] = [];
  const rejected: Array<{ title: string; url: string; reason: string; score: number }> = [];

  for (const item of items) {
    const decision = evaluateResearchRelevance(item, query);
    if (decision.accepted) {
      accepted.push({ ...item, relevanceScore: decision.score, relevanceReason: decision.reason });
    } else {
      rejected.push({
        title: String(item?.title || item?.organization || item?.source || "Unknown"),
        url: String(item?.url || ""),
        reason: decision.reason,
        score: decision.score,
      });
    }
  }

  return { accepted, rejected };
}
