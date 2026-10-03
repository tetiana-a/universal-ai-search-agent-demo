import { detectGoals, detectSegments, matchCity, matchCountries, CITY_ALIASES } from "@/lib/scout/extract";
import { detectLang, nowIso, parseBudget, parseMoney } from "@/lib/scout/text";
import type { ChecklistAnswer, Lang, Lead } from "@/lib/scout/types";

// Module 4: scripted qualification. The lead is handed to the human only when
// every checklist item is answered; money and disputes are escalated, not decided.

export const INVESTOR_CHECKLIST = ["budget", "geography", "type", "goal", "horizon", "deal_form", "decision_maker", "meeting"] as const;
export const OBJECT_CHECKLIST = ["price", "legal", "owner", "commission", "documents", "viewing"] as const;

export const CHECKLIST_LABELS: Record<string, string> = {
  budget: "Бюджет и валюта",
  geography: "География интереса",
  type: "Тип объекта",
  goal: "Цель (доход / ВНЖ / сохранение / спекуляция)",
  horizon: "Горизонт и срочность",
  deal_form: "Форма сделки",
  decision_maker: "Кто принимает решение",
  meeting: "Готовность к встрече",
  price: "Реальная цена и торг",
  legal: "Юридическая чистота, обременения, долги",
  owner: "Собственник, прямая продажа или агент",
  commission: "Комиссия и кто платит",
  documents: "Документы (кадастр, энергосертификат, ITE)",
  viewing: "Просмотр / видео-обход",
};

const QUESTIONS: Record<string, Record<Lang, string>> = {
  budget: { ru: "Какой бюджет вы рассматриваете и в какой валюте?", en: "What budget are you considering, and in which currency?", es: "¿Qué presupuesto contempla y en qué moneda?", uk: "Який бюджет ви розглядаєте і в якій валюті?" },
  geography: { ru: "Какие страны или города вам интересны?", en: "Which countries or cities are you interested in?", es: "¿Qué países o ciudades le interesan?", uk: "Які країни чи міста вас цікавлять?" },
  type: { ru: "Какой тип объекта: жильё, коммерция, земля или доходный бизнес?", en: "What type of property: residential, commercial, land or an income-producing business?", es: "¿Qué tipo de inmueble: vivienda, comercial, suelo o negocio con rentas?", uk: "Який тип об'єкта: житло, комерція, земля чи прибутковий бізнес?" },
  goal: { ru: "Какая основная цель: доход, ВНЖ/гражданство, сохранение капитала или перепродажа?", en: "What is the main goal: income, residency/citizenship, capital preservation or resale?", es: "¿Cuál es el objetivo principal: rentas, residencia/ciudadanía, preservar capital o reventa?", uk: "Яка основна мета: дохід, ВНЖ/громадянство, збереження капіталу чи перепродаж?" },
  horizon: { ru: "Когда планируете сделку и насколько это срочно?", en: "When are you planning the purchase, and how urgent is it?", es: "¿Cuándo planea la compra y qué urgencia tiene?", uk: "Коли плануєте угоду і наскільки це терміново?" },
  deal_form: { ru: "Как планируете оформлять сделку: наличные, ипотека, через юрлицо или SPV?", en: "How do you plan to structure the deal: cash, mortgage, via a company or an SPV?", es: "¿Cómo piensa estructurar la operación: contado, hipoteca, sociedad o SPV?", uk: "Як плануєте оформлювати угоду: готівка, іпотека, через юрособу чи SPV?" },
  decision_maker: { ru: "Кто принимает окончательное решение — вы или с кем-то вместе?", en: "Who makes the final decision — you, or together with someone?", es: "¿Quién toma la decisión final: usted o junto con alguien?", uk: "Хто ухвалює остаточне рішення — ви чи разом із кимось?" },
  meeting: { ru: "Когда вам удобно созвониться или встретиться, и в каком формате (Zoom, звонок, лично)?", en: "When would suit you for a call or meeting, and in what format (Zoom, phone, in person)?", es: "¿Cuándo le viene bien una llamada o reunión, y en qué formato (Zoom, teléfono, en persona)?", uk: "Коли вам зручно зідзвонитися чи зустрітися, і в якому форматі (Zoom, дзвінок, особисто)?" },
  price: { ru: "Цена актуальна? Возможен ли торг?", en: "Is the price current? Is it negotiable?", es: "¿El precio está actualizado? ¿Es negociable?", uk: "Ціна актуальна? Чи можливий торг?" },
  legal: { ru: "Есть ли обременения, долги или юридические вопросы по объекту?", en: "Are there any encumbrances, debts or legal issues on the property?", es: "¿Tiene cargas, deudas o cuestiones legales el inmueble?", uk: "Чи є обтяження, борги або юридичні питання щодо об'єкта?" },
  owner: { ru: "Кто собственник — продажа напрямую или через агента?", en: "Who is the owner — is it a direct sale or through an agent?", es: "¿Quién es el propietario? ¿Venta directa o a través de agencia?", uk: "Хто власник — продаж напряму чи через агента?" },
  commission: { ru: "Какая комиссия и кто её платит?", en: "What is the commission and who pays it?", es: "¿Cuál es la comisión y quién la paga?", uk: "Яка комісія і хто її сплачує?" },
  documents: { ru: "Какие документы готовы: кадастр, энергосертификат, ITE?", en: "Which documents are ready: cadastre, energy certificate, ITE?", es: "¿Qué documentos están listos: catastro, certificado energético, ITE?", uk: "Які документи готові: кадастр, енергосертифікат, ITE?" },
  viewing: { ru: "Возможен ли просмотр или видео-обход?", en: "Is a viewing or video tour possible?", es: "¿Es posible una visita o un videorecorrido?", uk: "Чи можливий перегляд або відеообхід?" },
};

