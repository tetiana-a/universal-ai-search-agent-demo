import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockFetch } from "./helpers";
import { parseArea, parseBudget, parseMoney, detectLang } from "@/lib/scout/text";
import { classifyComment, extractAgency, extractInvestor, extractObject, extractSource, looksLikeListing } from "@/lib/scout/extract";
import { dedupeObjects, findMatches, matchScore, scoreObject } from "@/lib/scout/scoring";
import { advanceDialog, missingItems } from "@/lib/scout/qualification";
import { markDeadSources, telegramHandle } from "@/lib/scout/sources";
import { buildFirstMessage, createDraft, decideDraft, firstContactProblems, addToStopList, isStopped } from "@/lib/scout/outreach";
import { DEFAULT_SETTINGS } from "@/lib/scout/config";
import { buildIcs, parseMeetingCommand } from "@/lib/scout/calendar";
import { collectReport, renderReport } from "@/lib/scout/report";
import { parseFeed, parseTelegramChannel } from "@/lib/scout/adapters";
import { listAll, putMany, resetMemoryStore } from "@/lib/scout/store";
import { runScan, dueForReminder } from "@/lib/scout/scan";
import { handleUpdate } from "@/lib/scout/bot";
import { sendMessage, webhookSecret } from "@/lib/scout/telegram";
import type { InvestorCard, Lead, ObjectCard, ScoutSource } from "@/lib/scout/types";

const VALENCIA = DEFAULT_SETTINGS.targets[0];

