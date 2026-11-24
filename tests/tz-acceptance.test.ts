import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "./helpers";
import { localClock, matchesPost, parsePrice, parseSchedule, parseWatch, planTasks, recallCheck, scheduleAllows, type Campaign } from "@/lib/scout/campaigns";
import { activityFromPosts, detectAdsPolicy, groupsCsv, parseTelegramPosts, setActivityThreshold, activityThreshold, type GroupCard } from "@/lib/scout/groups";
import { getOne, putOne, resetMemoryStore } from "@/lib/scout/store";

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});

const now = new Date().toISOString();
const group = (id: string, over: Partial<GroupCard> = {}): GroupCard => ({ id, platform: "telegram", url: "https://t.me/" + id, name: id, ads: "allowed", status: "free", permissionConfirmedAt: now, foundAt: now, updatedAt: now, ...over });
const campaign = (over: Partial<Campaign> = {}): Campaign => ({ id: "c1", title: "Квартира", adText: "Продаю квартиру", topic: "недвижимость", region: "Валенсия, Испания", languages: ["ru"], keywords: ["квартира"], adjacent: [], queries: [], exclusions: [], questions: [], translations: {}, platforms: ["telegram"], dailyTarget: 300, status: "approved", source: "text", createdAt: now, updatedAt: now, ...over });

describe("schedule", () => {
  it("parses hours, weekdays and end date", () => {
    expect(parseSchedule("9,13,18 будни до 31.12", "Europe/Madrid", 2026)).toEqual({ hours: [9, 13, 18], days: [1, 2, 3, 4, 5], until: "2026-12-31", tz: "Europe/Madrid" });
    expect(parseSchedule("10 20 пн,ср,пт")?.days).toEqual([1, 3, 5]);
    expect(parseSchedule("off")).toBeNull();
  });
  it("skips days outside the schedule and spreads tasks over hours", () => {
    const groups = Array.from({ length: 6 }, (_, i) => group("g" + i));
    const s = { hours: [9, 18], days: [1, 2, 3, 4, 5], until: "2026-12-31", tz: "Europe/Madrid" };
    const c = campaign({ schedule: s, found: { total: 6, core: 6, adjacent: 0, inactive: 0, at: now }, searchGroupIds: groups.map((g) => g.id) });
    expect(scheduleAllows(s, "2026-11-28")).toBe(false); // Saturday
    expect(planTasks([c], groups, [], "2026-11-28")).toHaveLength(0);
    expect(planTasks([c], groups, [], "2027-01-04")).toHaveLength(0); // after end date
    const tasks = planTasks([c], groups, [], "2026-11-24");
    expect(tasks.map((t) => t.slot)).toEqual([9, 18, 9, 18, 9, 18]);
  });
  it("reads the local clock of a time zone", () => {
    expect(localClock("Europe/Madrid", new Date("2026-11-24T08:30:00Z"))).toEqual({ day: "2026-11-24", hour: 9, weekday: 2 });
  });
});

describe("ad rules and liveness", () => {
  it("separates 'through the admin' from paid", () => {
    expect(detectAdsPolicy("По вопросам рекламы @admin")).toBe("admin");
    expect(detectAdsPolicy("Прайс на рекламу в закрепе")).toBe("paid");
    expect(detectAdsPolicy("Реклама запрещена")).toBe("forbidden");
  });
  it("marks rare posting as inactive and the threshold is configurable", async () => {
    const day = 86_400_000;
    const t = Date.parse("2026-11-24T00:00:00Z");
    const rare = [{ url: "a", text: "", at: new Date(t - 2 * day).toISOString() }, { url: "b", text: "", at: new Date(t - 60 * day).toISOString() }];
    expect(activityFromPosts(rare, t, { days: 30, minPerWeek: 0.5 }).activity).toBe("inactive");
    expect(activityFromPosts(rare, t, { days: 30, minPerWeek: 0 }).activity).toBe("active");
    await setActivityThreshold(14, 1);
    expect(await activityThreshold()).toEqual({ days: 14, minPerWeek: 1 });
  });
  it("labels unchecked communities in CSV", () => {
    const csv = groupsCsv([group("x", { activity: "unknown", ads: "admin" }), group("y", { activity: "inactive" })]);
    expect(csv).toContain("не проверено");
    expect(csv).toContain("через админа");
    expect(csv).toContain("неактивна");
  });
});

