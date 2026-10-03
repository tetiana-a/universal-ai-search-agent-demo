import type { ResearchExportPayload } from "@/lib/research-report";
import { compactText } from "@/lib/research-report";

const HEADERS = [
  "#","Result","Organization","Profile","Location","Area / Profile","Price / Round",
  "Match","Confidence","Status","Quality Gate","Source","Domain","URL",
  "Evidence","Evidence Quote","Why it matches","Retrieved At","Freshness (days)","Independent Verification",
];

function resultRow(item: any, index: number) {
  return [
    index + 1,
    item.title || "",
    item.organization || "",
    item.specialization || "",
    item.geography || item.location || "",
    item.area || "",
    item.price || item.ticket || "",
    item.match === undefined ? "" : Math.round(Number(item.match)),
    item.confidence === undefined ? "" : Math.round(Number(item.confidence)),
    item.status || "",
    item.qualityGate?.gate || "",
    item.source || "",
    item.sourceDomain || "",
    item.url || "",
    compactText(item.evidence, 700),
    compactText(item.evidenceQuote, 700),
    compactText(item.why, 500),
    item.retrievedAt || "",
    item.freshnessDays ?? "",
    item.independentVerification ? "Yes" : "No",
  ];
}

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

export function createCsvBuffer(payload: ResearchExportPayload) {
  const rows = [HEADERS, ...payload.results.map(function(item, index) { return resultRow(item, index); })];
  const csvEscape = function(value: unknown) {
    const text = typeof value === "number" ? String(value) : neutralizeFormula(value);
    return '"' + text.replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
  };
  return Buffer.from("\uFEFF" + rows.map(function(row) { return row.map(csvEscape).join(";"); }).join("\r\n"), "utf8");
}

export function createJsonBuffer(payload: ResearchExportPayload) {
  return Buffer.from(JSON.stringify(payload, null, 2), "utf8");
}

