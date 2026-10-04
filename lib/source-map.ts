import { inferResearchKind, type ResearchKind } from "@/lib/relevance-gate";

// Stage 2 of the spec: before searching for results, map where they can be found.
// The map has classes of sources for the task type (portals, agencies, auctions,
// banks, directories, communities…), known sources for the country, and search
// branches that cover every class, in English and in the country's language.

export type SourceAccess = "open" | "search_only" | "auth_required" | "not_automatable";

export type MappedSource = {
  name: string;
  domain: string;
  url: string;
  classId: string;
  access: SourceAccess;
  note?: string;
};

export type SourceClass = { id: string; ru: string; en: string };

export type SourceMap = {
  kind: ResearchKind;
  country: string | null;
  place: string;
  subject: string;
  classes: SourceClass[];
  sources: MappedSource[];
  branches: Array<{ classId: string; query: string }>;
};

type Country = { id: string; names: RegExp; lang: string; en: string };

const COUNTRIES: Country[] = [
  { id: "es", names: /(испани|spain|españa|madrid|мадрид|barcelona|барселон|valencia|валенси|malaga|малаг|marbella|марбель|alicante|аликанте|ibiza|ибица|mallorca|майорк|costa)/i, lang: "es", en: "Spain" },
  { id: "it", names: /(итали|italy|italia|rome|roma|milan|милан|tuscany|тоскан|florence|флоренци|sicily|сицили|napoli|неапол)/i, lang: "it", en: "Italy" },
  { id: "pt", names: /(португали|portugal|lisbon|лиссабон|lisboa|porto|порту|algarve|алгарв|madeira|мадейр)/i, lang: "pt", en: "Portugal" },
  { id: "nl", names: /(нидерланд|голланди|netherlands|holland|amsterdam|амстердам|rotterdam|роттердам|utrecht|утрехт|hague|гаага|eindhoven|эйндховен)/i, lang: "nl", en: "Netherlands" },
  { id: "cn", names: /(кита|china|chinese|shenzhen|шэньчжэн|шеньчжень|guangzhou|гуанчжоу|shanghai|шанха|beijing|пекин|yiwu|ningbo|нинбо)/i, lang: "zh", en: "China" },
  { id: "cy", names: /(кипр|cyprus|limassol|лимасол|paphos|пафос|larnaca|ларнак|nicosia|никоси)/i, lang: "el", en: "Cyprus" },
  { id: "ae", names: /(оаэ|эмират|uae|emirates|dubai|дубай|abu dhabi|абу.даби)/i, lang: "en", en: "UAE" },
  { id: "id", names: /(бали|bali|индонези|indonesia|jakarta|джакарт|ubud|убуд|canggu|чангу)/i, lang: "id", en: "Indonesia" },
  { id: "de", names: /(германи|germany|deutschland|berlin|берлин|munich|мюнхен|hamburg|гамбург|frankfurt|франкфурт)/i, lang: "de", en: "Germany" },
  { id: "fr", names: /(франци|france|paris|париж|nice|ницц|lyon|лион|marseille|марсел)/i, lang: "fr", en: "France" },
  { id: "gb", names: /(великобритани|англи|united kingdom|\buk\b|england|london|лондон|manchester|манчестер)/i, lang: "en", en: "United Kingdom" },
  { id: "cz", names: /(чехи|czech|česko|prague|прага|praha|brno|брно)/i, lang: "cs", en: "Czechia" },
  { id: "us", names: /(сша|usa|united states|new york|нью.йорк|miami|майами|california|калифорни|texas|техас)/i, lang: "en", en: "USA" },
];

