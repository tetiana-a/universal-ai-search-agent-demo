import { NextResponse } from "next/server";
import { getPlans, getQuotaUsage, publicPlanInfo, resolvePlan } from "@/lib/plans";

export const runtime = "nodejs";

// Current plan, today's usage and the catalogue of plans. Does not consume quota.
export async function GET(request: Request) {
  const plan = resolvePlan(request);
  const usage = await getQuotaUsage(request, plan);
  const plans = getPlans();
  return NextResponse.json(
    {
      plan: publicPlanInfo(plan),
      usage,
      enforcement: process.env.PLAN_ENFORCEMENT === "off" ? "off" : "on",
      catalog: [publicPlanInfo(plans.free), publicPlanInfo(plans.pro)],
      billing: { enabled: false, provider: "stripe", status: "not_connected" },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
