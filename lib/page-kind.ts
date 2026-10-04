import type { ResearchKind } from "@/lib/relevance-gate";

// What a found page is, as opposed to what it mentions. A search for land plots or
// investors returns many pages that are about the topic (a portal's category page,
// a blog article, a shop catalogue) but are not one plot or one investor. Those are
// still useful as sources, so they are kept, labelled, and ranked below real entities.

export type PageType = "entity" | "listing_index" | "article" | "catalog";

const ARTICLE_PATH = /\/(blog|news|novosti|article|articles|stati|statya|faq|wiki|journal|magazine|media|guide|guides|insights|post|posts|press)(\/|$|-)/iu;
const ARTICLE_TITLE = /(что такое|как (?:найти|выбрать|привлечь|купить|получить)|как работает|руководство|гид по|обзор|советы|топ[- ]?\d+|\d+ (?:лучших|способов|шагов|крупнейших|ведущих|главных|популярных|надежных|надёжных)|рейтинг|what is|how to|guide to|\btips\b|\btop[- ]?\d+|\d+ (?:best|top|leading|largest|biggest|major|popular)\b|\bbest (?:[\p{L}\d-]+ ){1,3}(?:in|for)\b|explained|\blist of\b)/iu;
const LISTING_PATH = /\/(search|category|categories|catalog|catalogue|katalog|listing|listings|tag|tags|filter|results|kupit|prodazha|for-sale|sale)(\/|$|\?|-)|[?&](page|sort|q|query)=/iu;
const LISTING_TEXT = /(найден[оa]?\s*(?:объект|объявлен|предложен)\p{L}*\s*:?\s*\d|\d[\d\s]*\s+(?:объявлен|предложен|объект)\p{L}*\s+(?:по запросу|найдено|в продаже)|\b\d[\d,.\s]*\s+(?:results|listings|properties|homes|plots)\s+(?:found|for sale|available)|сортир\p{L}+ по|sort by|показать ещ[её]|load more|все объявления|view all listings)/iu;
const LISTING_TITLE = /^(?:купить|продажа|снять|аренда|buy|sale of|for sale|properties for sale)(?=\s).*(?:участк|квартир|дом[аов]?(?![\p{L}])|вилл|недвижимост|апартамент|plots|land|houses|apartments|villas|properties)/iu;
// Portal result pages in the languages of the mapped countries ("2.971 Terrenos en venta",
// "Ordenar por", /venta-terrenos/madrid/). An item page usually carries a long numeric id.
const LOCAL_LISTING_TEXT = /(\d[\d.,\s]*\s+(?:terrenos|parcelas|solares|viviendas|pisos|casas|inmuebles|anuncios|propiedades|terreni|immobili|annunci|case|imóveis|imoveis|moradias|grundstücke|immobilien|anzeigen|terrains|annonces|biens|woningen|kavels|resultaten|results|listings|properties)\b|ordenar por|ordina per|ordenar resultados|sortieren nach|trier par|sorteer op)/iu;
const LOCAL_LISTING_PATH = /\/(venta-[\p{L}-]+|alquiler-[\p{L}-]+|comprar|vendita-[\p{L}-]+|affitto-[\p{L}-]+|comprare|kaufen|mieten|achat|vente|koop|te-koop|for-sale|en-venta|in-vendita|a-venda|terrenos|terreni|grundstuecke)(\/|$|\?)/iu;
const DIRECTORY_PATH = /\/(brands|brendy|manufacturers|proizvoditeli|companies|kompanii|directory|suppliers|postavshchiki|vendors)\/?(?:$|\?)/iu;
const DIRECTORY_TITLE = /^(?:бренды|производители|список|каталог|рейтинг|directory|list of|brands|manufacturers|suppliers)(?=\s|$)/iu;
const CATALOG = /(каталог|catalog(?:ue)?|интернет[- ]магазин|online store|shop now|в корзину|add to cart|купить в розницу)/iu;

