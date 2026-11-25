import { beforeEach, expect, it, vi } from "vitest";
import { postViaBot, sendPhoto, type GroupCard } from "@/lib/scout/groups";
import { dispatchBotTasks, today, type Campaign, type CampaignTask } from "@/lib/scout/campaigns";
import { increment, putOne, resetMemoryStore } from "@/lib/scout/store";
import { json, mockFetch } from "./helpers";

const at = "2026-11-24T09:00:00Z";
const group: GroupCard = { id: "audit-group", name: "Audit group", platform: "telegram", url: "https://t.me/audit_group", chatId: "-1001234567890", botConnected: true, postingEnabled: true, status: "free", ads: "allowed", dailyLimit: 1, foundAt: at, updatedAt: at };
beforeEach(() => {
  resetMemoryStore(); vi.unstubAllGlobals();
  vi.stubEnv("KV_REST_API_URL", ""); vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-only"); vi.stubEnv("CAMPAIGN_AUTOPOST", "on");
});
function capture() {
  const sent: unknown[] = [];
  mockFetch([{ match: u => /\/send(Message|Photo)$/.test(u), respond: (_u, init) => { sent.push(JSON.parse(String(init?.body))); return json({ ok: true, result: { message_id: sent.length } }); } }]);
  return sent;
}
async function seedCampaign() {
  const c: Campaign = { id: "audit-c", title: "Audit", topic: "flowers", region: "Prague", adText: "Audit text", languages: ["en"], platforms: ["telegram"], keywords: [], adjacent: [], queries: [], exclusions: [], questions: [], translations: {}, status: "approved", dailyTarget: 1, source: "text", searchGroupIds: [group.id], found: { total: 1, core: 1, adjacent: 0, inactive: 0, at }, createdAt: at, updatedAt: at };
  const t: CampaignTask = { id: "audit-task", campaignId: c.id, campaignTitle: c.title, groupId: group.id, groupName: group.name, platform: "telegram", url: group.url, mode: "bot", status: "scheduled", day: today(), createdAt: at, updatedAt: at };
  await putOne("campaigns", c); await putOne("campaign_tasks", t);
}
it.each([{ status: "declined" }, { ads: "forbidden" }, { activity: "inactive" }])("dashboard excludes revoked or ineligible group %j", async patch => {
  const sent = capture(); await putOne("groups", { ...group, ...patch } as GroupCard);
  await postViaBot("Audit", undefined, "test", Date.now() + 10000, 0);
  expect(sent).toHaveLength(0);
});
it("concurrent dashboard sends cannot exceed the daily cap", async () => {
  const sent = capture(); await putOne("groups", group);
  await Promise.all([postViaBot("First", undefined, "test", Date.now() + 10000, 0), postViaBot("Second", undefined, "test", Date.now() + 10000, 0)]);
  expect(sent).toHaveLength(1);
});
it("dispatch rechecks revoked permission after planning", async () => {
  const sent = capture(); await putOne("groups", { ...group, status: "declined" }); await seedCampaign();
  await dispatchBotTasks(today(), Date.now() + 10000, 0); expect(sent).toHaveLength(0);
});
it("dispatch respects posts already sent from dashboard", async () => {
  const sent = capture(); await putOne("groups", group); await seedCampaign();
  await increment("grp-post:" + group.id + ":" + today(), 172800);
  await dispatchBotTasks(today(), Date.now() + 10000, 0); expect(sent).toHaveLength(0);
});
it("rejects an overlong photo caption instead of silently truncating it", async () => {
  const sent = capture(); const result = await sendPhoto(group.chatId!, "https://example.com/photo.jpg", "a".repeat(1025));
  expect(result.ok).toBe(false); expect(sent).toHaveLength(0);
});