const CITIES: Array<[RegExp, string]> = [
  [/мадрид|madrid/i, "Madrid"], [/барселон|barcelona/i, "Barcelona"], [/валенси|valencia/i, "Valencia"], [/малаг|málaga|malaga/i, "Málaga"],
  [/марбель|marbella/i, "Marbella"], [/аликанте|alicante/i, "Alicante"], [/милан|milan/i, "Milano"], [/флоренци|florence|firenze/i, "Firenze"],
  [/лиссабон|lisbon|lisboa/i, "Lisboa"], [/амстердам|amsterdam/i, "Amsterdam"], [/роттердам|rotterdam/i, "Rotterdam"], [/утрехт|utrecht/i, "Utrecht"],
  [/шэньчжэн|шеньчжень|shenzhen/i, "Shenzhen"], [/гуанчжоу|guangzhou/i, "Guangzhou"], [/шанха|shanghai/i, "Shanghai"], [/пекин|beijing/i, "Beijing"],
  [/лимасол|limassol/i, "Limassol"], [/пафос|paphos/i, "Paphos"], [/ларнак|larnaca/i, "Larnaca"], [/дубай|dubai/i, "Dubai"], [/бали|bali/i, "Bali"],
  [/берлин|berlin/i, "Berlin"], [/мюнхен|munich|münchen/i, "München"], [/париж|paris/i, "Paris"], [/ницц|nice\b/i, "Nice"], [/лондон|london/i, "London"],
  [/прага|praha|prague/i, "Praha"], [/нью.йорк|new york/i, "New York"], [/майами|miami/i, "Miami"],
];

// Object words in the country's language, so portal searches use the portal's own terms.
const OBJECT_LOCAL: Array<[RegExp, Record<string, string>]> = [
  [/земел|участ|land|plot|terreno|parcela/i, { es: "terreno", it: "terreno", pt: "terreno", fr: "terrain", de: "Grundstück", nl: "bouwgrond", cs: "pozemek", en: "land plot" }],
  [/квартир|апартамент|apartment|flat/i, { es: "piso", it: "appartamento", pt: "apartamento", fr: "appartement", de: "Wohnung", nl: "appartement", cs: "byt", en: "apartment" }],
  [/вилл|villa/i, { es: "villa", it: "villa", pt: "moradia", fr: "villa", de: "Villa", nl: "villa", cs: "vila", en: "villa" }],
  [/дом|house|home/i, { es: "casa", it: "casa", pt: "moradia", fr: "maison", de: "Haus", nl: "huis", cs: "dům", en: "house" }],
  [/коммерческ|commercial|офис|office|склад|warehouse/i, { es: "local comercial", it: "immobile commerciale", pt: "imóvel comercial", fr: "local commercial", de: "Gewerbeimmobilie", nl: "bedrijfspand", cs: "komerční prostor", en: "commercial property" }],
];

const SALE: Record<string, string> = { es: "en venta", it: "in vendita", pt: "à venda", fr: "à vendre", de: "kaufen", nl: "te koop", cs: "na prodej", el: "for sale", id: "dijual", zh: "for sale", en: "for sale" };

export function cityOf(text: string) {
  return CITIES.find(([re]) => re.test(text))?.[1] || "";
}

export function detectCountry(text: string): Country | null {
  return COUNTRIES.find((c) => c.names.test(text)) || null;
}

const CLASSES: Record<ResearchKind, SourceClass[]> = {
  real_estate: [
    { id: "portals", ru: "Порталы недвижимости", en: "Property portals" },
    { id: "agencies", ru: "Агентства и брокеры", en: "Agencies and brokers" },
    { id: "banks", ru: "Банковские и залоговые объекты", en: "Bank-owned property" },
    { id: "auctions", ru: "Аукционы и торги", en: "Auctions" },
    { id: "classifieds", ru: "Доски объявлений", en: "Classifieds" },
    { id: "official", ru: "Государственные и открытые базы", en: "Official registries" },
    { id: "communities", ru: "Соцсети, группы, форумы", en: "Social groups and forums" },
  ],
  investor: [
    { id: "vc", ru: "Венчурные фонды", en: "VC funds" },
    { id: "angels", ru: "Бизнес-ангелы и клубы", en: "Angel networks" },
    { id: "family_offices", ru: "Family offices", en: "Family offices" },
    { id: "accelerators", ru: "Акселераторы", en: "Accelerators" },
    { id: "directories", ru: "Профессиональные каталоги", en: "Investor directories" },
    { id: "events", ru: "Конференции и мероприятия", en: "Conferences and events" },
    { id: "communities", ru: "Профессиональные сети и сообщества", en: "Networks and communities" },
  ],
  company: [
    { id: "b2b", ru: "B2B-площадки", en: "B2B marketplaces" },
    { id: "manufacturers", ru: "Сайты производителей", en: "Manufacturer websites" },
    { id: "directories", ru: "Отраслевые каталоги", en: "Industry directories" },
    { id: "fairs", ru: "Выставки", en: "Trade fairs" },
    { id: "associations", ru: "Отраслевые ассоциации", en: "Trade associations" },
    { id: "registries", ru: "Реестры компаний", en: "Company registries" },
    { id: "communities", ru: "Соцсети и сообщества", en: "Social and communities" },
  ],
  person: [
    { id: "profiles", ru: "Профессиональные профили", en: "Professional profiles" },
    { id: "associations", ru: "Профессиональные ассоциации и коллегии", en: "Professional bodies" },
    { id: "directories", ru: "Каталоги специалистов", en: "Specialist directories" },
    { id: "firms", ru: "Сайты компаний и бюро", en: "Firms" },
    { id: "communities", ru: "Сообщества и мероприятия", en: "Communities and events" },
  ],
  general: [
    { id: "web", ru: "Сайты по теме", en: "Topic websites" },
    { id: "directories", ru: "Каталоги и базы", en: "Directories and databases" },
    { id: "official", ru: "Официальные источники", en: "Official sources" },
    { id: "news", ru: "Новости и анонсы", en: "News and announcements" },
    { id: "communities", ru: "Сообщества и мероприятия", en: "Communities and events" },
  ],
};

