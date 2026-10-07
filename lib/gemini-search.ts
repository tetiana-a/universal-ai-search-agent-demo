import { isSafePublicUrl } from "@/lib/url-safety";
import { normalizeResultUrl } from "@/lib/result-quality";

// Web search through Gemini's built-in Google Search grounding. It uses the same
// free GEMINI_API_KEY as the AI checks, so search keeps working when Jina runs out
// of balance and DuckDuckGo answers Vercel servers with a captcha. Only the sources
// Google actually returned (grounding chunks) are used; URLs written by the model
// itself are ignored, so nothing here is invented.

export type GeminiSearchHit = { title: string; url: string; snippet: string; domain: string; provider: "gemini_search" };
export type GeminiSearchOutcome = { ok: boolean; hits: GeminiSearchHit[]; httpStatus?: number; status?: "rate_limited" | "error"; message?: string };

const REDIRECT_HOST = "vertexaisearch.cloud.google.com";

export function geminiSearchKey() {
  if (process.env.GEMINI_SEARCH === "off") return "";
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "").trim();
}

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

// Grounding links point at a Google redirect; the real page is in its Location header.
async function resolveRedirect(uri: string): Promise<string> {
  if (host(uri) !== REDIRECT_HOST) return uri;
  try {
    const response = await fetch(uri, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000), cache: "no-store" });
    const location = response.headers.get("location") || "";
    return /^https?:\/\//i.test(location) ? location : "";
  } catch { return ""; }
}

type Chunk = { web?: { uri?: string; title?: string } };
type Support = { segment?: { text?: string }; groundingChunkIndices?: number[] };

export function snippetsByChunk(supports: Support[] | undefined) {
  const out = new Map<number, string>();
  for (const support of supports || []) {
    const text = String(support?.segment?.text || "").trim();
    if (!text) continue;
    for (const index of support.groundingChunkIndices || []) {
      const prev = out.get(index) || "";
      if (prev.length < 900) out.set(index, (prev ? prev + " " : "") + text);
    }
  }
  return out;
}

export async function geminiSearch(query: string, language = "en"): Promise<GeminiSearchOutcome> {
  const key = geminiSearchKey();
  if (!key) return { ok: false, hits: [], status: "error", message: "GEMINI_API_KEY is not set." };
  const model = process.env.GEMINI_SEARCH_MODEL || "gemini-2.5-flash";
  const prompt = (language === "ru"
    ? "Найди в интернете конкретные первоисточники (официальные сайты компаний, каталоги, объявления, реестры) по запросу: "
    : "Search the web for specific primary sources (official company sites, catalogues, listings, registries) for: ")
    + query
    + (language === "ru" ? ". Кратко перечисли найденные источники." : ". Briefly list the sources you found.");
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0 } }),
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      const limited = response.status === 429;
      return {
        ok: false,
        hits: [],
        httpStatus: response.status,
        status: limited ? "rate_limited" : "error",
        message: limited
          ? "Gemini search daily free quota is used up (HTTP 429)."
          : response.status === 400 || response.status === 403 ? "Gemini rejected the key or request (HTTP " + response.status + "). Check GEMINI_API_KEY." : "Gemini search failed (HTTP " + response.status + ").",
      };
    }
    const payload = await response.json().catch(() => null);
    const meta = payload?.candidates?.[0]?.groundingMetadata;
    const chunks: Chunk[] = Array.isArray(meta?.groundingChunks) ? meta.groundingChunks : [];
    const snippets = snippetsByChunk(meta?.groundingSupports);
    const resolved = await Promise.all(chunks.map((chunk) => resolveRedirect(String(chunk?.web?.uri || ""))));
    const hits: GeminiSearchHit[] = [];
    resolved.forEach((raw, index) => {
      const url = normalizeResultUrl(raw);
      if (!url || !isSafePublicUrl(url)) return;
      const domain = host(url);
      if (!domain || domain === REDIRECT_HOST) return;
      const title = String(chunks[index]?.web?.title || domain);
      hits.push({ title, url, snippet: (snippets.get(index) || "").slice(0, 1400), domain, provider: "gemini_search" });
    });
    return { ok: true, hits };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, hits: [], status: "error", message: timeout ? "Gemini search timed out." : "Gemini search request failed." };
  }
}
