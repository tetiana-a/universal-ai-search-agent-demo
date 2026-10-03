import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getResearchMemoryContext, recordResearchLearning } from "@/lib/memory";

beforeEach(() => { vi.stubEnv("KV_REST_API_URL", ""); vi.stubEnv("UPSTASH_REDIS_REST_URL", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("Source Registry learning and health", () => {
  it("stores one source per domain and reuses it for a similar task", async () => {
    await recordResearchLearning({
      query: "venture capital investors Amsterdam",
      sourceRegistry: [
        { name: "Northwave", url: "https://northwave.vc", domain: "northwave.vc", accessStatus: "checked", evidenceAvailable: true },
        { name: "Northwave team", url: "https://northwave.vc/team", domain: "northwave.vc", accessStatus: "partial" },
      ],
      results: [{ url: "https://northwave.vc", status: "Verified", qualityGate: { gate: "PASS" } }],
    });
    const context = await getResearchMemoryContext("angel investors in Amsterdam");
    const matches = context.sources.filter((s) => s.domain === "northwave.vc");
    expect(matches).toHaveLength(1);
    expect(matches[0].healthStatus).toBe("healthy");
  });

  it("demotes a source after repeated failed reads and stops reusing it", async () => {
    for (let i = 0; i < 3; i += 1) {
      await recordResearchLearning({
        query: "investors in Madrid",
        sourceRegistry: [{ name: "Blocked", url: "https://blocked-site.es/x", domain: "blocked-site.es", accessStatus: "blocked", reason: "403" }],
        results: [],
      });
    }
    const context = await getResearchMemoryContext("investors in Madrid");
    expect(context.sources.some((s) => s.domain === "blocked-site.es")).toBe(false);
  });

  it("does not reuse unrelated sources", async () => {
    await recordResearchLearning({
      query: "земельный участок Мадрид",
      sourceRegistry: [{ name: "Idealista", url: "https://idealista.com/terrenos", domain: "idealista.com", accessStatus: "checked", evidenceAvailable: true }],
      results: [],
    });
    const context = await getResearchMemoryContext("semiconductor suppliers in Shenzhen");
    expect(context.sources.some((s) => s.domain === "idealista.com")).toBe(false);
  });
});
