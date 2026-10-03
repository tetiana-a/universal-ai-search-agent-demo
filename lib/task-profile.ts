import { inferResearchKind, type ResearchKind } from "@/lib/relevance-gate";

// Per-task-type behaviour: which result columns to show, how to pull those fields
// out of page text without AI, and which clarifying questions to ask before searching.

export type FieldDef = { key: string; ru: string; en: string };

const COMMON_TAIL: FieldDef[] = [
  { key: "source", ru: "Источник", en: "Source" },
  { key: "url", ru: "Ссылка", en: "Link" },
  { key: "status", ru: "Статус", en: "Status" },
];

const FIELDS: Record<ResearchKind, FieldDef[]> = {
  real_estate: [
    { key: "title", ru: "Объект", en: "Listing" },
    { key: "price", ru: "Цена", en: "Price" },
    { key: "area", ru: "Площадь", en: "Area" },
    { key: "location", ru: "Местоположение", en: "Location" },
    { key: "specialization", ru: "Тип объекта", en: "Property type" },
    { key: "contact", ru: "Контакт", en: "Contact" },
  ],
  investor: [
    { key: "organization", ru: "Имя / фонд", en: "Name / fund" },
    { key: "specialization", ru: "Сфера инвестиций", en: "Focus" },
    { key: "geography", ru: "География", en: "Geography" },
    { key: "ticket", ru: "Чек / стадия", en: "Ticket / stage" },
    { key: "why", ru: "Почему подходит", en: "Why it fits" },
    { key: "contact", ru: "Публичные контакты", en: "Public contacts" },
  ],
  company: [
    { key: "organization", ru: "Компания", en: "Company" },
    { key: "specialization", ru: "Профиль / продукция", en: "Profile / products" },
    { key: "location", ru: "Страна / город", en: "Country / city" },
    { key: "why", ru: "Почему подходит", en: "Why it fits" },
    { key: "contact", ru: "Контакты", en: "Contacts" },
  ],
  person: [
    { key: "title", ru: "Имя", en: "Name" },
    { key: "specialization", ru: "Специализация", en: "Specialization" },
    { key: "organization", ru: "Компания", en: "Company" },
    { key: "location", ru: "Город", en: "City" },
    { key: "contact", ru: "Публичные контакты", en: "Public contacts" },
  ],
  general: [
    { key: "title", ru: "Результат", en: "Result" },
    { key: "organization", ru: "Организация", en: "Organization" },
    { key: "location", ru: "Местоположение", en: "Location" },
    { key: "why", ru: "Почему подходит", en: "Why it fits" },
    { key: "contact", ru: "Контакты", en: "Contacts" },
  ],
};

export function fieldSchemaFor(kind: ResearchKind): FieldDef[] {
  return [...FIELDS[kind], ...COMMON_TAIL];
}

const PRICE = /(?:€|eur|euro|\$|usd|£|gbp|₽|руб|¥|cny|rmb)\s?\d[\d\s.,]*(?:\s?(?:k|m|mln|млн|тыс|million|thousand))?|\d[\d\s.,]*\s?(?:€|eur|euro|\$|usd|£|₽|руб\.?|млн|million)/i;
const AREA = /\d[\d\s.,]*\s?(?:m²|m2|кв\.?\s?м|м²|sq\.?\s?m|sqm|ha|hectares?|га|гектар\w*|acres?)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+|00)\d[\d\s().-]{7,}\d/;
const TICKET = /(?:ticket|cheque|check|чек|invest(?:s|ing)?)\D{0,30}((?:€|eur|\$|usd|£)\s?\d[\d.,]*\s?(?:k|m|mln|million)?(?:\s?(?:-|–|to|до)\s?(?:€|eur|\$|usd|£)?\s?\d[\d.,]*\s?(?:k|m|mln|million)?)?)/i;
const STAGE = /\b(pre-seed|seed|series [a-e]|growth|early[- ]stage|late[- ]stage)\b/i;

