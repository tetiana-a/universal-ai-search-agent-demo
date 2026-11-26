import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminLetter, contactUrl, joinUrl, updateGroup, upsertGroups, type GroupCard } from "@/lib/scout/groups";
import { resetMemoryStore } from "@/lib/scout/store";

beforeEach(() => {
  resetMemoryStore();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});

const card = (p: Partial<GroupCard>): GroupCard => ({ id: "grp_x1", platform: "telegram", url: "https://t.me/valencia_chat", name: "Valencia Expats", ads: "unknown", status: "new", foundAt: "2026-11-26", updatedAt: "2026-11-26", ...p });

describe("personal admin requests", () => {
  it("writes in the community's language, with its name and a join line only for groups", () => {
    const es = adminLetter(card({ language: "es", topic: "вино", city: "Валенсия" }), "free", { senderName: "Ana", companyName: "AURELIUS" });
    expect(es.lang).toBe("es");
    expect(es.text).toContain("¡Hola!");
    expect(es.text).toContain("«Valencia Expats»");
    expect(es.text).not.toContain("вино"); // Russian topic is not pasted into a Spanish letter
    expect(es.text).toContain("solicitud para unirnos");
    expect(es.text).toMatch(/startgroup=true/);
    const ru = adminLetter(card({ language: "ru", topic: "вино", city: "Валенсия", kind: "channel" }), "paid");
    expect(ru.text).toContain("(вино, Валенсия)");
    expect(ru.text).toContain("платное размещение");
    expect(ru.text).not.toContain("вступление");
    expect(ru.joinUrl).toBeUndefined();
  });

  it("asks profiles for a collaboration and gives a personal partner link", () => {
    const ig = adminLetter(card({ platform: "instagram", url: "https://www.instagram.com/vino.valencia", kind: "profile", language: "xx" }));
    expect(ig.lang).toBe("en");
    expect(ig.text).toContain("your profile");
    expect(ig.addBotUrl).toMatch(/\?start=partner_grp_x1$/);
    expect(ig.contactUrl).toBe("https://ig.me/m/vino.valencia");
  });

  it("opens the right place to write to the admin", () => {
    expect(contactUrl(card({ adminContact: "@boss" }))).toBe("https://t.me/boss");
    expect(contactUrl(card({ adminContact: "a@b.com" }), "hi")).toBe("mailto:a@b.com?subject=Valencia%20Expats&body=hi");
    expect(contactUrl(card({ platform: "facebook", url: "https://www.facebook.com/groups/vlc" }))).toBe("https://www.facebook.com/groups/vlc/members/admins");
    expect(contactUrl(card({ platform: "tiktok", url: "https://www.tiktok.com/@vlc" }))).toBe("https://www.tiktok.com/@vlc");
    expect(joinUrl(card({ platform: "facebook", url: "https://www.facebook.com/groups/vlc" }))).toBe("https://www.facebook.com/groups/vlc");
  });

  it("records when the request was sent and answered, and keeps it on re-search", async () => {
    await upsertGroups([card({})]);
    const sent = await updateGroup("grp_x1", { status: "contacted" });
    expect(sent?.requestSentAt).toBeTruthy();
    const ok = await updateGroup("grp_x1", { status: "free" }, "owner");
    expect(ok?.repliedAt).toBeTruthy();
    expect(ok?.permissionConfirmedAt).toBeTruthy();
    await upsertGroups([card({ name: "Valencia Expats 2" })]);
    const { listGroups } = await import("@/lib/scout/groups");
    const again = (await listGroups()).find((g) => g.id === "grp_x1");
    expect(again?.requestSentAt).toBe(sent?.requestSentAt);
    expect(again?.status).toBe("free");
  });
});
