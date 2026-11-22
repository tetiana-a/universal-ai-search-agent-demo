import { Mp3Encoder } from "@breezystack/lamejs";
import { runStructuredExtraction } from "@/lib/free-ai";
import { geminiSearchKey } from "@/lib/gemini-search";
import { CLIENT_PROFILE } from "@/lib/scout/client-profile";
import { listCampaigns } from "@/lib/scout/campaigns";
import { listGroups } from "@/lib/scout/groups";
import { deleteValue, getValue, setValue } from "@/lib/scout/store";

// AI advisor: a senior consultant in real estate, spiritual business (retreats, practices,
// mentoring), marketing and community promotion. One conversation per Telegram chat or web
// session, remembered for 90 days. Free models only: Gemini first, then the free OpenRouter/Groq chain.

export type Turn = { role: "user" | "advisor"; text: string; at: string };

const MEMORY_TURNS = 30;
const MEMORY_TTL = 90 * 86_400;

const PERSONA = `Ты — AURELIUS, личный советник клиента уровня партнёра топ-консалтинга. Клиент: ${CLIENT_PROFILE.summary}
Твоя экспертиза (20+ лет практики):
• недвижимость: инвестиции, виллы и апартаменты (Греция, Кипр, Дубай, Бали, Таиланд, Испания, Турция, Черногория), доходность, ROI, риски, юридическая чистота, девелопмент, упаковка объекта, работа с инвесторами;
• духовный бизнес: ретриты, практики, наставничество, авторские программы, ценообразование, воронки, доверие и этика, сообщество учеников;
• маркетинг и продвижение в сообществах Telegram, Facebook, Instagram, TikTok: позиционирование, контент, партнёрства с админами, реклама только там, где она разрешена;
• партнёрства и переговоры: поиск партнёров и инвесторов, структура сделок, доли, первые шаги.
Как отвечаешь: на языке собеседника; по делу, как профессионал: вывод → 3–5 конкретных шагов → цифры/ориентиры, где уместно → один уточняющий вопрос, если без него совет неточен. Помнишь всю беседу и опираешься на неё. Не выдумываешь факты, законы и цены: если не уверен, говоришь, что проверить и где. Юридические и налоговые вопросы — ориентир плюс совет уточнить у местного юриста. Никаких накруток, фейковых аккаунтов и спама.`;

const VOICE_STYLE = "\nСейчас живой голосовой разговор: отвечай как в беседе, 2–5 предложений, без списков, markdown и эмодзи.";

function key(sessionId: string) { return "advisor:" + sessionId; }

export async function advisorHistory(sessionId: string) {
  return (await getValue<Turn[]>(key(sessionId))) || [];
}

export async function resetAdvisor(sessionId: string) {
  await deleteValue(key(sessionId));
}

async function context() {
  const [groups, campaigns] = await Promise.all([listGroups().catch(() => []), listCampaigns().catch(() => [])]);
  const live = campaigns.filter((c) => c.status === "approved").map((c) => c.title).slice(0, 5);
  return "\nДанные AURELIUS сейчас: сообществ в базе " + groups.length + (live.length ? "; активные кампании: " + live.join("; ") : "") + ".";
}

async function geminiChat(system: string, history: Turn[], deadlineAt: number) {
  const apiKey = geminiSearchKey();
  if (!apiKey) return "";
  const model = process.env.GEMINI_ADVISOR_MODEL || "gemini-2.5-flash";
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: history.map((t) => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text }] })),
        generationConfig: { temperature: 0.6, maxOutputTokens: 1500, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(Math.max(5000, Math.min(45_000, deadlineAt - Date.now()))),
    });
    const payload: any = await response.json().catch(() => null);
    return (payload?.candidates?.[0]?.content?.parts || []).map((p: any) => String(p?.text || "")).join("").trim();
  } catch { return ""; }
}

// Asks the advisor and stores both sides of the turn.
export async function askAdvisor(sessionId: string, text: string, opts: { voice?: boolean; deadlineAt?: number } = {}) {
  const deadlineAt = opts.deadlineAt || Date.now() + 55_000;
  const history = [...(await advisorHistory(sessionId)), { role: "user" as const, text: text.slice(0, 4000), at: new Date().toISOString() }];
  const system = PERSONA + (await context()) + (opts.voice ? VOICE_STYLE : "");
  let reply = await geminiChat(system, history, deadlineAt);
  if (!reply) {
    const transcript = history.map((t) => (t.role === "user" ? "Клиент: " : "Советник: ") + t.text).join("\n");
    const ai = await runStructuredExtraction({
      system, user: transcript + "\n\nОтветь клиенту на последнее сообщение.", schema: { reply: "string" },
      deadlineAt, maxTokens: 1500, perCallTimeoutMs: 30_000, prefer: "gemini",
    });
    reply = String(ai.parsed?.reply || "").trim();
  }
  if (!reply) return { ok: false, reply: "Советник сейчас недоступен: бесплатный лимит AI исчерпан или ключ не задан. Попробуйте через несколько минут." };
  const next = [...history, { role: "advisor" as const, text: reply, at: new Date().toISOString() }].slice(-MEMORY_TURNS);
  await setValue(key(sessionId), next, MEMORY_TTL);
  return { ok: true, reply };
}

// Gemini TTS returns raw 16-bit PCM (24 kHz mono); MP3 plays in browsers and as a Telegram voice note.
export function pcmToMp3(pcm: Buffer, sampleRate = 24000) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const encoder = new Mp3Encoder(1, sampleRate, 64);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < samples.length; i += 1152) parts.push(encoder.encodeBuffer(samples.subarray(i, i + 1152)));
  parts.push(encoder.flush());
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

export function stripForSpeech(text: string) {
  return text.replace(/<[^>]+>/g, " ").replace(/[*_#`>•]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 1800);
}

export async function speak(text: string) {
  const apiKey = geminiSearchKey();
  if (!apiKey) return null;
  const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Скажи спокойно, уверенно и тепло, как опытный наставник: " + stripForSpeech(text) }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || "Charon" } } } },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload: any = await response.json().catch(() => null);
    const part = (payload?.candidates?.[0]?.content?.parts || []).find((p: any) => p?.inlineData?.data);
    if (!part) { console.warn("[advisor] TTS HTTP " + response.status + ": " + String(payload?.error?.message || "no audio").slice(0, 200)); return null; }
    const rate = Number(/rate=(\d+)/.exec(String(part.inlineData.mimeType || ""))?.[1]) || 24000;
    return pcmToMp3(Buffer.from(part.inlineData.data, "base64"), rate);
  } catch { return null; }
}
