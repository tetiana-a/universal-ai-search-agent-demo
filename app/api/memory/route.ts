import { NextResponse } from "next/server";
import { getMemoryHealth, getResearchMemoryContext } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("query") || "").trim();

  if (query) {
    const context = await getResearchMemoryContext(query, 40);
    return NextResponse.json(
      { ...context, sourceCount: context.sources.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(await getMemoryHealth(), {
    headers: { "Cache-Control": "no-store" },
  });
}