// B2B platforms host both search/category pages (many suppliers) and one supplier's own
// shop (e.g. acme.en.made-in-china.com, acme.en.alibaba.com). Only the latter is a company.
const B2B_HOST = /(^|\.)(alibaba\.com|made-in-china\.com|globalsources\.com|1688\.com|dhgate\.com|tradekey\.com|ec21\.com|indiamart\.com|europages\.[a-z.]+|thomasnet\.com|kompass\.com)$/i;
const B2B_SUPPLIER_HOST = /^[a-z0-9-]+\.(en\.)?(alibaba|made-in-china)\.com$/i;
const B2B_LIST_PATH = /\/(showroom|trade\/search|countrysearch|products?-search|multi-search|tag_search\w*|hot-china-products|suppliers?|manufacturers?|factory|factories|wholesale|search|category|categories|catalog|premium|top-ranking|selected|products)(\/|$|-|_|\?|\.html)/i;

export function isB2bListing(url: string) {
  let u: URL;
  try { u = new URL(String(url)); } catch { return false; }
  const host = u.hostname.replace(/^www\./, "");
  if (!B2B_HOST.test(host)) return false;
  if (B2B_SUPPLIER_HOST.test(host) && !/^(www|m|s|offer|sale|insights|tradeshow|activity)\./i.test(host)) return false;
  return B2B_LIST_PATH.test(u.pathname + u.search) || u.pathname === "/" || u.searchParams.has("SearchText") || u.searchParams.has("keyword");
}

export function classifyPage(input: { url?: string; title?: string; text?: string }, kind: ResearchKind): PageType {
  const url = String(input.url || "");
  let path = url;
  try { const u = new URL(url); path = u.pathname + u.search; } catch { /* keep raw */ }
  const title = String(input.title || "");
  const text = String(input.text || "").slice(0, 4000);

  if (ARTICLE_PATH.test(path) || ARTICLE_TITLE.test(title)) return "article";
  if (isB2bListing(url)) return "listing_index";
  if (LISTING_TEXT.test(text) || LISTING_TITLE.test(title)) return "listing_index";
  const itemId = /\d{5,}/.test(path);
  if (!itemId && (LOCAL_LISTING_TEXT.test(title + " " + text.slice(0, 600)) || LOCAL_LISTING_PATH.test(path))) return "listing_index";
  if (DIRECTORY_PATH.test(path) || DIRECTORY_TITLE.test(title)) return "listing_index";
  if (kind !== "company" && LISTING_PATH.test(path)) return "listing_index";
  if (kind !== "company" && CATALOG.test(title + " " + text.slice(0, 600))) return "catalog";
  if (kind === "company" && /\/(catalog|catalogue|katalog|shop|store)(\/|$)/i.test(path) && CATALOG.test(text.slice(0, 1500))) return "catalog";
  return "entity";
}

export function pageTypeLabel(type: string, lang: "ru" | "en") {
  const labels: Record<string, [string, string]> = {
    listing_index: ["Подборка, не отдельный результат", "List page, not a single result"],
    article: ["Статья, не объект", "Article, not an entity"],
    catalog: ["Каталог / магазин", "Catalogue / shop"],
  };
  const label = labels[type];
  return label ? label[lang === "ru" ? 0 : 1] : "";
}

const STOP = new Set([
  "найди", "найти", "ищу", "нужны", "нужен", "нужна", "которые", "который", "для", "или", "and", "the", "with", "from", "find",
  "list", "компании", "компаний", "инвесторов", "инвесторы", "купить", "продажа", "земельный", "участок", "участки",
  "уточнения", "details", "investors", "companies", "search", "looking",
]);

function stem(word: string) {
  const w = word.toLowerCase();
  return w.length <= 5 ? w.slice(0, Math.max(3, w.length - 1)) : w.slice(0, Math.max(4, Math.min(6, w.length - 2)));
}

export function queryTerms(query: string) {
  const words = String(query || "").match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || [];
  return [...new Set(words.filter((w) => !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w)).map(stem))].slice(0, 14);
}

// Share of the query's meaningful terms that the page actually contains.
export function termCoverage(query: string, text: string) {
  const terms = queryTerms(query);
  if (!terms.length) return 0;
  const hay = String(text || "").toLowerCase();
  return terms.filter((t) => hay.includes(t)).length / terms.length;
}

