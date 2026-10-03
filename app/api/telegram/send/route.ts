import { NextResponse } from "next/server";
import { buildTelegramMessages, escapeHtml, type ResearchExportPayload } from "@/lib/research-report";
import { createPdfBuffer, createXlsxBuffer } from "@/lib/server-exporters";
import { assertFeature, resolvePlan } from "@/lib/plans";
import { errorBody } from "@/lib/research-errors";

export const runtime = "nodejs";
export const maxDuration = 45;

function splitIds(value: unknown) {
  return String(value || "")
    .split(",")
    .map(function(id) { return id.trim(); })
    .filter(Boolean);
}

function configuredChatIds() {
  return Array.from(new Set([
    ...splitIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    ...splitIds(process.env.TELEGRAM_CHAT_ID),
  ]));
}

function isAllowedChatId(chatId: string) {
  return configuredChatIds().includes(chatId);
}

async function telegramApi(token: string, method: string, body?: unknown, init?: RequestInit) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
    ...init,
  });
  const data = await response.json().catch(function() { return null; });
  return { response, data };
}

// Turns Telegram's error description into an actionable diagnostic.
export function telegramHint(description: string) {
  const d = description.toLowerCase();
  if (d.includes("unauthorized")) return "TELEGRAM_BOT_TOKEN is invalid or revoked. Create a new token with @BotFather and update it in Vercel.";
  if (d.includes("chat not found")) return "Chat ID not found. The recipient must open the bot and press Start; check the Chat ID.";
  if (d.includes("bot was blocked")) return "The recipient blocked the bot. They must unblock it and press Start.";
  if (d.includes("not enough rights") || d.includes("have no rights")) return "The bot has no permission to post in this group/channel. Make it an admin.";
  if (d.includes("can't parse entities")) return "Telegram rejected the message formatting (HTML).";
  if (d.includes("too many requests")) return "Telegram rate limit reached. Retry in a minute.";
  if (d.includes("request entity too large") || d.includes("file is too big")) return "Attachment is larger than Telegram allows (50 MB).";
  return "";
}

class TelegramError extends Error {
  constructor(message: string, readonly stage: string, readonly hint: string) { super(message); }
}

async function withRetry<T extends { response: Response; data: any }>(run: () => Promise<T>): Promise<T> {
  const first = await run();
  const retryAfter = Number(first.data?.parameters?.retry_after || 0);
  if (first.response.status === 429 && retryAfter > 0 && retryAfter <= 5) {
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return run();
  }
  return first;
}

async function sendMessage(token: string, chatId: string, html: string) {
  const result = await withRetry(() => telegramApi(token, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  }));
  if (!result.response.ok || !result.data?.ok) {
    const description = String(result.data?.description || "Telegram sendMessage failed (HTTP " + result.response.status + ").");
    throw new TelegramError(description, "send_message", telegramHint(description));
  }
  return Number(result.data?.result?.message_id || 0) || undefined;
}

async function sendDocument(token: string, chatId: string, buffer: Buffer, filename: string, contentType: string) {
  if (buffer.length > 45 * 1024 * 1024) throw new TelegramError("Telegram attachment is too large.", "send_document", "Reduce the number of results before sending.");
  const run = async () => {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", new Blob([buffer as unknown as BlobPart], { type: contentType }), filename);
    const response = await fetch("https://api.telegram.org/bot" + token + "/sendDocument", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(25000),
      cache: "no-store",
    });
    const data = await response.json().catch(function() { return null; });
    return { response, data };
  };
  const { response, data } = await withRetry(run);
  if (!response.ok || !data?.ok) {
    const description = String(data?.description || "Telegram sendDocument failed (HTTP " + response.status + ").");
    throw new TelegramError(description, "send_document", telegramHint(description));
  }
  return Number(data?.result?.message_id || 0) || undefined;
}

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ configured: false, botUsername: null, botId: null, configuredChatIds: 0 });
  }

  try {
    const me = await telegramApi(token, "getMe");
    if (!me.response.ok || !me.data?.ok) {
      return NextResponse.json({ configured: false, botUsername: null, botId: null, configuredChatIds: configuredChatIds().length });
    }

    const botId = String(me.data?.result?.id || "");
    const targets = configuredChatIds();
    const hasBotIdAsTarget = Boolean(botId && targets.includes(botId));

    let targetDiagnostics: any[] = [];
    for (const chatId of targets.slice(0, 10)) {
      if (chatId === botId) {
        targetDiagnostics.push({ chatId, valid: false, reason: "bot_id_is_not_a_recipient_chat_id" });
        continue;
      }
      const chat = await telegramApi(token, "getChat", { chat_id: chatId });
      targetDiagnostics.push({
        chatId,
        valid: Boolean(chat.response.ok && chat.data?.ok),
        type: chat.data?.result?.type || null,
        title: chat.data?.result?.title || chat.data?.result?.username || null,
        reason: chat.response.ok && chat.data?.ok ? null : chat.data?.description || "Unable to resolve chat",
      });
    }

    return NextResponse.json({
      configured: true,
      botUsername: me.data?.result?.username || null,
      botId,
      configuredChatIds: targets.length,
      hasBotIdAsTarget,
      targetDiagnostics,
    });
  } catch {
    return NextResponse.json({
      configured: Boolean(token),
      botUsername: null,
      botId: null,
      configuredChatIds: configuredChatIds().length,
    });
  }
}

