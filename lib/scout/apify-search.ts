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

export async function apifySearch(queries: string[], country: string, language = "en"): Promise<ApifyResult> {
  if (!apifyEnabled()) return { ok: false, hits: [], message: "Apify group search is not configured." };
  if (await providerPaused("apify")) return { ok: false, hits: [], message: "Apify: лимит исчерпан, поиск через Apify на паузе до завтра." };
  const list = queries.map((q) => q.trim()).filter(Boolean).slice(0, 4); // budget per search run
  if (!list.length) return { ok: false, hits: [], message: "Search phrase is empty." };
  const input: Record<string, unknown> = { queries: list.join("\n"), resultsPerPage: 10, maxPagesPerQuery: 1, languageCode: /^[a-z]{2}$/.test(language) ? language : "en" };
  const code = apifyCountry(country);
  if (code) input.countryCode = code;
  try {
    const response = await fetch(ACTOR + "?timeout=40", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + String(process.env.APIFY_TOKEN).trim() },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
    if (isQuotaStatus(response.status)) {
      await pauseProvider("apify", "HTTP " + response.status);
      return { ok: false, hits: [], httpStatus: response.status, message: "Apify: лимит или баланс исчерпан (HTTP " + response.status + "), поиск через Apify на паузе до завтра." };
    }
    if (!response.ok) return { ok: false, hits: [], httpStatus: response.status, message: "Apify HTTP " + response.status };
    return { ok: true, hits: mapApifyItems(await response.json()) };
  } catch (error) {
    return { ok: false, hits: [], message: error instanceof Error && /timeout|abort/i.test(error.name + error.message) ? "Apify timed out." : "Apify request failed." };
  }
}
