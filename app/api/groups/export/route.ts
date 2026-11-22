import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { fullExportXlsx } from "@/lib/scout/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sensitive exports must use an authenticated request header, never a
// credential in the URL (which can leak through history, logs and referrers).
export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const buffer = await fullExportXlsx();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": "attachment; filename=\"aurelius-groups-" + new Date().toISOString().slice(0, 10) + ".xlsx\"",
      "cache-control": "no-store",
    },
  });
}