type Seed = [name: string, domain: string, classId: string, access?: SourceAccess];

const SOCIAL: Seed[] = [
  ["Facebook (публичные группы)", "facebook.com", "communities", "not_automatable"],
  ["Telegram (публичные каналы)", "t.me", "communities", "search_only"],
  ["LinkedIn", "linkedin.com", "communities", "auth_required"],
  ["Instagram", "instagram.com", "communities", "auth_required"],
  ["Reddit", "reddit.com", "communities", "search_only"],
];

const REAL_ESTATE: Record<string, Seed[]> = {
  es: [
    ["Idealista", "idealista.com", "portals"], ["Fotocasa", "fotocasa.es", "portals"], ["Pisos.com", "pisos.com", "portals"],
    ["Habitaclia", "habitaclia.com", "portals"], ["Kyero", "kyero.com", "portals"], ["Milanuncios", "milanuncios.com", "classifieds"],
    ["Portal de Subastas BOE", "subastas.boe.es", "auctions"], ["Haya Real Estate", "haya.es", "banks"], ["Solvia", "solvia.es", "banks"],
    ["Servihabitat", "servihabitat.com", "banks"], ["Aliseda", "alisedainmobiliaria.com", "banks"], ["Engel & Völkers España", "engelvoelkers.com", "agencies"],
  ],
  it: [
    ["Immobiliare.it", "immobiliare.it", "portals"], ["Idealista Italia", "idealista.it", "portals"], ["Casa.it", "casa.it", "portals"],
    ["Subito", "subito.it", "classifieds"], ["Aste Giudiziarie", "astegiudiziarie.it", "auctions"], ["Astalegale", "astalegale.net", "auctions"],
    ["Tecnocasa", "tecnocasa.it", "agencies"], ["Gate-away", "gate-away.com", "portals"],
  ],
  pt: [
    ["Idealista Portugal", "idealista.pt", "portals"], ["Imovirtual", "imovirtual.com", "portals"], ["Casa Sapo", "casa.sapo.pt", "portals"],
    ["e-leilões", "e-leiloes.pt", "auctions"], ["OLX Portugal", "olx.pt", "classifieds"],
  ],
  cy: [["Bazaraki", "bazaraki.com", "classifieds"], ["BuySell Cyprus", "buysellcyprus.com", "portals"], ["Home.cy", "home.cy", "portals"]],
  ae: [["Property Finder", "propertyfinder.ae", "portals"], ["Bayut", "bayut.com", "portals"], ["Dubizzle", "dubizzle.com", "classifieds"], ["Dubai Land Department", "dubailand.gov.ae", "official"]],
  id: [["Rumah123", "rumah123.com", "portals"], ["Lamudi", "lamudi.co.id", "portals"], ["Dot Property", "dotproperty.id", "portals"]],
  de: [["ImmoScout24", "immobilienscout24.de", "portals"], ["Immowelt", "immowelt.de", "portals"], ["Kleinanzeigen", "kleinanzeigen.de", "classifieds"], ["Zwangsversteigerung.de", "zvg-portal.de", "auctions"]],
  fr: [["SeLoger", "seloger.com", "portals"], ["Leboncoin", "leboncoin.fr", "classifieds"], ["Bien'ici", "bienici.com", "portals"], ["Licitor", "licitor.com", "auctions"]],
  gb: [["Rightmove", "rightmove.co.uk", "portals"], ["Zoopla", "zoopla.co.uk", "portals"], ["OnTheMarket", "onthemarket.com", "portals"]],
  nl: [["Funda", "funda.nl", "portals"], ["Pararius", "pararius.nl", "portals"]],
  cz: [["Sreality", "sreality.cz", "portals"], ["Bezrealitky", "bezrealitky.cz", "portals"]],
  us: [["Zillow", "zillow.com", "portals"], ["Realtor.com", "realtor.com", "portals"], ["LandWatch", "landwatch.com", "portals"]],
};

