import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { collectOperationalHealth } from "@/lib/scout/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const health = await collectOperationalHealth();
  return Response.json(health, { status: health.ok ? 200 : 503 });
}
