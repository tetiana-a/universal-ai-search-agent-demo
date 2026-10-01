import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type ResearchRequest = {
  query?: string;
  language?: "ru" | "en";
  maxResults?: number;
};

type ResearchResult = {
  id: number;
  title: string;
  location: string;
  area: string;
  price: string;
  match: number;
  evidence: string;
  status: "Verified" | "Reviewed" | "Manual review";
  source: string;
  url: string;
  why: string;
};

function outputText(response: any) {
  return typeof response?.output_text === "string" ? response.output_text : "";
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.6-sol";

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not configured. Add it to Vercel Environment Variables to enable live web research.",
      },
      { status: 503 },
    );
  }

  const body = (await request.json()) as ResearchRequest;
  const query = String(body.query || "").trim();
  const language = body.language === "en" ? "en" : "ru";
  const maxResults = Math.min(Math.max(Number(body.maxResults || 8), 4), 12);

  if (!query) {
    return NextResponse.json({ error: "Query is required." }, { status: 400 });
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      search_plan: { type: "string" },
      search_summary: { type: "string" },
      candidates_seen: { type: "integer", minimum: 0 },
      duplicates_removed: { type: "integer", minimum: 0 },
      results: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            location: { type: "string" },
            area: { type: "string" },
            price: { type: "string" },
            match: { type: "integer", minimum: 0, maximum: 100 },
            evidence: { type: "string" },
            status: { type: "string", enum: ["Verified", "Reviewed", "Manual review"] },
            source: { type: "string" },
            url: { type: "string" },
            why: { type: "string" },
          },
          required: [
            "title",
            "location",
            "area",
            "price",
            "match",
            "evidence",
            "status",
            "source",
            "url",
            "why",
          ],
        },
      },
    },
    required: ["search_plan", "search_summary", "candidates_seen", "duplicates_removed", "results"],
  };

  const systemPrompt =
    language === "ru"
      ? `Ты — live web research engine для AURELIUS.
Используй реальный web_search.
Не выдумывай результаты, цены, площади, адреса или URL.
Каждый результат должен происходить из реально найденного веб-источника.
Если поле неизвестно, пиши "не указано".
URL должен быть прямым URL найденного источника.
Не называй результат Verified без достаточного evidence; используй Reviewed или Manual review.
match — только оценка соответствия запросу, не юридическая или инвестиционная рекомендация.
Старайся использовать разные типы источников: property portals, public land, cadastral data, planning, open data, auctions/tenders.
Не обходи CAPTCHA, login или технические ограничения источника.`
      : `You are the live web research engine for AURELIUS.
Use the real web_search tool.
Do not invent results, prices, areas, addresses or URLs.
Every result must come from a real web source you found.
If a field is unknown, write "not specified".
Use the direct URL of the found source.
Do not call a result Verified without sufficient evidence; use Reviewed or Manual review.
match is only an estimated fit score against the user's query, not legal or investment advice.
Prefer different source classes: property portals, public land, cadastral data, planning, open data, auctions/tenders.
Do not bypass CAPTCHA, login or technical source restrictions.`;

  const userPrompt =
    language === "ru"
      ? `Запрос пользователя:
${query}

Найди до ${maxResults} релевантных результатов. Сначала расширь web search по Мадриду/Испании, затем просмотри наиболее подходящие страницы.
Верни только JSON по схеме.`
      : `User query:
${query}

Find up to ${maxResults} relevant results. Expand the web search across Madrid/Spain first, then inspect the best-matching pages.
Return JSON only according to the schema.`;

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [{ type: "web_search", search_context_size: "medium" }],
      text: {
        format: {
          type: "json_schema",
          name: "aurelius_research",
          strict: true,
          schema,
        },
      },
      max_output_tokens: 5000,
    }),
  });

  const response = await upstream.json();

  if (!upstream.ok) {
    return NextResponse.json(
      { error: response?.error?.message || "OpenAI live research request failed." },
      { status: upstream.status },
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(outputText(response));
  } catch {
    return NextResponse.json(
      { error: "The live research response was not valid JSON." },
      { status: 502 },
    );
  }

  const webSources = new Set<string>();
  const output = Array.isArray(response?.output) ? response.output : [];

  for (const item of output) {
    if (item?.type === "web_search_call") {
      const sources = item?.action?.sources;
      if (Array.isArray(sources)) {
        for (const source of sources) {
          if (typeof source?.url === "string") webSources.add(source.url);
        }
      }
    }
  }

  const results: ResearchResult[] = Array.isArray(parsed?.results)
    ? parsed.results.slice(0, maxResults).map((item: any, index: number) => ({
        id: index + 1,
        title: String(item?.title || "Untitled result"),
        location: String(item?.location || "not specified"),
        area: String(item?.area || "not specified"),
        price: String(item?.price || "not specified"),
        match: Math.max(0, Math.min(100, Number(item?.match || 0))),
        evidence: String(item?.evidence || "No evidence summary"),
        status:
          item?.status === "Verified" ||
          item?.status === "Reviewed" ||
          item?.status === "Manual review"
            ? item.status
            : "Reviewed",
        source: String(item?.source || "Web source"),
        url: String(item?.url || ""),
        why: String(item?.why || ""),
      }))
    : [];

  const uniqueResultUrls = new Set(results.map((item) => item.url).filter(Boolean));

  return NextResponse.json({
    live: true,
    model,
    query,
    elapsedMs: Date.now(),
    searchPlan: String(parsed?.search_plan || ""),
    summary: String(parsed?.search_summary || ""),
    results,
    sourceUrls: Array.from(webSources),
    stats: {
      sourcesFound: webSources.size,
      sourcesChecked: webSources.size,
      pagesProcessed: webSources.size,
      recordsExtracted: Number(parsed?.candidates_seen || results.length),
      duplicatesRemoved: Number(
        parsed?.duplicates_removed ??
          Math.max(0, Number(parsed?.candidates_seen || results.length) - uniqueResultUrls.size),
      ),
      qualified: results.length,
      evidenceCoverage: results.length
        ? Math.round(
            (results.filter(
              (item) => item.evidence && item.evidence !== "No evidence summary",
            ).length /
              results.length) *
              100,
          )
        : 0,
    },
  });
}
