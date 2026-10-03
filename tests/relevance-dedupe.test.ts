import { describe, expect, it } from "vitest";
import { evaluateResearchRelevance, filterResearchResults } from "@/lib/relevance-gate";
import { dedupeResults, isQuoteGrounded } from "@/lib/result-quality";
import { isSafePublicUrl } from "@/lib/url-safety";

const base = (over: Record<string, unknown>) => ({ evidence: "x".repeat(40), evidence_quote: "y".repeat(40), ...over });
const Q = "Найди инвесторов в Амстердаме для B2B SaaS проекта";

describe("investor relevance", () => {
  const noise = [
    { title: "Amsterdam Startup Investor Conference 2026", url: "https://conf.example.com/2026" },
    { title: "Networking programme for founders and angels", url: "https://hub.example.com/programme" },
    { title: "Investment Analyst — job vacancy", url: "https://fund.example.com/careers/analyst" },
    { title: "Investment Analyst job opening", url: "https://jobs-board.example.com/listing/123" },
    { title: "Adyen IPO: share price soars", url: "https://news.example.com/adyen-ipo" },
    { title: "Northwave Ventures news", url: "https://northwave.vc/news/fund-ii" },
  ];
  for (const item of noise) {
    it("rejects noise: " + item.title, () => {
      expect(evaluateResearchRelevance(base(item), Q).tier).toBe("reject");
    });
  }

  it("accepts a real VC fund matching geography and sector (ru query, en page)", () => {
    const verdict = evaluateResearchRelevance(base({ title: "Northwave Ventures", url: "https://northwave.vc", evidence_quote: "Amsterdam venture capital fund investing in B2B SaaS companies." }), Q);
    expect(verdict.tier).toBe("accept");
  });

  it("does not require a tech sector when the query names none (no SaaS hard-coding)", () => {
    const verdict = evaluateResearchRelevance(base({ title: "Canal Real Estate Partners — private equity", url: "https://canalrep.nl", evidence_quote: "Private equity firm in Amsterdam that invests in residential real estate." }), "Find real estate investors in Amsterdam");
    expect(verdict.tier).toBe("accept");
  });

  it("does not require Cyprus for non-Cyprus queries", () => {
    const verdict = evaluateResearchRelevance(base({ title: "Madrid Angels network", url: "https://madridangels.es", evidence_quote: "Business angels network in Madrid investing in startups." }), "angel investors in Madrid");
    expect(verdict.tier).toBe("accept");
  });

  it("keeps an investor without geography confirmation for manual review instead of dropping it", () => {
    const verdict = evaluateResearchRelevance(base({ title: "Northwave Ventures", url: "https://northwave.vc", evidence_quote: "Venture capital fund investing in B2B SaaS companies across Europe." }), Q);
    expect(verdict.tier).toBe("review");
    expect(verdict.reason).toBe("geography_not_confirmed");
  });

  it("treats 'top investors' list pages as sources needing review", () => {
    const verdict = evaluateResearchRelevance(base({ title: "Top 50 investors in Amsterdam", url: "https://list.example.com/top", evidence_quote: "The top 50 venture capital investors in Amsterdam for B2B SaaS." }), Q);
    expect(verdict.tier).toBe("review");
  });

  it("filterResearchResults marks review items as Manual review and keeps them", () => {
    const out = filterResearchResults([base({ title: "Northwave Ventures", url: "https://northwave.vc", evidence_quote: "Venture fund investing in B2B SaaS.", status: "Verified" })], Q);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0].status).toBe("Manual review");
  });
});

describe("deduplication", () => {
  const q = "venture capital investors Amsterdam";
  it("merges one organisation found under different URLs", () => {
    const { out, removed } = dedupeResults([
      { organization: "Northwave Ventures B.V.", url: "https://northwave.vc", confidence: 80 },
      { organization: "Northwave Ventures", url: "https://www.northwave.vc/portfolio?utm_source=x", confidence: 60 },
      { title: "Northwave Ventures | LinkedIn", url: "https://www.linkedin.com/company/northwave", confidence: 50 },
    ], q);
    expect(out).toHaveLength(1);
    expect(removed).toBe(2);
    expect(out[0].url).toBe("https://northwave.vc");
  });

  it("does not merge different organisations on a shared platform", () => {
    const { out } = dedupeResults([
      { title: "Alpha Capital", url: "https://www.linkedin.com/company/alpha-capital" },
      { title: "Beta Partners", url: "https://www.linkedin.com/company/beta-partners" },
    ], q);
    expect(out).toHaveLength(2);
  });

  it("does not merge different property listings from one portal", () => {
    const { out } = dedupeResults([
      { title: "Plot 12 000 m2", location: "Madrid", area: "12000", url: "https://portal.es/a/1" },
      { title: "Plot 15 000 m2", location: "Madrid", area: "15000", url: "https://portal.es/a/2" },
      { title: "Plot 12 000 m2", location: "Madrid", area: "12000", url: "https://other.es/x" },
    ], "земельный участок в Мадриде от 10 000 м2");
    expect(out).toHaveLength(2);
  });
});

describe("evidence grounding and URL safety", () => {
  it("detects verbatim and near-verbatim quotes", () => {
    const page = "Northwave Ventures is an Amsterdam-based venture capital fund investing in B2B software.";
    expect(isQuoteGrounded("Amsterdam-based venture capital fund", page)).toBe(true);
    expect(isQuoteGrounded("Northwave manages EUR 900m across twelve funds", page)).toBe(false);
  });

  it("blocks private, local and credentialed URLs", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1/x", "http://10.1.2.3", "http://169.254.169.254/latest", "http://[::1]/", "https://user:pw@example.com", "ftp://example.com", "http://intranet.local"]) {
      expect(isSafePublicUrl(url)).toBe(false);
    }
    expect(isSafePublicUrl("https://northwave.vc/team")).toBe(true);
  });
});
