import { inferResearchKind, type ResearchKind } from "@/lib/relevance-gate";
import { isSafePublicUrl } from "@/lib/url-safety";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function normalizeText(value: unknown) {
  let raw = "";
  if (typeof value === "string") raw = value;
  else if (typeof value === "number" || typeof value === "boolean") raw = String(value);
  return raw.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9а-яёіїєґ]+/gi, " ").trim();
}

export function normalizeResultUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|ref_src$)/i.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}

export function domainOf(value: unknown) {
  try { return new URL(String(value ?? "")).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

const MULTI_PART_TLDS = /\.(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/;

export function registrableDomain(value: unknown) {
  const host = domainOf(value);
  if (!host) return "";
  const parts = host.split(".");
  const keep = MULTI_PART_TLDS.test(host) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

// Platforms that host many different organisations: the domain alone does not identify an entity.
const SHARED_PLATFORMS = new Set([
  "linkedin.com", "crunchbase.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "t.me", "telegram.me",
  "youtube.com", "reddit.com", "medium.com", "substack.com", "wikipedia.org", "dealroom.co", "pitchbook.com",
  "wellfound.com", "angel.co", "f6s.com", "nfx.com", "tracxn.com", "cbinsights.com", "github.com", "google.com",
  "bloomberg.com", "techcrunch.com", "eu-startups.com", "sifted.eu", "idealista.com", "fotocasa.es", "immobiliare.it",
  "alibaba.com", "made-in-china.com", "globalsources.com", "europages.com", "kompass.com", "yelp.com", "clutch.co",
]);

const LEGAL_SUFFIX = /\b(b ?v|n ?v|ltd|limited|llc|llp|lp|inc|incorporated|gmbh|ag|sa|sl|srl|spa|plc|oy|ab|as|bv|sarl|s a|s l|co|corp|corporation|ооо|зао|ао|оао)\b/g;

export function organizationKey(value: unknown) {
  const base = normalizeText(value).replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
  return base.length >= 3 ? base : "";
}

// ---------------------------------------------------------------------------
// Deduplication / entity resolution
// ---------------------------------------------------------------------------

function entityKeys(item: any, kind: ResearchKind) {
  const keys: string[] = [];
  const url = normalizeResultUrl(item?.url);
  if (url) keys.push("url:" + url.toLowerCase());

  if (kind === "investor" || kind === "company" || kind === "person") {
    const org = organizationKey(item?.organization);
    if (org) keys.push("org:" + org);
    const domain = registrableDomain(url);
    if (domain && !SHARED_PLATFORMS.has(domain)) keys.push("domain:" + domain);
    if (!org) {
      const title = organizationKey(String(item?.title || "").split(/[|–—:-]/)[0]);
      if (title && title.split(" ").length <= 6) keys.push("org:" + title);
    }
  } else {
    const identity = [normalizeText(item?.title), normalizeText(item?.location), normalizeText(item?.area), normalizeText(item?.price)]
      .filter(Boolean).join("|");
    if (identity && normalizeText(item?.title)) keys.push("listing:" + identity);
  }
  return keys;
}

export function dedupeResults<T extends Record<string, any>>(items: T[], query: string) {
  const kind = inferResearchKind(query);
  const parent: number[] = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<string, number>();

  items.forEach((item, index) => {
    for (const key of entityKeys(item, kind)) {
      const seen = owner.get(key);
      if (seen === undefined) owner.set(key, index);
      else parent[find(index)] = find(seen);
    }
  });

  const groups = new Map<number, T[]>();
  items.forEach((item, index) => {
    const root = find(index);
    const bucket = groups.get(root) ?? [];
    bucket.push(item);
    groups.set(root, bucket);
  });

  const out: T[] = [];
  let removed = 0;
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => Number(b?.confidence ?? 0) - Number(a?.confidence ?? 0) || String(b?.evidence_quote ?? b?.evidenceQuote ?? "").length - String(a?.evidence_quote ?? a?.evidenceQuote ?? "").length);
    const best = bucket[0];
    const alternateUrls = Array.from(new Set(bucket.slice(1).map((x) => normalizeResultUrl(x?.url)).filter((u) => u && u !== normalizeResultUrl(best?.url)))).slice(0, 5);
    out.push(alternateUrls.length ? { ...best, alternateUrls, duplicatesMerged: bucket.length - 1 } : best);
    removed += bucket.length - 1;
  }
  return { out, removed };
}

// ---------------------------------------------------------------------------
// Evidence grounding
// ---------------------------------------------------------------------------

// A quote is grounded when it actually appears in text we retrieved ourselves.
export function isQuoteGrounded(quote: unknown, sourceText: unknown) {
  const q = normalizeText(quote);
  const body = normalizeText(sourceText);
  if (q.length < 15 || !body) return false;
  if (body.includes(q)) return true;
  const tokens = q.split(" ").filter((t) => t.length >= 4);
  if (tokens.length < 4) return false;
  const present = tokens.filter((t) => body.includes(t)).length;
  return present / tokens.length >= 0.85;
}

// ---------------------------------------------------------------------------
// Quality Gate
// ---------------------------------------------------------------------------

export type QualityDimension = { pass: boolean; score: number; notes: string[] };
export type QualityGateResult = {
  gate: "PASS" | "REVIEW" | "FAIL";
  passed: number;
  total: number;
  checks: Record<string, boolean>;
  dimensions: { relevance: QualityDimension; evidence: QualityDimension; sourceValidity: QualityDimension; confidence: QualityDimension };
  independentVerification: boolean;
  note: string;
};

export type QualityGateOptions = {
  query: string;
  knownUrls?: Set<string>;
  knownDomains?: Set<string>;
  // Normalized URL -> text we retrieved for that page (search snippet and/or reader content).
  sourceText?: Map<string, string>;
};

export const QUALITY_RULESET = [
  "relevance: result matches the task type, geography and sector",
  "evidence: direct quote present and found in the retrieved source text",
  "source validity: public http(s) URL from a discovered source",
  "confidence: model confidence >= 70",
  "Verified only when all four dimensions pass",
  "REVIEW keeps the result visible for manual checking",
];

function has(value: unknown) {
  const v = String(value ?? "").trim();
  return Boolean(v) && !/^(not specified|не указано|unknown|n\/a|—|-)$/i.test(v);
}

// NOSONAR - each dimension is scored independently so that reviewers can see why a result needs review.
export function evaluateQuality(result: any, options: QualityGateOptions): QualityGateResult {
  const kind = inferResearchKind(options.query);
  const url = normalizeResultUrl(result?.url);
  const domain = domainOf(url);
  const quote = String(result?.evidenceQuote ?? result?.evidence_quote ?? "");
  const evidence = String(result?.evidence ?? "");
  const pageText = options.sourceText?.get(url) ?? "";
  const grounded = pageText ? isQuoteGrounded(quote, pageText) : false;

  const sourceCaptured = !options.knownUrls?.size && !options.knownDomains?.size
    ? true
    : Boolean(options.knownUrls?.has(url) || (domain && options.knownDomains?.has(domain)));

  const sourceNotes: string[] = [];
  const safeUrl = isSafePublicUrl(url);
  if (!safeUrl) sourceNotes.push("URL is missing, not public or not http(s)");
  if (!has(result?.source)) sourceNotes.push("source name missing");
  if (!sourceCaptured) sourceNotes.push("URL was not among discovered sources");
  const sourceValidity: QualityDimension = { pass: safeUrl && sourceCaptured, score: safeUrl ? (sourceCaptured ? 100 : 50) : 0, notes: sourceNotes };

  const evidenceNotes: string[] = [];
  if (quote.trim().length < 20) evidenceNotes.push("evidence quote shorter than 20 characters");
  if (!has(evidence)) evidenceNotes.push("evidence summary missing");
  if (quote.trim().length >= 20 && pageText && !grounded) evidenceNotes.push("quote not found in retrieved source text");
  // Without any retrieved text (e.g. a provider that returns only citations) the quote cannot be
  // checked: the dimension may pass on presence, but the result can never become "Verified".
  const canCheck = Boolean(options.sourceText);
  if (canCheck && !pageText) evidenceNotes.push("source text was not retrieved; quote cannot be checked");
  const evidencePass = quote.trim().length >= 20 && (canCheck ? grounded : has(evidence));
  const evidenceDim: QualityDimension = { pass: evidencePass, score: evidencePass ? 100 : quote.trim().length >= 20 ? 50 : 0, notes: evidenceNotes };

  const tier = String(result?.relevanceTier || "accept");
  const relevanceScore = Number(result?.relevanceScore ?? (tier === "accept" ? 60 : 40));
  const relevance: QualityDimension = { pass: tier === "accept", score: relevanceScore, notes: tier === "accept" ? [] : [String(result?.relevanceReason || "needs relevance review")] };

  const confidenceValue = Math.max(0, Math.min(100, Number(result?.confidence ?? 0)));
  const confidence: QualityDimension = { pass: confidenceValue >= 70, score: confidenceValue, notes: confidenceValue >= 70 ? [] : ["confidence below 70"] };

  const isProperty = kind === "real_estate";
  const structured = isProperty
    ? has(result?.area) || has(result?.price)
    : [result?.organization, result?.specialization, result?.geography, result?.contact, result?.investmentType, result?.stage, result?.ticket, result?.area, result?.price].some(has);

  const checks = {
    sourceUrl: safeUrl,
    sourceName: has(result?.source),
    evidence: has(evidence),
    evidenceQuote: quote.trim().length >= 20,
    evidenceGrounded: grounded,
    title: has(result?.title) && result?.title !== "Untitled result",
    location: has(result?.location) || has(result?.geography),
    structuredValue: structured,
    confidence: confidence.pass,
    sourceCaptured,
    relevance: relevance.pass,
  };

  const dimensions = { relevance, evidence: evidenceDim, sourceValidity, confidence };
  const gate: QualityGateResult["gate"] = !safeUrl
    ? "FAIL"
    : Object.values(dimensions).every((d) => d.pass)
      ? "PASS"
      : "REVIEW";

  const passed = Object.values(checks).filter(Boolean).length;
  const reasons = Object.entries(dimensions).filter(([, d]) => !d.pass).map(([name, d]) => name + ": " + (d.notes[0] || "not passed"));
  return {
    gate,
    passed,
    total: Object.keys(checks).length,
    checks,
    dimensions,
    independentVerification: Boolean(result?.independentVerification ?? result?.independent_verification),
    note: gate === "PASS" ? "All quality dimensions passed." : gate === "FAIL" ? "Invalid source URL." : "Manual review: " + reasons.join("; "),
  };
}

export type VerificationStatus = "Verified" | "Reviewed" | "Manual review";

// "Verified" is earned, never taken from the model's word.
export function reconcileStatus(claimed: unknown, gate: QualityGateResult): VerificationStatus {
  const status = ["Verified", "Reviewed", "Manual review"].includes(String(claimed)) ? (claimed as VerificationStatus) : "Reviewed";
  if (gate.gate !== "PASS") return "Manual review";
  if (status === "Verified" && !gate.checks.evidenceGrounded) return "Reviewed";
  return status;
}

export function applyQualityGate<T extends Record<string, any>>(results: T[], options: QualityGateOptions) {
  const gated = results.map((result) => {
    const qualityGate = evaluateQuality(result, options);
    return { ...result, status: reconcileStatus(result?.status, qualityGate), qualityGate };
  });
  const order = { PASS: 0, REVIEW: 1, FAIL: 2 } as const;
  gated.sort((a, b) => order[a.qualityGate.gate] - order[b.qualityGate.gate] || Number(b.match ?? 0) - Number(a.match ?? 0));
  const pass = gated.filter((r) => r.qualityGate.gate === "PASS").length;
  const review = gated.filter((r) => r.qualityGate.gate === "REVIEW").length;
  const fail = gated.filter((r) => r.qualityGate.gate === "FAIL").length;
  const evidenceCount = gated.filter((r) => r.qualityGate.checks.evidence && r.qualityGate.checks.evidenceQuote).length;
  const groundedCount = gated.filter((r) => r.qualityGate.checks.evidenceGrounded).length;
  return {
    results: gated.map((r, i) => ({ ...r, id: i + 1 })),
    summary: {
      total: gated.length, pass, review, fail,
      evidenceCount, groundedCount,
      independentVerification: gated.some((r) => r.qualityGate.independentVerification),
      ruleSet: QUALITY_RULESET,
    },
  };
}