beforeEach(() => {
  resetMemoryStore();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("TELEGRAM_CHAT_ID", "-5415363237");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "-5415363237,8213865630");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
  vi.stubEnv("SCOUT_ADMIN_KEY", "");
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("SCOUT_TIMEZONE", "Europe/Madrid");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function object(partial: Partial<ObjectCard>): ObjectCard {
  const now = new Date().toISOString();
  return { id: "o1", title: "Piso", url: "https://a.es/1", urls: ["https://a.es/1"], country: "Испания", city: "Валенсия", type: "apartment", status: "regular", sourceDomain: "a.es", score: 0, scoreReasons: [], checklist: {}, firstSeenAt: now, lastSeenAt: now, state: "new", ...partial };
}

function investor(partial: Partial<InvestorCard>): InvestorCard {
  const now = new Date().toISOString();
  return { id: "i1", name: "Iberia Family Office", kind: "family_office", interest: { segments: [], geography: [], goals: [] }, source: "web", score: 50, checklist: {}, firstSeenAt: now, lastSeenAt: now, state: "new", ...partial };
}

describe("scout text parsing", () => {
  it("reads prices, areas and budgets in several formats", () => {
    expect(parseMoney("Ático en Ruzafa 280.000 € 95 m²")).toEqual({ amount: 280000, currency: "EUR" });
    expect(parseMoney("Villa Canggu USD 450k freehold")).toEqual({ amount: 450000, currency: "USD" });
    expect(parseMoney("Цена 1,2 млн евро")).toEqual({ amount: 1200000, currency: "EUR" });
    expect(parseArea("120 m2 terrace")).toBe(120);
    expect(parseArea("land 5 are Bali")).toBe(500);
    expect(parseArea("участок 12 соток")).toBe(1200);
    expect(parseBudget("бюджет от 300 до 500 тыс евро")).toMatchObject({ min: 300000, max: 500000, currency: "EUR" });
    expect(parseBudget("up to €2M")).toMatchObject({ max: 2000000 });
  });

  it("detects the four dialogue languages", () => {
    expect(detectLang("Привет, сколько стоит?")).toBe("ru");
    expect(detectLang("Вітаю, скільки коштує?")).toBe("uk");
    expect(detectLang("Hola, ¿cuál es el precio?")).toBe("es");
    expect(detectLang("Hello, what is the price?")).toBe("en");
  });
});

describe("scout extraction", () => {
  it("keeps real listings in the target city and drops articles and other cities", () => {
    const listing = { title: "Ático en venta en Ruzafa, Valencia - idealista", url: "https://www.idealista.com/inmueble/12345/", snippet: "Ático 95 m² con terraza, 280.000 €. Contacto 612 345 678" };
    const card = extractObject(listing, VALENCIA)!;
    expect(card).toMatchObject({ city: "Валенсия", district: "Ruzafa", type: "penthouse", price: 280000, areaM2: 95, pricePerM2: 2947 });
    expect(card.sellerContact).toContain("612");
    expect(extractObject({ title: "Guía: cómo comprar piso en Valencia 2026", url: "https://blog.example.com/guia", snippet: "Consejos y precios medios" }, VALENCIA)).toBeNull();
    expect(extractObject({ title: "Piso en venta en Madrid", url: "https://x.es/property/1", snippet: "250.000 € 80 m²" }, VALENCIA)).toBeNull();
    expect(looksLikeListing({ title: "Top 10 best areas in Valencia", url: "https://news.example.com/top", snippet: "from 200.000 €" })).toBe(false);
  });

  it("classifies investors, agencies, commenters and new sources", () => {
    expect(extractInvestor({ title: "Iberia Family Office | Real estate investments in Spain", url: "https://iberia-fo.com", snippet: "Family office acquiring residential property in Spain, tickets €1-5M" }, "web")).toMatchObject({ kind: "family_office", interest: { geography: ["Испания"] } });
    expect(extractAgency({ title: "Engel & Völkers Valencia - Inmobiliaria", url: "https://engelvoelkers.com/es/valencia", snippet: "Agencia inmobiliaria en Valencia" }, ["Валенсия"], "web")).toMatchObject({ city: "Валенсия", network: "Engel & Völkers" });
    expect(classifyComment("Сколько стоит? Напишите в личку")).toBe("explicit");
    expect(classifyComment("Очень интересно!")).toBe("general");
    expect(classifyComment("Красивый закат")).toBe("neutral");
    const src = extractSource({ title: "Инвестиции в Испанию 2026 — Telegram", url: "https://t.me/invest_spain_2026", snippet: "2 400 subscribers. Объекты и сделки, инвестиции в недвижимость Испании" }, ["Испания"])!;
    expect(src).toMatchObject({ kind: "channel", members: 2400, recommendation: "join", country: "Испания" });
  });
});

describe("scout scoring, dedupe and matching", () => {
  it("scores below-market objects higher and explains why", () => {
    const cheap = scoreObject(object({ price: 200000, areaM2: 100, pricePerM2: 2000, currency: "EUR" }), DEFAULT_SETTINGS);
    const expensive = scoreObject(object({ price: 400000, areaM2: 100, pricePerM2: 4000, currency: "EUR" }), DEFAULT_SETTINGS);
    expect(cheap.discountPct).toBe(35);
    expect(cheap.score).toBeGreaterThan(expensive.score);
    expect(cheap.scoreReasons[0]).toContain("ниже рынка");
  });

  it("merges the same object listed on several portals", () => {
    const a = object({ id: "a", url: "https://idealista.com/1", urls: ["https://idealista.com/1"], price: 280000, areaM2: 95, title: "Ático Ruzafa terraza" });
    const b = object({ id: "b", url: "https://fotocasa.es/2", urls: ["https://fotocasa.es/2"], price: 282000, areaM2: 95, title: "Precioso ático en Ruzafa" });
    const c = object({ id: "c", url: "https://kyero.com/3", urls: ["https://kyero.com/3"], price: 150000, areaM2: 60, title: "Piso Benimaclet" });
    const { all, added, merged } = dedupeObjects([a], [b, c]);
    expect(all).toHaveLength(2);
    expect(added.map((x) => x.id)).toEqual(["c"]);
    expect(merged).toHaveLength(1);
    expect(merged[0].urls).toEqual(["https://idealista.com/1", "https://fotocasa.es/2"]);
  });

  it("pairs objects with investors whose geography, type and budget fit", () => {
    const o = object({ price: 300000, type: "apartment", yieldPct: 6 });
    const fit = investor({ interest: { segments: ["apartment"], geography: ["Испания"], budgetMin: 200000, budgetMax: 400000, goals: ["income"] } });
    const wrongBudget = investor({ id: "i2", interest: { segments: ["apartment"], geography: ["Испания"], budgetMin: 1000000, goals: [] } });
    expect(matchScore(o, fit).score).toBe(95);
    expect(matchScore(o, wrongBudget).score).toBe(0);
    expect(findMatches([o], [fit, wrongBudget]).map((m) => m.investorId)).toEqual(["i1"]);
  });
});

describe("scout qualification dialogue", () => {
  const start = (): Lead => ({ id: "l", type: "investor", name: "Ana", lang: "ru", answers: {}, transcript: [{ from: "agent", text: "Какой бюджет вы рассматриваете и в какой валюте?", at: "" }], state: "in_progress", lastContactAt: "", remindersSent: 0, createdAt: "" });

  it("fills several checklist items from one reply and asks the next missing one", () => {
    const { lead, reply, event } = advanceDialog(start(), "Бюджет 300-500 тыс евро, интересует квартира в Испании под сдачу");
    expect(event).toBe("question");
    expect(Object.keys(lead.answers).sort((a, b) => a.localeCompare(b))).toEqual(["budget", "geography", "goal", "type"]);
    expect(reply).toBe("Когда планируете сделку и насколько это срочно?");
  });

  it("hands over only when every item is closed", () => {
    let lead = start();
    const replies = ["500 тыс евро", "Испания", "квартира", "доход от аренды", "в течение 3 месяцев", "наличные", "решаю я сама", "во вторник в 11:00 по Zoom"];
    let event = "";
    for (const r of replies) ({ lead, event } = advanceDialog(lead, r));
    expect(event).toBe("qualified");
    expect(missingItems(lead)).toEqual([]);
  });

  it("escalates money questions and records refusals", () => {
    expect(advanceDialog(start(), "А какая у вас комиссия? Нужен ли задаток?").event).toBe("escalated");
    expect(advanceDialog(start(), "стоп").event).toBe("refused");
    expect(advanceDialog(start(), "Hello, budget around 1M EUR").lead.lang).toBe("en");
  });
});

describe("scout first-contact rules", () => {
  it("renders approved templates with who/where/why/unsubscribe", () => {
    const text = buildFirstMessage(DEFAULT_SETTINGS, "investor_first", "es", { name: "Ana", source: "LinkedIn", city: "Валенсия" });
    expect(text).toContain(DEFAULT_SETTINGS.companyName);
    expect(text).toContain("LinkedIn");
    expect(text).toContain("en Valencia");
    expect(firstContactProblems(text, DEFAULT_SETTINGS, "es", "email")).toEqual([]);
    expect(firstContactProblems("hola", DEFAULT_SETTINGS, "es", "email")).toHaveLength(2);
  });

  it("never drafts to a stop-listed contact and enforces daily limits", async () => {
    await addToStopList("ana@example.com", "refused");
    expect(await isStopped(" ANA@example.com ")).toBe(true);
    expect(await createDraft({ target: { type: "investor", id: "i", name: "Ana", contact: "ana@example.com" }, channel: "email", lang: "ru", templateId: "investor_first", kind: "first_contact", text: "x" })).toBeNull();

    vi.stubEnv("KV_REST_API_URL", "");
    const { saveSettings } = await import("@/lib/scout/config");
    await saveSettings({ dailyLimits: { ...DEFAULT_SETTINGS.dailyLimits, email: 1 } });
    const d1 = await createDraft({ target: { type: "investor", id: "a", name: "A", contact: "a@x.com" }, channel: "email", lang: "en", templateId: "investor_first", kind: "first_contact", text: "x" });
    const d2 = await createDraft({ target: { type: "investor", id: "b", name: "B", contact: "b@x.com" }, channel: "email", lang: "en", templateId: "investor_first", kind: "first_contact", text: "y" });
    const first = await decideDraft(d1!.id, "approve", "T");
    expect(first.ok).toBe(true);
    expect(first.link).toMatch(/^mailto:a@x\.com\?subject=/);
    expect((await decideDraft(d2!.id, "approve", "T")).message).toContain("лимит");
  });
});

describe("scout self-learning and watchlist", () => {
  it("marks approved sources without useful results for 30 days as dead", () => {
    const now = Date.parse("2026-10-03T06:00:00Z");
    const base: ScoutSource = { id: "s", name: "Portal", url: "https://p.es", domain: "p.es", kind: "portal", state: "approved", discoveredAt: "2026-08-01T00:00:00Z", approvedAt: "2026-08-01T00:00:00Z", usefulCount: 0, checkedCount: 20 };
    const { dead } = markDeadSources([base, { ...base, id: "fresh", lastUsefulAt: "2026-09-30T00:00:00Z" }, { ...base, id: "cand", state: "candidate" }], now);
    expect(dead.map((s) => s.id)).toEqual(["s"]);
    expect(telegramHandle("https://t.me/s/valencia_invest")).toBe("valencia_invest");
    expect(telegramHandle("@valencia_invest")).toBe("valencia_invest");
    expect(telegramHandle("Иван Петров")).toBeNull();
  });

  it("parses public Telegram channel previews and RSS feeds", () => {
    const html = '<div class="tgme_widget_message_wrap"><div data-post="valencia_invest/42"><div class="tgme_widget_message_text js-message_text">Ático en Ruzafa<br>280.000 € · 95 m²</div><time datetime="2026-10-02T10:00:00+00:00"></time></div></div>';
    expect(parseTelegramChannel(html, "valencia_invest")).toEqual([{ url: "https://t.me/valencia_invest/42", text: "Ático en Ruzafa\n280.000 € · 95 m²", at: "2026-10-02T10:00:00+00:00", image: undefined }]);
    const rss = "<rss><channel><item><title>Villa Canggu</title><link>https://bali.example/villa-1</link><description><![CDATA[USD 450k, 300 m2]]></description></item></channel></rss>";
    expect(parseFeed(rss)[0]).toMatchObject({ title: "Villa Canggu", url: "https://bali.example/villa-1", snippet: "USD 450k, 300 m2" });
  });
});

describe("scout meetings and reminders", () => {
  it("parses /meet in Madrid time and builds an .ics", () => {
    const m = parseMeetingCommand("18.10 11:00 Zoom — Engel & Völkers Valencia", new Date("2026-10-03T00:00:00Z"))!;
    expect(m.startsAt).toBe("2026-10-18T09:00:00.000Z");
    expect(m.with).toBe("Engel & Völkers Valencia");
    const ics = buildIcs({ ...m, id: "mt_1", createdAt: "" });
    expect(ics).toContain("DTSTART:20261018T090000Z");
    expect(ics).toContain("SUMMARY:Встреча: Engel & Völkers Valencia");
  });

  it("reminds at most every 3 days and at most twice", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    const lead = { state: "in_progress", remindersSent: 0, lastContactAt: "2026-10-06T00:00:00Z", transcript: [{ from: "agent", text: "?", at: "" }] } as any;
    expect(dueForReminder(lead, DEFAULT_SETTINGS, now)).toBe(true);
    expect(dueForReminder({ ...lead, lastContactAt: "2026-10-08T00:00:00Z" }, DEFAULT_SETTINGS, now)).toBe(false);
    expect(dueForReminder({ ...lead, remindersSent: 2 }, DEFAULT_SETTINGS, now)).toBe(false);
    expect(dueForReminder({ ...lead, transcript: [{ from: "contact", text: "ok", at: "" }] }, DEFAULT_SETTINGS, now)).toBe(false);
  });
});

