"use client";

import type { Result } from "@/lib/data";

export type ExportContext = {
  query: string;
  searchPlan: string;
  summary?: string;
  generatedAt?: string;
  sourceUrls?: string[];
  stats?: Record<string, number>;
  queryUnderstanding?: any;
  searchBranches?: string[];
  sourceRegistry?: any[];
  accessEvents?: any[];
};

function escHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function filenameBase(query: string) {
  const safe = query
    .toLowerCase()
    .replace(/[^a-z0-9а-яёіїєґ]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return `aurelius-research-${safe || "results"}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rowsFor(results: Result[]) {
  return results.map((item) => [
    item.title,
    item.location,
    item.area,
    item.price,
    `${item.match}%`,
    item.status,
    item.qualityGate?.gate || "",
    item.source,
    item.url,
    item.evidence,
    item.why,
  ]);
}

const headers = [
  "Title",
  "Location",
  "Area / Profile",
  "Price / Round",
  "Match",
  "Status",
  "Quality Gate",
  "Source",
  "URL",
  "Evidence",
  "Why it matches",
];

export function exportCsv(results: Result[], ctx: ExportContext) {
  const escapeCell = (value: unknown) => {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  };

  const csv =
    "\uFEFF" +
    [headers.map(escapeCell).join(";"), ...rowsFor(results).map((row) => row.map(escapeCell).join(";"))].join("\r\n");

  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${filenameBase(ctx.query)}.csv`);
}

