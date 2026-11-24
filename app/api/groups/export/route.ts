import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { fullExportXlsx, groupsCsv, listGroups, listPosts, postsCsv } from "@/lib/scout/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sensitive exports must use an authenticated request header, never a
// credential in the URL (which can leak through history, logs and referrers).
export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv" || format === "posts-csv") {
    const body = format === "csv" ? groupsCsv(await listGroups()) : postsCsv(await listPosts(5000));
    return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=\"aurelius-" + (format === "csv" ? "groups" : "posts") + "-" + new Date().toISOString().slice(0, 10) + ".csv\"", "cache-control": "no-store" } });
  }
  const buffer = await fullExportXlsx();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": "attachment; filename=\"aurelius-groups-" + new Date().toISOString().slice(0, 10) + ".xlsx\"",
      "cache-control": "no-store",
    },
  });
}
