import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockFetch } from "./helpers";
import { detectAdminContact, detectAdsPolicy, extractGroupLinks, findGroups, groupsXlsx, handleMyChatMember, listGroups, listPosts, listQueue, markQueued, normalizeTelegramUrl, parseMembers, parseTelegramPreview, postViaBot, queueManual, upsertGroups, type GroupCard } from "@/lib/scout/groups";
import { parseGroupsArgs } from "@/lib/scout/groups-bot";
import { handleUpdate } from "@/lib/scout/bot";
import { resetMemoryStore } from "@/lib/scout/store";

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("TELEGRAM_CHAT_ID", "-5415363237");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "-5415363237,8213865630");
  vi.stubEnv("GEMINI_API_KEY", "g-key");
  vi.stubEnv("KEYLESS_SEARCH", "off");
});

const TG_PAGE = (title: string, extra: string, desc: string) => `<div class="tgme_page_title" dir="auto"><span dir="auto">${title}</span></div><div class="tgme_page_extra">${extra}</div><div class="tgme_page_description" dir="auto">${desc}</div>`;

describe("group parsing", () => {
  it("normalizes Telegram and Facebook links and skips bots and service paths", () => {
    expect(normalizeTelegramUrl("https://t.me/s/barcelona_pisos/123")).toBe("https://t.me/barcelona_pisos");
    expect(normalizeTelegramUrl("t.me/share/url?x")).toBe("");
    expect(normalizeTelegramUrl("https://t.me/somehelperbot")).toBe("");
    const links = extractGroupLinks("see https://t.me/bcn_realty and https://www.facebook.com/groups/pisosbcn/?ref=x and facebook.com/groups/feed");
    expect(links).toEqual({ telegram: ["https://t.me/bcn_realty"], facebook: ["https://www.facebook.com/groups/pisosbcn"] });
  });

  it("reads members, ads policy and admin contact", () => {
    expect(parseMembers("12 345 members, 300 online")).toBe(12345);
    expect(parseMembers("1.2K members")).toBe(1200);
    expect(parseMembers("3,4 тыс. участников")).toBe(3400);
    expect(detectAdsPolicy("Без рекламы и спама")).toBe("forbidden");
    expect(detectAdsPolicy("По вопросам рекламы: @bcn_admin")).toBe("paid");
    expect(detectAdsPolicy("Аренда и продажа квартир")).toBe("allowed");
    expect(detectAdminContact("Чат о недвижимости\nПо вопросам рекламы: @bcn_admin", "https://t.me/bcn_chat")).toBe("@bcn_admin");
  });

  it("accepts groups and channels but not personal profiles", () => {
    expect(parseTelegramPreview(TG_PAGE("Pisos BCN", "5 400 members, 12 online", "x"))?.kind).toBe("group");
    expect(parseTelegramPreview(TG_PAGE("Ivan", "@ivan", ""))).toBeNull();
  });

  it("parses /groups arguments", () => {
    expect(parseGroupsArgs("Испания, Барселона, недвижимость")).toEqual({ country: "Испания", city: "Барселона", topic: "недвижимость" });
    expect(parseGroupsArgs("Мадрид, аренда")).toEqual({ country: "", city: "Мадрид", topic: "аренда" });
  });
});

describe("findGroups", () => {
  it("keeps only links confirmed by their public page and saves them", async () => {
    mockFetch([
      { match: (u) => u.includes("generativelanguage"), respond: () => json({ candidates: [{ content: { parts: [{ text: "1. https://t.me/bcn_pisos 2. https://t.me/made_up_group" }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://www.facebook.com/groups/pisosbcn", title: "Pisos Barcelona | Facebook" } }], groundingSupports: [{ segment: { text: "Pisos Barcelona 25K members" }, groundingChunkIndices: [0] }] } }] }) },
      { match: (u) => u === "https://t.me/bcn_pisos", respond: () => new Response(TG_PAGE("BCN Pisos", "8 000 members", "Аренда и продажа. Реклама: @owner_bcn")) },
      { match: (u) => u === "https://t.me/made_up_group", respond: () => new Response("<html></html>") },
      { match: (u) => u.includes("facebook.com"), respond: () => new Response("login", { status: 200 }) },
    ]);
    const result = await findGroups({ country: "Испания", city: "Барселона", topic: "недвижимость" });
    expect(result.found.map((g) => g.name).sort()).toEqual(["BCN Pisos", "Pisos Barcelona"]);
    const tg = result.found.find((g) => g.platform === "telegram")!;
    expect(tg).toMatchObject({ members: 8000, ads: "paid", adminContact: "@owner_bcn" });
    expect(result.found.find((g) => g.platform === "facebook")!.members).toBe(25000);
    expect(await listGroups()).toHaveLength(2);
  });
});

describe("bot posting and manual queue", () => {
  it("connects a group when an admin adds the bot, posts with a daily cap and logs", async () => {
    const sent: any[] = [];
    mockFetch([
      { match: (u) => u.endsWith("/getChatMember"), respond: () => json({ ok: true, result: { status: "administrator" } }) },
      { match: (u) => u.endsWith("/sendMessage"), respond: (_u, init) => { sent.push(JSON.parse(String(init?.body))); return json({ ok: true, result: { message_id: sent.length } }); } },
    ]);
    await handleUpdate({ update_id: 1, my_chat_member: { chat: { id: -100777, type: "supergroup", title: "BCN Pisos", username: "bcn_pisos" }, from: { id: 42 }, new_chat_member: { status: "member" } } });
    const [card] = await listGroups();
    expect(card).toMatchObject({ botConnected: true, postingEnabled: true, chatId: "-100777" });
    for (let i = 0; i < 4; i += 1) await postViaBot("Квартира 2 комнаты", undefined, "test", Date.now() + 10_000, 0);
    expect(sent.filter((b) => b.chat_id === "-100777")).toHaveLength(3); // default cap 3/day
    const posts = await listPosts();
    expect(posts.filter((p) => p.status === "sent")[0].link).toMatch(/^https:\/\/t\.me\/bcn_pisos\/\d+$/);
  });

  it("does not enable posting when a non-admin added the bot", async () => {
    mockFetch([{ match: (u) => u.endsWith("/getChatMember"), respond: () => json({ ok: true, result: { status: "member" } }) }]);
    const card = await handleMyChatMember({ chat: { id: -1009, type: "group", title: "Chat" }, from: { id: 5 }, new_chat_member: { status: "member" } });
    expect(card?.postingEnabled).toBe(false);
  });

  it("queues groups without the bot for manual posting and logs the human's confirmation", async () => {
    const now = new Date().toISOString();
    const base = { ads: "unknown", status: "new", foundAt: now, updatedAt: now } as const;
    await upsertGroups([
      { ...base, id: "g1", platform: "facebook", url: "https://www.facebook.com/groups/a", name: "FB A" },
      { ...base, id: "g2", platform: "telegram", url: "https://t.me/b", name: "TG B", ads: "forbidden" },
    ] as GroupCard[]);
    const result = await queueManual("Текст", "all");
    expect(result.added).toBe(1); // the group that forbids ads is left out
    const [item] = await listQueue();
    await markQueued(item.id, "published", "@me");
    expect((await listPosts())[0]).toMatchObject({ mode: "manual", status: "published", groupName: "FB A" });
    const xlsx = await groupsXlsx(await listGroups(), await listPosts());
    expect(xlsx.length).toBeGreaterThan(1000);
  });
});
