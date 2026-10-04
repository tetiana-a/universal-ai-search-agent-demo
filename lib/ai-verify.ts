import { runStructuredExtraction, type AiAttempt, type AiProviderId, type Edition } from "@/lib/free-ai";
import type { ResearchKind } from "@/lib/relevance-gate";
import { describeCriteria, type NumericCriteria } from "@/lib/criteria";

// Stage 4 of the spec with a free model: every page that was read is checked by the AI
// (is it one real object/company/person matching the task, or an article, list, forum,
// video?) and its fields are extracted. The request is kept small (short page excerpts,
// a flat schema, a few hundred output tokens per page) so a free model answers in time;
// pages are sent in parallel batches.

export type VerifyPage = { id: number; url: string; title: string; domain: string; content: string };

export type VerifiedItem = {
  id: number;
  keep: boolean;
  page_type: "entity" | "listing_index" | "article" | "catalog" | "forum_or_video" | "other";
  name: string;
  organization: string;
  location: string;
  area: string;
  price: string;
  specialization: string;
  contact: string;
  investment_type: string;
  stage: string;
  ticket: string;
  match: number;
  evidence_quote: string;
  why: string;
};

export const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          keep: { type: "boolean" },
          page_type: { type: "string", enum: ["entity", "listing_index", "article", "catalog", "forum_or_video", "other"] },
          name: { type: "string" },
          organization: { type: "string" },
          location: { type: "string" },
          area: { type: "string" },
          price: { type: "string" },
          specialization: { type: "string" },
          contact: { type: "string" },
          investment_type: { type: "string" },
          stage: { type: "string" },
          ticket: { type: "string" },
          match: { type: "integer" },
          evidence_quote: { type: "string" },
          why: { type: "string" },
        },
        required: ["id", "keep", "page_type", "name", "match", "evidence_quote", "why"],
      },
    },
  },
  required: ["results"],
} as const;

const KIND_RULES: Record<ResearchKind, string> = {
  real_estate: "An entity is ONE concrete property offer (one plot, one house, one apartment) with its own page. A portal search page, a category page or a list of many offers is listing_index, not an entity. Extract area (with unit as written) and price.",
  investor: "An entity is ONE investor: a venture fund, an angel network, a family office or a named business angel, on its own site or profile. 'Top 10 investors' articles, rankings, news and event pages are article/listing_index, not entities. Extract investment_type, stage, ticket.",
  company: "An entity is ONE company: its own website, or its supplier/company page on a B2B platform (Made-in-China, Alibaba, Global Sources, Europages…). For manufacturers it must make the product itself (factory/manufacturer), not only write about it. Blog posts, 'top manufacturers' lists, Reddit, YouTube and Quora are not entities. Extract organization, specialization, location, contact.",
  person: "An entity is ONE professional or ONE firm (law firm, bureau) with its own page or directory profile. Articles and lists of many people are not entities. Extract organization, specialization, location, contact.",
  general: "An entity is one item that directly answers the task. Pages that only discuss the topic are articles.",
};

function excerpt(content: string, max = 2200) {
  return String(content || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]{0,80})\]\((https?:[^)]*)\)/g, "$1")
    .replace(/^(Title|URL Source|Markdown Content|Published Time):.*$/gim, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, max);
}

export function buildVerifyPrompt(query: string, kind: ResearchKind, criteria: NumericCriteria, lang: "ru" | "en", pages: VerifyPage[]) {
  // Larger batches get shorter excerpts so the request stays small for a free model.
  const perPage = pages.length > 3 ? 1500 : 2200;
  const numeric = describeCriteria(criteria, "en");
  const system = [
    "You verify web pages for a research task and extract structured facts. Use only text from the pages; never invent facts or URLs.",
    KIND_RULES[kind],
    "For every page return one item with its id. keep=true only when the page is a single entity that matches the task (place, type, criteria). keep=false for articles, rankings, listicles, forums, videos, list/search pages, unrelated pages, or when a stated value breaks a numeric criterion.",
    numeric ? "Numeric criteria: " + numeric + ". If the page states a value outside this range, keep=false. If it states no value, keep=true only if everything else matches and say so in why." : "",
    "organization: the legal or brand name of the entity the page itself is about (from the page title, header, logo text or imprint), never a client, partner, investor or other company mentioned on the page. location: the city and country of that entity.",
    "match: 0-100, how well the page fits the whole task. evidence_quote: one short sentence copied verbatim from the page that proves the match (empty if none). why: one short sentence in " + (lang === "ru" ? "Russian" : "English") + ". Leave unknown fields as empty strings.",
    "Return ONLY a JSON object {\"results\":[...]}.",
  ].filter(Boolean).join("\n");
  const user = [
    "TASK: " + query,
    "",
    ...pages.map((p) => "PAGE id=" + p.id + "\nURL: " + p.url + "\nTITLE: " + p.title + "\nTEXT:\n" + excerpt(p.content, perPage) + "\n"),
  ].join("\n");
  return { system, user };
}