const INVESTOR_GLOBAL: Seed[] = [
  ["Crunchbase", "crunchbase.com", "directories", "auth_required"], ["Dealroom", "dealroom.co", "directories", "search_only"],
  ["EBAN (European Business Angels Network)", "eban.org", "angels"], ["F6S", "f6s.com", "accelerators"],
  ["Signal by NFX", "signal.nfx.com", "directories", "search_only"], ["AngelList", "angel.co", "angels", "auth_required"],
];
const INVESTOR: Record<string, Seed[]> = {
  nl: [["NVP (Dutch VC association)", "nvp.nl", "directories"], ["Techleap", "techleap.nl", "directories"], ["StartupAmsterdam", "startupamsterdam.com", "communities"], ["Rockstart", "rockstart.com", "accelerators"]],
  es: [["SpainCap (ASCRI)", "spaincap.org", "directories"], ["AEBAN", "aeban.es", "angels"], ["Lanzadera", "lanzadera.es", "accelerators"], ["South Summit", "southsummit.io", "events"]],
  de: [["BVK", "bvkap.de", "directories"], ["Business Angels Netzwerk Deutschland", "business-angels.de", "angels"]],
  fr: [["France Invest", "franceinvest.eu", "directories"], ["France Angels", "franceangels.org", "angels"]],
  gb: [["BVCA", "bvca.co.uk", "directories"], ["UK Business Angels Association", "ukbaa.org.uk", "angels"]],
  pt: [["Portugal Ventures", "portugalventures.pt", "vc"], ["Web Summit", "websummit.com", "events"]],
  cy: [["Cyprus Seeds", "cyprusseeds.com", "accelerators"], ["Invest Cyprus", "investcyprus.org.cy", "directories"]],
};

const COMPANY_GLOBAL: Seed[] = [["Europages", "europages.com", "directories"], ["Kompass", "kompass.com", "directories", "search_only"]];
const COMPANY: Record<string, Seed[]> = {
  cn: [
    ["Alibaba.com", "alibaba.com", "b2b"], ["Made-in-China.com", "made-in-china.com", "b2b"], ["Global Sources", "globalsources.com", "b2b"],
    ["1688.com", "1688.com", "b2b", "search_only"], ["HKTDC", "hktdc.com", "directories"], ["Canton Fair", "cantonfair.org.cn", "fairs"],
  ],
  de: [["WLW (Wer liefert was)", "wlw.de", "directories"]],
  us: [["ThomasNet", "thomasnet.com", "directories"]],
  es: [["Empresite", "empresite.eleconomista.es", "registries"]],
  it: [["Kompass Italia", "it.kompass.com", "directories", "search_only"]],
};

const PERSON: Record<string, Seed[]> = {
  es: [["Consejo General de la Abogacía", "abogacia.es", "associations"]],
  de: [["XING", "xing.com", "profiles", "auth_required"]],
};

