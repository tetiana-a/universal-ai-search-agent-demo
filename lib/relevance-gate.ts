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

const INVESTOR_ENTITY = /venture capital|vc fund|venture firm|angel investor|investment fund|private equity|family office|investor|investors|инвестор|инвесторы|венчур|инвестиц|бизнес ангел|інвестор/i;
const INVESTMENT_ACTIVITY = /invests?|investment strategy|investment focus|portfolio companies?|backed by|funding|financ(?:e|ing)|seed|series a|series b|growth capital|investment mandate|инвестирует|инвестицион|портфел|финансир|стартап/i;
const INVESTOR_SECTOR = /saas|b2b|enterprise|software|technology|tech|startup|digital|cloud|cyber|fintech|ai|data|platform|software as a service/i;
const INVESTOR_NOISE = /\b(event|events|conference|conferences|networking|programmes?|programme|webinar|meetup|jobs?|job|career|hiring|vacanc(?:y|ies)|ipo|initial public offering|stock price|share price|shares|listing|ticker|news)\b|конферен|мероприят|нетворкинг|ваканс|работ|ipo|акци|листинг|новост/i;

function hasCyprusSignal(value:export function evaluateResearchRelevance(item: any, query: string): RelevanceDecision {
  const kind = inferResearchKind(query);
  const title = join([item?.title, item?.organization, item?.source]);
  const body = join([
    item?.title, item?.organization, item?.specialization, item?.geography,
    item?.investment_type, item?.stage, item?.ticket, item?.why,
    item?.evidence, item?.evidence_quote, item?.source, item?.url,
  ]);
  const q = text(query);

  if (!item?.url || !/^https?:\/\//i.test(String(item.url))) {
    return { accepted: false, score: 0, reason: "missing_valid_url" };
  }

  const evidenceText = String(item?.evidence_quote || item?.evidence || "").trim();
  if (evidenceText.length < 20) {
    return { accepted: false, score: 15, reason: "insufficient_evidence_text" };
  }

  if (kind === "investor") {
    let score = 0;
    const hasInvestorEntity = INVESTOR_ENTITY.test(body);
    const hasInvestmentActivity = INVESTMENT_ACTIVITY.test(body);
    const hasSector = INVESTOR_SECTOR.test(body);
    const hasCyprus = hasCyprusSignal(body);
    const queryHasCyprus = hasCyprusSignal(q);
    const noise = INVESTOR_NOISE.test(title) || INVESTOR_NOISE.test(String(item?.evidence || "") + " " + String(item?.evidence_quote || ""));

    if (hasInvestorEntity) score += 35;
    if (hasInvestmentActivity) score += 25;
    if (hasSector) score += 15;
    if (hasCyprus) score += 15;
    if (item?.investment_type || item?.stage || item?.ticket) score += 10;

    if (noise && !hasInvestorEntity && !hasInvestmentActivity) {
      return { accepted: false, score: Math.min(score, 20), reason: "investor_query_noise" };
    }
    if (!hasInvestorEntity && !hasInvestmentActivity) {
      return { accepted: false, score, reason: "no_investor_activity_signal" };
    }

    if (queryHasCyprus && !hasCyprus) {
      return {
        accepted: score >= 45,
        score,
        reason: score >= 45 ? "investor_found_cyprus_link_unconfirmed" : "weak_cyprus_fit",
      };
    }

    return {
      accepted: score >= 45,
      score,
      reason: score >= 60 ? "investor_relevance_confirmed" : "investor_identity_needs_review",
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