describe("scout daily run and report", () => {
  it("scans, dedupes, matches, drafts and renders the report in the spec format", async () => {
    await putMany("investors", [investor({ interest: { segments: ["penthouse", "apartment"], geography: ["Испания"], budgetMin: 200000, budgetMax: 400000, goals: [] }, channel: "info@iberia-fo.com" })]);
    const search = async (queries: string[]) => ({ errors: [], results: queries.map((q) => q.includes("Valencia") && !q.includes("inmobiliaria") ? [
      { title: "Ático en venta en Ruzafa, Valencia", url: "https://www.idealista.com/inmueble/1/", snippet: "Ático 95 m², 250.000 €" },
      { title: "Ático Ruzafa con terraza", url: "https://www.fotocasa.es/es/comprar/vivienda/valencia/1/d", snippet: "95 m² 251.000 € Valencia Ruzafa" },
    ] : q.startsWith("t.me") ? [{ title: "Инвестиции в Испанию 2026", url: "https://t.me/invest_spain_2026", snippet: "2 400 subscribers, объекты и сделки, недвижимость Испания" }] : []) });
    const stats = await runScan({ search, deadlineAt: Date.now() + 60_000 });
    expect(stats.objectsNew).toBe(1);
    expect(stats.objectsMerged).toBeGreaterThanOrEqual(1);
    expect(stats.matchesNew).toBe(1);
    expect(stats.sourcesDiscovered).toBe(1);
    const [obj] = await listAll<ObjectCard>("objects");
    expect(obj.urls).toHaveLength(2);

    const { html, keyboard } = renderReport(await collectReport());
    expect(html).toContain("<b>ОТЧЁТ ЗА ");
    expect(html).toContain("НЕДВИЖИМОСТЬ</b> — новых: 1");
    expect(html).toContain("Испания (Валенсия): 1");
    expect(html).toContain("ИНВЕСТОРЫ</b> — новых: 1");
    expect(html).toContain("Квалифицировано и ждёт тебя: 0");
    expect(html).toContain("Новые группы: 1");
    expect(keyboard[0][0].callback_data).toMatch(/^src:approve:src_/);
  });
});

