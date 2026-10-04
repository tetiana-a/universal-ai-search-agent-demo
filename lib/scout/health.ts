import { configuredAiProviders } from "@/lib/free-ai";
import { keylessProviders } from "@/lib/keyless-search";
import { adminKeyConfigured, publicDashboardEnabled } from "@/lib/scout/auth";
import { deleteValue, getValue, setValue, storeIsPersistent } from "@/lib/scout/store";
import { botToken, openGroupAccessEnabled, reportChatId, tgCall, webhookSecret } from "@/lib/scout/telegram";

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
    openGroupAccess: boolean;
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

type TelegramHealth = OperationalHealth["telegram"];
type PersistenceHealth = OperationalHealth["persistence"];

function check(id: string, label: string, level: HealthLevel, detail: string): HealthCheck {
  return { id, label, level, detail };
}

async function probePersistence(checkedAt: string): Promise<{ health: PersistenceHealth; check: HealthCheck }> {
  if (!storeIsPersistent()) {
    return {
      health: { configured: false, roundTrip: false },
      check: check("persistence", "Persistent storage", "warning", "Redis is not configured; serverless restarts can lose state."),
    };
  }

  const probeKey = "ops-health-probe";
  const probe = { at: checkedAt, marker: checkedAt.slice(-12) };
  let roundTrip = false;

  try {
    await setValue(probeKey, probe, 60);
    const saved = await getValue<typeof probe>(probeKey);
    roundTrip = saved?.at === probe.at && saved?.marker === probe.marker;
    await deleteValue(probeKey);
  } catch {
    roundTrip = false;
  }

  const storageCheck = roundTrip
    ? check("persistence", "Persistent storage", "ok", "Redis read/write works.")
    : check("persistence", "Persistent storage", "error", "Redis is configured but the read/write probe failed.");

  return { health: { configured: true, roundTrip }, check: storageCheck };
}

function telegramApiCheck(configured: boolean, apiOk: boolean, me: any): HealthCheck {
  if (!configured) return check("telegram-api", "Telegram API", "error", "TELEGRAM_BOT_TOKEN is not configured.");
  if (!apiOk) return check("telegram-api", "Telegram API", "error", String(me?.description || "Telegram API check failed."));
  const username = String(me?.result?.username || "bot");
  return check("telegram-api", "Telegram API", "ok", "Connected as @" + username + ".");
}

function telegramWebhookCheck(webhookUrl: string, webhookError: string, pendingUpdates: number): HealthCheck {
  if (webhookError) return check("telegram-webhook", "Telegram webhook", "error", webhookError.slice(0, 240));
  if (!webhookUrl) return check("telegram-webhook", "Telegram webhook", "warning", "Webhook is not configured.");
  return check("telegram-webhook", "Telegram webhook", "ok", "Webhook is connected; pending updates: " + pendingUpdates + ".");
}

async function probeTelegram(): Promise<{ health: TelegramHealth; checks: HealthCheck[] }> {
  const configured = Boolean(botToken());
  let me: any = null;
  let hook: any = null;

  if (configured) {
    [me, hook] = await Promise.all([tgCall("getMe", {}), tgCall("getWebhookInfo", {})]);
  }

  const apiOk = Boolean(me?.ok);
  const webhookUrl = String(hook?.result?.url || "");
  const webhookError = String(hook?.result?.last_error_message || "");
  const pendingUpdates = Number(hook?.result?.pending_update_count || 0);
  const reportId = await reportChatId();
  const usernameValue = String(me?.result?.username || "");

  const health: TelegramHealth = {
    configured,
    apiOk,
    webhookConfigured: Boolean(webhookUrl),
    pendingUpdates,
    openGroupAccess: openGroupAccessEnabled(),
  };
  if (usernameValue) health.username = usernameValue;
  if (webhookUrl) health.webhookUrl = webhookUrl;
  if (webhookError) health.webhookError = webhookError;
  if (reportId) health.reportChatId = reportId;

  return {
    health,
    checks: [
      telegramApiCheck(configured, apiOk, me),
      telegramWebhookCheck(webhookUrl, webhookError, pendingUpdates),
    ],
  };
}

function searchHealth(): { providers: string[]; directRead: boolean; check: HealthCheck } {
  const providers = keylessProviders();
  const directRead = process.env.DIRECT_READ !== "off";
  if (!providers.length) {
    return {
      providers,
      directRead,
      check: check("search", "Search providers", "error", "No keyless search provider is enabled."),
    };
  }
  const detail = providers.join(", ") + (directRead ? " + direct read" : "");
  return { providers, directRead, check: check("search", "Search providers", "ok", detail) };
}

function aiHealth() {
  const providers = configuredAiProviders("pro").map((p) => ({ provider: p.id, model: p.model }));
  const zeroCost = process.env.ZERO_COST_MODE === "on";
  const aiCheck = providers.length
    ? check("ai", "AI route", "ok", providers.map((p) => p.provider + ":" + p.model).join(", "))
    : check("ai", "AI route", "warning", "No cloud AI provider is configured; deterministic extraction remains available.");
  return { providers, zeroCost, check: aiCheck };
}

function dashboardAccessCheck(publicDashboard: boolean, adminProtected: boolean): HealthCheck {
  if (publicDashboard) return check("admin", "Dashboard access", "ok", "Public shared dashboard mode is enabled.");
  if (adminProtected) return check("admin", "Admin protection", "ok", "SCOUT_ADMIN_KEY protects Scout API/dashboard state.");
  return check("admin", "Admin protection", "warning", "SCOUT_ADMIN_KEY is not set. Do not store real personal data in open demo mode.");
}

function securityHealth() {
  const publicDashboard = publicDashboardEnabled();
  const adminProtected = adminKeyConfigured();
  const explicitWebhookSecret = Boolean(String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim());
  const adminCheck = dashboardAccessCheck(publicDashboard, adminProtected);

  let webhookCheck: HealthCheck;
  if (!webhookSecret()) {
    webhookCheck = check("webhook-secret", "Webhook authentication", "error", "Webhook secret cannot be derived because the bot token is missing.");
  } else if (explicitWebhookSecret) {
    webhookCheck = check("webhook-secret", "Webhook authentication", "ok", "Explicit Telegram webhook secret is configured.");
  } else {
    webhookCheck = check("webhook-secret", "Webhook authentication", "warning", "Webhook secret is derived from the bot token.");
  }

  return {
    adminProtected,
    explicitWebhookSecret,
    checks: [adminCheck, webhookCheck],
  };
}

export async function collectOperationalHealth(): Promise<OperationalHealth> {
  const checkedAt = new Date().toISOString();
  const [persistence, telegram] = await Promise.all([
    probePersistence(checkedAt),
    probeTelegram(),
  ]);
  const search = searchHealth();
  const ai = aiHealth();
  const security = securityHealth();

  const checks = [
    persistence.check,
    ...telegram.checks,
    search.check,
    ai.check,
    ...security.checks,
  ];

  return {
    ok: checks.every((item) => item.level !== "error"),
    checkedAt,
    checks,
    telegram: telegram.health,
    persistence: persistence.health,
    ai: { zeroCost: ai.zeroCost, providers: ai.providers, deterministicFallback: true },
    search: { providers: search.providers, directRead: search.directRead },
    security: {
      adminProtected: security.adminProtected,
      webhookSecretConfigured: security.explicitWebhookSecret,
    },
  };
}
