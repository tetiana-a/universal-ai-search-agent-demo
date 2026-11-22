import { geminiSearchKey } from "@/lib/gemini-search";

// Speech → text with the free Gemini key; the model detects the language itself (any language).
export async function geminiTranscribe(base64: string, mimeType: string) {
  const key = geminiSearchKey();
  if (!key) return { ok: false, text: "", message: "Для распознавания речи нужен GEMINI_API_KEY (бесплатный)." };
  try {
    const model = process.env.GEMINI_AUDIO_MODEL || "gemini-2.5-flash";
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ inline_data: { mime_type: mimeType.split(";")[0] || "audio/ogg", data: base64 } }, { text: "Transcribe this voice message word for word in its original language, whatever language it is. Return only the text." }] }], generationConfig: { temperature: 0 } }),
      signal: AbortSignal.timeout(40000),
    });
    const payload: any = await response.json().catch(() => null);
    const text = (payload?.candidates?.[0]?.content?.parts || []).map((p: any) => String(p?.text || "")).join(" ").trim();
    return text ? { ok: true, text, message: "" } : { ok: false, text: "", message: "Gemini не распознал речь (HTTP " + response.status + ")." };
  } catch (error) {
    return { ok: false, text: "", message: "Ошибка распознавания: " + (error instanceof Error ? error.message : "сеть") };
  }
}