// A place named in the query (a capitalised word: Мадрид, Амстердаме, Китае) that the
// page also mentions. Returned in the page's own spelling, so it is grounded in the page.
export function placeFromQuery(query: string, text: string) {
  // Whole capitalised words only, so acronyms such as SaaS or LED are not taken for places.
  const names = String(query || "").match(/(?<![\p{L}])\p{Lu}[\p{Ll}-]{2,}(?![\p{L}])/gu) || [];
  const pageWords = String(text || "").match(/(?<![\p{L}])\p{Lu}[\p{Ll}-]{2,}(?![\p{L}])/gu) || [];
  const found: string[] = [];
  for (const name of names) {
    if (STOP.has(name.toLowerCase()) || /^(Найди|Найти|Нужны|Ищу|Find|Список|List|Уточнения|Details)$/.test(name)) continue;
    const s = stem(name);
    const hit = pageWords.find((w) => w.toLowerCase().startsWith(s));
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found.slice(0, 2).join(", ");
}

const PROFILE_TERMS: Record<ResearchKind, RegExp> = {
  real_estate: /(земельн\p{L}+ участ\p{L}+|участ\p{L}+ под застройку|сельхоз\p{L}*|вилл\p{L}+|апартамент\p{L}+|квартир\p{L}+|таунхаус\p{L}*|коммерческ\p{L}+ недвижимост\p{L}+|building plot|urban land|rustic land|finca|solar|villa|apartment|townhouse|commercial property)/giu,
  investor: /(venture capital|венчурн\p{L}+ фонд\p{L}*|бизнес[- ]ангел\p{L}*|business angels?|family office|private equity|b2b|saas|fintech|proptech|healthtech|deep ?tech|ai\b|climate|marketplace\p{L}*|pre-seed|seed|series [a-c])/giu,
  company: /(manufacturer|производител\p{L}+|factory|завод\p{L}*|фабрик\p{L}+|supplier|поставщик\p{L}*|oem|odm|led\b|светодиодн\p{L}+(?: \p{L}+)?|lighting|освещени\p{L}+|wholesale|оптов\p{L}+|exporter|iso ?9001|ce\b|rohs)/giu,
  person: /(lawyer|юрист\p{L}*|адвокат\p{L}*|broker|брокер\p{L}*|agent|агент\p{L}*|consultant|консультант\p{L}*|developer|разработчик\p{L}*|architect|архитектор\p{L}*)/giu,
  general: /(?!)/g,
};

// Short profile from words the page uses for this kind of task (e.g. "B2B, SaaS, seed").
export function profileFromText(kind: ResearchKind, text: string) {
  const re = PROFILE_TERMS[kind];
  const seen = new Map<string, string>();
  for (const m of String(text || "").slice(0, 6000).matchAll(re)) {
    const key = m[0].toLowerCase();
    if (!seen.has(key)) seen.set(key, m[0]);
    if (seen.size >= 4) break;
  }
  return [...seen.values()].join(", ");
}

// Forums, video hosts, social feeds and encyclopedias: useful context, never a result
// when the task asks for concrete objects, companies, investors or people.
const NOISE_DOMAINS = /(^|\.)(reddit\.com|youtube\.com|youtu\.be|quora\.com|pinterest\.[a-z.]+|tiktok\.com|medium\.com|wikipedia\.org|zhihu\.com|vk\.com|ok\.ru|dzen\.ru|pikabu\.ru|twitter\.com|x\.com|facebook\.com|instagram\.com|threads\.net|tumblr\.com|scribd\.com|slideshare\.net|issuu\.com)$/i;

export function isNoiseSource(url: string, kind: ResearchKind) {
  if (kind === "general") return false;
  let host = "";
  let path = "";
  try { const u = new URL(String(url)); host = u.hostname.replace(/^www\./, ""); path = u.pathname; } catch { return false; }
  if (NOISE_DOMAINS.test(host)) return true;
  if (/(^|\.)linkedin\.com$/i.test(host) && /^\/(pulse|posts|feed)\//i.test(path)) return true;
  return false;
}
