import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleUpdate } from "@/lib/scout/bot";
import { listGroups, registerOwnedTelegramGroup } from "@/lib/scout/groups";
import { listPosts, postingTargets } from "@/lib/scout/groups";
import { resetMemoryStore } from "@/lib/scout/store";
import { json, mockFetch } from "./helpers";

const owner = 8213865630;
const chat = { id: -1004318201860, title: "AURELIUS TEST", type: "supergroup" };
const update = (from: number) => ({ update_id: 1861, message: { text: "/connect", chat, from: { id: from, first_name: "Owner" } } });

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", String(owner));
  vi.stubEnv("TELEGRAM_CHAT_ID", String(owner));
});

function mockTelegram(botStatus: string, humanStatus: string) {
  const messages: any[] = [];
  mockFetch([{
    match: (url) => url.startsWith("https://api.telegram.org/bottest-bot-token/"),
    respond: (url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (url.endsWith("/getMe")) return json({ ok: true, result: { id: 222333, is_bot: true, username: "AURELIUS8_bot" } });
      if (url.endsWith("/getChatMember")) return json({ ok: true, result: { status: body.user_id === 222333 ? botStatus : humanStatus } });
      if (url.endsWith("/sendMessage")) { messages.push(body); return json({ ok: true, result: { message_id: messages.length } }); }
      throw new Error("Unexpected Telegram call " + url);
    },
  }]);
  return messages;
}

describe("explicit Telegram test group registration", () => {
  it("registers an existing supergroup from /connect only after checking both admins", async () => {
    const sent = mockTelegram("administrator", "creator");
    await handleUpdate(update(owner));
    const groups = await listGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: "AURELIUS TEST", chatId: String(chat.id), botConnected: true, postingEnabled: true });
    expect(await postingTargets()).toHaveLength(1);
    expect(await listPosts()).toHaveLength(0);
    expect(sent[0].text).toContain("Группа зарегистрирована");
  });

  it("does not register when the bot is not an administrator", async () => {
    mockTelegram("member", "creator");
    const outcome = await registerOwnedTelegramGroup(chat, String(owner));
    expect(outcome.ok).toBe(false);
    expect(await listGroups()).toHaveLength(0);
  });

  it("does not register when the caller lacks Telegram admin rights", async () => {
    mockTelegram("administrator", "member");
    const outcome = await registerOwnedTelegramGroup(chat, String(owner));
    expect(outcome.ok).toBe(false);
    expect(await listGroups()).toHaveLength(0);
  });

  it("rejects an unconfigured outsider before consulting admin roles", async () => {
    const messages = mockTelegram("administrator", "administrator");
    await handleUpdate(update(123456789));
    expect(await listGroups()).toHaveLength(0);
    expect(messages[0].text).toContain("Только владелец");
  });
});
