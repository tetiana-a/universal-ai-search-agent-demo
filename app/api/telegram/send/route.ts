import { NextResponse } from "next/server";
import { buildTelegramMessages, type ResearchExportPayload } from "@/lib/research-report";
import { createPdfBuffer, createXlsxBuffer } from "@/lib/server-exporters";

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

async function sendMessage(token: string, chatId: string, html: string) {
  const result = await telegramApi(token, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (!result.response.ok || !result.data?.ok) {
    throw new Error(result.data?.description || "Telegram sendMessage failed.");
  }
  return Number(result.data?.result?.message_id || 0) || undefined;
}

async function sendDocument(token: string, chatId: string, buffer: Buffer, filename: string, contentType: string) {
  if (buffer.length > 45 * 1024 * 1024) throw new Error("Telegram attachment is too large.");
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
  if (!response.ok || !data?.ok) throw new Error(data?.description || "Telegram sendDocument failed.");
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
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Telegram bot token is not configured in Vercel." }, { status: 503 });
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
    return NextResponse.json({ error: "No Telegram recipient is configured." }, { status: 503 });
  }

  const notAllowed = recipients.filter(function(id) { return !isAllowedChatId(id); });
  if (notAllowed.length) {
    return NextResponse.json(
      { error: "Recipient chat ID is not allowlisted. Add it to TELEGRAM_ALLOWED_CHAT_IDS in Vercel.", notAllowed },
      { status: 403 },
    );
  }

  let me: any = null;
  try {
    const result = await telegramApi(token, "getMe");
    me = result.data?.result || null;
  } catch {}

  const botId = me?.id ? String(me.id) : "";
  if (botId && recipients.some(function(id) { return id === botId; })) {
    return NextResponse.json(
      {
        error: "The configured Telegram ID is the bot's own ID, not a recipient chat ID. Open the bot, press Start, then configure the user's chat ID.",
        botUsername: me?.username || null,
        botId,
      },
      { status: 400 },
    );
  }

  const payload = body?.payload;
  const title = String(body?.title || "Aurelius Research").trim();
  const legacyText = String(body?.text || "").trim();
  const messages: string[] = payload && Array.isArray(payload.results)
    ? buildTelegramMessages(payload as ResearchExportPayload, 12)
    : legacyText
      ? ["<b>" + title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</b>\\n\\n" + legacyText]
      : [];

  if (!messages.length) {
    return NextResponse.json({ error: "Nothing to send." }, { status: 400 });
  }

  const attachFiles = body?.attachFiles !== false;
  let xlsx: Buffer | null = null;
  let pdf: Buffer | null = null;
  if (attachFiles && payload && Array.isArray(payload.results)) {
    [xlsx, pdf] = await Promise.all([
      createXlsxBuffer(payload as ResearchExportPayload),
      createPdfBuffer(payload as ResearchExportPayload),
    ]);
  }

  const delivered: any[] = [];
  try {
    for (const chatId of recipients) {
      const messageIds: number[] = [];
      for (const message of messages) {
        const id = await sendMessage(token, chatId, message);
        if (id) messageIds.push(id);
      }

      if (xlsx) {
        const id = await sendDocument(
          token,
          chatId,
          xlsx,
          "aurelius-research.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        if (id) messageIds.push(id);
      }

      if (pdf) {
        const id = await sendDocument(token, chatId, pdf, "aurelius-research.pdf", "application/pdf");
        if (id) messageIds.push(id);
      }

      delivered.push({ chatId, messageIds });
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Telegram delivery failed.",
        delivered,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    botUsername: me?.username || null,
    recipients: delivered.length,
    delivered,
    attachments: { xlsx: Boolean(xlsx), pdf: Boolean(pdf) },
  });
}