describe("scout Telegram bot", () => {
  function botFetch() {
    return mockFetch([{ match: (url) => url.startsWith("https://api.telegram.org/bottest-bot-token/"), respond: () => json({ ok: true, result: { message_id: 7 } }) }]);
  }
  const sent = (calls: Array<{ url: string; init?: RequestInit }>) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => JSON.parse(String(c.init?.body)));

  it("rejects webhook calls without the secret", async () => {
    const { POST } = await import("@/app/api/scout/telegram/route");
    const response = await POST(new Request("https://x/api/scout/telegram", { method: "POST", body: "{}" }));
    expect(response.status).toBe(403);
    expect(webhookSecret()).toHaveLength(48);
  });

  it("runs control commands only for the allowed chats", async () => {
    const calls = botFetch();
    await handleUpdate({ message: { text: "/watch@AURELIUS8_bot add person @valencia_invest", chat: { id: -5415363237, type: "group" }, from: { id: 1, first_name: "T" } } });
    expect(sent(calls)[0].text).toContain("Добавлено в watchlist: person — @valencia_invest");
    await handleUpdate({ message: { text: "/report", chat: { id: -999, type: "group" }, from: { id: 2 } } });
    expect(sent(calls)).toHaveLength(1);
  });

  it("approves a new source from an inline button", async () => {
    const calls = botFetch();
    await putMany("sources", [{ id: "src_1", name: "Crowd X", url: "https://crowdx.pt", domain: "crowdx.pt", kind: "platform", state: "candidate", discoveredAt: new Date().toISOString(), usefulCount: 0, checkedCount: 0 } as ScoutSource]);
    await handleUpdate({ callback_query: { id: "cb", data: "src:approve:src_1", from: { id: 8213865630, username: "t" }, message: { chat: { id: 8213865630 }, message_id: 5, text: "🔭 Crowd X" } } });
    expect((await listAll<ScoutSource>("sources"))[0].state).toBe("approved");
    expect(calls.some((c) => c.url.endsWith("/answerCallbackQuery"))).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/editMessageText"))).toBe(true);
  });

  it("qualifies a person who wrote to the bot and alerts the group", async () => {
    const calls = botFetch();
    const from = { id: 555, first_name: "Ana", username: "ana", language_code: "ru" };
    const say = (text: string) => handleUpdate({ message: { text, chat: { id: 555, type: "private" }, from } });
    await say("/start");
    for (const r of ["Бюджет до 400 тыс евро", "Испания, Валенсия", "квартира", "доход", "в этом году", "наличные", "решаю я сама", "завтра в 12:00 по Zoom"]) await say(r);
    const [lead] = await listAll<Lead>("leads");
    expect(lead.state).toBe("qualified");
    const toGroup = sent(calls).filter((m) => m.chat_id === "-5415363237");
    expect(toGroup).toHaveLength(1);
    expect(toGroup[0].text).toContain("Квалифицированный лид");
    expect(toGroup[0].text).toContain("Бюджет и валюта");
  });

  it("follows a group upgraded to a supergroup and remembers the new id", async () => {
    const calls = mockFetch([{ match: (url) => url.endsWith("/sendMessage"), respond: (_url, init) => JSON.parse(String(init?.body)).chat_id === "-5415363237" ? json({ ok: false, description: "Bad Request: group chat was upgraded to a supergroup chat", parameters: { migrate_to_chat_id: -1005415363237 } }, 400) : json({ ok: true, result: { message_id: 1 } }) }]);
    const first = await sendMessage("-5415363237", "hi");
    expect(first).toMatchObject({ ok: true, chatId: "-1005415363237" });
    await sendMessage("-5415363237", "again");
    expect(JSON.parse(String(calls[calls.length - 1].init?.body)).chat_id).toBe("-1005415363237");
  });
});
