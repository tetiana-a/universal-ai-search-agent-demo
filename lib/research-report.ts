export type ReportResult = {
  id?: number;
  title?: string;
  organization?: string;
  specialization?: string;
  geography?: string;
  contact?: string;
  investmentType?: string;
  stage?: string;
  ticket?: string;
  location?: string;
  area?: string;
  price?: string;
  match?: number;
  confidence?: number;
  evidence?: string;
  evidenceQuote?: string;
  status?: string;
  source?: string;
  sourceType?: string;
  sourceDomain?: string;
  url?: string;
  why?: string;
  retrievedAt?: string;
  freshnessDays?: number;
  independentVerification?: boolean;
  qualityGate?: { gate?: string; passed?: number; total?: number };
  [key: string]: unknown;
};

export type ReportSource = {
  name?: string;
  url?: string;
  domain?: string;
  category?: string;
  accessStatus?: string;
  access_status?: string;
  accessMethod?: string;
  access_method?: string;
  reason?: string;
  evidenceAvailable?: boolean;
  evidence_available?: boolean;
  quality?: number;
  [key: string]: unknown;
};

export type ResearchExportPayload = {
  query?: string;
  generatedAt?: string;
  searchPlan?: string;
  searchSummary?: string;
  stats?: Record<string, number | string | boolean | null>;
  billing?: Record<string, unknown>;
  results: ReportResult[];
  sourceRegistry?: ReportSource[];
  // Optional run metadata; exports fall back to stats and the query when absent.
  language?: "ru" | "en";
  taskKind?: string;
  fieldSchema?: Array<{ key: string; ru: string; en: string }>;
  progressCounters?: Partial<Record<string, number>>;
};

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g",
};

// File names keep the query readable: Cyrillic is transliterated, "²" becomes "2".
export function safeFilenamePart(value: string) {
  const transliterated = Array.from(String(value || "research").split("\n")[0].toLowerCase())
    .map((ch) => CYRILLIC[ch] ?? ch)
    .join("")
    .replace(/²/g, "2");
  const normalized = transliterated.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const result = normalized.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "");
  return result || "research";
}

export function compactText(value: unknown, limit = 240) {
  const text = value === null || value === undefined ? "" : String(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? normalized.slice(0, limit - 1) + "…" : normalized;
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function valueOrDash(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && !/^not specified$/i.test(text) && text !== "—") return text;
  }
  return "—";
}

function pct(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return Math.max(0, Math.min(100, Math.round(numeric))) + "%";
}

export function resultLabel(item: ReportResult) {
  return valueOrDash(item.organization, item.title, item.sourceDomain, item.source);
}