const CLOSING: Record<Lang, string> = {
  ru: "Спасибо! Я передаю всё нашему специалисту — он свяжется с вами в ближайшее время.",
  en: "Thank you! I'm passing everything to our specialist, who will contact you shortly.",
  es: "¡Gracias! Paso toda la información a nuestro especialista, que se pondrá en contacto con usted en breve.",
  uk: "Дякую! Передаю все нашому спеціалісту — він зв'яжеться з вами найближчим часом.",
};

const ESCALATED: Record<Lang, string> = {
  ru: "Это вопрос, который лучше обсудить с нашим специалистом напрямую. Я передал ему ваше сообщение.",
  en: "That's best discussed with our specialist directly. I've passed your message on.",
  es: "Es mejor tratarlo directamente con nuestro especialista. Le he trasladado su mensaje.",
  uk: "Це питання краще обговорити з нашим спеціалістом напряму. Я передав йому ваше повідомлення.",
};

const REFUSED: Record<Lang, string> = {
  ru: "Поняла, больше не будем писать. Ваш контакт удалён.",
  en: "Understood, we won't contact you again. Your contact has been removed.",
  es: "Entendido, no volveremos a escribirle. Su contacto ha sido eliminado.",
  uk: "Зрозуміло, більше не писатимемо. Ваш контакт видалено.",
};

export const GREETING: Record<Lang, string> = {
  ru: "Здравствуйте! Я ассистент по подбору инвестиционной недвижимости. Задам несколько коротких вопросов, чтобы прислать подходящие варианты. Ответьте «стоп» в любой момент, если не хотите продолжать.",
  en: "Hello! I'm an assistant for investment property selection. I'll ask a few short questions so we can send suitable options. Reply \"stop\" at any time if you don't want to continue.",
  es: "¡Hola! Soy un asistente de selección de inmuebles de inversión. Le haré unas preguntas breves para enviarle opciones adecuadas. Responda «stop» en cualquier momento si no desea continuar.",
  uk: "Вітаю! Я асистент із підбору інвестиційної нерухомості. Поставлю кілька коротких запитань, щоб надіслати відповідні варіанти. Напишіть «стоп» будь-коли, якщо не бажаєте продовжувати.",
};

export function checklistFor(type: Lead["type"]): readonly string[] {
  return type === "investor" ? INVESTOR_CHECKLIST : OBJECT_CHECKLIST;
}

export function missingItems(lead: Pick<Lead, "type" | "answers">) {
  return checklistFor(lead.type).filter((key) => !lead.answers[key]?.value);
}

export function questionFor(key: string, lang: Lang) {
  return QUESTIONS[key]?.[lang] || QUESTIONS[key]?.en || "";
}

export function isRefusal(text: string) {
  return /^\s*(стоп|stop|нет|ні|no|baja|unsubscribe)\s*[.!]*\s*$/i.test(text)
    || /не пишите|не пишіть|не интересно|не цікаво|no me interesa|not interested|remove me|отпишите|удалите (мой|мои)|видаліть/i.test(text);
}

export function needsEscalation(text: string) {
  return /комисси|комісі|commission|comisi[oó]n|предоплат|передоплат|аванс|задат|deposit|dep[oó]sito|se[ñn]al|договор|contract|contrato|юрист|lawyer|abogado|суд\b|court|complaint|жалоб|скарг|refund|возврат|повернен|скидк\w* на комисс|гаранти/i.test(text);
}

