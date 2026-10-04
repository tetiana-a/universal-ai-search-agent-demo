import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/scout/health/route";
import { collectOperationalHealth } from "@/lib/scout/health";
import { resetMemoryStore } from "@/lib/scout/store";
import { json, mockFetch } from "./helpers";

beforeEach(() => {
  resetMemoryStore();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("SCOUT_REPORT_CHAT_ID", "-100123");
  vi.stubEnv("SCOUT_PUBLIC_DASHBOARD", "off");
  vi.stubEnv("TELEGRAM_OPEN_GROUP_ACCESS", "off");
  vi.stubEnv("SCOUT_ADMIN_KEY", "admin-test-key");
  vi.stubEnv("ZERO_COST_MODE", "on");
  vi.stubEnv("KEYLESS_SEARCH", "always");
  vi.stubEnv("DIRECT_READ", "on");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GOOGLE_AI_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function telegramHealth(ok = true) {
  return mockFetch([
    {
      match: (url) => url.endsWith("/getMe"),
      respond: () => ok ? json({ ok: true, result: { id: 1, username: "AURELIUS8_bot" } }) : json({ ok: false, description: "Unauthorized" }, 401),
    },
    {
      match: (url) => url.endsWith("/getWebhookInfo"),
      respond: () => json({ ok: true, result: { url: "https://example.com/api/scout/telegram", pending_update_count: 0 } }),
    },
  ]);
}

describe("Scout production health", () => {
  it("reports safe operational status without exposing credentials", async () => {
    telegramHealth(true);
    const health = await collectOperationalHealth();
    expect(health.ok).toBe(true);
    expect(health.telegram).toMatchObject({ configured: true, apiOk: true, username: "AURELIUS8_bot", webhookConfigured: true });
    expect(health.search.providers).toContain("duckduckgo");
    expect(health.ai.zeroCost).toBe(true);
    expect(health.security.adminProtected).toBe(true);
    expect(JSON.stringify(health)).not.toContain("test-bot-token");
    expect(JSON.stringify(health)).not.toContain("test-webhook-secret");
    expect(JSON.stringify(health)).not.toContain("admin-test-key");
  });

  it("turns a Telegram authentication failure into a failing health state", async () => {
    telegramHealth(false);
    const health = await collectOperationalHealth();
    expect(health.ok).toBe(false);
    expect(health.checks.find((item) => item.id === "telegram-api")?.level).toBe("error");
  });

  it("protects the health endpoint with SCOUT_ADMIN_KEY", async () => {
    telegramHealth(true);
    const denied = await GET(new Request("https://x/api/scout/health"));
    expect(denied.status).toBe(401);

    const allowed = await GET(new Request("https://x/api/scout/health", { headers: { "x-scout-key": "admin-test-key" } }));
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).ok).toBe(true);
  });

  it("allows the shared dashboard without a key when public mode is explicitly enabled", async () => {
    telegramHealth(true);
    vi.stubEnv("SCOUT_PUBLIC_DASHBOARD", "on");
    vi.stubEnv("TELEGRAM_OPEN_GROUP_ACCESS", "on");

    const response = await GET(new Request("https://x/api/scout/health"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.telegram.openGroupAccess).toBe(true);
    expect(data.security.adminProtected).toBe(false);
    expect(data.checks.find((item: any) => item.id === "admin")?.detail).toContain("Public shared dashboard");
  });
});

describe("free AI chain", () => {
  it("keeps Gemini and Groq after OpenRouter in strict zero-cost mode", async () => {
    const { configuredAiProviders } = await import("@/lib/free-ai");
    vi.stubEnv("OPENROUTER_API_KEY", "or_key");
    vi.stubEnv("GEMINI_API_KEY", "gm_key");
    vi.stubEnv("GROQ_API_KEY", "gq_key");
    vi.stubEnv("PRO_GEMINI_MODEL", "gemini-2.5-pro");
    const providers = configuredAiProviders("pro").map((p) => p.id + ":" + p.model);
    expect(providers[0]).toMatch(/^openrouter:/);
    expect(providers.slice(1)).toEqual(["gemini:gemini-2.5-flash", "groq:llama-3.3-70b-versatile"]);
  });
});
