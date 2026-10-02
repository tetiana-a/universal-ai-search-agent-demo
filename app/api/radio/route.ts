import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RADIO_BROWSER_HOSTS = [
  "https://de1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
];

type RadioBrowserStation = {
  stationuuid?: string;
  name?: string;
  country?: string;
  language?: string;
  tags?: string;
  favicon?: string;
  homepage?: string;
  url?: string;
  url_resolved?: string;
  codec?: string;
  bitrate?: number;
  votes?: number;
  lastcheckok?: number;
};

function isHttpsStream(value: unknown): value is string {
  return typeof value === "string" && /^https:///i.test(value.trim());
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tag = String(url.searchParams.get("tag") || "chillout").trim().slice(0, 40);
  const countrycode = String(url.searchParams.get("countrycode") || "").trim().toUpperCase().slice(0, 2);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 12), 4), 18);

  const params = new URLSearchParams({
    tag,
    codec: "MP3,AAC",
    order: "votes",
    reverse: "true",
    limit: String(limit),
    hidebroken: "true",
  });
  if (countrycode) params.set("countrycode", countrycode);

  let lastError = "Radio service unavailable.";
  for (const host of RADIO_BROWSER_HOSTS) {
    try {
      const response = await fetch(
        host + "/json/stations/search?" + params.toString(),
        {
          headers: {
            "User-Agent": "Aurelius Universal AI Research Engine/2.1 radio-module",
            Accept: "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(6000),
        },
      );

      if (!response.ok) {
        lastError = "Radio provider returned HTTP " + response.status + ".";
        continue;
      }

      const stations = (await response.json()) as RadioBrowserStation[];
      const normalized = stations
        .map((station) => ({
          stationuuid: String(station.stationuuid || ""),
          name: String(station.name || "Unknown station"),
          country: String(station.country || "International"),
          language: String(station.language || ""),
          tags: String(station.tags || ""),
          favicon: String(station.favicon || ""),
          homepage: String(station.homepage || ""),
          streamUrl: isHttpsStream(station.url_resolved)
            ? station.url_resolved
            : isHttpsStream(station.url)
              ? station.url
              : "",
          codec: String(station.codec || ""),
          bitrate: Number(station.bitrate || 0),
          votes: Number(station.votes || 0),
        }))
        .filter((station) => station.stationuuid && station.streamUrl)
        .slice(0, limit);

      return NextResponse.json(
        { ok: true, provider: host, tag, countrycode, stations: normalized },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  return NextResponse.json(
    { ok: false, error: lastError, stations: [] },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
