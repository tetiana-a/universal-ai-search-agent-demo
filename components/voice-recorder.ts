"use client";

// Records from the microphone and returns the server transcription (Gemini, any language).
// Works in every modern browser, unlike Web Speech, which is Chrome-only and needs a fixed language.
export async function startVoiceRecording(onText: (text: string) => void, onError: (message: string) => void, onBusy?: (busy: boolean) => void) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { onError("Браузер не даёт доступ к микрофону."); return null; }
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { onError("Нет доступа к микрофону: разрешите его в браузере."); return null; }
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const type = recorder.mimeType || "audio/webm";
    const form = new FormData();
    form.append("file", new File([new Blob(chunks, { type })], /mp4/.test(type) ? "voice.m4a" : /ogg/.test(type) ? "voice.ogg" : "voice.webm", { type }));
    onBusy?.(true);
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.text) onText(String(data.text)); else onError(data.error || "Не удалось распознать речь.");
    } catch { onError("Сеть недоступна."); } finally { onBusy?.(false); }
  };
  recorder.start();
  return recorder;
}