// Terms in the country's language for the object the user is looking for.
const LOCAL_TERMS: Record<string, Partial<Record<ResearchKind, string[]>>> = {
  es: { real_estate: ["terreno en venta", "parcela urbana venta", "solar edificable"], investor: ["inversores", "business angels", "fondos de capital riesgo"], company: ["fabricante", "proveedor"], person: ["abogado", "especialista"] },
  it: { real_estate: ["terreno in vendita", "terreno edificabile", "appartamento in vendita"], investor: ["investitori", "business angel", "fondi venture capital"], company: ["produttore", "fornitore"] },
  pt: { real_estate: ["terreno à venda", "lote para construção", "moradia à venda"], investor: ["investidores", "business angels"], company: ["fabricante", "fornecedor"] },
  nl: { real_estate: ["bouwgrond te koop", "huis te koop"], investor: ["investeerders", "durfkapitaal", "informal investors"], company: ["fabrikant", "leverancier"] },
  de: { real_estate: ["Grundstück kaufen", "Baugrundstück"], investor: ["Investoren", "Business Angels", "Risikokapital"], company: ["Hersteller", "Lieferant"] },
  fr: { real_estate: ["terrain à vendre", "terrain constructible"], investor: ["investisseurs", "business angels"], company: ["fabricant", "fournisseur"] },
  zh: { company: ["manufacturer factory", "供应商", "生产厂家"] },
  cs: { real_estate: ["pozemek na prodej", "byt na prodej"], investor: ["investoři"], company: ["výrobce"] },
};

// Without an AI key the task cannot be translated, so common product and trade words are
// mapped to English by a small table: B2B platforms and factory sites are in English.
const PRODUCT_EN: Array<[RegExp, string]> = [
  [/светодиод\p{L}*|\bled\b/iu, "LED"], [/светильник\p{L}*|освещени\p{L}*/iu, "lighting"], [/ламп\p{L}*/iu, "lamps"],
  [/мебел\p{L}*/iu, "furniture"], [/одежд\p{L}*/iu, "clothing"], [/обув\p{L}*/iu, "footwear"], [/текстил\p{L}*|ткан\p{L}*/iu, "textile"],
  [/упаковк\p{L}*/iu, "packaging"], [/электроник\p{L}*/iu, "electronics"], [/косметик\p{L}*/iu, "cosmetics"], [/игрушк\p{L}*/iu, "toys"],
  [/солнечн\p{L}* панел\p{L}*/iu, "solar panels"], [/аккумулятор\p{L}*|батаре\p{L}*/iu, "batteries"], [/кабел\p{L}*/iu, "cables"],
  [/станк\p{L}*|оборудовани\p{L}*/iu, "machinery"], [/запчаст\p{L}*/iu, "spare parts"], [/пластик\p{L}*/iu, "plastic products"],
  [/стекл\p{L}*/iu, "glass"], [/металл\p{L}*/iu, "metal products"], [/плитк\p{L}*/iu, "tiles"], [/сантехник\p{L}*/iu, "sanitary ware"],
  [/дрон\p{L}*|беспилотник\p{L}*/iu, "drones"], [/велосипед\p{L}*/iu, "bicycles"], [/электромобил\p{L}*/iu, "electric vehicles"],
];
const TRADE_EN: Array<[RegExp, string]> = [
  [/производител\p{L}*|завод\p{L}*|фабрик\p{L}*/iu, "manufacturers"], [/поставщик\p{L}*/iu, "suppliers"], [/дистрибьютор\p{L}*|дистрибутор\p{L}*/iu, "distributors"],
];

export function roughEnglish(query: string, kind: ResearchKind, where: string) {
  const text = String(query || "").split("\n")[0];
  if (!/[^\x00-\x7F]/.test(text)) return "";
  const product = PRODUCT_EN.filter(([re]) => re.test(text)).map(([, en]) => en);
  if (!product.length) return "";
  const trade = TRADE_EN.filter(([re]) => re.test(text)).map(([, en]) => en);
  const tail = trade.length ? trade : kind === "company" ? ["manufacturers"] : [];
  return [...new Set([...product, ...tail])].join(" ") + (where ? " " + where : "");
}

const OBJECT = /(земельн\p{L}* участ\p{L}*|участ\p{L}*|земл\p{L}*|квартир\p{L}*|апартамент\p{L}*|дом\p{L}*|вилл\p{L}*|коммерческ\p{L}* недвижимост\p{L}*|land|plot|apartment|flat|house|villa|commercial property)/iu;

const FILLER = /^(найди|найти|ищу|нужн\p{L}*|подбери|покажи|find|search|look for|i need|please)\s+/iu;

