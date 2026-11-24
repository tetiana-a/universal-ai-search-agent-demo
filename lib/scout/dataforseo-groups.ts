import { isSafePublicUrl } from "@/lib/url-safety";
import { normalizeResultUrl } from "@/lib/result-quality";
import { isQuotaStatus, pauseProvider, providerPaused } from "@/lib/scout/provider-quota";

// Opt-in, billable Google SERP search. Do not activate merely because
// credentials exist: group discovery can run many queries per campaign.
export type DataForSeoHit = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  provider: "dataforseo";
};
export type DataForSeoResult = {
  ok: boolean;
  hits: DataForSeoHit[];
  httpStatus?: number;
  message?: string;
};

export function dataForSeoEnabled() {
  return process.env.DATAFORSEO_GROUP_SEARCH === "on"
    && Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

export function dataForSeoRegion(country: string) {
  if (/поль|poland|polska|polsce|polski/i.test(country)) return "Poland";
  if (/испан|spain|españa/i.test(country)) return "Spain";
  if (/чех|czech|česk/i.test(country)) return "Czech Republic";
  if (/герман|germany|deutschland/i.test(country)) return "Germany";
  if (/слова|slovak/i.test(country)) return "Slovakia";
  if (/австри|austria|österreich/i.test(country)) return "Austria";
  if (/итал|italy|italia/i.test(country)) return "Italy";
  return String(process.env.DATAFORSEO_LOCATION_NAME || "United States").trim();
}

export function mapDataForSeoResponse(body: any): DataForSeoResult {
  const tasks = Array.isArray(body?.tasks) ? body.tasks : [];
  const task = tasks[0];
  const results = Array.isArray(task?.result) ? task.result : [];
  const items = results.flatMap((r: any) => Array.isArray(r?.items) ? r.items : []);
  const hits: DataForSeoHit[] = [];
  for (const item of items) {
    if (item?.type !== "organic" || !item?.url) continue;
    const url = normalizeResultUrl(String(item.url));
    if (!url || !isSafePublicUrl(url)) continue;
    const domain = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    hits.push({ url, domain, title: String(item.title || domain).slice(0, 300),
      snippet: String(item.description || item.snippet || "").slice(0, 1400), provider: "dataforseo" });
  }
  const success = body?.status_code === 20000 && task?.status_code === 20000;
  return success ? { ok: true, hits } : {
    ok: false, hits: [],
    message: "DataForSEO error: " + String(task?.status_message || body?.status_message || "unexpected result").slice(0, 160),
  };
}

// Live Advanced SERP usually answers in 6–30 s; 12 s was too short in production.
export async function dataForSeoSearch(query: string, country: string, language = "pl", budgetMs = 40_000): Promise<DataForSeoResult> {
  if (!dataForSeoEnabled()) return { ok: false, hits: [], message: "DataForSEO group search is not configured." };
  // The API charges 5x for Google's site: and other search operators.
  // We deliberately use ordinary keywords and limit results to depth=10.
  const safeQuery = query.replace(/\bsite:\S+/gi, "").trim().slice(0, 600);
  if (!safeQuery) return { ok: false, hits: [], message: "Search phrase is empty." };
  if (await providerPaused("dataforseo")) return { ok: false, hits: [], message: "DataForSEO: баланс исчерпан, поиск на паузе до завтра." };
  const login = String(process.env.DATAFORSEO_LOGIN);
  const password = String(process.env.DATAFORSEO_PASSWORD);
  const location = dataForSeoRegion(country);
  const isoLanguage = /^(pl|en|ru|es|cs|de|it|sk)$/.test(language) ? language : "en";
  try {
    const response = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Basic " + Buffer.from(login + ":" + password).toString("base64") },
      body: JSON.stringify([{ keyword: safeQuery, location_name: location, language_code: isoLanguage, depth: 10 }]),
      signal: AbortSignal.timeout(Math.max(12_000, Math.min(45_000, budgetMs))),
      cache: "no-store",
    });
    const body = response.ok ? await response.json().catch(() => null) : null;
    // 402xx task codes are DataForSEO's "payment required / insufficient funds".
    if (isQuotaStatus(response.status) || /^402/.test(String(body?.tasks?.[0]?.status_code || body?.status_code || ""))) {
      await pauseProvider("dataforseo", "HTTP " + response.status);
      return { ok: false, hits: [], httpStatus: response.status, message: "DataForSEO: баланс исчерпан, поиск на паузе до завтра." };
    }
    if (!response.ok) return { ok: false, hits: [], httpStatus: response.status, message: "DataForSEO HTTP " + response.status };
    return mapDataForSeoResponse(body);
  } catch (error) {
    return { ok: false, hits: [], message: error instanceof Error && /timeout|abort/i.test(error.name + error.message)
      ? "DataForSEO timed out." : "DataForSEO request failed." };
  }
}
