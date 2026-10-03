import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { BOT_COMMANDS, botToken, tgCall, webhookSecret } from "@/lib/scout/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function webhookUrl(request: Request) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : new URL(request.url).origin);
  return base.replace(/\/$/, "") + "/api/scout/telegram";
}

// GET: current webhook state. POST: connect the bot to this deployment and publish its command menu.
export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  if (!botToken()) return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN не задан в Vercel" });
  const info = await tgCall("getWebhookInfo", {});
  const expected = webhookUrl(request);
  return Response.json({ ok: true, connected: info?.result?.url === expected, expected, current: info?.result?.url || "", pending: info?.result?.pending_update_count, lastError: info?.result?.last_error_message });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  if (!botToken()) return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN не задан в Vercel" }, { status: 400 });
  const url = webhookUrl(request);
  const hook = await tgCall("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message", "edited_message", "callback_query"], drop_pending_updates: false });
  const commands = await tgCall("setMyCommands", { commands: BOT_COMMANDS });
  return Response.json({ ok: Boolean(hook?.ok), url, webhook: hook?.description || "ok", commands: commands?.ok ? "ok" : commands?.description });
}
