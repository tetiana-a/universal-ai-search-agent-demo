import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { json, mockFetch } from "./helpers";
import { geminiSearch } from "@/lib/gemini-search";
import { dataForSeoEnabled, dataForSeoSearch, dataForSeoRegion, mapDataForSeoResponse } from "@/lib/scout/dataforseo-groups";
import { isPolishWineCampaign, POLISH_WINE_B2B_QUERIES } from "@/lib/scout/wine-compliance";
import { ruleCampaign, searchPlan, setCampaignStatus, planTasks, capacityOf, type Campaign } from "@/lib/scout/campaigns";
import { putOne, resetMemoryStore } from "@/lib/scout/store";
import type { GroupCard } from "@/lib/scout/groups";

const wineTask = "Разместить объявление о продаже вина в Польше не нарушая законов";
const now = "2026-11-21T12:00:00.000Z";
const mkCampaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: "wine-pl-01", title: "Продажа вина в Польше", region: "Польше",
  adText: "Разместить объявление о продаже вина в Польше не нарушая законов",
  topic: "разместить объявление о продаже", languages: ["ru"],
  keywords: ["разместить", "объявление", "продаже", "вина", "польше", "нарушая", "законов"],
  adjacent: [], queries: [], exclusions: [], questions: [], translations: {},
  platforms: ["telegram", "facebook"], dailyTarget: 300, status: "approved",
  source: "text", createdAt: now, updatedAt: now, ...over,
});
const group: GroupCard = {
  id: "group-1", platform: "telegram", url: "https://t.me/wine_partner",
  name: "Wine partner", ads: "allowed", status: "free", botConnected: true,
  postingEnabled: true, chatId: "-100100100100", foundAt: now, updatedAt: now,
};

beforeEach(() => {
  resetMemoryStore();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GEMINI_SEARCH_FALLBACK_MODEL", "");
  vi.stubEnv("DATAFORSEO_LOGIN", "");
  vi.stubEnv("DATAFORSEO_PASSWORD", "");
  vi.stubEnv("DATAFORSEO_GROUP_SEARCH", "off");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Polish wine B2B search and public publishing guard", () => {
  it("drops instructions and legal phrases from keywords and uses professional Polish search terms", () => {
    const c = ruleCampaign(wineTask);
    expect(c.region).toBe("Польше");
    expect(c.topic).toBe("importerzy wina Polska");
    expect(c.keywords).toContain("hurtownie wina Polska");
    expect(c.keywords).not.toContain("нарушая");
    expect(c.keywords).not.toContain("законов");
    const plan = searchPlan(mkCampaign(), 8);
    expect(plan).toHaveLength(8);
    expect(plan[0].topic).toContain("importerzy wina");
    expect(plan.every((x) => x.relevance === "core")).toBe(true);
    expect(POLISH_WINE_B2B_QUERIES.length).toBeGreaterThan(5);
  });

  it("blocks scheduling and approval even when a Telegram bot has publishing rights", async () => {
    const c = mkCampaign();
    expect(isPolishWineCampaign(c)).toBe(true);
    expect(planTasks([c], [group], [], "2026-11-22")).toHaveLength(0);
    expect(capacityOf([group], [], [c], "2026-11-22").target).toBe(0);
    await putOne("campaigns", { ...c, status: "ready" });
    expect(await setCampaignStatus(c.id, "approved")).toBeNull();
    expect(isPolishWineCampaign({ region: "Валенсия, Испания", adText: "Продам квартиру" })).toBe(false);
  });
});

describe("Gemini 404 and billable search opt-in", () => {
  it("does not silently try another potentially paid model after a 404", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const calls = mockFetch([{ match: (u) => u.includes("generativelanguage"), respond: () => json({ error: { message: "model not available" } }, 404) }]);
    const result = await geminiSearch("Polish wine importer groups");
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
    expect(result.message).toContain("model");
    expect(calls.filter((c) => c.url.includes(":generateContent"))).toHaveLength(1);
  });

  it("retries a new model only when the owner explicitly configured it", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_SEARCH_FALLBACK_MODEL", "gemini-3.5-flash");
    const calls = mockFetch([{
      match: (u) => u.includes("generativelanguage"),
      respond: (u) => u.includes("gemini-2.5-flash") ? json({ error: { message: "unavailable" } }, 404)
        : json({ candidates: [{ content: { parts: [{ text: "No citations" }] }, groundingMetadata: { groundingChunks: [] } }] }),
    }]);
    const result = await geminiSearch("Polish wine importers");
    expect(result.ok).toBe(true);
    expect(calls.filter((c) => c.url.includes(":generateContent"))).toHaveLength(2);
  });

  it("uses DataForSEO only when explicitly enabled with login/password", async () => {
    vi.stubEnv("DATAFORSEO_LOGIN", "login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "password");
    expect(dataForSeoEnabled()).toBe(false);
    vi.stubEnv("DATAFORSEO_GROUP_SEARCH", "on");
    expect(dataForSeoEnabled()).toBe(true);
    expect(dataForSeoRegion("Польша")).toBe("Poland");
    const calls = mockFetch([{
      match: (u) => u.includes("api.dataforseo.com"),
      respond: () => json({
        status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [
          { type: "organic", url: "https://t.me/wine_partner", title: "Wine trade", description: "Profesjonalna branża winiarska" },
          { type: "paid", url: "https://spam.example.com", title: "Ad" },
        ] }] }],
      }),
    }]);
    const result = await dataForSeoSearch("site:facebook.com/groups importerzy wina Polska", "Польша", "pl");
    expect(result.hits.map((hit) => hit.url)).toEqual(["https://t.me/wine_partner"]);
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent[0].keyword).not.toContain("site:");
    expect(sent[0].location_name).toBe("Poland");
    expect(sent[0].depth).toBe(10);
    expect(mapDataForSeoResponse({ status_code: 40100, tasks: [] }).ok).toBe(false);
  });

  it("retries DataForSEO once after its transient 'Internal SE Server Error'", async () => {
    vi.stubEnv("DATAFORSEO_LOGIN", "login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "password");
    vi.stubEnv("DATAFORSEO_GROUP_SEARCH", "on");
    let n = 0;
    const calls = mockFetch([{
      match: (u) => u.includes("api.dataforseo.com"),
      respond: () => ++n === 1
        ? json({ status_code: 20000, tasks: [{ status_code: 50000, status_message: "Internal SE Server Error." }] })
        : json({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [{ type: "organic", url: "https://t.me/wifi_au", title: "WiFi AU" }] }] }] }),
    }]);
    const result = await dataForSeoSearch("ремонт wifi Австралия", "Австралия", "en");
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1].init?.body))[0].location_name).toBe("Australia");
  });
});

it("DataForSEO gets its own location names for countries and cities", () => {
  expect(dataForSeoRegion("Чехия")).toBe("Czechia");
  expect(dataForSeoRegion("Прага")).toBe("Czechia");
  expect(dataForSeoRegion("Италия")).toBe("Italy");
  expect(dataForSeoRegion("Кипр")).toBe("Cyprus");
  expect(dataForSeoRegion("Барселона")).toBe("Spain");
  expect(dataForSeoRegion("Дубай")).toBe("United Arab Emirates");
  expect(dataForSeoRegion("Австралия")).toBe("Australia");
  expect(dataForSeoRegion("Перт")).toBe("Australia");
  expect(dataForSeoRegion("Канада")).toBe("Canada");
  expect(dataForSeoRegion("Гоа")).toBe("India");
  expect(dataForSeoRegion("Нидерланды")).toBe("Netherlands");
});
