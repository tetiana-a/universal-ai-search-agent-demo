import { beforeEach, describe, expect, it, vi } from "vitest";
import { isOwnersGroupAdmin } from "@/lib/scout/telegram";
import { json, mockFetch } from "./helpers";

const admins = (creator: number) => json({ ok: true, result: [
  { status: "creator", user: { id: creator } },
  { status: "administrator", user: { id: 555 } },
  { status: "administrator", user: { id: 999, is_bot: true } },
] });

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:test-admins");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "8213865630");
});

describe("admins of the owner's group get control", () => {
  it("lets an admin of a group the owner created in, and caches the list", async () => {
    const calls = mockFetch([{ match: (u) => u.includes("getChatAdministrators"), respond: () => admins(8213865630) }]);
    expect(await isOwnersGroupAdmin("-1001111", "555", "supergroup")).toBe(true);
    expect(await isOwnersGroupAdmin("-1001111", "777", "supergroup")).toBe(false);
    expect(calls).toHaveLength(1);
  });
  it("refuses admins of someone else's group, bots and private chats", async () => {
    mockFetch([{ match: (u) => u.includes("getChatAdministrators"), respond: () => admins(42) }]);
    expect(await isOwnersGroupAdmin("-1002222", "555", "supergroup")).toBe(false);
    expect(await isOwnersGroupAdmin("-1003333", "999", "supergroup")).toBe(false);
    expect(await isOwnersGroupAdmin("555", "555", "private")).toBe(false);
  });
});
