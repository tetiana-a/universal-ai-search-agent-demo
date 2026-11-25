import { describe, expect, it } from "vitest";
import { jobPlatform, validateInstagramRequest } from "@/lib/scout/instagram-posts";

const at = new Date(Date.now() + 3_600_000).toISOString();
const base = { requestId: "tgfb-1-abcdef12", ownerId: "1", caption: "Текст поста", scheduledAt: at };

describe("Facebook via Postiz", () => {
  it("allows a text-only Facebook post but still requires media for Instagram", () => {
    expect(validateInstagramRequest({ ...base, platform: "facebook" })).toBeNull();
    expect(validateInstagramRequest({ ...base })).toBe("ONE_MEDIA_REQUIRED");
    expect(validateInstagramRequest({ ...base, platform: "facebook", mediaUrl: "https://example.com/a.jpg", telegramFileId: "AgACAgIAAxkBAAI" })).toBe("ONE_MEDIA_REQUIRED");
  });
  it("labels jobs by id prefix", () => {
    expect(jobPlatform({ id: "fb-x" })).toBe("Facebook");
    expect(jobPlatform({ id: "tt-x" })).toBe("TikTok");
    expect(jobPlatform({ id: "ig-x" })).toBe("Instagram");
  });
});
