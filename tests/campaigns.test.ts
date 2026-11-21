import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockFetch } from "./helpers";
import { capacityOf, createCampaign, digestText, matchesPost, planDay, planTasks, ruleCampaign, searchPlan, setCampaignStatus, submitProof, verifyProof, notifyPartners, type Campaign, type CampaignTask } from "@/lib/scout/campaigns";
import { editKeywords } from "@/lib/scout/campaigns-bot";
import { activityFromPosts, listQueue, parseTelegramPosts, platformOfUrl, upsertGroups, type GroupCard } from "@/lib/scout/groups";
import { handleUpdate } from "@/lib/scout/bot";
import { getOne, listAll, putOne, resetMemoryStore } from "@/lib/scout/store";

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("TELEGRAM_CHAT_ID", "-5415363237");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "-5415363237,8213865630");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "");
});

const now = new Date().toISOString();
const group = (id: string, over: Partial<GroupCard> = {}): GroupCard => ({ id, platform: "telegram", url: "https://t.me/" + id, name: id, ads: "unknown", status: "free", foundAt: now, updatedAt: now, ...over });
const campaign = (over: Partial<Campaign> = {}): Campaign => ({ id: "c1", title: "Квартира Валенсия", adText: "Продаю квартиру", topic: "недвижимость", region: "Валенсия, Испания", languages: ["ru"], keywords: ["квартира"], adjacent: [], queries: [], exclusions: [], questions: [], translations: {}, platforms: ["telegram", "facebook", "instagram", "tiktok"], dailyTarget: 300, status: "approved", source: "text", createdAt: now, updatedAt: now, ...over });

describe("task parsing without AI", () => {
  it("asks for the region and ad text when missing and keeps at most 40 unique keywords", () => {
    const c = ruleCampaign("квартиры квартиры дома недвижимость");
    expect(c.questions.length).toBe(2);
    const many = ruleCampaign(Array.from({ length: 60 }, (_, i) => "слово" + i).join(" ") + " в Валенсии");
    expect(many.keywords.length).toBe(40);
    expect(many.region).toBe("Валенсии");
  });

  it("edits keywords with +/- and replaces the list otherwise", () => {
    expect(editKeywords(["квартира", "дом"], "+вилла, -дом")).toEqual(["квартира", "вилла"]);
    expect(editKeywords(["квартира"], "a1, b2")).toEqual(["a1", "b2"]);
  });

  it("plans core queries and a third for adjacent audiences", () => {
    const plan = searchPlan(campaign({ keywords: Array.from({ length: 20 }, (_, i) => "k" + i), adjacent: ["экспаты Валенсия", "барахолка Валенсия"] }), 9);
    expect(plan).toHaveLength(9);
    expect(plan.filter((p) => p.relevance === "adjacent")).toHaveLength(2);
  });
});

describe("liveness and platforms", () => {
  it("reads Telegram public posts and marks a channel inactive after the threshold", () => {
    const html = `<div class="tgme_widget_message_wrap"><div data-post="bcn/10"><div class="tgme_widget_message_text js-message_text">Продаётся квартира</div><span class="tgme_widget_message_views">1.2K</span><time datetime="2026-01-01T10:00:00+00:00"></time></div></div>`;
    const posts = parseTelegramPosts(html);
    expect(posts[0]).toMatchObject({ url: "https://t.me/bcn/10", views: 1200 });
    expect(activityFromPosts(posts, Date.parse("2026-11-20")).activity).toBe("inactive");
    expect(activityFromPosts(posts, Date.parse("2026-01-05")).activity).toBe("active");
    expect(activityFromPosts([]).activity).toBe("unknown");
    expect(matchesPost("Продаётся квартира у моря", campaign())).toBe(true);
  });

  it("recognises Instagram and TikTok pages for partner placements", () => {
    expect(platformOfUrl("https://www.instagram.com/valencia.homes/")?.platform).toBe("instagram");
    expect(platformOfUrl("https://tiktok.com/@valencia")?.url).toBe("https://www.tiktok.com/@valencia");
  });
});

