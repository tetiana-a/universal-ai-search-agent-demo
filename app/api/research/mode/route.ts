import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const provider = (process.env.RESEARCH_AI_PROVIDER || "free").toLowerCase();
  const isFree = provider === "free";
  const model = isFree
    ? (process.env.OPENROUTER_MODEL || "openrouter/free")
    : (process.env.OPENAI_MODEL || "paid-model");

  return NextResponse.json(
    {
      provider: isFree ? "free" : "paid",
      model,
      billing: isFree ? "free" : "paid",
      label: isFree ? "Free AI" : "Paid AI",
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
