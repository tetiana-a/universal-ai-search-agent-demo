import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectLanguage } from "@/lib/scout/text";
import { isAdPostingIntent } from "@/lib/scout/ad-wizard";
import { platformSearchQueries, topicTranslations } from "@/lib/scout/groups";
import { resetMemoryStore } from "@/lib/scout/store";
import { mockFetch, openRouterReply } from "./helpers";

describe("any language", () => {
  beforeEach(() => { resetMemoryStore(); vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("GROQ_API_KEY", ""); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("detects the language of a community beyond the four dialogue languages", () => {
    expect(detectLanguage("Wino i winnice – grupa dla miłośników")).toBe("pl");
    expect(detectLanguage("Víno a vinaři – skupina, inzerce")).toBe("cs");
    expect(detectLanguage("Weinliebhaber Gruppe für Wein und Genuss")).toBe("de");
    expect(detectLanguage("Vino e cantine: gruppo per gli amanti del vino")).toBe("it");
    expect(detectLanguage("Vinos de Valencia, grupo para los amantes del vino")).toBe("es");
    expect(detectLanguage("Les amateurs de vin, groupe d'échange")).toBe("fr");
    expect(detectLanguage("Вино у Валенсії")).toBe("uk");
    expect(detectLanguage("葡萄酒爱好者")).toBe("zh");
  });

  it("recognises a request to publish an ad in other languages", () => {
    expect(isAdPostingIntent("Opublikuj ogłoszenie")).toBe(true);
    expect(isAdPostingIntent("Pubblica un annuncio")).toBe(true);
    expect(isAdPostingIntent("Bitte Anzeige veröffentlichen")).toBe(true);
    expect(isAdPostingIntent("Publier une annonce")).toBe(true);
    expect(isAdPostingIntent("Найди объявления о продаже квартир")).toBe(false);
  });

  it("searches the second round in the place's language", () => {
    const qs = platformSearchQueries({ topic: "вино", city: "Валенсия", platforms: ["telegram"], localTopic: "vino" });
    expect(qs[0].query).toContain("вино");
    expect(qs[1].query).toContain("vino");
  });

  it("translates the topic once with the free AI and caches it", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    const calls = mockFetch([
      { match: (u) => u.includes("openrouter.ai/api/v1/models"), respond: () => new Response(JSON.stringify({ data: [] })) },
      { match: (u) => u.includes("openrouter.ai"), respond: () => openRouterReply({ lang: "es", local: "vino", variants: ["wine", "bodegas"] }) },
    ]);
    const first = await topicTranslations("вино", "Валенсия, Испания");
    expect(first).toEqual({ lang: "es", local: "vino", variants: ["vino", "wine", "bodegas"] });
    const n = calls.length;
    expect(await topicTranslations("вино", "Валенсия, Испания")).toEqual(first);
    expect(calls.length).toBe(n);
  });

  it("uses the topic as typed when no AI key is set", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await topicTranslations("вино", "Испания")).toEqual({ lang: "es", local: "", variants: [] });
  });
});
