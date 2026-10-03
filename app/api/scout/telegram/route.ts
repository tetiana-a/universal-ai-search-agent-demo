import { after } from "next/server";
import { handleUpdate } from "@/lib/scout/bot";
import { logAction } from "@/lib/scout/store";
import { webhookSecret } from "@/lib/scout/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Telegram webhook. Telegram signs each call with the secret set in setWebhook;
// anything without it is rejected. Long work (/scan, research rounds) runs after the 200 reply.
export async function POST(request: Request) {
  const secret = webhookSecret();
  if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) return new Response("forbidden", { status: 403 });
  const update = await request.json().catch(() => null);
  if (!update) return Response.json({ ok: true });
  try {
    const result = await handleUpdate(update);
    if (result.background) after(result.background);
  } catch (error) {
    // Answer 200 anyway: a failing update must not make Telegram retry it forever.
    await logAction({ actor: "bot", action: "bot.error", detail: error instanceof Error ? error.message : "unknown" });
  }
  return Response.json({ ok: true });
}
