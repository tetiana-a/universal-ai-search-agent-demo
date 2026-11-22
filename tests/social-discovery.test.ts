import { beforeEach, describe, expect, it, vi } from "vitest";
import { findGroups, inferredSearchPlatforms, normalizeInstagramProfileUrl, normalizeTikTokProfileUrl, platformSearchQueries, type Platform } from "@/lib/scout/groups";
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
    expect(queries.find((q) => q.platform === "instagram")?.query).toContain("inmobiliaria pisos apartamentos");
    expect(queries.find((q) => q.platform === "tiktok")?.query).toContain("TikTok");
    const defaultList = platformSearchQueries({ topic: "flowers", city: "Краков", country: "Польша" });
    expect(new Set(defaultList.map((q) => q.platform))).toEqual(new Set<Platform>(["telegram","instagram","tiktok","facebook"]));
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
