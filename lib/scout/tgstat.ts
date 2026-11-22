import { isQuotaStatus, pauseProvider, providerPaused } from "@/lib/scout/provider-quota";
// Optional paid TGStat API search; provider documentation:
// https://api.tgstat.ru/docs/ru/channels/search.html
// Never enabled implicitly: some channel-search methods require API Stat S+.
export type TgStatResult = {
  ok: boolean; urls: string[]; error?: string; source: "tgstat";
};
export function tgStatEnabled() {
  return process.env.TGSTAT_SEARCH_ENABLED === "on" && Boolean(String(process.env.TGSTAT_TOKEN || "").trim());
}
function tgStatCountry(input: string): string {
  if (/поль|poland|polska|polsce/i.test(input)) return "pl";
  if (/испан|spain|españa|españa|valencia|барселон/i.test(input)) return "es";
  if (/чех|czech|česk/i.test(input)) return "cz";
  if (/герман|germany|deutschland/i.test(input)) return "de";
  if (/укра|ukrain/i.test(input)) return "ua";
  if (/итал|italy|italia/i.test(input)) return "it";
  if (/франц|france|français/i.test(input)) return "fr";
  if (/австр|austria|österreich/i.test(input)) return "at";
  if (/словак|slovakia/i.test(input)) return "sk";
  return "";
}
export function normalizeTgStatHits(data: any): string[] {
  if (data?.status !== "ok" || !Array.isArray(data?.response?.items)) return [];
  const urls = new Set<string>();
  for (const item of data.response.items) {
    let raw = String(item?.link || item?.username || "");
    if (!raw) continue;
    if (raw.startsWith("@")) raw = "https://t.me/" + raw.slice(1);
    else if (/^t\.me\//.test(raw)) raw = "https://" + raw;
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (url.hostname !== "t.me") continue;
    const name = url.pathname.replace(/^\//, "").replace(/\/$/, "");
    if (!/^[a-z][a-z0-9_]{3,31}$/i.test(name) || /bot$/i.test(name)) continue;
    urls.add("https://t.me/" + name);
  }
  return [...urls];
}
export async function tgStatSearch(topic: string, country: string): Promise<TgStatResult> {
  if (!tgStatEnabled()) return { ok: false, urls: [], source: "tgstat", error: "TGSTAT_NOT_CONFIGURED" };
  const c = tgStatCountry(country);
  const q = String(topic || "").trim().slice(0, 100);
  if (!c || q.length < 3) return { ok: false, urls: [], source: "tgstat", error: "COUNTRY_OR_QUERY_NOT_SUPPORTED" };
  if (await providerPaused("tgstat")) return { ok: false, urls: [], source: "tgstat", error: "TGSTAT_LIMIT_PAUSED" };
  const uri = new URL("https://api.tgstat.ru/channels/search");
  uri.searchParams.set("token", String(process.env.TGSTAT_TOKEN).trim());
  uri.searchParams.set("q", q);
  uri.searchParams.set("country", c);
  uri.searchParams.set("peer_type", "all");
  uri.searchParams.set("limit", "20");
  try {
    const response = await fetch(uri.toString(), { signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (isQuotaStatus(response.status)) { await pauseProvider("tgstat", "HTTP " + response.status); return { ok:false, urls:[], source:"tgstat", error:"TGSTAT_LIMIT_PAUSED" }; }
    if (!response.ok) return { ok:false, urls:[], source:"tgstat", error:"TGSTAT_HTTP_"+response.status };
    const json = await response.json();
    if (json?.status !== "ok") return { ok:false, urls:[], source:"tgstat", error:"TGSTAT_API_ERROR" };
    return { ok: true, urls: normalizeTgStatHits(json), source:"tgstat" };
  } catch {
    return { ok:false, urls:[], source:"tgstat", error:"TGSTAT_TIMEOUT_OR_UNAVAILABLE" };
  }
}
