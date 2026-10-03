import { getValue, setValue } from "@/lib/scout/store";
import type { Lang, ScoutSettings } from "@/lib/scout/types";

// Approved first-contact templates (spec 4: "агент не импровизирует в первом касании").
// Every first message says who we are, where the contact came from, why we write
// and how to opt out. Placeholders: {name} {company} {sender} {source} {object} {city} {unsubscribe} {bot}.
export const DEFAULT_TEMPLATES: Record<string, Record<Lang, string>> = {
  investor_first: {
    ru: "Здравствуйте, {name}! Меня зовут {sender}, я представляю {company} — мы подбираем объекты недвижимости для инвесторов. Ваш контакт нашли в открытом источнике: {source}. Пишу, потому что у нас есть предложения в локации {city}, которые могут подойти под ваш профиль. Если интересно, расскажу подробнее и задам пару вопросов о ваших критериях.\n\n{unsubscribe}",
    en: "Hello {name}, my name is {sender} from {company} — we source real estate for investors. We found your contact in a public source: {source}. I'm reaching out because we have opportunities in {city} that may fit your profile. If it's of interest, I'd be glad to share details and ask a couple of questions about your criteria.\n\n{unsubscribe}",
    es: "Hola {name}, soy {sender} de {company}: buscamos inmuebles para inversores. Encontramos su contacto en una fuente pública: {source}. Le escribo porque tenemos oportunidades en {city} que podrían encajar con su perfil. Si le interesa, le cuento los detalles y le hago un par de preguntas sobre sus criterios.\n\n{unsubscribe}",
    uk: "Вітаю, {name}! Мене звати {sender}, я представляю {company} — ми підбираємо нерухомість для інвесторів. Ваш контакт знайшли у відкритому джерелі: {source}. Пишу, бо маємо пропозиції в локації {city}, які можуть підійти під ваш профіль. Якщо цікаво, розповім детальніше та поставлю кілька запитань про ваші критерії.\n\n{unsubscribe}",
  },
  agency_partnership: {
    ru: "Здравствуйте! Я {sender} из {company}. Нашли ваше агентство через {source}. Мы работаем с инвесторами из СНГ и ЕС, которые ищут объекты в локации {city}, и предлагаем партнёрство: реферальная схема или co-brokerage с прозрачным разделом комиссии. Удобно созвониться на 20 минут на этой неделе?\n\n{unsubscribe}",
    en: "Hello! I'm {sender} from {company}. We found your agency via {source}. We work with investors looking for property in {city} and would like to propose a partnership: a referral scheme or co-brokerage with a transparent commission split. Would a 20-minute call this week work for you?\n\n{unsubscribe}",
    es: "¡Hola! Soy {sender} de {company}. Encontramos su agencia a través de {source}. Trabajamos con inversores que buscan inmuebles en {city} y nos gustaría proponer una colaboración: esquema de referidos o co-brokerage con reparto transparente de comisión. ¿Le vendría bien una llamada de 20 minutos esta semana?\n\n{unsubscribe}",
    uk: "Вітаю! Я {sender} з {company}. Знайшли ваше агентство через {source}. Ми працюємо з інвесторами, які шукають об'єкти в локації {city}, і пропонуємо партнерство: реферальна схема або co-brokerage з прозорим розподілом комісії. Чи зручно зідзвонитися на 20 хвилин цього тижня?\n\n{unsubscribe}",
  },
  seller_object: {
    ru: "Здравствуйте! Я {sender} из {company}. Увидели ваш объект «{object}» ({source}). У нас есть покупатель-инвестор под такой формат. Подскажите, пожалуйста: актуальна ли цена и возможен ли торг, кто собственник, какие документы готовы и можно ли организовать просмотр или видео-обход?\n\n{unsubscribe}",
    en: "Hello! I'm {sender} from {company}. We saw your property \"{object}\" ({source}). We have an investor-buyer for this kind of asset. Could you tell me whether the price is current and negotiable, who the owner is, which documents are ready, and whether a viewing or video tour is possible?\n\n{unsubscribe}",
    es: "¡Hola! Soy {sender} de {company}. Vimos su inmueble «{object}» ({source}). Tenemos un comprador inversor para este tipo de activo. ¿Me podría indicar si el precio es actual y negociable, quién es el propietario, qué documentos están listos y si es posible una visita o videollamada?\n\n{unsubscribe}",
    uk: "Вітаю! Я {sender} з {company}. Побачили ваш об'єкт «{object}» ({source}). Маємо покупця-інвестора під такий формат. Підкажіть, будь ласка: чи актуальна ціна і чи можливий торг, хто власник, які документи готові та чи можна організувати перегляд або відеообхід?\n\n{unsubscribe}",
  },
  public_reply: {
    ru: "Здравствуйте! Если ищете объекты под инвестицию в локации {city} — напишите нам в Telegram {bot}, пришлём подборку под ваш бюджет.",
    en: "Hi! If you're looking for investment property in {city}, message us on Telegram at {bot} and we'll send a selection that fits your budget.",
    es: "¡Hola! Si busca inmuebles para invertir en {city}, escríbanos por Telegram a {bot} y le enviaremos una selección según su presupuesto.",
    uk: "Вітаю! Якщо шукаєте об'єкти для інвестицій у локації {city} — напишіть нам у Telegram {bot}, надішлемо добірку під ваш бюджет.",
  },
  reminder: {
    ru: "Здравствуйте, {name}! Напоминаю о своём сообщении — актуально ли для вас? Если нет, просто ответьте «нет», и я больше не побеспокою.",
    en: "Hello {name}, just following up on my message — is this still relevant for you? If not, simply reply \"no\" and I won't write again.",
    es: "Hola {name}, le escribo de nuevo sobre mi mensaje: ¿sigue siendo de interés? Si no, responda «no» y no volveré a escribirle.",
    uk: "Вітаю, {name}! Нагадую про своє повідомлення — чи актуально для вас? Якщо ні, просто дайте відповідь «ні», і я більше не турбуватиму.",
  },
};

