import { afterEach, describe, expect, it, vi } from "vitest";
import { createCsvBuffer, createJsonBuffer, createPdfBuffer, createXlsxBuffer } from "@/lib/server-exporters";
import { POST as exportRoute } from "@/app/api/export/route";
import { postJson } from "./helpers";
import type { ResearchExportPayload } from "@/lib/research-report";

function payload(count: number): ResearchExportPayload {
  return {
    query: "Инвесторы в Амстердаме",
    generatedAt: "2026-10-03T00:00:00Z",
    searchSummary: "summary",
    stats: { sourcesFound: count, nested: { a: 1 } as any, qualified: count },
    results: Array.from({ length: count }, (_, i) => ({
      title: "Fund " + i, organization: "Fund " + i + " Ventures", url: "https://fund" + i + ".example.com",
      evidenceQuote: "Fund " + i + " invests in B2B software in Amsterdam.", match: 80, confidence: 75, status: "Reviewed",
      qualityGate: { gate: i % 2 ? "PASS" : "REVIEW" },
    })),
    sourceRegistry: [{ name: "=HYPERLINK(\"http://evil\")", url: "https://fund0.example.com", accessStatus: "checked", quality: 80 }],
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("exports on empty, small and large data sets", () => {
  for (const size of [0, 3, 1000]) {
    it("builds CSV/JSON/XLSX/PDF for " + size + " results", async () => {
      const data = payload(size);
      const csv = createCsvBuffer(data).toString("utf8");
      expect(csv.split("\r\n")).toHaveLength(size + 1);
      expect(JSON.parse(createJsonBuffer(data).toString("utf8")).results).toHaveLength(size);
      const xlsx = await createXlsxBuffer(data);
      expect(xlsx.subarray(0, 2).toString()).toBe("PK");
      const pdf = await createPdfBuffer(data);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    });
  }

  it("neutralizes spreadsheet formulas in CSV cells", () => {
    const data = payload(1);
    data.results[0].title = "=cmd|' /C calc'!A0";
    const csv = createCsvBuffer(data).toString("utf8");
    expect(csv).toContain("\"'=cmd");
  });
});

describe("export route", () => {
  it("rejects XLSX on the free plan with a clear 403 and allows CSV", async () => {
    vi.stubEnv("PLAN_ENFORCEMENT", "on");
    vi.stubEnv("DEFAULT_PLAN", "free");
    const denied = await exportRoute(postJson("http://localhost/api/export", { format: "xlsx", payload: payload(2) }));
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("PLAN_FEATURE_UNAVAILABLE");
    const allowed = await exportRoute(postJson("http://localhost/api/export", { format: "csv", payload: payload(2) }));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-type")).toContain("text/csv");
  });

  it("returns 400 for a missing payload and unknown format", async () => {
    vi.stubEnv("PLAN_ENFORCEMENT", "off");
    expect((await exportRoute(postJson("http://localhost/api/export", { format: "csv" }))).status).toBe(400);
    expect((await exportRoute(postJson("http://localhost/api/export", { format: "docx", payload: payload(1) }))).status).toBe(400);
  });
});
