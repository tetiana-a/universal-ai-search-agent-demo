import { isSafePublicUrl } from "@/lib/url-safety";
import { normalizeResultUrl } from "@/lib/result-quality";
import { isQuotaStatus, pauseProvider, providerPaused } from "@/lib/scout/provider-quota";

// Opt-in Apify "Google Search Results Scraper" (apify/google-search-scraper):
// Google results for ordinary search phrases, so public group/profile links are
// found without logging into Facebook or scraping behind a wall. Free plan gives
// monthly credit; one run with several queries costs a fraction of a cent.
export type ApifyHit = { title: string; url: string; snippet: string; domain: string; provider: "apify"; query: string };
export type ApifyResult = { ok: boolean; hits: ApifyHit[]; httpStatus?: number; message?: string };

const ACTOR = "https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items";

export function apifyEnabled() {
  return process.env.APIFY_GROUP_SEARCH === "on" && Boolean(String(process.env.APIFY_TOKEN || "").trim());
}

export function apifyCountry(country: string) {
  if (/поль|poland|polska|polsce/i.test(country)) return "pl";
  if (/испан|spain|españa/i.test(country)) return "es";
  if (/чех|czech|česk/i.test(country)) return "cz";
  if (/герман|germany|deutschland/i.test(country)) return "de";
  if (/итал|italy|italia/i.test(country)) return "it";
  if (/укра|ukrain/i.test(country)) return "ua";
  return "";
}

// Google's own language codes as the actor accepts them; anything else is sent as "" (any language).
const APIFY_LANGS = new Set("af sq sm ar az eu be bn bh bs bg ca zh-CN zh-TW hr cs da nl en eo et fo fi fr fy gl ka de el gu iw hi hu is id ia ga it ja jw kn ko la lv lt mk ms ml mt mr sr no oc fa pl pt-BR pt-PT pa ro ru gd sk sl es su sw sv tl ta te th ti tr uk ur uz vi cy xh zu".split(" "));
const APIFY_ALIAS: Record<string, string> = { zh: "zh-CN", he: "iw", pt: "pt-PT", jv: "jw", nb: "no", nn: "no", fil: "tl" };
export function apifyLanguage(code: string) {
  const c = APIFY_ALIAS[code.toLowerCase()] || code;
  return APIFY_LANGS.has(c) ? c : "";
}

export function mapApifyItems(items: unknown): ApifyHit[] {
  const hits: ApifyHit[] = [];
  for (const page of Array.isArray(items) ? items : []) {
    const query = String((page as any)?.searchQuery?.term || "");
    for (const row of Array.isArray((page as any)?.organicResults) ? (page as any).organicResults : []) {
      const url = normalizeResultUrl(String(row?.url || ""));
      if (!url || !isSafePublicUrl(url)) continue;
      const domain = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      hits.push({ url, domain, query, provider: "apify", title: String(row?.title || domain).slice(0, 300), snippet: String(row?.description || "").slice(0, 1400) });
    }
  }
  return hits;
}

// Google scraping for 4 queries often takes 40–90 s; a shorter run timeout makes
// Apify abort the run (TIMED-OUT) and answer HTTP 400 with no results.
export async function apifySearch(queries: string[], country: string, language = "en", budgetMs = 120_000): Promise<ApifyResult> {
  if (!apifyEnabled()) return { ok: false, hits: [], message: "Apify group search is not configured." };
  if (await providerPaused("apify")) return { ok: false, hits: [], message: "Apify: лимит исчерпан, поиск через Apify на паузе до завтра." };
  const list = queries.map((q) => q.trim()).filter(Boolean).slice(0, 4); // budget per search run
  if (!list.length) return { ok: false, hits: [], message: "Search phrase is empty." };
  const input: Record<string, unknown> = { queries: list.join("\n"), resultsPerPage: 10, maxPagesPerQuery: 1, languageCode: apifyLanguage(language) };
  const code = apifyCountry(country);
  if (code) input.countryCode = code;
  try {
    const runSeconds = Math.max(30, Math.min(150, Math.floor(budgetMs / 1000) - 5));
    const response = await fetch(ACTOR + "?timeout=" + runSeconds, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + String(process.env.APIFY_TOKEN).trim() },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((runSeconds + 5) * 1000),
      cache: "no-store",
    });
    if (isQuotaStatus(response.status)) {
      await pauseProvider("apify", "HTTP " + response.status);
      return { ok: false, hits: [], httpStatus: response.status, message: "Apify: лимит или баланс исчерпан (HTTP " + response.status + "), поиск через Apify на паузе до завтра." };
    }
    if (!response.ok) {
      const body: any = await response.json().catch(() => null);
      const reason = String(body?.error?.message || body?.error?.type || "").replace(/\s+/g, " ").slice(0, 160);
      if (/TIMED-OUT/i.test(reason)) return { ok: false, hits: [], httpStatus: response.status, message: "Apify не успел ответить за " + runSeconds + " с (таймаут) — результаты из других источников." };
      return { ok: false, hits: [], httpStatus: response.status, message: "Apify HTTP " + response.status + (reason ? ": " + reason : "") };
    }
    return { ok: true, hits: mapApifyItems(await response.json()) };
  } catch (error) {
    return { ok: false, hits: [], message: error instanceof Error && /timeout|abort/i.test(error.name + error.message) ? "Apify не успел ответить (таймаут) — результаты из других источников." : "Apify request failed." };
  }
}
