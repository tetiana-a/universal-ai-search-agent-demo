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

type RadioStation = {
  stationuuid: string;
  name: string;
  country: string;
  language: string;
  tags: string;
  favicon: string;
  homepage: string;
  streamUrl: string;
  codec: string;
  bitrate: number;
  votes: number;
};

function secureStreamUrl(station: RadioBrowserStation): string {
  const candidates = [station.url_resolved, station.url];

  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:") return parsed.toString();
    } catch {
      // Ignore malformed provider URLs.
    }
  }

  return "";
}

function normalizeStation(station: RadioBrowserStation): RadioStation | null {
  const streamUrl = secureStreamUrl(station);
  const stationuuid = String(station.stationuuid || "").trim();

  if (!stationuuid || !streamUrl) return null;

  return {
    stationuuid,
    name: String(station.name || "Unknown station").trim(),
    country: String(station.country || "International").trim(),
    language: String(station.language || "").trim(),
    tags: String(station.tags || "").trim(),
    favicon: String(station.favicon || "").trim(),
    homepage: String(station.homepage || "").trim(),
    streamUrl,
    codec: String(station.codec || "").trim(),
    bitrate: Number(station.bitrate || 0),
    votes: Number(station.votes || 0),
  };
}

function buildQueryVariants(tag: string, countrycode: string) {
  const variants: Array<Record<string, string>> = [];

  if (tag) {
    variants.push({ tag, codec: "MP3" });
    variants.push({ tag, codec: "AAC" });
    variants.push({ tag });
  }

  // Broad fallback: useful when a genre has few HTTPS stations.
  variants.push({ codec: "MP3" });
  variants.push({ codec: "AAC" });
  variants.push({});

  return variants.map((variant) => {
    const params = new URLSearchParams({
      order: "votes",
      reverse: "true",
      limit: "24",
      hidebroken: "true",
      ...variant,
    });

    if (countrycode) params.set("countrycode", countrycode);
    return params.toString();
  });
}

async function fetchStations(host: string, query: string): Promise<RadioStation[]> {
  const response = await fetch(
    host + "/json/stations/search?" + query,
    {
      headers: {
        "User-Agent": "Aurelius Universal AI Research Engine/2.1 (+radio module)",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!response.ok) {
    throw new Error("Radio provider returned HTTP " + response.status + ".");
  }

  const stations = (await response.json()) as RadioBrowserStation[];

  return stations
    .map(normalizeStation)
    .filter((station): station is RadioStation => station !== null);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tag = String(url.searchParams.get("tag") || "chillout")
    .trim()
    .slice(0, 40)
    .toLowerCase();
  const countrycode = String(url.searchParams.get("countrycode") || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") || 12), 4),
    18,
  );

  const queries = buildQueryVariants(tag, countrycode);
  const stations = new Map<string, RadioStation>();
  let lastError = "Radio service unavailable.";

  for (const host of RADIO_BROWSER_HOSTS) {
    for (const query of queries) {
      if (stations.size >= limit) break;

      try {
        const found = await fetchStations(host, query);

        for (const station of found) {
          if (!stations.has(station.stationuuid)) {
            stations.set(station.stationuuid, station);
          }

          if (stations.size >= limit) break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
    }

    if (stations.size >= limit) break;
  }

  const normalized = Array.from(stations.values()).slice(0, limit);

  if (normalized.length > 0) {
    return NextResponse.json(
      {
        ok: true,
        provider: "Radio Browser",
        tag,
        countrycode,
        stations: normalized,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        lastError ||
        "No compatible HTTPS radio stations were found for this genre.",
      stations: [],
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
