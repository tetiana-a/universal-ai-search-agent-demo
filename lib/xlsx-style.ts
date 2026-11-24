// One house style for every Excel sheet AURELIUS produces (same palette as the research report):
// dark header with white bold text, wrapped text, thin borders, zebra rows, frozen header,
// filter on every column, print setup. Coloured status cells make the table readable at a glance.

const INK = "FF171717";
const HEADER = "FF2B2B2B";
const ZEBRA = "FFFAF7F1";
const LINE = { style: "thin", color: { argb: "FFE5E1D8" } };

// Text in a status cell → fill colour. Matched by substring, first hit wins.
const TONES: Array<[RegExp, string]> = [
  [/неактивн|запрещ|ошибк|отказ|отклон|отмен/i, "FFFDE2E1"],
  [/не проверено|не указано|через админа|ждёт|запланировано|написали|платно/i, "FFFFF4D6"],
  [/^активн|разрешен|опубликовано|отправлено|засчитано|бесплатно|профильное|^да(,|$)/i, "FFE3F4E8"],
];

export function styleSheet(ws: any, opts: { statusColumns?: string[]; title?: string } = {}) {
  const count = ws.columnCount;
  if (!count) return;
  const header = ws.getRow(1);
  header.height = 30;
  header.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
    cell.border = { top: LINE, left: LINE, bottom: LINE, right: LINE };
  });
  const status = new Set((opts.statusColumns || []).map((key) => ws.getColumn(key)?.number).filter(Boolean));
  ws.eachRow((row: any, n: number) => {
    if (n === 1) return;
    row.eachCell({ includeEmpty: true }, (cell: any, col: number) => {
      cell.font = cell.value && typeof cell.value === "object" && "hyperlink" in cell.value ? { color: { argb: "FF0A66C2" }, underline: true, size: 10 } : { color: { argb: INK }, size: 10 };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = { top: LINE, left: LINE, bottom: LINE, right: LINE };
      const tone = status.has(col) ? TONES.find(([re]) => re.test(String(cell.value ?? "")))?.[1] : undefined;
      if (tone || n % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone || ZEBRA } };
    });
  });
  ws.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: count } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  ws.headerFooter.oddFooter = "&L AURELIUS" + (opts.title ? " · " + opts.title : "") + "&R &P / &N";
}

// Readable Russian headers for raw records (the "everything" export).
const LABELS: Record<string, string> = {
  id: "ID", at: "Время", createdAt: "Создано", updatedAt: "Обновлено", foundAt: "Найдено", day: "День",
  name: "Название", title: "Заголовок", url: "Ссылка", platform: "Площадка", kind: "Тип", members: "Участники",
  ads: "Реклама по правилам", adminContact: "Контакт админа", country: "Страна", city: "Город", topic: "Тема",
  status: "Статус", price: "Цена", currency: "Валюта", notes: "Заметки", language: "Язык", relevance: "Релевантность",
  foundBy: "Найдено по запросу", activity: "Активность", lastPostAt: "Последний пост", postsPerWeek: "Постов в неделю",
  groupName: "Группа", groupId: "ID группы", mode: "Способ", text: "Текст", error: "Ошибка", link: "Ссылка на пост", by: "Кто",
  campaignTitle: "Кампания", campaignId: "ID кампании", adText: "Текст объявления", region: "Регион", keywords: "Ключевые слова",
  dailyTarget: "Цель в день", query: "Запрос", actor: "Кто", action: "Действие", detail: "Подробности",
};

export function headerLabel(key: string) {
  return LABELS[key] || key;
}

// Width from content: header length vs. the longest of the first 200 values, 10…60 characters.
export function fitWidth(header: string, values: unknown[]) {
  const longest = values.slice(0, 200).reduce<number>((m, v) => Math.max(m, String(v ?? "").length), 0);
  return Math.min(60, Math.max(10, header.length + 2, Math.min(longest, 60) + 2));
}
