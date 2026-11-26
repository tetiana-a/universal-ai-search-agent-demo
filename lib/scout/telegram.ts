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

// Who may control the agent directly: configured personal ids and chats.
export function controlIds() {
  return new Set([...splitIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS), ...splitIds(process.env.TELEGRAM_CHAT_ID), ...splitIds(process.env.SCOUT_ADMIN_TELEGRAM_IDS)]);
}

export function openGroupAccessEnabled() {
  return String(process.env.TELEGRAM_OPEN_GROUP_ACCESS || "").trim().toLowerCase() === "on";
}

export function openGroupIds() {
  return new Set(splitIds(process.env.TELEGRAM_OPEN_GROUP_IDS));
}

// In a group the owner created, every admin the owner appointed gets the owner's
// rights, so a new admin works at once without adding ids in Vercel.
// Admin lists are cached for 10 minutes to keep one Bot API call per group.
export async function isOwnersGroupAdmin(chatId: string, userId: string, chatType?: string) {
  if (!userId || !chatId || chatType === "private" || chatType === "channel" || !chatId.startsWith("-")) return false;
  const key = "tg-admins:" + chatId;
  let cached = await getValue<{ creator: string; admins: string[] }>(key);
  if (!cached) {
    const res = await tgCall("getChatAdministrators", { chat_id: chatId });
    if (!res?.ok || !Array.isArray(res.result)) return false;
    const humans = res.result.filter((m: any) => !m?.user?.is_bot);
    cached = {
      creator: String(humans.find((m: any) => m.status === "creator")?.user?.id || ""),
      admins: humans.map((m: any) => String(m?.user?.id || "")).filter(Boolean),
    };
    await setValue(key, cached, 600);
  }
  return Boolean(cached.creator) && controlIds().has(cached.creator) && cached.admins.includes(userId);
}

// When open group access is enabled, either explicitly listed groups or the report group
// are shared workspaces: every human member can use commands/buttons with the same rules.
export async function isOpenGroup(chatId: string, chatType?: string) {
  if (!openGroupAccessEnabled() || chatType === "private") return false;
  const resolved = await resolveChatId(chatId);
  const explicit = openGroupIds();
  if (explicit.size) return explicit.has(chatId) || explicit.has(resolved);
  const report = await reportChatId();
  return Boolean(report) && (report === chatId || report === resolved);
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

// Telegram Bot API call. Flood control (429) answers with retry_after: wait and retry, up to
// 2 times if the wait is short (≤ 30 s), so a big posting wave slows down instead of losing posts.
// Network errors and 5xx get one quick retry. Everything else returns Telegram's answer as is.
export async function tgCall(method: string, body: Record<string, unknown>, attempt = 0): Promise<any> {
  const token = botToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN is not set" } as any;
  let data: any;
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    data = await response.json().catch(() => ({ ok: false, error_code: response.status, description: "HTTP " + response.status }));
  } catch (error) {
    data = { ok: false, error_code: 0, description: error instanceof Error ? error.message : "network error" };
  }
  if (data?.ok || attempt >= 2) return data;
  const wait = Number(data?.parameters?.retry_after);
  const code = Number(data?.error_code);
  if (code === 429 && wait > 0 && wait <= 30) {
    await new Promise((r) => setTimeout(r, wait * 1000 + 250));
    return tgCall(method, body, attempt + 1);
  }
  if ((code === 0 || code >= 500) && attempt === 0) {
    await new Promise((r) => setTimeout(r, 1000));
    return tgCall(method, body, 1);
  }
  if (code === 429 || code >= 500 || code === 0) console.error("[telegram] " + method + " failed: " + (data?.description || code));
  return data;
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

export async function sendVoice(chatId: string, mp3: Buffer, caption?: string) {
  const token = botToken();
  if (!token) return false;
  const form = new FormData();
  form.append("chat_id", await resolveChatId(chatId));
  form.append("voice", new Blob([new Uint8Array(mp3)], { type: "audio/mpeg" }), "advisor.mp3");
  if (caption) form.append("caption", caption.slice(0, 1000));
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/sendVoice", { method: "POST", body: form, signal: AbortSignal.timeout(30000), cache: "no-store" });
    return Boolean(((await response.json().catch(() => null)) as any)?.ok);
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

// Short menu: the main TZ flow first; every other command still works when typed.
export const BOT_COMMANDS = [
  { command: "panel", description: "Главное меню" },
  { command: "campaign", description: "Новая кампания (или просто голосовое)" },
  { command: "campaigns", description: "Все кампании и прогресс за сегодня" },
  { command: "creport", description: "Отчёт за день" },
  { command: "capacity", description: "Ёмкость сети: сколько размещений в день" },
  { command: "recall", description: "Проверка полноты поиска по вашему списку" },
  { command: "cstop", description: "Остановить кампанию или все: /cstop all" },
  { command: "advisor", description: "Советник: разговор текстом или голосом" },
  { command: "client", description: "Подобрать сообщества под клиента" },
  { command: "groups", description: "Найти сообщества: страна, город, тема" },
  { command: "requests", description: "Запросы админам: письмо каждому сообществу" },
  { command: "find", description: "Найти что угодно" },
  { command: "status", description: "Что сейчас происходит" },
  { command: "help", description: "Как пользоваться" },
];

export const BOT_PROFILE = {
  short_description: "AURELIUS: AI-агент. Находит сообщества, размещает объявления там, где разрешено, и присылает отчёты.",
  description: "✦ AURELIUS: AI-агент для рекламы в сообществах.\n\n🎙 Поставьте задачу голосом или текстом\n🔎 Найду профильные и смежные группы в Facebook, Telegram, Instagram, TikTok\n📣 Буду размещать каждый день, только где реклама разрешена\n📊 Пришлю мониторинг и отчёт\n\nНажмите «Старт».",
};
