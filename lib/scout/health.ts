import { configuredAiProviders } from "@/lib/free-ai";
import { keylessProviders } from "@/lib/keyless-search";
import { adminKeyConfigured } from "@/lib/scout/auth";
import { deleteValue, getValue, setValue, storeIsPersistent } from "@/lib/scout/store";
import { botToken, reportChatId, tgCall, webhookSecret } from "@/lib/scout/telegram";

export type HealthLevel = "ok" | "warning" | "error";

export type HealthCheck = {
  id: string;
  label: string;
  level: HealthLevel;
  detail: string;
};

export type OperationalHealth = {
  ok: boolean;
  checkedAt: string;
  checks: HealthCheck[];
  telegram: {
    configured: boolean;
    apiOk: boolean;
    username?: string;
    webhookConfigured: boolean;
    webhookUrl?: string;
    webhookError?: string;
    pendingUpdates?: number;
    reportChatId?: string;
  };
  persistence: {
    configured: boolean;
    roundTrip: boolean;
  };
  ai: {
    zeroCost: boolean;
    providers: Array<{ provider: string; model: string }>;
    deterministicFallback: boolean;
  };
  search: {
    providers: string[];
    directRead: boolean;
  };
  security: {
    adminProtected: boolean;
    webhookSecretConfigured: boolean;
  };
};

function check(id: string, label: string, level: HealthLevel, detail: string): HealthCheck {
  return { id, label, level, detail };
}

export async function collectOperationalHealth(): Promise<OperationalHealth> {
  const checkedAt = new Date().toISOString();
  const tokenConfigured = Boolean(botToken());
  const persistent = storeIsPersistent();
  const zeroCost = process.env.ZERO_COST_MODE === "on";
  const aiProviders = configuredAiProviders("pro").map((p) => ({ provider: p.id, model: p.model }));
  const searchProviders = keylessProviders();
  const directRead = process.env.DIRECT_READ !== "off";
  const adminProtected = adminKeyConfigured();
  const explicitWebhookSecret = Boolean(String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim());
  const checks: HealthCheck[] = [];

  let redisRoundTrip = false;
  if (persistent) {
    const probeKey = "ops-health-probe";
    const probe = { at: checkedAt, marker: checkedAt.slice(-12) };
    try {
      await setValue(probeKey, probe, 60);
      const saved = await getValue<typeof probe>(probeKey);
      redisRoundTrip = Boolean(saved && saved.at === probe.at && saved.marker === probe.marker);
      await deleteValue(probeKey);
    } catch {
      redisRoundTrip = false;
    }
  }
  checks.push(
    persistent
      ? check("persistence", "Persistent storage", redisRoundTrip ? "ok" : "error", redisRoundTrip ? "Redis read/write works." : "Redis is configured but the read/write probe failed.")
      : check("persistence", "Persistent storage", "warning", "Redis is not configured; serverless restarts can lose state."),
  );

  let me: any = null;
  let hook: any = null;
  if (tokenConfigured) {
    [me, hook] = await Promise.all([tgCall("getMe", {}), tgCall("getWebhookInfo", {})]);
  }
  const apiOk = Boolean(me?.ok);
  const webhookUrl = String(hook?.result?.url || "");
  const webhookError = String(hook?.result?.last_error_message || "");
  const pendingUpdates = Number(hook?.result?.pending_update_count || 0);
  const reportId = await reportChatId();

  checks.push(
    tokenConfigured
      ? check("telegram-api", "Telegram API", apiOk ? "ok" : "error", apiOk ? "Connected as @" + String(me?.result?.username || "bot") + "." : String(me?.description || "Telegram API check failed."))
      : check("telegram-api", "Telegram API", "error", "TELEGRAM_BOT_TOKEN is not configured."),
  );
  checks.push(
    webhookUrl && !webhookError
      ? check("telegram-webhook", "Telegram webhook", "ok", "Webhook is connected; pending updates: " + pendingUpdates + ".")
      : webhookError
        ? check("telegram-webhook", "Telegram webhook", "error", webhookError.slice(0, 240))
        : check("telegram-webhook", "Telegram webhook", "warning", "Webhook is not configured."),
  );

  checks.push(
    searchProviders.length
      ? check("search", "Search providers", "ok", searchProviders.join(", ") + (directRead ? " + direct read" : ""))
      : check("search", "Search providers", "error", "No keyless search provider is enabled."),
  );

  checks.push(
    aiProviders.length
      ? check("ai", "AI route", "ok", aiProviders.map((p) => p.provider + ":" + p.model).join(", "))
      : check("ai", "AI route", "warning", "No cloud AI provider is configured; deterministic extraction remains available."),
  );

  checks.push(
    adminProtected
      ? check("admin", "Admin protection", "ok", "SCOUT_ADMIN_KEY protects Scout API/dashboard state.")
      : check("admin", "Admin protection", "warning", "SCOUT_ADMIN_KEY is not set. Do not store real personal data in open demo mode."),
  );

  checks.push(
    webhookSecret()
      ? check("webhook-secret", "Webhook authentication", explicitWebhookSecret ? "ok" : "warning", explicitWebhookSecret ? "Explicit Telegram webhook secret is configured." : "Webhook secret is derived from the bot token.")
      : check("webhook-secret", "Webhook authentication", "error", "Webhook secret cannot be derived because the bot token is missing."),
  );

  return {
    ok: checks.every((item) => item.level !== "error"),
    checkedAt,
    checks,
    telegram: {
      configured: tokenConfigured,
      apiOk,
      username: apiOk ? String(me?.result?.username || "") || undefined : undefined,
      webhookConfigured: Boolean(webhookUrl),
      webhookUrl: webhookUrl || undefined,
      webhookError: webhookError || undefined,
      pendingUpdates,
      reportChatId: reportId || undefined,
    },
    persistence: { configured: persistent, roundTrip: redisRoundTrip },
    ai: { zeroCost, providers: aiProviders, deterministicFallback: true },
    search: { providers: searchProviders, directRead },
    security: { adminProtected, webhookSecretConfigured: explicitWebhookSecret },
  };
}