export type VerifyOutcome = {
  items: VerifiedItem[];
  attempts: AiAttempt[];
  provider?: AiProviderId;
  model?: string;
  usage: any;
  error: string;
  checkedPages: number;
  quotaExhausted: boolean;
};

export async function verifyPagesWithAi(options: {
  query: string;
  kind: ResearchKind;
  criteria: NumericCriteria;
  language: "ru" | "en";
  pages: VerifyPage[];
  edition: Edition;
  deadlineAt: number;
  batchSize?: number;
}): Promise<VerifyOutcome> {
  const size = Math.max(1, options.batchSize || 6);
  const batches: VerifyPage[][] = [];
  for (let i = 0; i < options.pages.length; i += size) batches.push(options.pages.slice(i, i + size));
  const outcomes = await Promise.all(batches.map((batch) => {
    const { system, user } = buildVerifyPrompt(options.query, options.kind, options.criteria, options.language, batch);
    return runStructuredExtraction({
      system,
      user,
      schema: VERIFY_SCHEMA,
      edition: options.edition,
      deadlineAt: options.deadlineAt,
      // Generous: some free models think before answering and return nothing when cut off.
      maxTokens: 500 * batch.length + 600,
      perCallTimeoutMs: Number(process.env.FREE_AI_TIMEOUT_MS || 25000),
    }).then((out) => ({ out, batch }));
  }));

  const items: VerifiedItem[] = [];
  const attempts: AiAttempt[] = [];
  let provider: AiProviderId | undefined;
  let model: string | undefined;
  let usage: any = null;
  let checkedPages = 0;
  const errors: string[] = [];
  for (const { out, batch } of outcomes) {
    attempts.push(...out.attempts);
    if (!out.parsed) { errors.push(out.error); continue; }
    provider = provider || out.provider;
    model = model || out.model;
    usage = usage || out.usage;
    checkedPages += batch.length;
    const ids = new Set(batch.map((p) => p.id));
    for (const raw of Array.isArray(out.parsed?.results) ? out.parsed.results : []) {
      const id = Number(raw?.id);
      if (!ids.has(id)) continue;
      items.push({
        id,
        keep: raw?.keep === true || raw?.keep === "true",
        page_type: ["entity", "listing_index", "article", "catalog", "forum_or_video", "other"].includes(raw?.page_type) ? raw.page_type : "other",
        name: String(raw?.name || "").slice(0, 200),
        organization: String(raw?.organization || "").slice(0, 200),
        location: String(raw?.location || "").slice(0, 160),
        area: String(raw?.area || "").slice(0, 80),
        price: String(raw?.price || "").slice(0, 80),
        specialization: String(raw?.specialization || "").slice(0, 200),
        contact: String(raw?.contact || "").slice(0, 200),
        investment_type: String(raw?.investment_type || "").slice(0, 120),
        stage: String(raw?.stage || "").slice(0, 120),
        ticket: String(raw?.ticket || "").slice(0, 120),
        match: Math.max(0, Math.min(100, Math.round(Number(raw?.match) || 0))),
        evidence_quote: String(raw?.evidence_quote || "").slice(0, 400),
        why: String(raw?.why || "").slice(0, 300),
      });
    }
  }
  const failed = outcomes.length - outcomes.filter((o) => o.out.parsed).length;
  const error = failed ? [...new Set(errors)].join(" ").slice(0, 600) : "";
  const quotaExhausted = outcomes.some((o) => !o.out.parsed && o.out.quotaExhausted);
  return { items, attempts, provider, model, usage, error, checkedPages, quotaExhausted };
}
