import { describe, expect, it } from "vitest";
import { recordResearchLearning, readRun } from "@/lib/memory";
import { buildAnalytics, searchTotals } from "@/lib/analytics";
import { readLog } from "@/lib/scout/store";

describe("search archive and analytics", () => {
  it("starts from honest zeros and counts only saved searches", async () => {
    expect((await searchTotals()).searches).toBe(0);
    const saved: any = await recordResearchLearning({
      taskId: "T-TEST1", query: "villa bali", origin: "telegram",
      sourceRegistry: [{ url: "https://good.example/a", accessStatus: "checked" }, { url: "https://bad.example/b", accessStatus: "blocked" }],
      results: [{ title: "Villa", url: "https://good.example/a", status: "Verified" }],
      stats: { sourcesFound: 2, sourcesChecked: 1, pagesProcessed: 3, duplicatesRemoved: 1 },
    });
    await recordResearchLearning({ query: "empty query", results: [], sourceRegistry: [] });

    const totals = await searchTotals();
    expect(totals).toMatchObject({ searches: 2, results: 1, verified: 1, sourcesFound: 2, sourcesChecked: 1, duplicatesRemoved: 1 });
    expect((await readRun(saved.runId))?.results).toHaveLength(1);
    expect((await readLog(10)).some((e) => e.action === "research.saved")).toBe(true);

    const a = await buildAnalytics(true);
    expect(a.totals.zeroResultSearches).toBe(1);
    expect(a.totals.telegramSearches).toBe(1);
    expect(a.insights.some((i) => i.level === "risk" && i.title.includes("без результатов"))).toBe(true);
  });
});