export const DEFAULT_SETTINGS: ScoutSettings = {
  targets: [
    { country: "Испания", city: "Валенсия", types: ["apartment", "penthouse", "house", "land"], lang: "es" },
    { country: "Индонезия", city: "Бали", types: ["villa", "land"], lang: "en" },
    { country: "Кипр", city: "Лимассол", types: ["apartment", "house", "land"], lang: "en" },
  ],
  priceMin: 80_000,
  priceMax: 2_000_000,
  areaMin: 0,
  minYieldPct: 0,
  minDiscountPct: 10,
  // Rough 2026 asking-price references, €/m². Edit them in the dashboard settings.
  marketPricePerM2: { "Валенсия": 3100, "Бали": 2400, "Лимассол": 5200, "Пафос": 3000, "Ларнака": 3200, "Аликанте": 2600, "Барселона": 4800, "Мадрид": 5000, "Малага": 3900, "Дубай": 5500, "Лиссабон": 5300 },
  dailyLimits: { email: 30, telegram: 20, whatsapp: 15, linkedin: 20, public_reply: 20, other: 10 },
  reminderDays: 3,
  maxReminders: 2,
  reportHourUtc: 6,
  companyName: "AURELIUS Capital",
  senderName: "Оксана",
  unsubscribeText: {
    ru: "Если не хотите получать сообщения, ответьте «стоп» — мы удалим ваш контакт.",
    en: "If you'd rather not hear from us, reply \"stop\" and we will delete your contact.",
    es: "Si no desea recibir mensajes, responda «stop» y eliminaremos su contacto.",
    uk: "Якщо не бажаєте отримувати повідомлення, дайте відповідь «стоп» — ми видалимо ваш контакт.",
  },
  templates: DEFAULT_TEMPLATES,
  monitorKeywords: [
    "недвижимость Валенсия",
    "инвестиции Испания",
    "real estate investors Spain",
    "property Bali investment",
    "property Cyprus investors",
    "relocation Spain",
    "ВНЖ через недвижимость",
  ],
};

const SETTINGS_KEY = "settings";

export async function loadSettings(): Promise<ScoutSettings> {
  const saved = await getValue<Partial<ScoutSettings>>(SETTINGS_KEY);
  if (!saved) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    dailyLimits: { ...DEFAULT_SETTINGS.dailyLimits, ...(saved.dailyLimits || {}) },
    unsubscribeText: { ...DEFAULT_SETTINGS.unsubscribeText, ...(saved.unsubscribeText || {}) },
    templates: { ...DEFAULT_TEMPLATES, ...(saved.templates || {}) },
    marketPricePerM2: { ...DEFAULT_SETTINGS.marketPricePerM2, ...(saved.marketPricePerM2 || {}) },
  };
}

export async function saveSettings(patch: Partial<ScoutSettings>) {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await setValue(SETTINGS_KEY, next);
  return next;
}

export function dashboardUrl(path = "") {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "") || "https://universal-ai-search-agent-demo.vercel.app").replace(/\/$/, "");
  return base + "/scout" + path;
}

export function botHandle() {
  return process.env.TELEGRAM_BOT_USERNAME ? "@" + process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, "") : "@AURELIUS8_bot";
}