function clip(value: string | undefined, limit = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

// Rule-based extraction used when no AI provider is available. Values are only
// taken when they literally appear in the text, so nothing is invented.
export function heuristicFields(kind: ResearchKind, text: string) {
  const out: Record<string, string> = {};
  const email = text.match(EMAIL)?.[0];
  const phone = text.match(PHONE)?.[0];
  if (email || phone) out.contact = clip([email, phone].filter(Boolean).join(" · "));
  if (kind === "real_estate" || kind === "general") {
    const price = text.match(PRICE)?.[0];
    const area = text.match(AREA)?.[0];
    if (price) out.price = clip(price, 60);
    if (area) out.area = clip(area, 60);
  }
  if (kind === "investor") {
    const ticket = text.match(TICKET)?.[1];
    const stage = text.match(STAGE)?.[1];
    if (ticket || stage) out.ticket = clip([stage, ticket].filter(Boolean).join(" · "), 80);
    if (stage) out.stage = clip(stage, 40);
  }
  return out;
}

export type ClarifyingQuestion = { id: string; ru: string; en: string; placeholderRu: string; placeholderEn: string };

const GEO_HINT = /\b(in|near|around|across)\s+[A-ZÀ-Ý][\w-]+|\b(в|во|на|под)\s+[А-ЯЁІЇЄ][\wа-яё-]+|madrid|amsterdam|spain|italy|china|europe|usa|london|berlin|paris|мадрид|амстердам|испани|итали|кита|европ|сша|лондон|берлин|париж|прага|praha|czech|чехи|украин|ukrain|киев|kyiv/i;
const NUMBER = /\d/;

function hasAny(q: string, re: RegExp) { return re.test(q); }

// Questions for criteria the query leaves open. The search can run without the
// answers; they only narrow it.
export function clarifyingQuestions(query: string): { kind: ResearchKind; questions: ClarifyingQuestion[]; detected: Record<string, boolean> } {
  const kind = inferResearchKind(query);
  const q = query.toLowerCase();
  const detected = {
    geography: hasAny(query, GEO_HINT),
    numbers: NUMBER.test(q),
    budget: /€|\$|eur|usd|£|₽|руб|budget|бюджет|price|цен|ticket|чек/.test(q),
    sector: /saas|b2b|fintech|proptech|software|ai\b|tech|медицин|health|food|retail|energy|логист|logistic|manufactur|производ|construction|строит|it\b|ит\b/.test(q),
  };
  const questions: ClarifyingQuestion[] = [];
  if (!detected.geography) {
    questions.push({ id: "geography", ru: "Где искать? Страна, город или регион.", en: "Where should we search? Country, city or region.", placeholderRu: "например, Мадрид, Испания", placeholderEn: "e.g. Madrid, Spain" });
  }
  if (kind === "real_estate") {
    if (!detected.budget) questions.push({ id: "budget", ru: "Какой бюджет?", en: "What is the budget?", placeholderRu: "например, до 2 млн €", placeholderEn: "e.g. up to €2M" });
    if (!/m²|m2|кв|sq|га|ha|площад|area|size/.test(q)) questions.push({ id: "area", ru: "Какая площадь нужна?", en: "What size do you need?", placeholderRu: "например, от 10 000 м²", placeholderEn: "e.g. from 10,000 m²" });
    questions.push({ id: "purpose", ru: "Назначение объекта (жильё, коммерция, застройка, сельхоз)?", en: "Intended use (residential, commercial, development, agricultural)?", placeholderRu: "например, под застройку", placeholderEn: "e.g. development" });
  } else if (kind === "investor") {
    if (!detected.sector) questions.push({ id: "sector", ru: "В какой отрасли ваш проект?", en: "Which sector is your project in?", placeholderRu: "например, B2B SaaS", placeholderEn: "e.g. B2B SaaS" });
    questions.push({ id: "stage", ru: "Стадия и сумма раунда?", en: "Round stage and size?", placeholderRu: "например, seed, 500 тыс. €", placeholderEn: "e.g. seed, €500k" });
    questions.push({ id: "investorType", ru: "Какие инвесторы интересны: VC, бизнес-ангелы, family office?", en: "Which investors: VC, angels, family offices?", placeholderRu: "например, VC и ангелы", placeholderEn: "e.g. VC and angels" });
  } else if (kind === "company") {
    if (!detected.sector) questions.push({ id: "product", ru: "Какой продукт или профиль компании нужен?", en: "Which product or company profile?", placeholderRu: "например, производители упаковки", placeholderEn: "e.g. packaging manufacturers" });
    questions.push({ id: "size", ru: "Требования к размеру, сертификатам или минимальной партии?", en: "Requirements on size, certificates or MOQ?", placeholderRu: "например, ISO 9001, MOQ до 1000 шт.", placeholderEn: "e.g. ISO 9001, MOQ under 1000" });
  } else if (kind === "person") {
    questions.push({ id: "profile", ru: "Какая специализация и опыт нужны?", en: "Which specialization and experience?", placeholderRu: "например, юрист по недвижимости, 5+ лет", placeholderEn: "e.g. real estate lawyer, 5+ years" });
    questions.push({ id: "language", ru: "Языки общения?", en: "Languages?", placeholderRu: "например, русский, английский", placeholderEn: "e.g. English, Spanish" });
  } else {
    questions.push({ id: "what", ru: "Что именно должно быть в результате (компании, люди, объявления, мероприятия)?", en: "What should each result be (companies, people, listings, events)?", placeholderRu: "например, фонды и гранты", placeholderEn: "e.g. funds and grants" });
  }
  return { kind, questions: questions.slice(0, 4), detected };
}

// Folds answered questions back into the query text so every pipeline sees them.
export function applyClarifications(query: string, answers: Record<string, string>, language: "ru" | "en") {
  const parts = Object.entries(answers || {})
    .map(([id, value]) => [id, String(value || "").trim().slice(0, 200)] as const)
    .filter(([, value]) => value);
  if (!parts.length) return query.trim();
  const label = language === "ru" ? "Уточнения" : "Details";
  return query.trim() + "\n" + label + ": " + parts.map(([, value]) => value).join("; ");
}