function subjectOf(query: string) {
  const firstLine = String(query || "").split("\n")[0];
  return firstLine.replace(FILLER, "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function placeOf(query: string, country: Country | null) {
  const names = String(query || "").match(/(?<![\p{L}])\p{Lu}[\p{Ll}-]{2,}(?![\p{L}])/gu) || [];
  const skip = /^(Найди|Найти|Нужны|Нужен|Ищу|Find|Список|List|Уточнения|Details|Подбери)$/;
  const place = names.find((n) => !skip.test(n) && (country ? country.names.test(n) : true));
  return place || country?.en || "";
}

function toSources(seeds: Seed[]): MappedSource[] {
  return seeds.map(([name, domain, classId, access]) => ({ name, domain, url: "https://" + domain, classId, access: access || "open" }));
}

// hints.subjectEn: the task in English (from the AI, when one is configured), so English
// templates and portal searches do not carry Russian words.
// Portals whose item pages share a path prefix: a site: search on it returns single
// offers instead of result lists.
const ITEM_PATHS: Record<string, string> = {
  "idealista.com": "idealista.com/inmueble",
  "idealista.it": "idealista.it/immobile",
  "idealista.pt": "idealista.pt/imovel",
  "immobiliare.it": "immobiliare.it/annunci",
};
// Manufacturing hubs: factory sites name the city, not just the country.
const CHINA_HUBS = "Shenzhen OR Guangdong OR Zhongshan OR Ningbo";

export function buildSourceMap(query: string, hints: { subjectEn?: string } = {}): SourceMap {
  const kind = inferResearchKind(query);
  const country = detectCountry(query);
  const original = subjectOf(query);
  const place = cityOf(query) || country?.en || placeOf(query, country);
  const subject = String(hints.subjectEn || "").trim().slice(0, 160) || roughEnglish(query, kind, cityOf(query) || country?.en || "") || original;
  const c = country?.id || "";

  const seeds: Seed[] = [];
  if (kind === "real_estate") seeds.push(...(REAL_ESTATE[c] || []));
  if (kind === "investor") seeds.push(...(INVESTOR[c] || []), ...INVESTOR_GLOBAL);
  if (kind === "company") seeds.push(...(COMPANY[c] || []), ...COMPANY_GLOBAL);
  if (kind === "person") seeds.push(...(PERSON[c] || []), ["LinkedIn", "linkedin.com", "profiles", "auth_required"]);
  seeds.push(...SOCIAL);
  const seen = new Set<string>();
  const sources = toSources(seeds).filter((s) => (seen.has(s.domain) ? false : (seen.add(s.domain), true)));

  const objectLocal = OBJECT_LOCAL.find(([re]) => re.test(original));
  const objectWord = objectLocal ? objectLocal[1][country?.lang || "en"] || objectLocal[1].en : (subject.match(OBJECT)?.[0] || "").toLowerCase();
  const local = (country && LOCAL_TERMS[country.lang]?.[kind]) || [];
  const where = place || country?.en || "";
  const branches: Array<{ classId: string; query: string }> = [{ classId: "web", query: original }];
  if (subject !== original) branches.push({ classId: "web", query: subject });

  if (kind === "real_estate") {
    const sale = SALE[country?.lang || "en"] || SALE.en;
    const itemTerm = objectWord || local[0] || "property";
    for (const source of sources.filter((x) => ITEM_PATHS[x.domain]).slice(0, 2)) {
      branches.push({ classId: "portals", query: `site:${ITEM_PATHS[source.domain]} ${itemTerm} ${where}`.trim() });
    }
    branches.push(
      { classId: "portals", query: `${itemTerm} ${sale} ${where}`.trim() },
      ...(objectLocal ? [] : local.slice(1, 2)).map((term) => ({ classId: "portals", query: `${term} ${where}`.trim() })),
      { classId: "agencies", query: `real estate agency ${where} ${objectWord || ""}`.trim() },
      { classId: "banks", query: `bank owned ${objectWord || "property"} ${where} for sale`.trim() },
      { classId: "auctions", query: `${objectWord || "property"} auction ${where}`.trim() },
    );
  } else if (kind === "investor") {
    branches.push(
      { classId: "vc", query: `venture capital fund ${where}`.trim() },
      { classId: "angels", query: `business angels network ${where}`.trim() },
      { classId: "family_offices", query: `family office ${where} direct investments`.trim() },
      { classId: "accelerators", query: `startup accelerator ${where}`.trim() },
      ...local.slice(0, 1).map((term) => ({ classId: "directories", query: `${term} ${where}`.trim() })),
      { classId: "events", query: `investor conference ${where} 2026`.trim() },
    );
  } else if (kind === "company") {
    // Manufacturers are found on B2B platforms and on their own sites, not in blogs:
    // B2B supplier searches go first, then factory sites ("Co., Ltd", OEM).
    const product = subject.replace(/\b(manufacturers?|suppliers?|factory|factories|distributors?)\b/gi, "").replace(new RegExp("\\b" + (where || "#none#") + "\\b", "i"), "").replace(/\s+/g, " ").trim() || subject;
    for (const source of sources.filter((s) => s.classId === "b2b" && s.access === "open").slice(0, 3)) {
      branches.push({ classId: "b2b", query: `site:${source.domain} ${product} manufacturer` });
    }
    if (c === "cn" || /china/i.test(where)) {
      branches.push({ classId: "manufacturers", query: `${product} factory ${CHINA_HUBS} "Co., Ltd"` });
    }
    branches.push(
      { classId: "manufacturers", query: `${product} manufacturer factory ${where} "Co., Ltd"`.replace(/\s+/g, " ").trim() },
      ...local.slice(0, 1).map((term) => ({ classId: "manufacturers", query: `${product} ${term}`.trim() })),
      { classId: "manufacturers", query: `${product} OEM ODM factory ${where}`.trim() },
      { classId: "directories", query: `${product} suppliers directory ${where}`.trim() },
      { classId: "fairs", query: `${product} trade fair exhibitors list`.trim() },
    );
  } else if (kind === "person") {
    branches.push(
      ...local.slice(0, 1).map((term) => ({ classId: "profiles", query: `${term} ${where}`.trim() })),
      { classId: "associations", query: `${subject} professional association ${where} directory`.trim() },
      { classId: "firms", query: `${subject} firm ${where} contact`.trim() },
    );
  } else {
    branches.push(
      { classId: "directories", query: `${subject} directory list` },
      { classId: "official", query: `${subject} official` },
      { classId: "communities", query: `${subject} community events` },
    );
  }

  // Search inside known open portals through the search engine (site: queries).
  const searchable = sources.filter((s) => s.access === "open" || s.access === "search_only").filter((s) => s.classId !== "communities");
  for (const source of searchable.filter((s) => kind !== "company" || s.classId !== "b2b").slice(0, 6)) {
    branches.push({ classId: source.classId, query: `site:${source.domain} ${kind === "real_estate" ? objectWord || subject : subject} ${kind === "real_estate" || !subject.includes(where) ? where : ""}`.replace(/\s+/g, " ").trim() });
  }
  // Forums and channels are leads for people and open questions, not for objects or companies.
  if (kind === "person" || kind === "general") branches.push({ classId: "communities", query: `${original} (site:t.me OR site:reddit.com)` });

  const unique = new Map<string, { classId: string; query: string }>();
  for (const b of branches) if (b.query && !unique.has(b.query.toLowerCase())) unique.set(b.query.toLowerCase(), b);
  return { kind, country: country?.en || null, place, subject, classes: CLASSES[kind], sources, branches: [...unique.values()] };
}

// Spreads a budget of searches across classes so every kind of source gets a turn.
export function pickBranches(map: SourceMap, limit: number, round = 0) {
  const byClass = new Map<string, string[]>();
  for (const b of map.branches) byClass.set(b.classId, [...(byClass.get(b.classId) || []), b.query]);
  const order: string[] = [];
  for (let depth = 0; order.length < map.branches.length; depth += 1) {
    let added = false;
    for (const queries of byClass.values()) if (queries[depth]) { order.push(queries[depth]); added = true; }
    if (!added) break;
  }
  const offset = round > 0 && order.length > limit ? (round * limit) % order.length : 0;
  const rotated = offset ? [...order.slice(offset), ...order.slice(0, offset)] : order;
  return rotated.slice(0, limit);
}

export function classLabel(map: SourceMap, classId: string, lang: "ru" | "en") {
  const cls = map.classes.find((c) => c.id === classId);
  return cls ? (lang === "ru" ? cls.ru : cls.en) : classId;
}