export async function POST(request: Request) {
  try {
    assertFeature(resolvePlan(request), "telegram");
  } catch (error) {
    const e = errorBody(error);
    return NextResponse.json(e.body, { status: e.status });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Telegram bot token is not configured in Vercel (TELEGRAM_BOT_TOKEN).", stage: "configuration" }, { status: 503 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  let recipients = splitIds(body?.chatIds);
  if (!recipients.length) recipients = splitIds(process.env.TELEGRAM_CHAT_ID);
  recipients = Array.from(new Set(recipients));

  if (!recipients.length) {
    return NextResponse.json({ error: "No Telegram recipient is configured (TELEGRAM_CHAT_ID).", stage: "configuration" }, { status: 503 });
  }

  const notAllowed = recipients.filter(function(id) { return !isAllowedChatId(id); });
  if (notAllowed.length) {
    return NextResponse.json(
      { error: "Recipient chat ID is not allowlisted. Add it to TELEGRAM_ALLOWED_CHAT_IDS in Vercel.", stage: "allowlist", notAllowed },
      { status: 403 },
    );
  }

  let me: any = null;
  try {
    const result = await telegramApi(token, "getMe");
    if (!result.response.ok || !result.data?.ok) {
      const description = String(result.data?.description || "getMe failed (HTTP " + result.response.status + ")");
      return NextResponse.json(
        { error: "Telegram rejected the bot token: " + description, stage: "bot_token", hint: telegramHint(description) },
        { status: result.response.status === 401 ? 503 : 502 },
      );
    }
    me = result.data?.result || null;
  } catch (error) {
    return NextResponse.json(
      { error: "Telegram API is unreachable: " + (error instanceof Error ? error.message : "network error"), stage: "bot_token" },
      { status: 502 },
    );
  }

  const botId = me?.id ? String(me.id) : "";
  if (botId && recipients.some(function(id) { return id === botId; })) {
    return NextResponse.json(
      {
        error: "The configured Telegram ID is the bot's own ID, not a recipient chat ID. Open the bot, press Start, then configure the user's chat ID.",
        stage: "allowlist",
        botUsername: me?.username || null,
        botId,
      },
      { status: 400 },
    );
  }

  const payload = body?.payload;
  const title = String(body?.title || "Aurelius Research").trim();
  const legacyText = String(body?.text || "").trim().slice(0, 3500);
  const messages: string[] = payload && Array.isArray(payload.results)
    ? buildTelegramMessages(payload as ResearchExportPayload, 12)
    : legacyText
      ? ["<b>" + escapeHtml(title.slice(0, 200)) + "</b>\n\n" + escapeHtml(legacyText)]
      : [];

  if (!messages.length) {
    return NextResponse.json({ error: "Nothing to send." }, { status: 400 });
  }

  // A broken attachment must not block the report itself: the text goes out and the
  // failed attachment is reported precisely.
  const attachFiles = body?.attachFiles !== false;
  const attachments: Array<{ name: string; type: string; buffer: Buffer }> = [];
  const attachmentErrors: Array<{ stage: string; error: string }> = [];
  if (attachFiles && payload && Array.isArray(payload.results)) {
    try {
      attachments.push({ name: "aurelius-research.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await createXlsxBuffer(payload as ResearchExportPayload) });
    } catch (error) {
      attachmentErrors.push({ stage: "xlsx_generation", error: error instanceof Error ? error.message : "Unknown XLSX generation error." });
    }
    try {
      attachments.push({ name: "aurelius-research.pdf", type: "application/pdf", buffer: await createPdfBuffer(payload as ResearchExportPayload) });
    } catch (error) {
      attachmentErrors.push({ stage: "pdf_generation", error: error instanceof Error ? error.message : "Unknown PDF generation error." });
    }
  }

  const delivered: Array<{ chatId: string; messageIds: number[] }> = [];
  const failed: Array<{ chatId: string; stage: string; error: string; hint: string }> = [];
  for (const chatId of recipients) {
    const messageIds: number[] = [];
    try {
      for (const message of messages) {
        const id = await sendMessage(token, chatId, message);
        if (id) messageIds.push(id);
      }
    } catch (error) {
      failed.push({ chatId, stage: error instanceof TelegramError ? error.stage : "send_message", error: error instanceof Error ? error.message : "Telegram delivery failed.", hint: error instanceof TelegramError ? error.hint : "" });
      continue;
    }
    for (const file of attachments) {
      try {
        const id = await sendDocument(token, chatId, file.buffer, file.name, file.type);
        if (id) messageIds.push(id);
      } catch (error) {
        attachmentErrors.push({ stage: "send_document:" + file.name + ":" + chatId, error: error instanceof Error ? error.message : "Telegram sendDocument failed." });
      }
    }
    delivered.push({ chatId, messageIds });
  }

  if (!delivered.length) {
    const first = failed[0];
    return NextResponse.json(
      { error: "Telegram delivery failed: " + (first?.error || "unknown error"), stage: first?.stage || "send_message", hint: first?.hint || "", failed, attachmentErrors },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    partial: failed.length > 0 || attachmentErrors.length > 0,
    botUsername: me?.username || null,
    recipients: delivered.length,
    delivered,
    failed,
    attachments: {
      xlsx: attachments.some((f) => f.name.endsWith(".xlsx")),
      pdf: attachments.some((f) => f.name.endsWith(".pdf")),
    },
    attachmentErrors,
  }, { status: 200 });
}
