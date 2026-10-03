import { vi } from "vitest";

export type MockRoute = {
  match: (url: string, init?: RequestInit) => boolean;
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>;
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

// Replaces global fetch; unmatched URLs fail loudly so no test reaches the network.
export function mockFetch(routes: MockRoute[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input?.url);
    calls.push({ url, init });
    const route = routes.find((r) => r.match(url, init));
    if (!route) throw new Error("Unexpected fetch in test: " + url);
    return route.respond(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

export const VC_PAGE = "Northwave Ventures is an Amsterdam-based venture capital fund. We invest in early-stage B2B software companies across the Netherlands, with tickets from EUR 500k to EUR 3m. Our portfolio includes 40 companies.";
export const EVENT_PAGE = "Join the Amsterdam Investor Networking Night 2026 — an event for founders to meet angels. Tickets on sale now.";

export function openRouterReply(payload: unknown) {
  return json({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: { total_tokens: 1000 } });
}

export function researchPayload(results: any[]) {
  return {
    query_understanding: { intent: "find investors", entity_type: "investor", geography: ["Amsterdam"], languages: ["en"], criteria: [], exclusions: [], required_fields: [], source_classes: [] },
    search_plan: "plan", search_branches: ["a"], search_summary: "Found investors.", candidates_seen: 3, duplicates_removed: 0,
    access_events: [], source_registry: [], results,
  };
}

export function aiResult(over: Record<string, unknown>) {
  return {
    title: "", organization: "", specialization: "", geography: "", contact: "", investment_type: "", stage: "", ticket: "",
    location: "", area: "", price: "", match: 85, confidence: 85, evidence: "", evidence_quote: "", status: "Verified",
    source: "", source_type: "web", url: "", why: "", retrieved_at: "2026-10-03T00:00:00Z", freshness_days: 0, independent_verification: false,
    ...over,
  };
}