function columnLetter(index: number) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number) {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function concatBytes(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function zipStore(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);

    const localHeader = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(0x800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    local.push(localHeader);

    const centralHeader = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(0x800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    central.push(centralHeader);
    offset += localHeader.length;
  }

  const localBytes = concatBytes(local);
  const centralBytes = concatBytes(central);
  const end = concatBytes([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBytes.length),
    u32(localBytes.length),
    u16(0),
  ]);

  return concatBytes([localBytes, centralBytes, end]);
}

function makeSheetXml(headers: string[], rows: unknown[][], filterLastCol?: string) {
  const allRows = [headers, ...rows];
  const widths = headers.map((header) => Math.min(65, Math.max(14, Math.min(42, header.length + 8))));
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const sheetRows = allRows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          const ref = `${columnLetter(colIndex)}${rowIndex + 1}`;
          const style = rowIndex === 0 ? ' s="1"' : '';
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  const lastCol = filterLastCol || columnLetter(headers.length - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetViews><sheetView workbookViewId="0" showGridLines="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
    <cols>${cols}</cols>
    <sheetData>${sheetRows}</sheetData>
    <autoFilter ref="A1:${lastCol}${allRows.length}"/>
  </worksheet>`;
}

export function exportXlsx(results: Result[], ctx: ExportContext) {
  const resultRows = rowsFor(results);
  const sourceRows = (ctx.sourceRegistry || []).map((source: any) => [
    source.name, source.domain, source.category, source.accessStatus, source.accessMethod, source.evidenceAvailable ? "YES" : "NO", `${source.quality ?? 0}%`, source.reason, source.url,
  ]);
  const accessRows = (ctx.accessEvents || []).map((event: any) => [event.status, event.method, event.url, event.reason, event.fallback]);
  const statsRows = Object.entries(ctx.stats || {}).map(([key, value]) => [key, value]);
  const understandingRows = [
    ["Intent", ctx.queryUnderstanding?.intent || ""],
    ["Entity type", ctx.queryUnderstanding?.entityType || ""],
    ["Geography", Array.isArray(ctx.queryUnderstanding?.geography) ? ctx.queryUnderstanding.geography.join("; ") : ""],
    ["Languages", Array.isArray(ctx.queryUnderstanding?.languages) ? ctx.queryUnderstanding.languages.join("; ") : ""],
    ["Criteria", Array.isArray(ctx.queryUnderstanding?.criteria) ? ctx.queryUnderstanding.criteria.join("; ") : ""],
    ["Exclusions", Array.isArray(ctx.queryUnderstanding?.exclusions) ? ctx.queryUnderstanding.exclusions.join("; ") : ""],
    ["Required fields", Array.isArray(ctx.queryUnderstanding?.requiredFields) ? ctx.queryUnderstanding.requiredFields.join("; ") : ""],
    ["Source classes", Array.isArray(ctx.queryUnderstanding?.sourceClasses) ? ctx.queryUnderstanding.sourceClasses.join("; ") : ""],
  ];

  const workbookSheets = [
    { name: "Results", xml: makeSheetXml(headers, resultRows, "K") },
    { name: "Sources", xml: makeSheetXml(["Source","Domain","Category","Access","Method","Evidence","Quality","Reason","URL"], sourceRows, "I") },
    { name: "Run Summary", xml: makeSheetXml(["Metric","Value"], [["Generated at", ctx.generatedAt || new Date().toISOString()], ["Query", ctx.query], ["Summary", ctx.summary || ""], ["Search Plan", ctx.searchPlan || ""], ...statsRows, ...understandingRows], "B") },
    { name: "Search Branches", xml: makeSheetXml(["Branch"], (ctx.searchBranches || []).map((item) => [item]), "A") },
    { name: "Access Events", xml: makeSheetXml(["Status","Method","URL","Reason","Fallback"], accessRows, "E") },
  ];

  const sheetEntries = workbookSheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheets>${sheetEntries}</sheets>
  </workbook>`;

  const rels = workbookSheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${workbookSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const contentSheetOverrides = workbookSheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    ${contentSheetOverrides}
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  </Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
    <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
    <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
    <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/></cellXfs>
  </styleSheet>`;
  const coreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(ctx.query)}</dc:title><dc:creator>Aurelius Universal AI Search Agent</dc:creator></cp:coreProperties>`;
  const appProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Aurelius Universal AI Search Agent</Application><Sheets>${workbookSheets.length}</Sheets></Properties>`;

  const files = [
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rootRels },
    { name: "docProps/app.xml", content: appProps },
    { name: "docProps/core.xml", content: coreProps },
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
    { name: "xl/styles.xml", content: styles },
    ...workbookSheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheet.xml })),
  ];

  const bytes = zipStore(files);
  downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filenameBase(ctx.query)}.xlsx`);
}

function reportHtml(results: Result[], ctx: ExportContext) {
  const stats = ctx.stats
    ? Object.entries(ctx.stats)
        .map(([key, value]) => `<tr><td>${escHtml(key)}</td><td>${escHtml(value)}</td></tr>`)
        .join("")
    : "";
  const resultRows = rowsFor(results)
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escHtml(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  const sources = (ctx.sourceUrls || [])
    .map((url) => `<li><a href="${escHtml(url)}">${escHtml(url)}</a></li>`)
    .join("");
  const accessEvents = (ctx.accessEvents || [])
    .map((event: any) => `<tr><td>${escHtml(event.status)}</td><td>${escHtml(event.method)}</td><td>${escHtml(event.url)}</td><td>${escHtml(event.reason)}</td><td>${escHtml(event.fallback)}</td></tr>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Aurelius Research</title>
  <style>
    body{font-family:Arial,sans-serif;color:#161616;padding:32px;line-height:1.45}h1{margin:0 0 6px;font-size:26px}h2{margin-top:26px;font-size:16px}p{font-size:12px;color:#444}.meta{border:1px solid #ddd;padding:12px;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:10px;margin-top:12px}th{background:#162b26;color:#fff;text-align:left}th,td{border:1px solid #ddd;padding:7px;vertical-align:top}ul{font-size:11px}.muted{color:#666}@media print{body{padding:10px}}
  </style></head><body>
  <h1>AURELIUS — Universal AI Research Report</h1>
  <p class="muted">Generated ${escHtml(ctx.generatedAt || new Date().toISOString())}</p>
  <div class="meta"><strong>Query</strong><br>${escHtml(ctx.query)}<br><br><strong>Search Plan</strong><br>${escHtml(ctx.searchPlan || "—")}<br><br><strong>Summary</strong><br>${escHtml(ctx.summary || "—")}</div>
  <h2>Run statistics</h2><table><tbody>${stats}</tbody></table>
  <h2>Qualified results (${results.length})</h2><table><thead><tr>${headers.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr></thead><tbody>${resultRows}</tbody></table>
  <h2>Sources</h2><ul>${sources || "<li>No sources captured</li>"}</ul>
  <h2>Access events</h2><table><thead><tr><th>Status</th><th>Method</th><th>URL</th><th>Reason</th><th>Fallback</th></tr></thead><tbody>${accessEvents || "<tr><td colspan=\"5\">No access events</td></tr>"}</tbody></table>
  </body></html>`;
}

export function exportDoc(results: Result[], ctx: ExportContext) {
  downloadBlob(
    new Blob([reportHtml(results, ctx)], { type: "application/msword;charset=utf-8" }),
    `${filenameBase(ctx.query)}.doc`,
  );
}

export function exportJson(results: Result[], ctx: ExportContext) {
  const payload = {
    generatedAt: ctx.generatedAt || new Date().toISOString(),
    query: ctx.query,
    searchPlan: ctx.searchPlan,
    summary: ctx.summary || "",
    stats: ctx.stats || {},
    sourceUrls: ctx.sourceUrls || [],
    results,
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }),
    `${filenameBase(ctx.query)}.json`,
  );
}

export function printPdf(results: Result[], ctx: ExportContext) {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=1280,height=900");
  if (!popup) return;
  popup.document.open();
  popup.document.write(reportHtml(results, ctx));
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 350);
}
