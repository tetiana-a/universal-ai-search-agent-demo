import type { ReportResult, ResearchExportPayload } from "@/lib/research-report";
import { compactText } from "@/lib/research-report";
import {
  accessLabel, counterRows, domainOf, evidenceText, fieldValue, formatDate, formatNumber, kindLabel, percent,
  reportColumns, reportCounters, reportKind, reportLanguage, resultName, safeUrl, statusInfo, statusTally, t,
  type ReportLanguage, type StatusTone,
} from "@/lib/report-model";

// Spreadsheet formula injection guard: a cell that starts with = + - @ (or a control
// character) is executed by Excel/Sheets. Prefix it with a quote so it stays text.
export function neutralizeFormula(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function cellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    try { return neutralizeFormula(JSON.stringify(value)); } catch { return ""; }
  }
  return neutralizeFormula(value);
}

const TONE_COLOR: Record<StatusTone, { text: string; fill: string }> = {
  ok: { text: "15803D", fill: "E8F6EE" },
  partial: { text: "1D4ED8", fill: "E8EFFD" },
  review: { text: "9A6500", fill: "FFF4DC" },
  fail: { text: "B42318", fill: "FDE7E7" },
};

const INK = "171717";
const MUTED = "6B6458";
const GOLD = "B88A27";
const HEADER_FILL = "2B2B2B";
const ZEBRA = "FAF7F1";

// The results table shared by CSV and XLSX: the task's own columns, then match,
// status, source, link and the quote that backs the result.
type Column = { label: string; width: number; value: (item: ReportResult, index: number) => string | number };

function tableColumns(payload: ResearchExportPayload, lang: ReportLanguage): Column[] {
  const fields = reportColumns(payload).map<Column>((field, i) => ({
    label: lang === "ru" ? field.ru : field.en,
    width: i === 0 ? 34 : field.key === "why" ? 40 : 24,
    value: (item) => (i === 0 ? fieldValue(item, field.key) || resultName(item) : fieldValue(item, field.key)),
  }));
  return [
    { label: t("number", lang), width: 6, value: (_item, index) => index + 1 },
    ...fields,
    { label: t("match", lang), width: 12, value: (item) => percent(item.match) },
    { label: t("status", lang), width: 20, value: (item) => statusInfo(item, lang).label },
    { label: t("source", lang), width: 22, value: (item) => domainOf(item) },
    { label: t("link", lang), width: 40, value: (item) => safeUrl(item.url) },
    { label: t("evidence", lang), width: 60, value: (item) => evidenceText(item, 700) },
  ];
}

export function createCsvBuffer(payload: ResearchExportPayload) {
  const lang = reportLanguage(payload);
  const columns = tableColumns(payload, lang);
  const rows = [
    columns.map((c) => c.label),
    ...payload.results.map((item, index) => columns.map((c) => c.value(item, index))),
  ];
  const csvEscape = function(value: unknown) {
    const text = typeof value === "number" ? String(value) : neutralizeFormula(value);
    return '"' + text.replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
  };
  return Buffer.from("﻿" + rows.map(function(row) { return row.map(csvEscape).join(";"); }).join("\r\n"), "utf8");
}

export function createJsonBuffer(payload: ResearchExportPayload) {
  return Buffer.from(JSON.stringify(payload, null, 2), "utf8");
}

const solid = (hex: string) => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } });
const thin = (hex = "E5E1D8") => ({ style: "thin", color: { argb: "FF" + hex } });

