import { beforeEach, describe, expect, it, vi } from "vitest";
import { apifyEnabled, apifySearch, mapApifyItems } from "@/lib/scout/apify-search";
import { makeAyrsharePayload, scheduleAyrshareApproved } from "@/lib/scout/ayrshare";
import { dataForSeoSearch } from "@/lib/scout/dataforseo-groups";
import { deleteValue } from "@/lib/scout/store";
import { json, mockFetch } from "./helpers";

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv("APIFY_GROUP_SEARCH", "off");
  vi.stubEnv("APIFY_TOKEN", "");
});

describe("Apify group search", () => {
  it("is off without explicit opt-in and token", async () => {
    expect(apifyEnabled()).toBe(false);
    expect((await apifySearch(["kwiaty kraków"], "Poland")).ok).toBe(false);
  });
  it("maps organic results and keeps the query", () => {
    const hits = mapApifyItems([{ searchQuery: { term: "kwiaty" }, organicResults: [
      { url: "https://www.facebook.com/groups/kwiatykrakow", title: "Kwiaty Kraków", description: "grupa" },
      { url: "not a url" },
    ] }]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ domain: "facebook.com", query: "kwiaty", provider: "apify" });
  });
  it("pauses itself after an exhausted balance and stops calling the API", async () => {
    vi.stubEnv("APIFY_GROUP_SEARCH", "on");
    vi.stubEnv("APIFY_TOKEN", "test-only-apify-quota");
    const calls = mockFetch([{ match: (u) => u.startsWith("https://api.apify.com/"), respond: () => json({ error: "limit" }, 402) }]);
    const first = await apifySearch(["kwiaty"], "Poland", "pl");
    expect(first.ok).toBe(false);
    expect(first.message).toMatch(/пауз/);
    const second = await apifySearch(["kwiaty"], "Poland", "pl");
    expect(second.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ countryCode: "pl", languageCode: "pl" });
  });
  it("gives the run enough time and shows Apify's reason on failure", async () => {
    vi.stubEnv("APIFY_GROUP_SEARCH", "on");
    vi.stubEnv("APIFY_TOKEN", "test-only-apify-400");
    await deleteValue("provider-paused:apify"); // set by the quota test above
    const calls = mockFetch([{ match: (u) => u.startsWith("https://api.apify.com/"), respond: () => json({ error: { type: "run-failed", message: "Actor run did not succeed (status: TIMED-OUT)" } }, 400) }]);
    const result = await apifySearch(["kwiaty"], "Poland", "pl");
    expect(result.message).toMatch(/HTTP 400: Actor run did not succeed/);
    expect(String(calls[0].url)).toContain("timeout=115");
  });
});

describe("DataForSEO quota", () => {
  it("pauses on insufficient funds", async () => {
    vi.stubEnv("DATAFORSEO_GROUP_SEARCH", "on");
    vi.stubEnv("DATAFORSEO_LOGIN", "l");
    vi.stubEnv("DATAFORSEO_PASSWORD", "p-quota-test");
    const calls = mockFetch([{ match: (u) => u.includes("dataforseo.com"), respond: () => json({ status_code: 20000, tasks: [{ status_code: 40200, status_message: "Payment Required." }] }) }]);
    expect((await dataForSeoSearch("kwiaty unique-q", "Poland")).message).toMatch(/пауз/);
    await dataForSeoSearch("kwiaty unique-q", "Poland");
    expect(calls).toHaveLength(1);
  });
});

describe("Ayrshare own-profile scheduling", () => {
  it("requires media for Instagram/TikTok and filters unknown platforms", () => {
    expect(() => makeAyrsharePayload("Свежие цветы с доставкой", ["instagram"], "2030-01-01T10:00:00Z")).toThrow("AYRSHARE_MEDIA_REQUIRED");
    expect(() => makeAyrsharePayload("Свежие цветы с доставкой", ["myspace"], "2030-01-01T10:00:00Z")).toThrow("AYRSHARE_NO_PLATFORMS");
    expect(makeAyrsharePayload("Свежие цветы с доставкой", ["Facebook", "facebook"], "2030-01-01T10:00:00Z").platforms).toEqual(["facebook"]);
  });
  it("stays off without the explicit schedule switch", async () => {
    vi.stubEnv("AYRSHARE_API_KEY", "k");
    const r = await scheduleAyrshareApproved({ content: "Свежие цветы с доставкой", platforms: ["facebook"], requestId: "req-12345678", scheduledAt: new Date(Date.now() + 3600e3).toISOString(), campaignId: "c1" });
    expect(r.error).toBe("AYRSHARE_SCHEDULE_DISABLED");
  });
  it("schedules an approved post once", async () => {
    vi.stubEnv("AYRSHARE_API_KEY", "k");
    vi.stubEnv("AYRSHARE_ENABLE_SCHEDULE", "on");
    const calls = mockFetch([{ match: (u) => u === "https://api.ayrshare.com/api/post", respond: () => json({ status: "success", id: "ay1" }) }]);
    const args = { content: "Свежие цветы с доставкой", platforms: ["facebook"], requestId: "req-ayr-once-1", scheduledAt: new Date(Date.now() + 3600e3).toISOString(), campaignId: "c1" };
    expect(await scheduleAyrshareApproved(args)).toMatchObject({ ok: true, postId: "ay1" });
    expect((await scheduleAyrshareApproved(args)).error).toBe("DUPLICATE_REQUEST");
    expect(calls).toHaveLength(1);
  });
});
