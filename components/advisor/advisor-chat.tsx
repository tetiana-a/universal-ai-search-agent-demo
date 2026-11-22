"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Compass, Mic, MicOff, RotateCcw, Send, Square } from "lucide-react";
import { Atmosphere } from "@/components/site-chrome";

// Advisor chat: text, a one-off voice question, or a live conversation (speak → hear the answer →
// the mic opens again; a pause of ~1.5 s ends your phrase). Same access key as /groups and /scout.

type Turn = { role: "user" | "advisor"; text: string; at?: string };
const KEY_STORAGE = "aurelius-scout-key";
const inputClass = "scout-input w-full rounded-lg border border-[var(--line-soft)] bg-[var(--surface-strong)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--line)]";
const SUGGESTIONS = [
  "Проанализируй работу платформы по реальным данным: что работает, где ошибки и слабые места?",
  "Составь план роста на 30 дней с целями в цифрах и первыми шагами.",
  "Как упаковать виллу на Бали для русскоязычных инвесторов?",
  "Как поднять цену ретрита и не потерять доверие учеников?",
  "Какие сообщества лучше всего подходят для моей рекламы и как договориться с админами?",
  "Как структурировать партнёрство 50/50 в девелоперском проекте?",
];

export default function AdvisorChat() {
  const [key, setKey] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { try { setKey(window.localStorage.getItem(KEY_STORAGE) || ""); } catch {} }, []);
  const auth = useCallback((): Record<string, string> => (key ? { "x-scout-key": key } : {}), [key]);

  const load = useCallback(async () => {
    const res = await fetch("/api/advisor", { headers: auth(), cache: "no-store" }).catch(() => null);
    if (!res) return;
    if (res.status === 401) { setNeedKey(true); return; }
    setNeedKey(false);
    setTurns((await res.json()).history || []);
  }, [auth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns, status]);

  const play = (b64: string) => new Promise<void>((resolve) => {
    const audio = audioRef.current;
    if (!audio || !b64) { resolve(); return; }
    audio.src = "data:audio/mpeg;base64," + b64;
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    void audio.play().catch(() => resolve());
  });

  const ask = async (body: BodyInit, headers: Record<string, string>, question?: string) => {
    if (question) setTurns((t) => [...t, { role: "user", text: question }]);
    setStatus("Советник думает…");
    try {
      const res = await fetch("/api/advisor", { method: "POST", headers: { ...auth(), ...headers }, body });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { setNeedKey(true); return; }
      if (data.transcript) setTurns((t) => [...t, { role: "user", text: data.transcript }]);
      if (data.reply) setTurns((t) => [...t, { role: "advisor", text: data.reply }]);
      else setStatus(data.error || "Нет ответа.");
      if (data.audio) { setStatus("Говорит…"); await play(data.audio); }
      setStatus("");
    } catch { setStatus("Сеть недоступна."); }
  };

  const sendText = () => {
    const q = text.trim();
    if (!q) return;
    setText("");
    void ask(JSON.stringify({ text: q }), { "content-type": "application/json" }, q);
  };

  // Records one phrase; in live mode it stops itself after ~1.5 s of silence.
  const record = async (auto: boolean) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setStatus("Браузер не даёт доступ к микрофону."); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { setStatus("Разрешите микрофон в браузере."); setLive(false); liveRef.current = false; return; }
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    let ctx: AudioContext | null = null;
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setRecording(false);
      const type = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      if (blob.size > 2000) {
        const form = new FormData();
        form.append("file", new File([blob], /mp4/.test(type) ? "voice.m4a" : "voice.webm", { type }));
        await ask(form, {});
      }
      if (liveRef.current) void record(true);
    };
    if (auto) {
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let spoke = false, quietSince = Date.now();
      const started = Date.now();
      const tick = () => {
        if (recorder.state !== "recording") return;
        analyser.getByteTimeDomainData(data);
        const level = Math.max(...data.map((v) => Math.abs(v - 128)));
        if (level > 12) { spoke = true; quietSince = Date.now(); }
        if ((spoke && Date.now() - quietSince > 1500) || Date.now() - started > 60_000 || (!spoke && Date.now() - started > 20_000)) recorder.stop();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    recorder.start();
    setRecording(true);
    setStatus(auto ? "Слушаю… говорите" : "Запись… нажмите ещё раз, чтобы отправить");
  };

  const toggleMic = () => {
    if (recorderRef.current?.state === "recording") { recorderRef.current.stop(); return; }
    void record(false);
  };
  const toggleLive = () => {
    const next = !live;
    setLive(next);
    liveRef.current = next;
    if (next) void record(true);
    else { audioRef.current?.pause(); if (recorderRef.current?.state === "recording") recorderRef.current.stop(); setStatus(""); }
  };
  const reset = async () => {
    await fetch("/api/advisor", { method: "POST", headers: { ...auth(), "content-type": "application/json" }, body: JSON.stringify({ action: "reset" }) });
    setTurns([]);
  };

  return (
    <main className="scout-ui relative isolate min-h-screen overflow-x-clip bg-[var(--bg)] text-[var(--text)] spectrum-shell">
      <Atmosphere />
      <div className="app-grid pointer-events-none fixed inset-0 z-0 opacity-45" />
      <audio ref={audioRef} className="hidden" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[880px] flex-col gap-4 px-4 pb-28 pt-6 sm:px-6">
        <header>
          <Link href="/" className="brand-mark font-display text-[24px] tracking-[.19em]">AURELIUS</Link>
          <h1 className="mt-1 flex items-center gap-2 text-[18px] font-light"><Compass size={16} style={{ color: "#bf5af2" }} />Личный советник</h1>
          <p className="text-[12px] text-[var(--text-muted)]">Аналитик и стратег платформы (видит реальные метрики, поиски и журнал) · недвижимость и инвестиции · ретриты и духовный бизнес · маркетинг и сообщества. Помнит беседу; тот же разговор доступен в Telegram: /advisor.</p>
        </header>

        {needKey && (
          <section className="glass rounded-[18px] p-4">
            <p className="mb-2 text-[13px]">Нужен ключ доступа</p>
            <div className="flex gap-2">
              <input className={inputClass} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Ключ доступа (как в Разведчике)" />
              <button type="button" className="spectrum-button rounded-md px-3 text-[12px] text-white" onClick={() => { try { window.localStorage.setItem(KEY_STORAGE, key); } catch {} void load(); }}>Войти</button>
            </div>
          </section>
        )}

        <section className="glass flex-1 space-y-3 rounded-[18px] p-3 sm:p-4" aria-live="polite">
          {!turns.length && (
            <div className="space-y-2">
              <p className="text-[13px] text-[var(--text-soft)]">О чём поговорим? Например:</p>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => setText(s)} className="block w-full rounded-lg border border-[var(--line-soft)] px-3 py-2 text-left text-[12.5px] text-[var(--text-soft)] hover:border-[var(--line)] hover:text-[var(--text)]">{s}</button>
              ))}
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--gold)]/12 px-3 py-2 text-[13px]" : "max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-2 text-[13px] leading-relaxed"}>
              {t.text}
            </div>
          ))}
          {status && <p className="text-[12px] text-[var(--text-muted)]">{status}</p>}
          <div ref={endRef} />
        </section>

        <section className="glass sticky bottom-20 rounded-[18px] p-2 sm:p-3">
          <div className="flex items-end gap-2">
            <textarea className={inputClass + " min-h-[42px] resize-none"} rows={2} value={text} placeholder="Вопрос советнику…" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }} />
            <button type="button" onClick={sendText} disabled={!text.trim()} aria-label="Отправить" className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-lg border border-[var(--line-soft)] text-[var(--text-soft)] disabled:opacity-40"><Send size={16} /></button>
            <button type="button" onClick={toggleMic} disabled={live} aria-label={recording ? "Остановить запись" : "Спросить голосом"} className={"grid h-[42px] w-[42px] shrink-0 place-items-center rounded-lg border border-[var(--line-soft)] disabled:opacity-40 " + (recording && !live ? "text-[#ff453a]" : "text-[var(--text-soft)]")}>{recording && !live ? <Square size={15} /> : <Mic size={16} />}</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={toggleLive} className={"inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] " + (live ? "bg-[#ff453a]/15 text-[#ff453a]" : "spectrum-button text-white")}>
              {live ? <MicOff size={14} /> : <Mic size={14} />}{live ? "Завершить разговор" : "Живой разговор голосом"}
            </button>
            <button type="button" onClick={() => void reset()} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"><RotateCcw size={13} />Новая тема</button>
          </div>
        </section>
      </div>
    </main>
  );
}