export async function createXlsxBuffer(payload: ResearchExportPayload) {
  const mod: any = await import("exceljs");
  const ExcelJS: any = mod.default || mod;
  const lang = reportLanguage(payload);
  const ru = lang === "ru";
  const kind = kindLabel(reportKind(payload), lang);
  const counters = counterRows(reportCounters(payload), lang);
  const generated = formatDate(payload.generatedAt, lang);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AURELIUS Universal AI Research Engine";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties = { title: "AURELIUS " + t("title", lang), subject: compactText(payload.query || "", 250) };

  // ── Results ──────────────────────────────────────────────────────────────
  const columns = tableColumns(payload, lang);
  const lastCol = columns.length;
  const ws = workbook.addWorksheet(t("results", lang));
  ws.properties.defaultRowHeight = 18;
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  ws.headerFooter.oddFooter = "&L AURELIUS&R &P / &N";
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const band = (row: number, value: string, font: any, fill?: string, height = 20) => {
    ws.mergeCells(row, 1, row, lastCol);
    const cell = ws.getCell(row, 1);
    cell.value = cellValue(value) as any;
    cell.font = font;
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
    if (fill) cell.fill = solid(fill);
    ws.getRow(row).height = height;
  };
  band(1, "AURELIUS  ·  " + t("title", lang).toUpperCase(), { name: "Calibri", bold: true, size: 16, color: { argb: "FFFFFFFF" } }, HEADER_FILL, 34);
  band(2, t("query", lang) + ": " + compactText(payload.query || "—", 600), { bold: true, size: 11, color: { argb: "FF" + INK } }, "F6F1E7", 36);
  band(3, t("taskType", lang) + ": " + kind + "     " + t("generated", lang) + ": " + generated, { size: 9, color: { argb: "FF" + MUTED } }, "F6F1E7", 18);

  // Counter tiles: label above, big number below, as many per row as there are columns.
  const perRow = Math.max(1, lastCol - 1);
  let tileRow = 5;
  for (let i = 0; i < counters.length; i += perRow) {
    counters.slice(i, i + perRow).forEach((counter, j) => {
      const label = ws.getCell(tileRow, j + 2);
      const value = ws.getCell(tileRow + 1, j + 2);
      label.value = counter.label;
      label.font = { size: 8, color: { argb: "FF" + MUTED } };
      label.alignment = { wrapText: true, vertical: "bottom" };
      value.value = counter.value;
      value.numFmt = "#,##0";
      value.font = { bold: true, size: 15, color: { argb: "FF" + (counter.key === "matchingCriteria" ? GOLD : INK) } };
      value.alignment = { horizontal: "left", vertical: "top" };
      for (const cell of [label, value]) cell.border = { left: thin("D9CBA8") };
    });
    ws.getRow(tileRow).height = 26;
    ws.getRow(tileRow + 1).height = 24;
    tileRow += 2;
  }

  const headerRow = tileRow + 1;
  columns.forEach((c, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = c.label;
    cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    cell.fill = solid(HEADER_FILL);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { right: thin("4B4B4B") };
  });
  ws.getRow(headerRow).height = 30;
  ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 2, showGridLines: false }];

  const statusCol = columns.findIndex((c) => c.label === t("status", lang)) + 1;
  const linkCol = columns.findIndex((c) => c.label === t("link", lang)) + 1;
  payload.results.forEach((item, index) => {
    const row = ws.getRow(headerRow + 1 + index);
    columns.forEach((c, i) => { row.getCell(i + 1).value = cellValue(c.value(item, index)) as any; });
    row.height = 48;
    const zebra = index % 2 === 1;
    row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
      cell.alignment = { vertical: "top", wrapText: true, horizontal: colNumber === 1 ? "center" : "left" };
      cell.font = { size: 9, color: { argb: "FF262626" }, bold: colNumber === 2 };
      cell.border = { bottom: thin() };
      if (zebra) cell.fill = solid(ZEBRA);
    });
    const tone = TONE_COLOR[statusInfo(item, lang).tone];
    const status = row.getCell(statusCol);
    status.font = { bold: true, size: 9, color: { argb: "FF" + tone.text } };
    status.fill = solid(tone.fill);
    status.alignment = { vertical: "top", horizontal: "center", wrapText: true };
    const url = safeUrl(item.url);
    if (url) {
      row.getCell(linkCol).value = { text: t("open", lang) + " ↗  " + compactText(url, 80), hyperlink: url };
      row.getCell(linkCol).font = { color: { argb: "FF2563EB" }, underline: true, size: 9 };
    }
  });
  if (!payload.results.length) {
    ws.mergeCells(headerRow + 1, 1, headerRow + 1, lastCol);
    const cell = ws.getCell(headerRow + 1, 1);
    cell.value = t("noResults", lang);
    cell.font = { italic: true, color: { argb: "FF" + MUTED } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(headerRow + 1).height = 30;
  }
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + Math.max(payload.results.length, 1), column: lastCol } };

  // ── Summary ──────────────────────────────────────────────────────────────
  const summary = workbook.addWorksheet(t("summary", lang), { views: [{ showGridLines: false }] });
  summary.getColumn(1).width = 34;
  summary.getColumn(2).width = 110;
  summary.mergeCells("A1:B1");
  summary.getCell("A1").value = "AURELIUS  ·  " + t("title", lang).toUpperCase();
  summary.getCell("A1").font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  summary.getCell("A1").fill = solid(HEADER_FILL);
  summary.getCell("A1").alignment = { vertical: "middle", indent: 1 };
  summary.getRow(1).height = 30;
  const section = (title: string) => {
    const row = summary.addRow([title]);
    summary.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).font = { bold: true, size: 11, color: { argb: "FF" + GOLD } };
    row.getCell(1).border = { bottom: thin("D9CBA8") };
    row.height = 24;
  };
  const pair = (label: string, value: unknown) => {
    const row = summary.addRow([label, cellValue(value)]);
    row.getCell(1).font = { bold: true, size: 9, color: { argb: "FF" + MUTED } };
    row.getCell(2).font = { size: 10, color: { argb: "FF" + INK } };
    row.alignment = { vertical: "top", wrapText: true };
    const text = String(value ?? "");
    row.height = Math.min(300, Math.max(18, Math.ceil(text.length / 120) * 15));
  };
  summary.addRow([]);
  pair(t("query", lang), payload.query || "—");
  pair(t("taskType", lang), kind);
  pair(t("generated", lang), generated);
  summary.addRow([]);
  section(t("progress", lang));
  for (const counter of counters) pair(counter.label, formatNumber(counter.value, lang));
  const tally = statusTally(payload.results, lang);
  summary.addRow([]);
  section(t("status", lang));
  pair(ru ? "Проверено" : "Verified", tally.ok);
  pair(ru ? "Частично проверено" : "Partly verified", tally.partial);
  pair(ru ? "Нужна проверка" : "Needs review", tally.review);
  if (tally.fail) pair(ru ? "Не подтверждено" : "Not confirmed", tally.fail);
  if (payload.searchSummary) { summary.addRow([]); section(t("summary", lang)); pair("", compactText(payload.searchSummary, 4000)); }
  if (payload.searchPlan) { summary.addRow([]); section(ru ? "План поиска" : "Search plan"); pair("", compactText(payload.searchPlan, 4000)); }
  summary.addRow([]);
  section(ru ? "Как читать статусы" : "How to read the statuses");
  pair("", t("legend", lang));

  // ── Sources ──────────────────────────────────────────────────────────────
  const sources = workbook.addWorksheet(t("sources", lang), { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  sources.columns = [
    { header: t("source", lang), key: "name", width: 36 },
    { header: t("domain", lang), key: "domain", width: 26 },
    { header: t("category", lang), key: "category", width: 22 },
    { header: t("access", lang), key: "access", width: 24 },
    { header: t("quality", lang), key: "quality", width: 11 },
    { header: t("link", lang), key: "url", width: 50 },
    { header: t("reason", lang), key: "reason", width: 60 },
  ];
  sources.getRow(1).eachCell((cell: any) => {
    cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    cell.fill = solid(HEADER_FILL);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  sources.getRow(1).height = 26;
  (payload.sourceRegistry || []).forEach((item, index) => {
    const access = String(item.accessStatus ?? item.access_status ?? "");
    const url = safeUrl(item.url);
    const row = sources.addRow({
      name: cellValue(item.name || item.domain || ""),
      domain: cellValue(item.domain || ""),
      category: cellValue(item.category || ""),
      access: accessLabel(access, lang),
      quality: Number(item.quality ?? 0) || 0,
      url: cellValue(url),
      reason: cellValue(compactText(item.reason, 500)),
    });
    row.height = 30;
    row.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.font = { size: 9, color: { argb: "FF262626" } };
      cell.border = { bottom: thin() };
      if (index % 2 === 1) cell.fill = solid(ZEBRA);
    });
    const tone: StatusTone = access === "checked" ? "ok" : access === "partial" || !access ? "review" : "fail";
    row.getCell(4).font = { bold: true, size: 9, color: { argb: "FF" + TONE_COLOR[tone].text } };
    if (url) {
      row.getCell(6).value = { text: compactText(url, 90), hyperlink: url };
      row.getCell(6).font = { color: { argb: "FF2563EB" }, underline: true, size: 9 };
    }
  });
  sources.autoFilter = { from: "A1", to: "G" + Math.max(1, sources.rowCount) };

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

const PDF_TONE: Record<StatusTone, { color: string; fill: string }> = {
  ok: { color: "#15803D", fill: "#E8F6EE" },
  partial: { color: "#1D4ED8", fill: "#E8EFFD" },
  review: { color: "#9A6500", fill: "#FFF4DC" },
  fail: { color: "#B42318", fill: "#FDE7E7" },
};

const PDF_DETAIL_LIMIT = 150;

export async function createPdfBuffer(payload: ResearchExportPayload) {
  const pdfmakeModule: any = await import("pdfmake/build/pdfmake");
  const fontsModule: any = await import("pdfmake/build/vfs_fonts");
  const pdf: any = pdfmakeModule.default || pdfmakeModule;
  const fonts: any = fontsModule.default || fontsModule;
  const virtualFonts = fonts?.pdfMake || fonts;
  if (typeof pdf.addVirtualFileSystem === "function") {
    pdf.addVirtualFileSystem(virtualFonts);
  } else {
    pdf.vfs = virtualFonts?.vfs || virtualFonts;
  }

  const lang = reportLanguage(payload);
  const ru = lang === "ru";
  const counters = counterRows(reportCounters(payload), lang);
  const tally = statusTally(payload.results, lang);
  const fields = reportColumns(payload).slice(0, 5);

  const h2 = (text: string, extra: any = {}) => ({ text, fontSize: 12, bold: true, color: "#171717", margin: [0, 12, 0, 6], ...extra });
  const content: any[] = [
    { text: "AURELIUS", color: "#B88A27", bold: true, fontSize: 9, characterSpacing: 3 },
    { text: t("title", lang), fontSize: 22, bold: true, margin: [0, 2, 0, 8] },
    {
      table: { widths: ["*"], body: [[{
        stack: [
          { text: t("query", lang).toUpperCase(), fontSize: 7, color: "#8A8275", characterSpacing: 1 },
          { text: compactText(payload.query || "—", 700), fontSize: 11, bold: true, margin: [0, 2, 0, 4] },
          { text: t("taskType", lang) + ": " + kindLabel(reportKind(payload), lang) + "   ·   " + t("generated", lang) + ": " + formatDate(payload.generatedAt, lang), fontSize: 8, color: "#6B6458" },
        ],
        fillColor: "#F6F1E7", margin: [8, 7, 8, 7],
      }]] },
      layout: "noBorders",
    },
    h2(t("progress", lang)),
    {
      table: {
        widths: counters.map(() => "*"),
        body: [counters.map((c) => ({
          stack: [
            { text: formatNumber(c.value, lang), fontSize: 16, bold: true, color: c.key === "matchingCriteria" ? "#B88A27" : "#171717" },
            { text: c.label, fontSize: 7, color: "#6B6458", margin: [0, 2, 0, 0] },
          ],
          margin: [6, 5, 4, 5],
        }))],
      },
      layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 0 : 0.6), vLineColor: () => "#D9CBA8" },
    },
    {
      text: [
        { text: "● " + (ru ? "Проверено " : "Verified ") + tally.ok + "     ", color: PDF_TONE.ok.color },
        { text: "● " + (ru ? "Частично " : "Partly ") + tally.partial + "     ", color: PDF_TONE.partial.color },
        { text: "● " + (ru ? "Нужна проверка " : "Needs review ") + tally.review + (tally.fail ? "     " : ""), color: PDF_TONE.review.color },
        ...(tally.fail ? [{ text: "● " + (ru ? "Не подтверждено " : "Not confirmed ") + tally.fail, color: PDF_TONE.fail.color }] : []),
      ],
      fontSize: 8, margin: [0, 8, 0, 0],
    },
  ];

  if (payload.searchSummary) {
    content.push(h2(t("summary", lang)));
    content.push({ text: compactText(payload.searchSummary, 1800), fontSize: 9, color: "#3E3A33", lineHeight: 1.25 });
  }

  // Results table: number, the task's main columns, match, status and a clickable source.
  const header = [t("number", lang), ...fields.map((f) => (ru ? f.ru : f.en)), t("match", lang), t("status", lang), t("source", lang)]
    .map((text) => ({ text, bold: true, color: "#FFFFFF", fontSize: 7.5 }));
  const body: any[] = [header];
  payload.results.forEach((item, index) => {
    const status = statusInfo(item, lang);
    const url = safeUrl(item.url);
    body.push([
      { text: String(index + 1), alignment: "center", color: "#6B6458" },
      ...fields.map((f, i) => ({ text: compactText(i === 0 ? fieldValue(item, f.key) || resultName(item) : fieldValue(item, f.key) || "—", i === 0 ? 60 : 48), bold: i === 0 })),
      { text: percent(item.match) || "—", alignment: "center" },
      { text: status.label, color: PDF_TONE[status.tone].color, fillColor: PDF_TONE[status.tone].fill, bold: true, alignment: "center" },
      url ? { text: compactText(domainOf(item), 32), link: url, color: "#2563EB", decoration: "underline" } : { text: compactText(domainOf(item), 32) || "—" },
    ]);
  });
  if (!payload.results.length) {
    body.push([{ text: t("noResults", lang), colSpan: header.length, alignment: "center", italics: true, color: "#6B6458", margin: [0, 10, 0, 10] }, ...header.slice(1).map(() => "")]);
  }
  content.push(h2(t("results", lang), { margin: [0, 16, 0, 6] }));
  content.push({
    table: { headerRows: 1, dontBreakRows: true, widths: [16, ...fields.map((_f, i) => (i === 0 ? 120 : "*")), 52, 70, 96], body },
    layout: {
      fillColor: (row: number) => (row === 0 ? "#2B2B2B" : row % 2 === 0 ? "#FAF7F1" : null),
      hLineWidth: (i: number) => (i === 0 ? 0 : 0.4), vLineWidth: () => 0, hLineColor: () => "#E5E1D8",
      paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 4, paddingBottom: () => 4,
    },
    fontSize: 7.5,
  });

  // Details: every field, the quote from the page and the reason it fits.
  if (payload.results.length) {
    content.push(h2(t("details", lang), { pageBreak: "before", margin: [0, 0, 0, 8] }));
    const allFields = reportColumns(payload);
    payload.results.slice(0, PDF_DETAIL_LIMIT).forEach((item, index) => {
      const status = statusInfo(item, lang);
      const url = safeUrl(item.url);
      const facts = allFields
        .map((f) => ({ label: ru ? f.ru : f.en, value: fieldValue(item, f.key) }))
        .filter((f) => f.value && f.value !== resultName(item));
      const evidence = evidenceText(item, 700);
      content.push({
        unbreakable: true,
        margin: [0, 0, 0, 10],
        table: { widths: ["*"], body: [[{
          stack: [
            { columns: [
              { text: (index + 1) + ". " + compactText(resultName(item), 140), bold: true, fontSize: 10, width: "*" },
              { text: status.label + (percent(item.match) ? "  ·  " + percent(item.match) : ""), color: PDF_TONE[status.tone].color, bold: true, fontSize: 8, width: "auto" },
            ] },
            ...(facts.length ? [{ text: facts.map((f) => f.label + ": " + compactText(f.value, 200)).join("   ·   "), fontSize: 8, color: "#3E3A33", margin: [0, 3, 0, 0] }] : []),
            ...(evidence ? [{ text: [{ text: t("evidence", lang) + ": ", bold: true, color: "#6B6458" }, { text: "«" + evidence + "»", italics: true }], fontSize: 8, margin: [0, 4, 0, 0] }] : []),
            ...(url ? [{ text: t("link", lang) + ": " + compactText(url, 140), link: url, color: "#2563EB", fontSize: 7.5, margin: [0, 3, 0, 0] }] : []),
          ],
          margin: [8, 6, 8, 6],
        }]] },
        layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 2 : 0), vLineColor: () => PDF_TONE[status.tone].color },
      });
    });
    if (payload.results.length > PDF_DETAIL_LIMIT) {
      content.push({ text: ru ? "Подробности по остальным результатам — в XLSX." : "Details for the remaining results are in the XLSX.", italics: true, color: "#6B6458", fontSize: 8 });
    }
  }

  const registry = (payload.sourceRegistry || []).slice(0, 300);
  if (registry.length) {
    content.push(h2(t("sources", lang), { pageBreak: "before", margin: [0, 0, 0, 6] }));
    content.push({
      table: {
        headerRows: 1,
        widths: [150, 110, 90, "*"],
        body: [
          [t("source", lang), t("access", lang), t("category", lang), t("reason", lang)].map((text) => ({ text, bold: true, color: "#FFFFFF" })),
          ...registry.map((s) => {
            const url = safeUrl(s.url);
            const access = String(s.accessStatus ?? s.access_status ?? "");
            const tone: StatusTone = access === "checked" ? "ok" : access === "partial" || !access ? "review" : "fail";
            return [
              url ? { text: compactText(s.name || s.domain || url, 50), link: url, color: "#2563EB" } : compactText(s.name || s.domain || "—", 50),
              { text: accessLabel(access, lang), color: PDF_TONE[tone].color, bold: true },
              compactText(s.category || "—", 40),
              compactText(s.reason || "", 160),
            ];
          }),
        ],
      },
      layout: {
        fillColor: (row: number) => (row === 0 ? "#2B2B2B" : row % 2 === 0 ? "#FAF7F1" : null),
        hLineWidth: (i: number) => (i === 0 ? 0 : 0.4), vLineWidth: () => 0, hLineColor: () => "#E5E1D8",
      },
      fontSize: 7.5,
    });
  }

  content.push({ text: t("legend", lang), fontSize: 7, color: "#8A8275", margin: [0, 14, 0, 0] });

  const footerQuery = compactText(payload.query || "", 90);
  const docDefinition: any = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [28, 28, 28, 34],
    info: { title: "AURELIUS " + t("title", lang), subject: compactText(payload.query || "", 200), creator: "AURELIUS" },
    defaultStyle: { font: "Roboto", fontSize: 8, color: "#171717" },
    footer: function(page: number, count: number) {
      return {
        columns: [
          { text: "AURELIUS · " + footerQuery, color: "#8A8275" },
          { text: page + " / " + count, alignment: "right", color: "#8A8275", width: 60 },
        ],
        fontSize: 7, margin: [28, 10, 28, 0],
      };
    },
    content,
  };

  const doc = pdf.createPdf(docDefinition);
  return new Promise<Buffer>(function(resolve, reject) {
    try {
      doc.getBuffer(function(value: Uint8Array) { resolve(Buffer.from(value)); });
    } catch (error) {
      reject(error);
    }
  });
}
