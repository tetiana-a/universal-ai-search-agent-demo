import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 20;

function splitTelegramMessage(text: string, limit = 3900) {
  const normalized = text.trim();
  if (normalized.length <= limit) return [normalized];

  const parts: string[] = [];
  let remaining = normalized;

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n\n", limit);
    if (cut < Math.floor(limit * 0.55)) cut = remaining.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit * 0.55)) cut = remaining.lastIndexOf(" ", limit);
    if (cut < Math.floor(limit * 0.55)) cut = limit;

    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) parts.push(remaining);
  return parts.filter(Boolean);
}

export async function GET() {
  const configured = Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
  );

  if (!configured) {
    return NextResponse.json({
      configured: false,
      botUsername: null,
    });
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
      { signal: AbortSignal.timeout(5000), cache: "no-store" },
    );
    if (!response.ok) {
      return NextResponse.json({ configured: false, botUsername: null });
    }

    const data = await response.json();
    return NextResponse.json({
      configured: true,
      botUsername: data?.result?.username || null,
    });
  } catch {
    return NextResponse.json({
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      botUsername: null,
    });
  }
}

export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return NextResponse.json(
      {
        error:
          "Telegram bot is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Vercel Environment Variables.",
      },
      { status: 503 },
    );
  }

  let body: { text?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const text = String(body?.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "Nothing to send." }, { status: 400 });
  }
  if (text.length > 60_000) {
    return NextResponse.json({ error: "Message is too large." }, { status: 413 });
  }

  const title = String(body?.title || "Aurelius Research").trim();
  const message = `${title}\n\n${text}`;
  const chunks = splitTelegramMessage(message);

  const results: Array<{ ok: boolean; message_id?: number }> = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const suffix =
      chunks.length > 1 ? `\n\n[Part ${index + 1}/${chunks.length}]` : "";
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunks[index] + suffix,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8000),
      },
    );

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      return NextResponse.json(
        {
          error:
            data?.description ||
            `Telegram API error while sending part ${index + 1}.`,
          sentParts: results.length,
        },
        { status: 502 },
      );
    }

    results.push({
      ok: true,
      message_id: Number(data.result?.message_id || 0) || undefined,
    });
  }

  return NextResponse.json({
    ok: true,
    sentParts: results.length,
    botUsername: null,
  });
}
