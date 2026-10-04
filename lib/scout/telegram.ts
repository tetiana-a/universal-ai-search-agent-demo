import { createHash } from "node:crypto";
import { getValue, logAction, setValue } from "@/lib/scout/store";

// Minimal Telegram Bot API client for the Scout bot. Separate from the research
// sender on purpose: it adds inline keyboards, callback answers and message edits.

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type Keyboard = InlineButton[][];

export function botToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

export function splitIds(value: string | number | undefined | null) {
  return String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Who may control the agent: the configured group(s) and personal ids.
export function controlIds() {
  return new Set([...splitIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS), ...splitIds(process.env.TELEGRAM_CHAT_ID), ...splitIds(process.env.SCOUT_ADMIN_TELEGRAM_IDS)]);
}

// Webhook secret: TELEGRAM_WEBHOOK_SECRET, or derived from the bot token so no extra setup is needed.
export function webhookSecret() {
  const explicit = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (explicit) return explicit;
  const token = botToken();
  return token ? createHash("sha256").update("aurelius-scout:" + token).digest("hex").slice(0, 48) : "";
}

const MIGRATION_KEY = "tg-migrated:";

// A basic group upgraded to a supergroup gets a new "-100…" id; remember it so every later send uses it.
export async function resolveChatId(chatId: string) {
  return (await getValue<string>(MIGRATION_KEY + chatId)) || chatId;
}

export async function reportChatId() {
  const configured = String(process.env.SCOUT_REPORT_CHAT_ID || splitIds(process.env.TELEGRAM_CHAT_ID)[0] || "").trim();
  return configured ? resolveChatId(configured) : "";
}

export async function tgCall(method: string, body: Record<string, unknown>) {
  const token = botToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN is not set" } as any;
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    return (await response.json().catch(() => ({ ok: false, description: "HTTP " + response.status }))) as any;
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.message : "network error" } as any;
  }
}

export const TG_LIMIT = 3900;

export async function sendMessage(chatId: string, html: string, keyboard?: Keyboard): Promise<{ ok: boolean; chatId: string; messageId?: number; error?: string }> {
  let target = await resolveChatId(chatId);
  const payload = (id: string) => ({ chat_id: id, text: html.slice(0, 4096), parse_mode: "HTML", disable_web_page_preview: true, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
  let data = await tgCall("sendMessage", payload(target));
  const migrated = data?.parameters?.migrate_to_chat_id;
  if (!data?.ok && migrated) {
    await setValue(MIGRATION_KEY + chatId, String(migrated));
    await logAction({ actor: "bot", action: "telegram.migrated", detail: chatId + " → " + migrated + " (обновите TELEGRAM_CHAT_ID в Vercel)" });
    target = String(migrated);
    data = await tgCall("sendMessage", payload(target));
  }
  if (!data?.ok && /can't parse entities/i.test(String(data?.description))) {
    // Never lose a report over formatting: resend as plain text.
    data = await tgCall("sendMessage", { chat_id: target, text: html.replace(/<[^>]+>/g, "").slice(0, 4096), disable_web_page_preview: true, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
  }
  return { ok: Boolean(data?.ok), chatId: target, messageId: data?.result?.message_id, error: data?.ok ? undefined : String(data?.description || "send failed") };
}

// Splits long HTML on line boundaries; the keyboard goes on the last part.
export async function sendLong(chatId: string, html: string, keyboard?: Keyboard) {
  const parts: string[] = [];
  let current = "";
  for (const line of html.split("\n")) {
    if ((current + "\n" + line).length > TG_LIMIT && current) { parts.push(current); current = line; } else current = current ? current + "\n" + line : line;
  }
  if (current) parts.push(current);
  let last: Awaited<ReturnType<typeof sendMessage>> = { ok: false, chatId };
  for (const [i, part] of parts.entries()) {
    last = await sendMessage(chatId, part, i === parts.length - 1 ? keyboard : undefined);
    if (!last.ok) return last;
  }
  return last;
}

// Sends a file (CSV / Excel export) as a Telegram document.
export async function sendDocument(chatId: string, filename: string, data: Buffer | Uint8Array, caption?: string, keyboard?: Keyboard) {
  const token = botToken();
  if (!token) return false;
  const form = new FormData();
  form.append("chat_id", await resolveChatId(chatId));
  form.append("document", new Blob([new Uint8Array(data)]), filename);
  if (caption) form.append("caption", caption.slice(0, 1000));
  if (keyboard) form.append("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/sendDocument", { method: "POST", body: form, signal: AbortSignal.timeout(30000), cache: "no-store" });
    const result = (await response.json().catch(() => null)) as any;
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

export async function sendDirect(userId: string, text: string) {
  const result = await tgCall("sendMessage", { chat_id: userId, text: text.slice(0, 4096) });
  return Boolean(result?.ok);
}

export async function answerCallback(id: string, text: string) {
  await tgCall("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 190) });
}

export async function editMessage(chatId: string | number, messageId: number, html: string, keyboard?: Keyboard) {
  await tgCall("editMessageText", { chat_id: chatId, message_id: messageId, text: html.slice(0, 4096), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard || [] } });
}

export const BOT_COMMANDS = [
  { command: "panel", description: "Открыть меню" },
  { command: "find", description: "Найти что угодно" },
  { command: "status", description: "Что сейчас происходит" },
  { command: "tasks", description: "Мои последние поиски" },
  { command: "results", description: "Последние результаты" },
  { command: "help", description: "Как пользоваться" },
];