describe("monitoring", () => {
  it("parses prices and filters by type and range", () => {
    expect(parsePrice("Квартира 3 комнаты, 250 000 €")).toBe(250000);
    expect(parsePrice("Piso €185.000 en Ruzafa")).toBe(185000);
    expect(parsePrice("без цены")).toBeUndefined();
    const watch = parseWatch("квартира, дом 100000-300000")!;
    expect(watch).toEqual({ types: ["квартира", "дом"], minPrice: 100000, maxPrice: 300000 });
    const c = { topic: "недвижимость", keywords: ["квартира"], region: "", watch };
    expect(matchesPost("Продаю квартиру 250 000 €", c)).toBe(true);
    expect(matchesPost("Продаю квартиру 450 000 €", c)).toBe(false);
    expect(matchesPost("Продаю квартиру, цена договорная", c)).toBe(false);
  });
  it("reads Telegram reactions as engagement", () => {
    const html = '<div class="tgme_widget_message_wrap"><div data-post="chan/5"><div class="tgme_widget_message_text">квартира</div><div class="tgme_widget_message_reactions"><span class="tgme_reaction"><tg-emoji></tg-emoji>1.2K</span><span class="tgme_reaction"><i></i>30</span></div><span class="tgme_widget_message_views">5K</span><time datetime="2026-11-20T10:00:00+00:00"></time></div></div>';
    const [post] = parseTelegramPosts(html);
    expect(post.reactions).toBe(1230);
    expect(post.views).toBe(5000);
  });
});

describe("completeness check against a manual control list", () => {
  it("counts live found communities, ignores dead ones, adds misses and learns queries", async () => {
    await putOne("groups", group("found_one", { url: "https://t.me/found_one" }));
    await putOne("campaigns", campaign({ searchGroupIds: ["found_one"] }));
    const preview = (title: string) => '<div class="tgme_page_title"><span>' + title + '</span></div><div class="tgme_page_extra">1 200 members</div><div class="tgme_page_description">Объявления</div>';
    const fresh = '<div class="tgme_widget_message_wrap"><div data-post="x/1"><time datetime="' + now + '"></time></div></div>';
    mockFetch([
      { match: (u) => u === "https://t.me/s/found_one" || u === "https://t.me/s/missed_group", respond: () => new Response(fresh) },
      { match: (u) => u === "https://t.me/s/dead_group", respond: () => new Response("") },
      { match: (u) => u === "https://t.me/found_one", respond: () => new Response(preview("Found One")) },
      { match: (u) => u === "https://t.me/missed_group", respond: () => new Response(preview("Аренда Валенсия Русские")) },
      { match: (u) => u === "https://t.me/dead_group", respond: () => new Response("<html></html>") },
    ]);
    const r = await recallCheck("c1", ["https://t.me/found_one", "t.me/missed_group", "https://t.me/dead_group", "https://t.me/found_one"]);
    expect(r).toMatchObject({ control: 3, live: 2, found: 1, percent: 50 });
    expect(r!.dead).toEqual(["https://t.me/dead_group"]);
    expect(r!.missing).toEqual(["https://t.me/missed_group"]);
    expect(r!.learned).toContain("Аренда Валенсия Русские");
    const c = await getOne<Campaign>("campaigns", "c1");
    // The miss joins the placeable audience but not the recall base: a second check is still 1 of 2.
    expect(c!.searchGroupIds!.length).toBe(1);
    expect(c!.controlGroupIds!.length).toBe(1);
    expect(c!.queries).toContain("Аренда Валенсия Русские");
    const added = (await getOne<GroupCard>("groups", c!.controlGroupIds![0]))!;
    expect(added.status).toBe("new"); // a control-list find is not a permission to post
  });
});
