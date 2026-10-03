import { isSafePublicUrl } from "@/lib/url-safety";
import { normalizeResultUrl } from "@/lib/result-quality";

// Search that needs no API key, so the Free edition works on a fresh deploy.
// DuckDuckGo's HTML endpoints are used as a normal visitor would see them; a bot
// challenge is reported as rate_limited and never worked around. An optional
// self-hosted SearXNG (SEARXNG_URL) gives a more stable keyless backend.

export type KeylessHit = { title: string; url: string; snippet: string; domain: string; provider: "duckduckgo" | "searxng" };
export type KeylessOutcome = { provider: "duckduckgo" | "searxng"; ok: boolean; hits: KeylessHit[]; status?: "rate_limited" | "error"; httpStatus?: number; message?: string };

const USER_AGENT = "Mozilla/5.0 (compatible; AureliusResearchBot/2.1; +https://universal-ai-search-agent-demo.vercel.app)";

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

export function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function stripTags(value: string) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

// DuckDuckGo wraps outbound links as //duckduckgo.com/l/?uddg=<encoded target>.
export function unwrapDuckDuckGoUrl(href: string) {
  const raw = decodeEntities(href.trim());
  try {
    const url = new URL(raw.startsWith("//") ? "https:" + raw : raw, "https://duckduckgo.com");
    if (url.hostname.endsWith("duckduckgo.com")) {
      if (url.pathname.startsWith("/y.js")) return ""; // ads
      const target = url.searchParams.get("uddg");
      return target ? target : "";
    }
    return url.toString();
  } catch { return ""; }
}

function toHit(rawUrl: string, title: string, snippet: string, provider: KeylessHit["provider"]): KeylessHit | null {
  const url = normalizeResultUrl(rawUrl);
  if (!url || !isSafePublicUrl(url)) return null;
  const domain = host(url);
  if (!domain || domain.endsWith("duckduckgo.com")) return null;
  return { title: title || domain, url, snippet: snippet.slice(0, 1400), domain, provider };
}

export function parseDuckDuckGoHtml(html: string): KeylessHit[] {
  const hits: KeylessHit[] = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    if (/result--ad\b/.test(block.slice(0, 200))) continue;
    const link = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const snippet = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/i);
    const hit = toHit(unwrapDuckDuckGoUrl(link[1]), stripTags(link[2]), snippet ? stripTags(snippet[1]) : "", "duckduckgo");
    if (hit) hits.push(hit);
  }
  return hits;
}

export function parseDuckDuckGoLite(html: string): KeylessHit[] {
  const hits: KeylessHit[] = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>|<a[^>]+class=['"]result-link['"][^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [...html.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
  let index = 0;
  for (const m of html.matchAll(re)) {
    const href = m[1] || m[3];
    const title = stripTags(m[2] || m[4] || "");
    const hit = toHit(unwrapDuckDuckGoUrl(href), title, snippets[index] || "", "duckduckgo");
    index += 1;
    if (hit) hits.push(hit);
  }
  return hits;
}

function looksLikeChallenge(status: number, html: string) {
  return status === 202 || status === 403 || status === 429 || /anomaly-modal|challenge-form|detected unusual/i.test(html);
}

const REGION: Record<string, string> = { ru: "ru-ru", en: "wt-wt", uk: "ua-uk", cs: "cz-cs", de: "de-de", es: "es-es" };

export async function duckDuckGoSearch(query: string, language = "en", timeoutMs = 9000): Promise<KeylessOutcome> {
  const kl = REGION[language] || "wt-wt";
  const attempts: Array<{ url: string; parse: (html: string) => KeylessHit[] }> = [
    { url: "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query) + "&kl=" + kl, parse: parseDuckDuckGoHtml },
    { url: "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query) + "&kl=" + kl, parse: parseDuckDuckGoLite },
  ];
  let last: KeylessOutcome = { provider: "duckduckgo", ok: false, hits: [], status: "error", message: "DuckDuckGo did not respond." };
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html", "Accept-Language": language === "ru" ? "ru,en;q=0.8" : "en" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      const html = await response.text();
      if (looksLikeChallenge(response.status, html)) {
        last = { provider: "duckduckgo", ok: false, hits: [], status: "rate_limited", httpStatus: response.status, message: "DuckDuckGo asked for a human check (rate limit). It is not bypassed; add a search API key or SEARXNG_URL for stable results." };
        continue;
      }
      if (!response.ok) {
        last = { provider: "duckduckgo", ok: false, hits: [], status: "error", httpStatus: response.status, message: "DuckDuckGo HTTP " + response.status + "." };
        continue;
      }
      return { provider: "duckduckgo", ok: true, hits: attempt.parse(html) };
    } catch (error) {
      last = { provider: "duckduckgo", ok: false, hits: [], status: "error", message: "DuckDuckGo request failed: " + (error instanceof Error ? error.message : "network error") };
    }
  }
  return last;
}

export async function searxngSearch(query: string, language = "en", timeoutMs = 9000): Promise<KeylessOutcome> {
  const base = String(process.env.SEARXNG_URL || "").trim().replace(/\/$/, "");
  if (!base) return { provider: "searxng", ok: false, hits: [], status: "error", message: "SEARXNG_URL is not set." };
  try {
    const response = await fetch(base + "/search?format=json&q=" + encodeURIComponent(query) + "&language=" + encodeURIComponent(language), {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (response.status === 429) return { provider: "searxng", ok: false, hits: [], status: "rate_limited", httpStatus: 429, message: "SearXNG rate limit." };
    if (!response.ok) return { provider: "searxng", ok: false, hits: [], status: "error", httpStatus: response.status, message: "SearXNG HTTP " + response.status + " (is format=json enabled?)." };
    const payload: any = await response.json().catch(() => null);
    const hits = (Array.isArray(payload?.results) ? payload.results : [])
      .map((row: any) => toHit(String(row?.url || ""), String(row?.title || ""), String(row?.content || ""), "searxng"))
      .filter(Boolean) as KeylessHit[];
    return { provider: "searxng", ok: true, hits };
  } catch (error) {
    return { provider: "searxng", ok: false, hits: [], status: "error", message: "SearXNG request failed: " + (error instanceof Error ? error.message : "network error") };
  }
}

export function keylessSearchEnabled() {
  return process.env.KEYLESS_SEARCH !== "off";
}

export function keylessProviders() {
  const out: Array<"searxng" | "duckduckgo"> = [];
  if (!keylessSearchEnabled()) return out;
  if (process.env.SEARXNG_URL) out.push("searxng");
  out.push("duckduckgo");
  return out;
}

// Runs queries sequentially with a small pause: keyless endpoints are shared and
// bursts are what trigger their rate limits.
export async function runKeylessSearch(queries: string[], language = "en", deadlineAt = Date.now() + 25_000) {
  const outcomes: KeylessOutcome[] = [];
  const providers = keylessProviders();
  for (const [index, query] of queries.entries()) {
    if (Date.now() > deadlineAt - 3000) break;
    for (const provider of providers) {
      const outcome = provider === "searxng" ? await searxngSearch(query, language) : await duckDuckGoSearch(query, language);
      outcomes.push(outcome);
      if (outcome.ok && outcome.hits.length) break; // next query
    }
    const throttled = outcomes.some((o) => o.provider === "duckduckgo" && o.status === "rate_limited");
    if (throttled && !process.env.SEARXNG_URL) break;
    if (index < queries.length - 1) await new Promise((resolve) => setTimeout(resolve, Number(process.env.KEYLESS_SEARCH_PAUSE_MS ?? 350)));
  }
  return outcomes;
}