export async function createXlsxBuffer(payload: ResearchExportPayload) {
  const mod: any = await import("exceljs");
  const ExcelJS: any = mod.default || mod;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AURELIUS Universal AI Research Engine";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties = { title: "AURELIUS Research Report", subject: payload.query || "Research results" };

  const ws = workbook.addWorksheet("Results", { views: [{ state: "frozen", ySplit: 7 }] });
  ws.pageSetup.orientation = "landscape";
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.mergeCells("A1:T1");
  ws.getCell("A1").value = "AURELIUS • RESEARCH RESULTS";
  ws.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF242424" } };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  ws.mergeCells("A2:T2");
  ws.getCell("A2").value = "Query: " + (payload.query || "—");
  ws.getCell("A2").font = { bold: true, size: 11, color: { argb: "FF3E3A33" } };
  ws.getCell("A2").alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(2).height = 32;

  ws.mergeCells("A3:T3");
  ws.getCell("A3").value = "Generated: " + (payload.generatedAt || new Date().toISOString());
  ws.getCell("A3").font = { size: 10, color: { argb: "FF6B6458" } };

  let col = 1;
  for (const entry of Object.entries(payload.stats || {}).slice(0, 10)) {
    ws.getCell(4, col).value = entry[0];
    ws.getCell(4, col).font = { bold: true, size: 9, color: { argb: "FF6B6458" } };
    ws.getCell(5, col).value = cellValue(entry[1]) as any;
    ws.getCell(5, col).font = { bold: true, size: 11, color: { argb: "FF171717" } };
    col += 2;
    if (col > 19) break;
  }

  HEADERS.forEach(function(header, index) {
    const cell = ws.getCell(7, index + 1);
    cell.value = header;
    cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { top: { style: "thin", color: { argb: "FFD1D5DB" } }, bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });
  ws.getRow(7).height = 36;

  payload.results.forEach(function(item, index) {
    const row = ws.addRow(resultRow(item, index).map(cellValue));
    row.height = 64;
    row.eachCell(function(cell: any) {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.font = { size: 9, color: { argb: "FF262626" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
    });
    const gate = String(item.qualityGate?.gate || item.status || "REVIEW");
    const gateCell = row.getCell(11);
    gateCell.font = { bold: true, size: 9, color: { argb: gate === "PASS" ? "FF15803D" : gate === "FAIL" ? "FFDC2626" : "FFB45309" } };
    if (item.url && /^https?:\/\//i.test(String(item.url))) {
      row.getCell(14).value = { text: String(item.url), hyperlink: String(item.url) };
      row.getCell(14).font = { color: { argb: "FF2563EB" }, underline: true, size: 9 };
    }
  });

  [5,34,28,28,22,22,18,10,12,18,14,26,20,46,46,52,40,22,14,22].forEach(function(width, index) {
    ws.getColumn(index + 1).width = width;
  });
  ws.autoFilter = { from: "A7", to: "T" + Math.max(7, ws.rowCount) };
  // Zebra striping instead of an Excel "table": exceljs addTable() requires row data up
  // front and throws "Table must have row definitions" on pre-filled rows.
  for (let r = 8; r <= ws.rowCount; r += 1) {
    if (r % 2 === 0) {
      ws.getRow(r).eachCell(function(cell: any) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F3EC" } };
      });
    }
  }

  const summary = workbook.addWorksheet("Executive Summary");
  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 110;
  summary.addRow(["Field", "Value"]);
  summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
  summary.addRow(["Query", cellValue(payload.query || "")]);
  summary.addRow(["Generated", payload.generatedAt || new Date().toISOString()]);
  summary.addRow(["Search plan", cellValue(payload.searchPlan || "")]);
  summary.addRow(["Search summary", cellValue(payload.searchSummary || "")]);
  for (const entry of Object.entries(payload.stats || {})) summary.addRow([entry[0], cellValue(entry[1] ?? "—")]);
  for (const entry of Object.entries(payload.billing || {})) {
    summary.addRow(["billing." + entry[0], typeof entry[1] === "object" ? JSON.stringify(entry[1]) : String(entry[1] ?? "—")]);
  }
  summary.eachRow(function(row: any) { row.alignment = { vertical: "top", wrapText: true }; row.height = 30; });

  const source = workbook.addWorksheet("Source Registry");
  source.columns = [
    { header: "Source", key: "name", width: 36 }, { header: "Domain", key: "domain", width: 28 },
    { header: "Category", key: "category", width: 24 }, { header: "Access", key: "access", width: 20 },
    { header: "Method", key: "method", width: 24 }, { header: "Quality", key: "quality", width: 10 },
    { header: "Evidence", key: "evidence", width: 12 }, { header: "URL", key: "url", width: 65 },
    { header: "Reason", key: "reason", width: 70 },
  ];
  source.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  source.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
  for (const item of payload.sourceRegistry || []) {
    const row = source.addRow({
      name: cellValue(item.name || ""),
      domain: cellValue(item.domain || ""),
      category: cellValue(item.category || ""),
      access: cellValue(item.accessStatus ?? item.access_status ?? ""),
      method: cellValue(item.accessMethod ?? item.access_method ?? ""),
      quality: Number(item.quality ?? 0) || 0,
      evidence: (item.evidenceAvailable ?? item.evidence_available) ? "Yes" : "No",
      url: cellValue(item.url || ""),
      reason: cellValue(item.reason || ""),
    });
    row.alignment = { vertical: "top", wrapText: true };
    row.height = 42;
    if (item.url && /^https?:\/\//i.test(String(item.url))) {
      row.getCell(8).value = { text: String(item.url), hyperlink: String(item.url) };
      row.getCell(8).font = { color: { argb: "FF2563EB" }, underline: true, size: 9 };
    }
  }
  source.autoFilter = { from: "A1", to: "I" + Math.max(1, source.rowCount) };
  source.views = [{ state: "frozen", ySplit: 1 }];

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

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

  const summaryRows = Object.entries(payload.stats || {}).slice(0, 10).map(function(entry) {
    return [{ text: compactText(entry[0], 32), bold: true, color: "#4b463f" }, compactText(entry[1], 70)];
  });

  const resultBody: any[] = [[
    { text: "#", bold: true, color: "#FFFFFF" },
    { text: "Result", bold: true, color: "#FFFFFF" },
    { text: "Location", bold: true, color: "#FFFFFF" },
    { text: "Profile", bold: true, color: "#FFFFFF" },
    { text: "Match", bold: true, color: "#FFFFFF" },
    { text: "Confidence", bold: true, color: "#FFFFFF" },
    { text: "Gate", bold: true, color: "#FFFFFF" },
    { text: "Source", bold: true, color: "#FFFFFF" },
  ]];

  for (let i = 0; i < payload.results.length; i += 1) {
    const item = payload.results[i];
    resultBody.push([
      String(i + 1),
      compactText(item.organization || item.title || item.sourceDomain, 42),
      compactText(item.geography || item.location, 26),
      compactText(item.specialization || item.area, 30),
      item.match === undefined ? "—" : Math.round(Number(item.match)) + "%",
      item.confidence === undefined ? "—" : Math.round(Number(item.confidence)) + "%",
      compactText(item.qualityGate?.gate || item.status, 14),
      compactText(item.source || item.sourceDomain, 34),
    ]);
  }

  const content: any[] = [
    { text: "AURELIUS", color: "#B88A27", bold: true, fontSize: 10, characterSpacing: 2, margin: [0, 0, 0, 5] },
    { text: "Universal AI Research Report", fontSize: 22, bold: true, color: "#171717", margin: [0, 0, 0, 5] },
    { text: "Query: " + (payload.query || "—"), fontSize: 10, color: "#4B463F" },
    { text: "Generated: " + (payload.generatedAt || new Date().toISOString()), fontSize: 8, color: "#8A8275", margin: [0, 2, 0, 10] },
  ];

  if (summaryRows.length) {
    content.push({ text: "Run summary", fontSize: 13, bold: true, margin: [0, 4, 0, 5] });
    content.push({ table: { widths: [110, "*"], body: summaryRows }, layout: "lightHorizontalLines", margin: [0, 0, 0, 12] });
  }

  if (payload.searchSummary) {
    content.push({ text: "Research summary", fontSize: 13, bold: true, margin: [0, 4, 0, 5] });
    content.push({ text: compactText(payload.searchSummary, 1500), fontSize: 8.5, color: "#3E3A33", margin: [0, 0, 0, 12] });
  }

  content.push({ text: "Qualified results", fontSize: 13, bold: true, margin: [0, 4, 0, 5] });
  content.push({
    table: { headerRows: 1, widths: [18, 95, 72, 82, 42, 48, 44, "*"], body: resultBody },
    layout: {
      fillColor: function(row: number) { return row === 0 ? "#374151" : row % 2 === 0 ? "#F7F3EC" : null; },
      hLineColor: function() { return "#D1D5DB"; },
      vLineColor: function() { return "#D1D5DB"; },
      paddingLeft: function() { return 3; }, paddingRight: function() { return 3; }, paddingTop: function() { return 3; }, paddingBottom: function() { return 3; },
    },
    fontSize: 7.5,
  });

  content.push({ text: "Evidence details", pageBreak: "before", fontSize: 13, bold: true, margin: [0, 0, 0, 8] });
  for (let i = 0; i < payload.results.length; i += 1) {
    const item = payload.results[i];
    content.push({
      stack: [
        { text: (i + 1) + ". " + compactText(item.organization || item.title || item.sourceDomain, 120), bold: true, fontSize: 10, color: "#171717" },
        { text: "Location: " + compactText(item.geography || item.location, 160) + " · Match: " + (item.match === undefined ? "—" : Math.round(Number(item.match)) + "%") + " · Confidence: " + (item.confidence === undefined ? "—" : Math.round(Number(item.confidence)) + "%"), fontSize: 8, color: "#6B6458", margin: [0, 2, 0, 2] },
        { text: "Source: " + compactText(item.source || item.sourceDomain, 180), fontSize: 8 },
        { text: "URL: " + compactText(item.url, 220), fontSize: 8, color: "#2563EB" },
        { text: "Evidence: " + compactText(item.evidenceQuote || item.evidence, 700), fontSize: 8, color: "#3E3A33", margin: [0, 2, 0, 0] },
      ],
      margin: [0, 0, 0, 10],
    });
  }

  const docDefinition: any = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [22, 24, 22, 28],
    defaultStyle: { font: "Roboto", fontSize: 8, color: "#171717" },
    footer: function(page: number, count: number) {
      return { text: "AURELIUS • " + page + "/" + count, alignment: "right", fontSize: 7, color: "#8A8275", margin: [22, 6, 22, 0] };
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
