import { describe, expect, it } from "vitest";
import { classifyPage, placeFromQuery, profileFromText } from "@/lib/page-kind";
import { fallbackResults, rankResults } from "@/lib/free-research";

// Pages from a real test run of the three demo queries.
describe("page type", () => {
  it("recognises an article, a listings page and a brand directory", () => {
    expect(classifyPage({ url: "https://mbschool.ru/faq/articles/biznes-angely-i-venchurnoe-finansirovanie", title: "Бизнес-ангелы и венчурное финансирование" }, "investor")).toBe("article");
    expect(classifyPage({ url: "https://lusarealty.ru/kommercheskaya-nedvizhimost/zemelnye-uchastki-v-ispanii", title: "Купить земельный участок в Испании | Участки с домом", text: "Земельные участки для покупки в Испании, Коста. Найдено объектов:19 · 12.200 м2" }, "real_estate")).toBe("listing_index");
    expect(classifyPage({ url: "https://www.lampadia.ru/brands/", title: "Бренды и производители люстр, светильников" }, "company")).toBe("listing_index");
  });

  it("keeps real entities as entities", () => {
    expect(classifyPage({ url: "https://northwave.vc", title: "Northwave Ventures", text: "We invest in early-stage B2B software companies." }, "investor")).toBe("entity");
    expect(classifyPage({ url: "https://www.idealista.com/inmueble/12345/", title: "Terreno urbano en Boadilla del Monte, Madrid", text: "Parcela de 2.400 m², 650.000 €" }, "real_estate")).toBe("entity");
    expect(classifyPage({ url: "https://www.example-led.cn/about", title: "Shenzhen Bright LED Co., Ltd", text: "LED lighting manufacturer since 2008, ISO 9001." }, "company")).toBe("entity");
  });
});

describe("fields taken from the page", () => {
  it("finds the queried place in the page's own spelling and a short profile", () => {
    expect(placeFromQuery("Найди инвесторов в Амстердаме в B2B SaaS", "Northwave is an Amsterdam fund… офис в Амстердаме")).toBe("Амстердаме");
    expect(placeFromQuery("Найди земельный участок в Мадриде", "Parcela en Madrid, 2.400 m²")).toBe("");
    expect(placeFromQuery("Find LED manufacturers in China", "Shenzhen, China. LED lighting manufacturer")).toBe("China");
    expect(profileFromText("investor", "We back B2B SaaS and fintech founders at seed.")).toBe("B2B, SaaS, fintech, seed");
  });

  it("ranks entities above list pages and does not give every candidate the same score", () => {
    const input: any = { query: "Find venture investors in Amsterdam for B2B SaaS", language: "en", maxResults: 10 };
    const hits: any[] = [
      { title: "Top 10 VC funds in Europe", url: "https://blog.example.com/blog/top-vc", domain: "blog.example.com", snippet: "A list of venture funds.", provider: "duckduckgo", retrievedAt: "" },
      { title: "Northwave Ventures", url: "https://northwave.vc", domain: "northwave.vc", snippet: "Amsterdam venture fund investing in B2B SaaS.", content: "Northwave Ventures is an Amsterdam venture capital fund. We invest in B2B SaaS.", provider: "duckduckgo", retrievedAt: "" },
      { title: "Random agency", url: "https://agency.example.com", domain: "agency.example.com", snippet: "Marketing agency.", provider: "duckduckgo", retrievedAt: "" },
    ];
    const ranked = rankResults(fallbackResults(hits, input));
    expect(ranked[0].url).toBe("https://northwave.vc");
    expect(ranked[0].location).toBe("Amsterdam");
    expect(ranked[0].specialization).toContain("SaaS");
    expect(ranked[ranked.length - 1].page_type).toBe("article");
    expect(new Set(ranked.map((r) => r.match)).size).toBeGreaterThan(1);
  });
});

