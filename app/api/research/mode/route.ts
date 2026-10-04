import { NextResponse } from "next/server";
import { editionCapabilities } from "@/lib/editions";
import { resolvePlan } from "@/lib/plans";

export const runtime = "nodejs";

// Which edition this visitor is on and what each edition can use on this deployment.
export async function GET(request: Request) {
  const plan = resolvePlan(request);
  const editions = editionCapabilities();
  const current = plan.id === "pro" ? editions.pro : editions.free;
  const isFree = current.pipeline === "free";
  return NextResponse.json(
    {
      provider: isFree ? "free" : "paid",
      model: current.ai[0]?.model || "rules",
      billing: isFree && plan.id === "free" ? "free" : "paid",
      label: plan.id === "pro" ? "Pro" : "Free",
      edition: plan.id,
      editions,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