export function reportResultText(item: ReportResult, index: number) {
  const lines = [
    (index + 1) + ". " + resultLabel(item),
    item.title && item.title !== resultLabel(item) ? "Title: " + item.title : "",
    item.specialization ? "Profile: " + item.specialization : "",
    "Location: " + valueOrDash(item.geography, item.location),
    item.area ? "Area / profile: " + item.area : "",
    item.price ? "Price / round: " + item.price : "",
    item.match !== undefined ? "Match: " + pct(item.match) : "",
    item.confidence !== undefined ? "Confidence: " + pct(item.confidence) : "",
    item.status ? "Status: " + item.status : "",
    item.source ? "Source: " + item.source : "",
    item.url ? "URL: " + item.url : "",
    item.evidenceQuote ? "Evidence: " + item.evidenceQuote : item.evidence ? "Evidence: " + item.evidence : "",
    item.why ? "Why it matches: " + item.why : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildPlainTextReport(payload: ResearchExportPayload, maxResults = 12) {
  const results = payload.results.slice(0, maxResults);
  const statText = Object.entries(payload.stats || {})
    .slice(0, 10)
    .map(function(entry) { return entry[0] + ": " + String(entry[1] ?? "—"); })
    .join(" · ");

  return [
    "AURELIUS — Universal AI Research Engine",
    "Query: " + (payload.query || "—"),
    payload.generatedAt ? "Generated: " + payload.generatedAt : "",
    payload.searchSummary ? "Summary: " + compactText(payload.searchSummary, 600) : "",
    statText ? "Stats: " + statText : "",
    results.map(function(item, index) { return reportResultText(item, index); }).join("\n\n"),
  ].filter(Boolean).join("\n\n");
}

export function buildEmailHtml(payload: ResearchExportPayload, maxResults = 20) {
  const rows = payload.results.slice(0, maxResults).map(function(item, index) {
    const gate = escapeHtml(item.qualityGate?.gate || item.status || "REVIEW");
    const gateClass = gate === "PASS" ? "pass" : gate === "FAIL" ? "fail" : "review";
    const title = escapeHtml(resultLabel(item));
    const location = escapeHtml(valueOrDash(item.geography, item.location));
    const profile = escapeHtml(valueOrDash(item.specialization, item.area));
    const source = item.url
      ? '<a href="' + escapeHtml(item.url) + '" style="color:#b88a27;text-decoration:none">' + escapeHtml(item.source || item.sourceDomain || item.url) + "</a>"
      : escapeHtml(valueOrDash(item.source, item.sourceDomain));
    const evidence = escapeHtml(valueOrDash(item.evidenceQuote, item.evidence));
    return '<tr>' +
      '<td style="padding:14px 12px;border-bottom:1px solid #e8e1d4;vertical-align:top;color:#171717">' + (index + 1) + "</td>" +
      '<td style="padding:14px 12px;border-bottom:1px solid #e8e1d4;vertical-align:top"><div style="font-weight:700;color:#171717">' + title + '</div><div style="margin-top:6px;color:#6b6458;font-size:12px">' + escapeHtml(item.title || "") + "</div></td>" +
      '<td style="padding:14px 12px;border-bottom:1px solid #e8e1d4;vertical-align:top;color:#3e3a33">' + location + "</td>" +
      '<td style="padding:14px 12px;border-bottom:1px solid #e8e1d4;vertical-align:top;color:#3e3a33">' + profile + "</td>" +
      '<td style="padding:14px 12px;border-bottom:1px solid #e8e1d4;vertical-align:top"><span class="badge ' + gateClass + '">' + gate + "</span></td>" +
      '<td style="padding:14px 12px;border-bottom:1px solid #e8e1d4;vertical-align:top;color:#3e3a33">' + source + '<div style="margin-top:5px;color:#6b6458;font-size:12px">' + evidence + "</div></td>" +
      "</tr>";
  }).join("");

  const stats = Object.entries(payload.stats || {}).slice(0, 10).map(function(entry) {
    return '<div style="padding:12px 14px;border:1px solid #e8e1d4;border-radius:12px;background:#fcfaf6"><div style="font-size:11px;color:#7c7569;text-transform:uppercase;letter-spacing:.08em">' +
      escapeHtml(entry[0]) + '</div><div style="margin-top:4px;font-weight:700;color:#171717">' + escapeHtml(String(entry[1] ?? "—")) + "</div></div>";
  }).join("");

  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>AURELIUS Research Report</title>" +
    "<style>body{margin:0;background:#f3efe8;color:#171717;font-family:Arial,Helvetica,sans-serif}.wrap{max-width:1100px;margin:0 auto;padding:28px}.card{background:#fffdf9;border:1px solid #e8e1d4;border-radius:20px;padding:24px}.badge{display:inline-block;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:700}.badge.pass{background:#e8f6ee;color:#13783e}.badge.review{background:#fff4dc;color:#9a6500}.badge.fail{background:#fde7e7;color:#b42318}th{text-align:left;padding:10px 12px;background:#2b2b2b;color:white;font-size:11px;text-transform:uppercase;letter-spacing:.06em}</style></head><body>" +
    '<div class="wrap"><div class="card"><div style="font-size:12px;letter-spacing:.18em;color:#b88a27;font-weight:700">AURELIUS</div>' +
    '<h1 style="margin:8px 0 6px;font-size:28px">Universal AI Research Report</h1>' +
    '<div style="color:#6b6458;font-size:14px"><b>Query:</b> ' + escapeHtml(payload.query || "—") + "</div>" +
    '<div style="margin-top:6px;color:#8a8275;font-size:12px">' + escapeHtml(payload.generatedAt || new Date().toISOString()) + "</div></div>" +
    (stats ? '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px">' + stats + "</div>" : "") +
    '<div class="card" style="margin-top:14px"><h2 style="margin-top:0;font-size:18px">Qualified results</h2><table style="width:100%;border-collapse:collapse"><thead><tr><th>#</th><th>Result</th><th>Location</th><th>Profile</th><th>Gate</th><th>Evidence / source</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="6" style="padding:24px;text-align:center;color:#6b6458">No structured results. See attached Source Registry.</td></tr>') +
    "</tbody></table></div>" +
    (payload.searchSummary ? '<div class="card" style="margin-top:14px"><h2 style="margin-top:0;font-size:18px">Research summary</h2><div style="white-space:pre-wrap;line-height:1.6;color:#3e3a33">' + escapeHtml(payload.searchSummary) + "</div></div>" : "") +
    '<div style="margin:22px 4px;color:#8a8275;font-size:11px">Generated by AURELIUS Universal AI Research Engine</div></div></body></html>';
}