describe("daily planner", () => {
  it("creates 300 tasks a day over 300 permitted placements, without duplicates, and 300 again the next day", () => {
    const groups = Array.from({ length: 300 }, (_, i) => group("g" + i, { botConnected: true, postingEnabled: true, chatId: String(-100 - i), dailyLimit: 1 }));
    const day1 = planTasks([campaign()], groups, [], "2026-11-22");
    expect(day1).toHaveLength(300);
    expect(planTasks([campaign()], groups, day1, "2026-11-22")).toHaveLength(0);
    expect(planTasks([campaign()], groups, day1, "2026-11-23")).toHaveLength(300);
  });

  it("respects permission, inactivity, the per-group interval and stopped campaigns", () => {
    const groups = [
      group("bot", { botConnected: true, postingEnabled: true, chatId: "-1" }),
      group("partner", { platform: "instagram", partnerTelegramId: "555" }),
      group("manual", { platform: "facebook", status: "paid" }),
      group("ads-only", { platform: "facebook", status: "new", ads: "allowed" }),
      group("asked", { status: "contacted" }),
      group("declined", { status: "declined" }),
      group("sleepy", { activity: "inactive", botConnected: true, postingEnabled: true, chatId: "-2" }),
      group("weekly", { botConnected: true, postingEnabled: true, chatId: "-3", minDaysBetween: 7 }),
    ];
    const past: CampaignTask[] = [{ id: "old", campaignId: "x", campaignTitle: "x", groupId: "weekly", groupName: "weekly", platform: "telegram", url: "", day: "2026-11-20", mode: "bot", status: "sent", createdAt: now, updatedAt: now }];
    const tasks = planTasks([campaign(), campaign({ id: "c2", status: "stopped" })], groups, past, "2026-11-22");
    expect(tasks.map((t) => t.groupId + ":" + t.mode).sort()).toEqual(["bot:bot", "manual:manual", "partner:partner"]);
    const cap = capacityOf(groups, tasks, [campaign()], "2026-11-22");
    expect(cap.places).toBe(4);
    expect(cap.target).toBe(300);
    expect(cap.sustained).toBeLessThan(cap.peak);
  });
});

