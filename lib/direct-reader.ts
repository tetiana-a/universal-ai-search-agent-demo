import { isSafePublicUrl } from "@/lib/url-safety";
import { decodeEntities } from "@/lib/keyless-search";

// Reads a public page directly when the Jina Reader is unavailable or rate limited.
// It honours robots.txt, never follows redirects to private hosts, and gives up on
// login walls and bot challenges instead of working around them.

const USER_AGENT = "AureliusResearchBot/2.1 (+https://universal-ai-search-agent-demo.vercel.app)";
const ROBOTS_CACHE = new Map<string, { at: number; rules: string[] }>();

export type DirectReadStatus = "checked" | "unavailable" | "blocked" | "rate_limited" | "policy_restricted" | "auth_required";

// Disallow rules that apply to every crawler ("User-agent: *") or to our bot.
export function parseRobots(text: string): string[] {
  const rules: string[] = [];
  let applies = false;
  let inGroup = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [field, ...rest] = line.split(":");
    const key = field.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!inGroup) applies = false;
      inGroup = true;
      if (value === "*" || /aurelius/i.test(value)) applies = true;
      continue;
    }
    inGroup = false;
    if (key === "disallow" && applies && value) rules.push(value);
  }
  return rules;
}

export function robotsAllows(rules: string[], path: string) {
  return !rules.some((rule) => {
    const pattern = "^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    try { return new RegExp(pattern).test(path); } catch { return path.startsWith(rule); }
  });
}

async function robotsRules(origin: string): Promise<string[]> {
  const cached = ROBOTS_CACHE.get(origin);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.rules;
  let rules: string[] = [];
  try {
    const response = await fetch(origin + "/robots.txt", { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (response.ok) rules = parseRobots(await response.text());
  } catch {}
  ROBOTS_CACHE.set(origin, { at: Date.now(), rules });
  if (ROBOTS_CACHE.size > 200) ROBOTS_CACHE.delete(ROBOTS_CACHE.keys().next().value as string);
  return rules;
}

export function htmlToText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || "";
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities([title, description, body].join("\n"))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export async function directRead(url: string, timeoutMs = 8000): Promise<{ content: string; status: DirectReadStatus; httpStatus?: number }> {
  if (!isSafePublicUrl(url)) return { content: "", status: "blocked" };
  const parsed = new URL(url);
  const rules = await robotsRules(parsed.origin);
  if (!robotsAllows(rules, parsed.pathname + parsed.search)) return { content: "", status: "policy_restricted" };
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (response.url && !isSafePublicUrl(response.url)) return { content: "", status: "blocked" };
    if (response.status === 429) return { content: "", status: "rate_limited", httpStatus: 429 };
    if (response.status === 401) return { content: "", status: "auth_required", httpStatus: 401 };
    if (response.status === 403 || response.status === 451) return { content: "", status: "blocked", httpStatus: response.status };
    if (!response.ok) return { content: "", status: "unavailable", httpStatus: response.status };
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return { content: "", status: "unavailable", httpStatus: response.status };
    const html = (await response.text()).slice(0, 600_000);
    if (/cf-challenge|captcha|g-recaptcha|hcaptcha/i.test(html) && html.length < 40_000) return { content: "", status: "blocked", httpStatus: response.status };
    const content = htmlToText(html).slice(0, 8000);
    return { content, status: content.length > 200 ? "checked" : "unavailable", httpStatus: response.status };
  } catch {
    return { content: "", status: "unavailable" };
  }
}