// Opportunistic slot filling: one reply often answers several questions at once.
export function extractAnswers(text: string, type: Lead["type"]): Record<string, string> {
  const out: Record<string, string> = {};
  const t = String(text || "");
  if (type === "investor") {
    const budget = parseBudget(t);
    if (budget && (budget.min || budget.max)) out.budget = [budget.min, budget.max].filter(Boolean).map((n) => n!.toLocaleString("en-US")).join("–") + " " + (budget.currency || "");
    const places = [...matchCountries(t), ...(matchCity(t, Object.keys(CITY_ALIASES)) ? [matchCity(t, Object.keys(CITY_ALIASES))!] : [])];
    if (places.length) out.geography = Array.from(new Set(places)).join(", ");
    const segments = detectSegments(t);
    if (segments.length || /жиль|житл|residential|vivienda|коммерц|commercial|бизнес|business/i.test(t)) out.type = segments.join(", ") || t.slice(0, 80);
    const goals = detectGoals(t);
    if (goals.length) out.goal = goals.join(", ");
    if (/\b(\d+\s?(month|months|мес|міс|meses|year|years|год|лет|рок|años))|asap|срочно|терміново|сразу|now|ahora|этим летом|this year|в этом году|next year|в следующем году/i.test(t)) out.horizon = t.slice(0, 120);
    if (/наличн|готівк|cash|contado|ипотек|іпотек|mortgage|hipoteca|юрлиц|юросо|company|sociedad|\bspv\b/i.test(t)) out.deal_form = t.slice(0, 120);
    if (/я сам|сама|i decide|myself|yo decido|partner|партн[её]р|жена|муж|чоловік|дружина|совет директоров|board|family|семь[яе]/i.test(t)) out.decision_maker = t.slice(0, 120);
    if (/zoom|meet|call|звон|дзвін|созвон|встреч|зустріч|llamada|reuni[oó]n|monday|tuesday|понедельник|вторник|среда|четверг|пятниц|завтра|tomorrow|mañana|\d{1,2}[:.]\d{2}/i.test(t)) out.meeting = t.slice(0, 120);
  } else {
    const money = parseMoney(t);
    if (money || /торг|negoti|negocia|fixed|фиксир/i.test(t)) out.price = t.slice(0, 120);
    if (/обремен|обтяж|долг|борг|deuda|cargas|encumbr|чист|clean|libre de cargas|ипотек/i.test(t)) out.legal = t.slice(0, 120);
    if (/собственник|власник|owner|propietario|напрямую|напряму|direct|agent|агент|agencia/i.test(t)) out.owner = t.slice(0, 120);
    if (/комисс|коміс|commission|comisi/i.test(t)) out.commission = t.slice(0, 120);
    if (/кадастр|cadastr|catastro|энергосерт|енергосерт|energy cert|certificado energ|\bite\b|nota simple/i.test(t)) out.documents = t.slice(0, 120);
    if (/просмотр|перегляд|viewing|visita|video|видео|відео/i.test(t)) out.viewing = t.slice(0, 120);
  }
  return out;
}

export type DialogOutcome = { lead: Lead; reply: string; event: "question" | "qualified" | "escalated" | "refused" };

// One step of the scripted dialogue: record the reply, fill slots, decide what's next.
export function advanceDialog(lead: Lead, incoming: string): DialogOutcome {
  const at = nowIso();
  const lang = lead.transcript.some((m) => m.from === "contact") ? lead.lang : detectLang(incoming, lead.lang);
  const next: Lead = { ...lead, lang, answers: { ...lead.answers }, transcript: [...lead.transcript, { from: "contact", text: incoming, at }], lastContactAt: at, remindersSent: 0 };

  if (isRefusal(incoming)) {
    next.state = "refused";
    const reply = REFUSED[lang];
    next.transcript.push({ from: "agent", text: reply, at });
    return { lead: next, reply, event: "refused" };
  }

  if (needsEscalation(incoming)) {
    next.state = "escalated";
    next.escalation = incoming.slice(0, 300);
    const reply = ESCALATED[lang];
    next.transcript.push({ from: "agent", text: reply, at });
    return { lead: next, reply, event: "escalated" };
  }

  // The answer to the question we just asked goes to that slot, even when no rule recognises it.
  const lastAsked = [...lead.transcript].reverse().find((m) => m.from === "agent");
  const askedKey = lastAsked ? checklistFor(lead.type).find((key) => lastAsked.text.includes(questionFor(key, lead.lang))) : undefined;
  const extracted = extractAnswers(incoming, lead.type);
  const fill = (key: string, value: string) => { if (!next.answers[key]?.value && value.trim()) next.answers[key] = { value: value.trim().slice(0, 200), at, source: "dialog" } as ChecklistAnswer; };
  if (askedKey && !/^\s*\?|^(что|what|qué|що)\b/i.test(incoming)) fill(askedKey, extracted[askedKey] || incoming);
  for (const [key, value] of Object.entries(extracted)) fill(key, value);

  const missing = missingItems(next);
  if (!missing.length) {
    next.state = "qualified";
    const reply = CLOSING[lang];
    next.transcript.push({ from: "agent", text: reply, at });
    return { lead: next, reply, event: "qualified" };
  }
  const reply = questionFor(missing[0], lang);
  next.transcript.push({ from: "agent", text: reply, at });
  return { lead: next, reply, event: "question" };
}

export function leadSummary(lead: Lead) {
  const lines = checklistFor(lead.type).map((key) => "• " + CHECKLIST_LABELS[key] + ": " + (lead.answers[key]?.value || "—"));
  return lines.join("\n");
}