describe("campaign flow", () => {
  it("drafts without AI, plans, sends a partner task, accepts /proof only from that partner, and stops cleanly", async () => {
    const sent: any[] = [];
    mockFetch([{ match: (u) => u.includes("api.telegram.org"), respond: (_u, init) => { sent.push(JSON.parse(String(init?.body || "{}"))); return json({ ok: true, result: { message_id: sent.length } }); } }]);
    const { campaign: draft, ai } = await createCampaign("Продаю квартиру в Валенсии, 2 спальни, 240 000 €, Instagram и Facebook. Звоните +34 600 000 000", "text", "8213865630");
    expect(ai).toBe(false);
    expect(draft.platforms).toEqual(["facebook", "instagram"]);
    await upsertGroups([group("ig", { platform: "instagram", url: "https://www.instagram.com/vlc", partnerTelegramId: "555" }), group("fb", { platform: "facebook", url: "https://www.facebook.com/groups/vlc", status: "exchange" })]);
    await setCampaignStatus(draft.id, "approved");
    const plan = await planDay();
    expect(plan.byMode).toEqual({ bot: 0, partner: 1, manual: 1 });
    expect((await listQueue()).filter((q) => q.status === "pending")).toHaveLength(1);
    expect((await notifyPartners()).notified).toBe(1);
    const task = (await listAll<CampaignTask>("campaign_tasks")).find((t) => t.mode === "partner")!;
    expect(sent.some((b) => b.chat_id === "555" && String(b.text).includes("/proof " + task.id))).toBe(true);

    expect((await submitProof(task.id, "999", "https://www.instagram.com/p/abc")).ok).toBe(false);
    expect((await submitProof(task.id, "555", "https://t.me/x/1")).ok).toBe(false);
    expect((await submitProof(task.id, "555", "https://www.instagram.com/p/abc")).ok).toBe(true);
    expect((await verifyProof(task.id, true))?.status).toBe("verified");
    expect(await digestText()).toContain("Размещено: <b>1</b>");

    await setCampaignStatus(draft.id, "stopped");
    const manual = (await listAll<CampaignTask>("campaign_tasks")).find((t) => t.mode === "manual")!;
    expect(manual.status).toBe("cancelled");
    expect(await getOne("group_queue", manual.id)).toBeNull();
  });

  it("lets a partner send /proof without owner rights and ignores voice from strangers", async () => {
    const sent: any[] = [];
    mockFetch([{ match: (u) => u.includes("api.telegram.org"), respond: (_u, init) => { sent.push(JSON.parse(String(init?.body || "{}"))); return json({ ok: true, result: { message_id: 1 } }); } }]);
    await putOne("campaigns", campaign());
    await putOne("campaign_tasks", { id: "ct_1", campaignId: "c1", campaignTitle: "c", groupId: "g", groupName: "G", platform: "facebook", url: "", day: "2026-11-22", mode: "partner", status: "notified", partnerId: "777", createdAt: now, updatedAt: now } satisfies CampaignTask);
    await handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 777, type: "private" }, from: { id: 777, first_name: "P" }, text: "/proof ct_1 https://www.facebook.com/groups/vlc/posts/123" } });
    expect((await getOne<CampaignTask>("campaign_tasks", "ct_1"))?.status).toBe("proof");
    expect(sent.some((b) => b.chat_id === "-5415363237" || b.chat_id === "8213865630")).toBe(true);
    const before = sent.length;
    await handleUpdate({ update_id: 2, message: { message_id: 2, chat: { id: 1234, type: "private" }, from: { id: 1234 }, voice: { file_id: "v1" } } });
    expect(sent.length).toBe(before);
  });
  it("lets an admin join the partner network by /join, waits for owner approval and refuses a second admin", async () => {
    const sent: any[] = [];
    mockFetch([{ match: (u) => u.includes("api.telegram.org"), respond: (_u, init) => { sent.push(JSON.parse(String(init?.body || "{}"))); return json({ ok: true, result: { message_id: 1 } }); } }]);
    await handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 555123, type: "private" }, from: { id: 555123, first_name: "Admin" }, text: "/join https://www.facebook.com/groups/valencia 2 3" } });
    let card = (await listAll<GroupCard>("groups"))[0];
    expect(card).toMatchObject({ platform: "facebook", partnerTelegramId: "555123", status: "contacted", dailyLimit: 2, minDaysBetween: 3 });
    expect(planTasks([campaign()], [card], [], "2026-11-22")).toHaveLength(0);
    const owner = sent.find((b) => b.chat_id === "8213865630" && JSON.stringify(b.reply_markup || {}).includes("cp:pok:"));
    expect(owner).toBeTruthy();
    await handleUpdate({ update_id: 2, message: { message_id: 2, chat: { id: 666123, type: "private" }, from: { id: 666123 }, text: "/join https://www.facebook.com/groups/valencia" } });
    expect((await getOne<GroupCard>("groups", card.id))?.partnerTelegramId).toBe("555123");
    await handleUpdate({ update_id: 3, callback_query: { id: "q1", from: { id: 8213865630 }, data: "cp:pok:" + card.id, message: { message_id: 9, chat: { id: 8213865630, type: "private" } } } } as any);
    card = (await getOne<GroupCard>("groups", card.id))!;
    expect(card.status).toBe("free");
    expect(planTasks([campaign()], [card], [], "2026-11-22")[0]?.mode).toBe("partner");
  });
});
