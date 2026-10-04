import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

async function loadEnvFile(path) {
  try {
    const raw = await readFile(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {}
}

await loadEnvFile(".env.local");
await loadEnvFile(".env");

const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is missing in .env.local");
  process.exit(1);
}

const localEndpoint = String(process.env.LOCAL_BOT_WEBHOOK_URL || "http://127.0.0.1:3000/api/scout/telegram").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim()
  || createHash("sha256").update("aurelius-scout:" + token).digest("hex").slice(0, 48);

async function telegram(method, body = {}) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(method + ": " + String(data?.description || "HTTP " + response.status));
  return data.result;
}

async function forward(update) {
  const response = await fetch(localEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Local AURELIUS endpoint HTTP " + response.status);
}

await telegram("deleteWebhook", { drop_pending_updates: false }).catch(() => {});
const me = await telegram("getMe");
console.log("AURELIUS Telegram polling started as @" + me.username);
console.log("Forwarding updates to " + localEndpoint);
console.log("Press Ctrl+C to stop.");

let offset = 0;
let backoff = 1000;

for (;;) {
  try {
    const updates = await telegram("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message", "edited_message", "callback_query"],
    });
    for (const update of updates || []) {
      offset = Math.max(offset, Number(update.update_id || 0) + 1);
      try {
        await forward(update);
      } catch (error) {
        console.error("Forward failed:", error instanceof Error ? error.message : error);
      }
    }
    backoff = 1000;
  } catch (error) {
    console.error("Telegram polling error:", error instanceof Error ? error.message : error);
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, 15_000);
  }
}