describe("Cyrillic patterns", () => {
  it("matches Russian listing counters and profile words", () => {
    expect(classifyPage({ url: "https://site.ru/x", title: "Земля", text: "Найдено объектов: 19" }, "real_estate")).toBe("listing_index");
    expect(profileFromText("investor", "Венчурный фонд и бизнес-ангелы")).toBe("Венчурный фонд, бизнес-ангелы");
    expect(profileFromText("company", "Производитель светодиодных светильников")).toBe("Производитель, светодиодных светильников");
  });
});

import { buildSourceMap, pickBranches } from "@/lib/source-map";
import { itemLinks } from "@/lib/free-research";

describe("source map for the spec's examples", () => {
  it("builds country-specific sources and covers every class", () => {
    const land = buildSourceMap("Найди земельные участки в Мадриде площадью от 10 000 м²");
    expect(land.kind).toBe("real_estate");
    expect(land.country).toBe("Spain");
    expect(land.sources.map((s) => s.domain)).toEqual(expect.arrayContaining(["idealista.com", "subastas.boe.es", "solvia.es"]));
    const picked = pickBranches(land, 8);
    expect(picked.some((q) => q.includes("terreno en venta"))).toBe(true);
    expect(picked.some((q) => q.startsWith("site:idealista.com"))).toBe(true);

    const investors = buildSourceMap("Найти потенциальных инвесторов в Амстердаме для проекта X");
    expect(investors.kind).toBe("investor");
    expect(investors.sources.map((s) => s.domain)).toEqual(expect.arrayContaining(["nvp.nl", "techleap.nl", "dealroom.co"]));
    expect(investors.branches.every((b) => !/Cyprus/i.test(b.query))).toBe(true);

    const factories = buildSourceMap("Найти производителей светодиодных ламп в Китае");
    expect(factories.kind).toBe("company");
    expect(factories.sources.map((s) => s.domain)).toEqual(expect.arrayContaining(["alibaba.com", "made-in-china.com"]));
  });

  it("picks item pages from a list page and skips navigation", () => {
    const content = "[Parcela 2.400 m²](https://www.idealista.com/inmueble/104558231/) [Ayuda](https://www.idealista.com/ayuda/) [Login](https://www.idealista.com/login/x) [Otro](https://other.com/inmueble/1234/) [Terreno urbano en Boadilla del Monte con licencia](https://www.idealista.com/venta/terreno-urbano-boadilla-del-monte-licencia)";
    expect(itemLinks("https://www.idealista.com/venta-terrenos/madrid/", content)).toEqual([
      "https://www.idealista.com/inmueble/104558231",
      "https://www.idealista.com/venta/terreno-urbano-boadilla-del-monte-licencia",
    ]);
  });
});

import { clarifyingQuestions } from "@/lib/task-profile";
import { safeFilenamePart } from "@/lib/research-report";

describe("clarifying questions skip what the query already says", () => {
  it("does not ask for the area, the specialisation or the product when given", () => {
    expect(clarifyingQuestions("Найди земельные участки в Мадриде площадью от 10 000 м²").questions.map((q) => q.id)).not.toContain("area");
    expect(clarifyingQuestions("участки в Мадриде от 10 000 м²").questions.map((q) => q.id)).not.toContain("area");
    const lawyers = clarifyingQuestions("юристы по недвижимости в Испании");
    expect(lawyers.kind).toBe("person");
    expect(lawyers.questions.map((q) => q.id)).not.toContain("profile");
    expect(clarifyingQuestions("Найти производителей светодиодных ламп в Китае").questions.map((q) => q.id)).not.toContain("product");
    expect(clarifyingQuestions("Найди участок в Мадриде под застройку").questions.map((q) => q.id)).not.toContain("purpose");
  });
});

describe("export file names", () => {
  it("transliterates a Russian query", () => {
    expect(safeFilenamePart("Найди земельные участки в Мадриде от 10 000 м²")).toBe("naydi-zemelnye-uchastki-v-madride-ot-10-000-m2");
    expect(safeFilenamePart("Investors in Amsterdam")).toBe("investors-in-amsterdam");
    expect(safeFilenamePart("")).toBe("research");
  });
});
