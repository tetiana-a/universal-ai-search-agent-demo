import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROAD_DISCOVERY_CATEGORIES, BROAD_DISCOVERY_PAGES, findGroups, inferredSearchPlatforms, isBroadDiscoveryTopic, normalizeInstagramProfileUrl, normalizeTikTokProfileUrl, platformSearchQueries, type Platform } from "@/lib/scout/groups";
import { listGroups, postingTargets } from "@/lib/scout/groups";
import { resetMemoryStore } from "@/lib/scout/store";
import { json, mockFetch } from "./helpers";

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KEYLESS_SEARCH", "off");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("TGSTAT_SEARCH_ENABLED", "off");
  vi.stubEnv("DATAFORSEO_GROUP_SEARCH", "off");
});

describe("automatic multi-platform public discovery", () => {
  it("builds a search on every platform in the first round", () => {
    const queries = platformSearchQueries({
      city: "Валенсия", country: "Испания", topic: "продажа квартир",
      platforms: ["telegram", "instagram", "tiktok"],
    });
    expect(queries.slice(0, 3).map((q) => q.platform)).toEqual(["telegram", "instagram", "tiktok"]);
    expect(inferredSearchPlatforms({ topic: "Ищи квартиры в Инстаграм, ТикТок и Телеграм", city: "Валенсия" }))
      .toEqual(["telegram", "instagram", "tiktok"]);
    expect(inferredSearchPlatforms({ topic: "Квартиры в Instagram" })).toEqual(["instagram"]);
    expect(queries).toHaveLength(6);
    expect(queries.find((q) => q.platform === "instagram")?.query).toContain("продажа квартир");
    expect(queries.find((q) => q.platform === "tiktok")?.query).toContain("TikTok");
    const defaultList = platformSearchQueries({ topic: "flowers", city: "Краков", country: "Польша" });
    expect(new Set(defaultList.map((q) => q.platform))).toEqual(new Set<Platform>(["telegram","instagram","tiktok","facebook"]));
  });

  it("supports ANY user-defined topic without hard-coded real estate or flower substitutions", () => {
    for (const topic of ["ремонт велосипедов", "духовные практики", "поиск работы", "знакомства", "услуги адвоката", "коллекционеры марок", "собаководы", "йога"]) {
      const queries = platformSearchQueries({ country: "Чехия", city: "Брно", topic });
      expect(queries).toHaveLength(8);
      expect(queries.every((item) => item.query.includes(topic))).toBe(true);
      expect(queries.some((item) => item.query.includes("real estate apartments"))).toBe(false);
    }
  });

  it("browses broad public community categories by explicit page; never claims all worldwide communities", () => {
    expect(isBroadDiscoveryTopic("")).toBe(true);
    expect(isBroadDiscoveryTopic("все группы")).toBe(true);
    expect(isBroadDiscoveryTopic("все тематики")).toBe(true);
    expect(isBroadDiscoveryTopic("любые сообщества в Брно")).toBe(true);
    expect(isBroadDiscoveryTopic("все группы по продаже квартир")).toBe(false);
    expect(isBroadDiscoveryTopic("животные")).toBe(false);
    expect(BROAD_DISCOVERY_CATEGORIES.length).toBeGreaterThanOrEqual(12);
    expect(BROAD_DISCOVERY_PAGES).toBe(8);
    const first = platformSearchQueries({ country: "Чехия", city: "Брно", topic: "", platforms: ["telegram", "instagram"] });
    const next = platformSearchQueries({ country: "Чехия", city: "Брно", topic: "", platforms: ["telegram", "instagram"], broadPage: 1 });
    expect(first).toHaveLength(8);
    expect(first.slice(0, 2).map((x) => x.platform)).toEqual(["telegram", "instagram"]);
    expect(first[0].query).toContain(BROAD_DISCOVERY_CATEGORIES[0]);
    expect(first[2].query).toContain(BROAD_DISCOVERY_CATEGORIES[1]);
    expect(next[0].query).toContain(BROAD_DISCOVERY_CATEGORIES[2]);
    expect(first.some((x) => next.some((y) => y.query === x.query))).toBe(false);
  });

  it("normalizes profile links only on authentic Instagram/TikTok hosts", () => {
    expect(normalizeInstagramProfileUrl("https://www.instagram.com/valencia_realty/?igsh=123")).toBe("https://www.instagram.com/valencia_realty");
    expect(normalizeInstagramProfileUrl("https://instagram.com/p/AB1234")).toBe("");
    expect(normalizeInstagramProfileUrl("https://instagram.com/reel/AB1234")).toBe("");
    expect(normalizeInstagramProfileUrl("https://evil.example/instagram.com/valencia_realty")).toBe("");
    expect(normalizeTikTokProfileUrl("https://www.tiktok.com/@valencia.apartments/video/751234")).toBe("https://www.tiktok.com/@valencia.apartments");
    expect(normalizeTikTokProfileUrl("https://www.tiktok.com/tag/valencia")).toBe("");
    expect(normalizeTikTokProfileUrl("https://evil.example/tiktok.com/@valencia.apartments")).toBe("");
  });

  it("finds IG and TikTok public profiles by one query and labels them as unverified candidates, not publishable groups", async () => {
    vi.stubEnv("DATAFORSEO_GROUP_SEARCH", "on");
    vi.stubEnv("DATAFORSEO_LOGIN", "test-login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "test-password");
    const calls = mockFetch([{
      match: url => url.startsWith("https://api.dataforseo.com/v3/serp/google/organic/live/advanced"),
      respond: (_url, init) => {
        const request = JSON.parse(String(init?.body || "[]"))[0];
        const isInstagram = String(request?.keyword || "").includes("Instagram");
        const urls = isInstagram
          ? [{ url: "https://www.instagram.com/valencia_realty/", title: "Valencia Realty · Instagram", description: "Pisos y apartamentos en Valencia" },
             { url: "https://www.instagram.com/reel/C12345/", title: "Reel (not a profile)", description: "video" }]
          : [{ url: "https://www.tiktok.com/@pisos.valencia/video/11123", title: "Pisos Valencia · TikTok", description: "Alquiler y venta apartamentos en Valencia" }];
        return json({ status_code: 20000, tasks:[{ status_code: 20000, result:[{ items:urls.map(x=>({ type:"organic", ...x })) }] }] });
      },
    }]);
    const result = await findGroups({
      country:"Испания",city:"Валенсия",topic:"продажа квартир",
      platforms:["instagram","tiktok"],
    });
    expect(calls).toHaveLength(2);
    expect(result.found.map(g=>g.platform).sort()).toEqual(["instagram","tiktok"]);
    expect(result.found.map(g=>g.kind)).toEqual(["profile","profile"]);
    expect(result.found.map(g=>g.verification)).toEqual(["indexed_candidate","indexed_candidate"]);
    expect(result.found.every(g=>g.ads==="unknown" && g.activity==="unknown" && g.status==="new")).toBe(true);
    expect(result.found.find(g=>g.platform==="instagram")?.foundBy).toContain("Instagram");
    expect(result.found.find(g=>g.platform==="tiktok")?.url).toBe("https://www.tiktok.com/@pisos.valencia");
    expect(await listGroups()).toHaveLength(2);
    expect(await postingTargets()).toHaveLength(0);
  });
});
