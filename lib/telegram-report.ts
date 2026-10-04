import { compactText, escapeHtml, type ResearchExportPayload } from "@/lib/research-report";
import {
  counterRows, domainOf, evidenceText, formatDate, formatNumber, kindLabel, percent, reportColumns,
  reportCounters, reportKind, reportLanguage, resultFacts, resultName, safeUrl, statusInfo, statusTally,
  t, type StatusTone,
} from "@/lib/report-model";

export const TELEGRAM_MESSAGE_LIMIT = 3900;

const TONE_ICON: Record<StatusTone, string> = { ok: "🟢", partial: "🟡", review: "⚪️", fail: "🔴" };
const COUNTER_ICON: Record<string, string> = {
  sourcesDiscovered: "🌐", sourcesChecked: "✅", sourcesUnavailable: "🚧", resultsFound: "📥",
  afterDedupe: "🧹", filteredOut: "🚫", matchingCriteria: "🎯", needsReview: "👀", sourcesInBase: "🗂",
};

function summaryMessage(payload: ResearchExportPayload, shown: number) {
  const lang = reportLanguage(payload);
  const ru = lang === "ru";
  const counters = reportCounters(payload);
  const tally = statusTally(payload.results, lang);
  const total = payload.results.length;

  const lines = [
    "🏛 <b>AURELIUS · " + escapeHtml(t("title", lang)) + "</b>",
    "<i>" + escapeHtml(kindLabel(reportKind(payload), lang) + " · " + formatDate(payload.generatedAt, lang)) + "</i>",
    "",
    "🔎 <b>" + t("query", lang) + "</b>",
    "<blockquote>" + escapeHtml(compactText(payload.query || "—", 600)) + "</blockquote>",
    "",
    "📊 <b>" + t("progress", lang) + "</b>",
    ...counterRows(counters, lang).map((row) => (COUNTER_ICON[row.key] || "•") + " " + escapeHtml(row.label) + ": <b>" + formatNumber(row.value, lang) + "</b>"),
  ];
  if (total) {
    lines.push(
      "",
      [
        tally.ok ? TONE_ICON.ok + " " + (ru ? "проверено" : "verified") + " " + tally.ok : "",
        tally.partial ? TONE_ICON.partial + " " + (ru ? "частично" : "partly") + " " + tally.partial : "",
        tally.review ? TONE_ICON.review + " " + (ru ? "на проверку" : "to review") + " " + tally.review : "",
        tally.fail ? TONE_ICON.fail + " " + (ru ? "не подтверждено" : "not confirmed") + " " + tally.fail : "",
      ].filter(Boolean).join("  ·  "),
    );
  }
  if (payload.searchSummary) {
    lines.push("", "📝 <b>" + t("summary", lang) + "</b>", escapeHtml(compactText(payload.searchSummary, 700)));
  }
  lines.push("");
  if (!total) {
    lines.push("<i>" + escapeHtml(t("noResults", lang)) + "</i>");
  } else {
    const top = ru
      ? (shown < total ? "Ниже топ-" + shown + " из " + total + "." : "Ниже все результаты (" + total + ").")
      : (shown < total ? "Top " + shown + " of " + total + " below." : "All results below (" + total + ").");
    lines.push("📎 " + escapeHtml(top + " " + t("fullList", lang)));
  }
  return lines.join("\n");
}

function resultBlock(payload: ResearchExportPayload, index: number) {
  const lang = reportLanguage(payload);
  const item = payload.results[index];
  const status = statusInfo(item, lang);
  const match = percent(item.match);
  const heading = "<b>" + (index + 1) + ". " + escapeHtml(compactText(resultName(item), 140)) + "</b>";
  const badge = TONE_ICON[status.tone] + " " + escapeHtml(status.label) + (match ? " · " + t("match", lang).toLowerCase() + " " + match : "");
  const facts = resultFacts(item, reportColumns(payload), lang, 4)
    .map((f) => "▫️ " + escapeHtml(f.label) + ": " + escapeHtml(compactText(f.value, f.key === "why" ? 220 : 140)));
  const evidence = evidenceText(item, 260);
  const url = safeUrl(item.url);
  const domain = escapeHtml(compactText(domainOf(item), 60));
  const link = url
    ? "🔗 <a href=\"" + escapeHtml(url) + "\">" + t("open", lang) + "</a>" + (domain ? " · " + domain : "")
    : domain ? "🔗 " + domain : "";
  return [heading, badge, ...facts, evidence ? "<blockquote>«" + escapeHtml(evidence) + "»</blockquote>" : "", link]
    .filter(Boolean).join("\n");
}

// Telegram allows 4096 characters per message. The summary goes first; result blocks are
// packed into as few messages as possible without splitting a block.
export function buildTelegramMessages(payload: ResearchExportPayload, maxResults = 10) {
  const shown = Math.min(payload.results.length, maxResults);
  const messages = [summaryMessage(payload, shown)];
  let current = "";
  for (let i = 0; i < shown; i += 1) {
    const block = resultBlock(payload, i);
    if (current && current.length + 2 + block.length > TELEGRAM_MESSAGE_LIMIT) {
      messages.push(current);
      current = "";
    }
    current = current ? current + "\n\n" + block : block;
  }
  if (current) messages.push(current);
  return messages;
}
