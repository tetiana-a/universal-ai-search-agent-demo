import { isCronRequest, unauthorized } from "@/lib/scout/auth";
import { sendDailyReport } from "@/lib/scout/report";
import { runScan } from "@/lib/scout/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily run (Vercel Cron, see vercel.json): scan → match → drafts → report to Telegram.
export async function GET(request: Request) {
  if (!isCronRequest(request)) return unauthorized();
  const started = Date.now();
  let stats = null;
  let scanError = "";
  try {
    stats = await runScan({ actor: "cron", deadlineAt: started + 47_000 });
  } catch (error) {
    scanError = error instanceof Error ? error.message : "scan failed";
  }
  // The report goes out even if the scan failed: dialogues, drafts and meetings still matter.
  const report = await sendDailyReport("cron");
  return Response.json({ ok: report.ok && !scanError, stats, scanError: scanError || undefined, report: { ok: report.ok, error: report.error, chatId: report.chatId } });
}
