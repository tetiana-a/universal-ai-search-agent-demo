import { after } from "next/server";
import { handleUpdate } from "@/lib/scout/bot";
import { claimOnce, logAction } from "@/lib/scout/store";
import { sendMessage, webhookSecret } from "@/lib/scout/telegram";

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

  const updateId = Number(update?.update_id);
  if (Number.isFinite(updateId)) {
    const claimed = await claimOnce("telegram-update:" + updateId, 24 * 60 * 60);
    if (!claimed) {
      await logAction({ actor: "bot", action: "telegram.duplicate_ignored", detail: "update=" + updateId });
      return Response.json({ ok: true, duplicate: true });
    }
  }

  try {
    const result = await handleUpdate(update);
    await logAction({
      actor: "bot",
      action: "telegram.update_received",
      detail: "update=" + String(update?.update_id || "n/a") + " · " + (update?.callback_query ? "callback" : "message"),
    });
    if (result.background) {
      const chatId = String(update?.callback_query?.message?.chat?.id || update?.message?.chat?.id || update?.edited_message?.chat?.id || "");
      after(async () => {
        try {
          await result.background?.();
        } catch (error) {
          const detail = error instanceof Error ? error.message : "unknown background error";
          await logAction({ actor: "bot", action: "bot.background_error", detail: detail.slice(0, 400) });
          if (chatId) await sendMessage(chatId, "⚠️ Фоновая задача завершилась ошибкой. Откройте /health и повторите поиск. Ошибка записана в журнал.");
        }
      });
    }
  } catch (error) {
    // Answer 200 anyway: a failing update must not make Telegram retry it forever.
    await logAction({ actor: "bot", action: "bot.error", detail: error instanceof Error ? error.message.slice(0, 400) : "unknown" });
  }
  return Response.json({ ok: true });
}
