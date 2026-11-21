import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { groupsXlsx, listGroups, listPosts } from "@/lib/scout/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Excel with two sheets: groups (with admin contacts and prices) and the posting log.
// The key travels as ?key= because a plain download link cannot set headers.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const authed = isAuthorized(key ? new Request(request.url, { headers: { "x-scout-key": key } }) : request);
  if (!authed) return unauthorized();
  const buffer = await groupsXlsx(await listGroups(), await listPosts(2000));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": "attachment; filename=\"aurelius-groups-" + new Date().toISOString().slice(0, 10) + ".xlsx\"",
      "cache-control": "no-store",
    },
  });
}
