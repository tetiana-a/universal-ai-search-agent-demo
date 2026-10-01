"use client";

import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  CirclePause,
  CirclePlay,
  Clock3,
  Command,
  Download,
  ExternalLink,
  FileAudio,
  FileSearch,
  Globe2,
  Layers3,
  Menu,
  Mic,
  Moon,
  PanelLeft,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NavKey, Result, Scenario, Lang, Task } from "@/lib/data";
import { resultsByScenario, scenarios, sourceRegistry, tasks } from "@/lib/data";

type Theme = "dark" | "light";
type ResultFilter = "All" | "Verified" | "High match";
type AudioState = "idle" | "listening" | "transcribing";

const nav: Array<{ key: NavKey; icon: typeof Sparkles; ru: string; en: string }> = [
  { key: "research", icon: Sparkles, ru: "Исследование", en: "Research" },
  { key: "tasks", icon: Layers3, ru: "Задачи", en: "Tasks" },
  { key: "sources", icon: Globe2, ru: "Источники", en: "Sources" },
  { key: "results", icon: BarChart3, ru: "Результаты", en: "Results" },
];

const labels = {
  ru: {
    product: "Универсальный AI Research Engine",
    live: "Система активна",
    workspace: "Рабочее пространство",
    tell: "Скажите агенту, что нужно найти.",
    sub: "Один запрос → источники → исследование → доказательства → дедупликация → структурированный результат.",
    start: "Начать поиск",
    pause: "Пауза",
    resume: "Продолжить",
    stop: "Остановить",
    run: "Текущее исследование",
    progress: "Прогресс",
    remaining: "осталось",
    found: "Источников найдено",
    checked: "Источников проверено",
    qualified: "Подходящих результатов",
    duplicates: "Удалено дублей",
    evidence: "Качество доказательств",
    confidence: "уверенность",
    verified: "Проверено",
    reviewed: "Проверено",
    manual: "Ручная проверка",
    resultsTitle: "Подходящие результаты",
    all: "Все",
    high: "Высокое совпадение",
    export: "Экспорт CSV",
    location: "Местоположение",
    area: "Площадь / профиль",
    price: "Цена / раунд",
    match: "Совпадение",
    evidenceCol: "Доказательство",
    source: "Источник",
    open: "Открыть источник",
    details: "Подробнее",
    registry: "Source Registry",
    real: "Публичные / официальные источники",
    scenario: "Демо-сценарий",
    voice: "Голос и аудио",
    speak: "Говорить",
    mp3: "Распознать MP3",
    listening: "Слушаю…",
    transcribing: "Распознаю…",
    transcriptReady: "Текст получен",
    newResearch: "Новое исследование",
    memory: "Память источников",
    known: "известных источников",
    light: "Светлая",
    dark: "Тёмная",
    sourceHealth: "Состояние источника",
    access: "Доступ",
    lastChecked: "Проверено",
    quality: "Качество",
    status: "Статус",
    active: "Активен",
    review: "Проверка",
    noResults: "Нет результатов по этому фильтру",
    why: "Почему подходит",
    retrieved: "Получено",
    extraction: "Метод извлечения",
    taskId: "ID задачи",
    duration: "Длительность",
    resultCount: "Результатов",
    allTasks: "Все задачи",
    running: "В работе",
    completed: "Завершено",
    paused: "На паузе",
    noRealTime: "Демо-данные • real-time backend подключается следующим этапом",
  },
  en: {
    product: "Universal AI Research Engine",
    live: "System live",
    workspace: "Workspace",
    tell: "Tell the agent what you need to find.",
    sub: "One request → sources → research → evidence → deduplication → structured results.",
    start: "Start research",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    run: "Current research",
    progress: "Progress",
    remaining: "remaining",
    found: "Sources found",
    checked: "Sources checked",
    qualified: "Qualified results",
    duplicates: "Duplicates removed",
    evidence: "Evidence health",
    confidence: "confidence",
    verified: "Verified",
    reviewed: "Reviewed",
    manual: "Manual review",
    resultsTitle: "Qualified results",
    all: "All",
    high: "High match",
    export: "Export CSV",
    location: "Location",
    area: "Area / profile",
    price: "Price / round",
    match: "Match",
    evidenceCol: "Evidence",
    source: "Source",
    open: "Open source",
    details: "Details",
    registry: "Source Registry",
    real: "Public / official sources",
    scenario: "Demo scenario",
    voice: "Voice & audio",
    speak: "Speak",
    mp3: "Transcribe MP3",
    listening: "Listening…",
    transcribing: "Transcribing…",
    transcriptReady: "Transcript ready",
    newResearch: "New research",
    memory: "Source Memory",
    known: "known sources",
    light: "Light",
    dark: "Dark",
    sourceHealth: "Source health",
    access: "Access",
    lastChecked: "Last checked",
    quality: "Quality",
    status: "Status",
    active: "Active",
    review: "Review",
    noResults: "No results for this filter",
    why: "Why it matches",
    retrieved: "Retrieved",
    extraction: "Extraction method",
    taskId: "Task ID",
    duration: "Duration",
    resultCount: "Results",
    allTasks: "All tasks",
    running: "Running",
    completed: "Completed",
    paused: "Paused",
    noRealTime: "Demo data • real-time backend will be connected next",
  },
} as const;

export default function Home() {
  const [lang, setLang] = useState<Lang>("ru");
  const [theme, setTheme] = useState<Theme>("dark");
  const [activeNav, setActiveNav] = useState<NavKey>("research");
  const [scenario, setScenario] = useState<Scenario>("realEstate");
  const [query, setQuery] = useState<string>(scenarios.realEstate.query);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedResult, setSelectedResult] = useState<Result | null>(null);
  const [filter, setFilter] = useState<ResultFilter>("All");
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [transcript, setTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const recognitionRef = useRef<any>(null);
  const t = labels[lang];

  const current = scenarios[scenario];
  const results = resultsByScenario[scenario];

  useEffect(() => {
    const stored = window.localStorage.getItem("aurelius-theme") as Theme | null;
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    window.localStorage.setItem("aurelius-theme", theme);
  }, [theme]);

  useEffect(() => {
    setQuery(lang === "ru" ? current.query : current.queryEn);
  }, [current.query, current.queryEn, lang]);

  useEffect(() => {
    if (!running || progress >= 100) return;
    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(100, value + 2));
    }, 760);
    return () => window.clearInterval(timer);
  }, [running, progress]);

  useEffect(() => {
    if (progress >= 100) setRunning(false);
  }, [progress]);

  const shownResults = useMemo(() => {
    if (filter === "Verified") return results.filter((item) => item.status === "Verified");
    if (filter === "High match") return results.filter((item) => item.match >= 90);
    return results;
  }, [filter, results]);

  function startResearch() {
    setActiveNav("research");
    setProgress(0);
    setRunning(true);
  }

  function exportCsv() {
    const rows = [
      ["Title", "Location", "Area/Profile", "Price/Round", "Match", "Evidence", "Source", "URL"],
      ...shownResults.map((item) => [
        item.title,
        item.location,
        item.area,
        item.price,
        `${item.match}%`,
        item.evidence,
        item.source,
        item.url,
      ]),
    ];

    const csv = rows
      .map((row) =>
        row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aurelius-${scenario}-results.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function startMic() {
    setVoiceError("");

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceError(
        lang === "ru"
          ? "Этот браузер не поддерживает Web Speech API. Используйте MP3."
          : "This browser does not support Web Speech API. Use an MP3 file.",
      );
      return;
    }

    if (audioState === "listening") {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang === "ru" ? "ru-RU" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => setAudioState("listening");
    recognition.onresult = (event: any) => {
      const text = Array.from(event.results)
        .map((result: any) => result[0]?.transcript || "")
        .join(" ");
      setTranscript(text);
      setQuery(text);
    };
    recognition.onerror = (event: any) => {
      setVoiceError(event?.error || "Speech recognition error");
      setAudioState("idle");
    };
    recognition.onend = () => setAudioState("idle");

    recognitionRef.current = recognition;
    recognition.start();
  }

  async function transcribeFile(file: File) {
    setVoiceError("");
    setAudioState("transcribing");
    setTranscript("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("language", lang === "ru" ? "ru" : "en");

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Transcription failed");
      }

      setTranscript(data.text || "");
      setQuery(data.text || "");
    } catch (error) {
      setVoiceError(
        error instanceof Error ? error.message : "Transcription failed",
      );
    } finally {
      setAudioState("idle");
    }
  }

  function sourceFavicon(domain: string) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  }

  function setScenarioAndStay(next: Scenario) {
    setScenario(next);
    setProgress(0);
    setRunning(false);
    setFilter("All");
  }

  function statusLabel(status: Task["status"]) {
    if (status === "Running") return t.running;
    if (status === "Completed") return t.completed;
    return t.paused;
  }

  function renderResearch() {
    return (
      <>
        <section className="glass glow ambient relative overflow-hidden rounded-[30px] p-5 sm:p-7 lg:p-9 float-in">
          <div className="absolute -right-28 -top-32 h-80 w-80 rounded-full bg-[color:color-mix(in_srgb,var(--gold)_10%,transparent)] blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px shimmer opacity-70" />

          <div className="relative max-w-5xl">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--gold-bright)]">
              <Sparkles size={14} />
              {t.product}
            </div>

            <h1 className="mt-4 max-w-4xl text-3xl font-semibold tracking-[-.045em] text-[var(--text)] sm:text-4xl lg:text-[54px]">
              {t.tell}
            </h1>

            <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--text-muted)] sm:text-base">
              {t.sub}
            </p>

            <div className="mt-7 rounded-[22px] border border-[var(--line)] bg-black/20 p-2.5 backdrop-blur-xl">
              <div className="rounded-[17px] border border-[var(--line-soft)] bg-[var(--surface-strong)] p-3 shadow-2xl">
                <textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  rows={4}
                  className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-[var(--text-soft)] outline-none placeholder:text-[var(--text-faint)] sm:text-[15px]"
                  placeholder={lang === "ru" ? "Например: найди..." : "For example: find..."}
                  aria-label="Research query"
                />

                <div className="mt-2 flex flex-col gap-3 border-t border-[var(--line-soft)] pt-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setScenarioAndStay("realEstate")}
                      className={`rounded-full border px-3 py-1.5 text-[10px] transition ${
                        scenario === "realEstate"
                          ? "border-[var(--gold)]/35 bg-[var(--gold)]/10 text-[var(--gold-bright)]"
                          : "border-[var(--line-soft)] text-[var(--text-muted)] hover:border-[var(--gold)]/20"
                      }`}
                    >
                      {scenario === "realEstate" ? "Land / Земля" : "Land"}
                    </button>
                    <button
                      onClick={() => setScenarioAndStay("investors")}
                      className={`rounded-full border px-3 py-1.5 text-[10px] transition ${
                        scenario === "investors"
                          ? "border-[var(--gold)]/35 bg-[var(--gold)]/10 text-[var(--gold-bright)]"
                          : "border-[var(--line-soft)] text-[var(--text-muted)] hover:border-[var(--gold)]/20"
                      }`}
                    >
                      Investors / Инвесторы
                    </button>
                    <button
                      onClick={() => setScenarioAndStay("companies")}
                      className={`rounded-full border px-3 py-1.5 text-[10px] transition ${
                        scenario === "companies"
                          ? "border-[var(--gold)]/35 bg-[var(--gold)]/10 text-[var(--gold-bright)]"
                          : "border-[var(--line-soft)] text-[var(--text-muted)] hover:border-[var(--gold)]/20"
                      }`}
                    >
                      Companies / Компании
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={startMic}
                      className={`panel-hover inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                        audioState === "listening"
                          ? "border-[var(--gold)]/35 bg-[var(--gold)]/10 text-[var(--gold-bright)]"
                          : "border-[var(--line-soft)] bg-[var(--surface)] text-[var(--text-muted)]"
                      }`}
                    >
                      <Mic size={14} />
                      {audioState === "listening" ? t.listening : t.speak}
                    </button>

                    <label className="panel-hover inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
                      <Upload size={14} />
                      {t.mp3}
                      <input
                        type="file"
                        accept=".mp3,.m4a,.wav,.webm,.ogg,.flac,.mp4,audio/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void transcribeFile(file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>

                    <button
                      onClick={startResearch}
                      className="shine-button inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f2d16a] via-[#d4af37] to-[#9d7618] px-5 py-2.5 text-xs font-semibold text-black shadow-[0_12px_38px_rgba(212,175,55,.18)] transition hover:scale-[1.01]"
                    >
                      <Search size={14} />
                      {t.start}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {(transcript || voiceError || audioState === "transcribing") && (
              <div className="soft-focus mt-4 rounded-2xl border border-[var(--line-soft)] bg-[var(--surface)] p-4 backdrop-blur-xl">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <FileAudio size={14} className="text-[var(--gold)]" />
                  {audioState === "transcribing" ? t.transcribing : t.transcriptReady}
                </div>
                {transcript && (
                  <div className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
                    {transcript}
                  </div>
                )}
                {voiceError && (
                  <div className="mt-2 text-xs leading-5 text-[var(--danger)]">
                    {voiceError}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [t.found, current.sourcesFound.toLocaleString(), "+18 today", Globe2],
            [t.checked, current.sourcesChecked.toLocaleString(), `${((current.sourcesChecked / current.sourcesFound) * 100).toFixed(1)}% coverage`, Activity],
            [t.qualified, current.qualified.toLocaleString(), "12 new", Target],
            [t.duplicates, current.duplicates.toLocaleString(), "dedupe engine", FileSearch],
          ].map(([label, value, note, Icon], index) => (
            <div
              key={String(label)}
              className={`glass panel-hover rounded-2xl p-5 float-in ${index > 0 ? `float-in-delay-${Math.min(index, 3)}` : ""}`}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs text-[var(--text-muted)]">{String(label)}</div>
                <Icon size={17} className="text-[var(--gold)]" />
              </div>
              <div className="mt-4 text-3xl font-semibold tracking-tight text-[var(--text)]">
                {String(value)}
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-faint)]">{String(note)}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.5fr_.82fr]">
          <div className="glass rounded-[26px] p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-soft)]">
                  <Activity size={16} className="text-[var(--gold)]" />
                  {t.run}
                </div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  {current.label} · task #AURE-0427
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setRunning((value) => !value)}
                  className="panel-hover inline-flex items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]"
                >
                  {running ? <CirclePause size={14} /> : <CirclePlay size={14} />}
                  {running ? t.pause : t.resume}
                </button>
                <button
                  onClick={() => {
                    setRunning(false);
                    setProgress(0);
                  }}
                  className="panel-hover rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]"
                >
                  {t.stop}
                </button>
              </div>
            </div>

            <div className="mt-7">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-5xl font-semibold tracking-[-.04em] text-[var(--text)]">
                    {progress}%
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)]">{t.progress}</div>
                </div>
                <div className="text-right text-xs text-[var(--text-muted)]">
                  <Clock3 size={13} className="mr-1 inline" />
                  {current.remaining} {t.remaining}
                </div>
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/6">
                <div
                  className="progress-glow h-full rounded-full bg-gradient-to-r from-[#8b6d20] via-[#d4af37] to-[#f6dfa0] transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {current.categories.map(([name, count, quality, strength]) => (
                  <div
                    key={name}
                    className="panel-hover rounded-2xl border border-[var(--line-soft)] bg-[var(--surface)] p-3.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`pulse-dot h-2 w-2 rounded-full ${
                            strength === "strong"
                              ? "bg-[var(--success)]"
                              : strength === "medium"
                                ? "bg-[var(--warning)]"
                                : "bg-white/25"
                          }`}
                        />
                        <span className="truncate text-xs text-[var(--text-soft)]">{name}</span>
                      </div>
                      <span className="text-[10px] text-[var(--text-faint)]">{count}</span>
                    </div>
                    <div className="mt-3 flex justify-between text-[10px] text-[var(--text-muted)]">
                      <span>source quality</span>
                      <span>{quality}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="glass rounded-[26px] p-5 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-soft)]">
              <ShieldCheck size={16} className="text-[var(--gold)]" />
              {t.evidence}
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">field-level confidence</div>

            <div className="mt-7 flex justify-center">
              <div
                className="relative grid h-40 w-40 place-items-center rounded-full"
                style={{
                  background: `conic-gradient(var(--gold) 0deg ${current.evidence * 3.6}deg, color-mix(in srgb, var(--text) 8%, transparent) ${current.evidence * 3.6}deg)`,
                }}
              >
                <div className="grid h-32 w-32 place-items-center rounded-full bg-[var(--bg-soft)] ring-1 ring-[var(--line-soft)]">
                  <div className="text-center">
                    <div className="text-3xl font-semibold text-[var(--text)]">{current.evidence}%</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[.18em] text-[var(--text-faint)]">
                      {t.confidence}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-7 space-y-2">
              {[
                [t.verified, 78, "var(--success)"],
                [t.reviewed, 13, "var(--warning)"],
                [t.manual, 9, "rgba(255,255,255,.28)"],
              ].map(([label, value, color]) => (
                <div className="flex items-center gap-2 text-xs" key={String(label)}>
                  <span className="h-2 w-2 rounded-full" style={{ background: String(color) }} />
                  <span className="text-[var(--text-muted)]">{String(label)}</span>
                  <span className="ml-auto text-[var(--text-soft)]">{String(value)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="glass overflow-hidden rounded-[26px]">
          <div className="flex flex-col gap-4 border-b border-[var(--line-soft)] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-soft)]">
                <BarChart3 size={16} className="text-[var(--gold)]" />
                {t.resultsTitle}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {shownResults.length} visible demo matches
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["All", t.all],
                  ["Verified", t.verified],
                  ["High match", t.high],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-3 py-1.5 text-[10px] transition ${
                    filter === key
                      ? "bg-[var(--gold)]/12 text-[var(--gold-bright)] ring-1 ring-[var(--gold)]/15"
                      : "bg-white/[.03] text-[var(--text-muted)] hover:bg-white/[.05]"
                  }`}
                >
                  {label}
                </button>
              ))}

              <button
                onClick={exportCsv}
                className="panel-hover inline-flex items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]"
              >
                <Download size={12} />
                {t.export}
              </button>
            </div>
          </div>

          <div className="thin-scroll overflow-x-auto">
            {shownResults.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--text-muted)]">{t.noResults}</div>
            ) : (
              <table className="mobile-table w-full border-collapse">
                <thead>
                  <tr className="border-b border-[var(--line-soft)] text-left text-[10px] uppercase tracking-[.15em] text-[var(--text-faint)]">
                    <th className="px-6 py-4 font-medium">Result</th>
                    <th className="px-4 py-4 font-medium">{t.location}</th>
                    <th className="px-4 py-4 font-medium">{t.area}</th>
                    <th className="px-4 py-4 font-medium">{t.price}</th>
                    <th className="px-4 py-4 font-medium">{t.match}</th>
                    <th className="px-4 py-4 font-medium">{t.evidenceCol}</th>
                    <th className="px-4 py-4 font-medium">{t.source}</th>
                    <th className="px-4 py-4" />
                  </tr>
                </thead>
                <tbody>
                  {shownResults.map((item) => (
                    <tr key={item.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-white/[.015]">
                      <td className="px-6 py-4">
                        <div className="font-medium text-[var(--text-soft)]">{item.title}</div>
                        <div className="mt-1 text-[10px] text-[var(--text-faint)]">{item.status}</div>
                      </td>
                      <td className="px-4 py-4 text-xs text-[var(--text-muted)]">{item.location}</td>
                      <td className="px-4 py-4 text-xs text-[var(--text-muted)]">{item.area}</td>
                      <td className="px-4 py-4 text-xs text-[var(--text-soft)]">{item.price}</td>
                      <td className="px-4 py-4">
                        <span className="rounded-full bg-[var(--success)]/8 px-2.5 py-1 text-[10px] text-[var(--success)]">
                          {item.match}%
                        </span>
                      </td>
                      <td className="px-4 py-4 text-[10px] text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-1.5">
                          <Check size={12} className="text-[var(--success)]" />
                          {item.evidence}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <button
                          onClick={() => setSelectedResult(item)}
                          className="inline-flex items-center gap-1.5 text-xs text-[var(--gold-bright)] hover:underline"
                        >
                          {item.source}
                          <ExternalLink size={12} />
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <button
                          onClick={() => setSelectedResult(item)}
                          className="rounded-lg p-2 text-[var(--text-faint)] hover:bg-white/[.04] hover:text-[var(--text-soft)]"
                          aria-label={t.details}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="glass rounded-[26px] p-5 sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.2em] text-[var(--gold)]">
                ONE AGENT.
              </div>
              <div className="mt-1 text-xl font-semibold tracking-tight text-[var(--text)]">
                {lang === "ru" ? "МНОГО ТИПОВ ИССЛЕДОВАНИЯ." : "MANY RESEARCH TASKS."}
              </div>
            </div>
            <div className="text-xs text-[var(--text-muted)]">{t.scenario}</div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["realEstate", "Land / Земля", "Madrid · ≥10,000 m²"],
                ["investors", "Investors / Инвесторы", "Amsterdam · Series A–B"],
                ["companies", "Companies / Компании", "China → EU · B2B"],
              ] as const
            ).map(([key, label, note]) => (
              <button
                key={key}
                onClick={() => setScenarioAndStay(key)}
                className={`panel-hover rounded-2xl border p-4 text-left ${
                  scenario === key
                    ? "border-[var(--gold)]/28 bg-[var(--gold)]/7"
                    : "border-[var(--line-soft)] bg-[var(--surface)]"
                }`}
              >
                <div className="text-sm font-medium text-[var(--text-soft)]">{label}</div>
                <div className="mt-1 text-[10px] text-[var(--gold-bright)]">{note}</div>
              </button>
            ))}
          </div>
        </section>
      </>
    );
  }

  function renderTasks() {
    return (
      <section className="space-y-5">
        <div className="glass glow rounded-[28px] p-6 sm:p-8">
          <div className="text-[10px] font-semibold uppercase tracking-[.22em] text-[var(--gold)]">
            {t.allTasks}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-.035em] text-[var(--text)]">
            {lang === "ru" ? "Все исследовательские задачи" : "All research tasks"}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
            {lang === "ru"
              ? "История запусков, состояние, продолжительность и количество результатов."
              : "Run history, status, duration and result counts."}
          </p>
        </div>

        <div className="grid gap-4">
          {tasks.map((task, index) => (
            <div
              key={task.id}
              className={`glass panel-hover rounded-2xl p-5 float-in float-in-delay-${Math.min(index + 1, 3)}`}
            >
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="icon-lift grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-[var(--gold)]/7 text-[var(--gold)]">
                    {task.status === "Running" ? <Activity size={18} /> : task.status === "Completed" ? <Check size={18} /> : <CirclePause size={18} />}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-soft)]">{task.title}</div>
                    <div className="mt-1 text-[11px] text-[var(--text-muted)]">{task.id} · {task.date}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 lg:min-w-[420px]">
                  {[
                    [t.status, statusLabel(task.status)],
                    [t.duration, task.duration],
                    [t.resultCount, task.results.toString()],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="text-[10px] uppercase tracking-[.12em] text-[var(--text-faint)]">{label}</div>
                      <div className="mt-1 text-sm text-[var(--text-soft)]">{value}</div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => {
                    setScenario(task.scenario);
                    setActiveNav("research");
                  }}
                  className="panel-hover inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--gold-bright)]"
                >
                  {lang === "ru" ? "Открыть" : "Open"}
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderSources() {
    return (
      <section className="space-y-5">
        <div className="glass glow rounded-[28px] p-6 sm:p-8">
          <div className="text-[10px] font-semibold uppercase tracking-[.22em] text-[var(--gold)]">
            Source Registry
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-.035em] text-[var(--text)]">
            {lang === "ru" ? "Память источников" : "Source memory"}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
            {lang === "ru"
              ? "Реальные публичные и официальные источники, которые демонстрационно участвуют в архитектуре discovery / validation."
              : "Real public and official sources used to demonstrate discovery and validation paths."}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sourceRegistry.map((source, index) => (
            <div
              key={`${source.name}-${source.domain}`}
              className={`glass panel-hover rounded-2xl p-4 float-in float-in-delay-${Math.min((index % 3) + 1, 3)}`}
            >
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-[var(--line-soft)] bg-[var(--surface)]">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${source.domain}&sz=128`}
                    alt=""
                    className="h-6 w-6"
                    referrerPolicy="no-referrer"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--text-soft)]">{source.name}</div>
                      <div className="mt-1 text-[10px] text-[var(--text-muted)]">{source.category}</div>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-[9px] ${
                        source.health === "Healthy"
                          ? "bg-[var(--success)]/8 text-[var(--success)]"
                          : source.health === "Warning"
                            ? "bg-[var(--warning)]/8 text-[var(--warning)]"
                            : "bg-white/6 text-[var(--text-muted)]"
                      }`}
                    >
                      {source.health}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-[10px]">
                    <div>
                      <div className="text-[var(--text-faint)]">{t.quality}</div>
                      <div className="mt-1 text-[var(--text-soft)]">{source.quality}%</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-faint)]">{t.lastChecked}</div>
                      <div className="mt-1 text-[var(--text-soft)]">{source.lastChecked}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-faint)]">{t.access}</div>
                      <div className="mt-1 text-[var(--text-muted)]">{source.method}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-faint)]">{t.status}</div>
                      <div className="mt-1 text-[var(--text-muted)]">{source.status === "Active" ? t.active : t.review}</div>
                    </div>
                  </div>

                  <div className="mt-4 text-[11px] leading-5 text-[var(--text-muted)]">{source.description}</div>

                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--gold-bright)]"
                  >
                    {t.open}
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderResults() {
    return (
      <section className="space-y-5">
        <div className="glass glow rounded-[28px] p-6 sm:p-8">
          <div className="text-[10px] font-semibold uppercase tracking-[.22em] text-[var(--gold)]">
            Qualified Results
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-.035em] text-[var(--text)]">
            {lang === "ru" ? "Результаты исследования" : "Research results"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
            {lang === "ru"
              ? "Открывайте результат, источник и evidence в одном месте."
              : "Open a result, its source and evidence in one place."}
          </p>
        </div>

        <div className="glass overflow-hidden rounded-[26px]">
          <div className="flex flex-wrap gap-2 border-b border-[var(--line-soft)] p-5">
            {(
              [
                ["All", t.all],
                ["Verified", t.verified],
                ["High match", t.high],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-full px-3 py-1.5 text-[10px] ${
                  filter === key
                    ? "bg-[var(--gold)]/12 text-[var(--gold-bright)]"
                    : "bg-white/[.03] text-[var(--text-muted)]"
                }`}
              >
                {label}
              </button>
            ))}

            <button
              onClick={exportCsv}
              className="panel-hover ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]"
            >
              <Download size={12} />
              {t.export}
            </button>
          </div>

          <div className="thin-scroll overflow-x-auto">
            <table className="mobile-table w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--line-soft)] text-left text-[10px] uppercase tracking-[.15em] text-[var(--text-faint)]">
                  <th className="px-6 py-4">Result</th>
                  <th className="px-4 py-4">{t.location}</th>
                  <th className="px-4 py-4">{t.area}</th>
                  <th className="px-4 py-4">{t.price}</th>
                  <th className="px-4 py-4">{t.match}</th>
                  <th className="px-4 py-4">{t.source}</th>
                  <th className="px-4 py-4" />
                </tr>
              </thead>
              <tbody>
                {shownResults.map((item) => (
                  <tr key={item.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-white/[.015]">
                    <td className="px-6 py-4">
                      <div className="text-sm text-[var(--text-soft)]">{item.title}</div>
                      <div className="mt-1 text-[10px] text-[var(--text-muted)]">{item.status}</div>
                    </td>
                    <td className="px-4 py-4 text-xs text-[var(--text-muted)]">{item.location}</td>
                    <td className="px-4 py-4 text-xs text-[var(--text-muted)]">{item.area}</td>
                    <td className="px-4 py-4 text-xs text-[var(--text-soft)]">{item.price}</td>
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-[var(--success)]/8 px-2.5 py-1 text-[10px] text-[var(--success)]">
                        {item.match}%
                      </span>
                    </td>
                    <td className="px-4 py-4 text-xs text-[var(--text-muted)]">{item.source}</td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => setSelectedResult(item)}
                        className="rounded-lg border border-[var(--line-soft)] p-2 text-[var(--text-muted)] hover:border-[var(--line)] hover:text-[var(--gold-bright)]"
                      >
                        <ArrowUpRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  function renderActiveView() {
    if (activeNav === "tasks") return renderTasks();
    if (activeNav === "sources") return renderSources();
    if (activeNav === "results") return renderResults();
    return renderResearch();
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-300">
      <div className="app-grid pointer-events-none fixed inset-0 -z-10 opacity-45" />

      <div className="mx-auto flex min-h-screen max-w-[1900px]">
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-[280px] border-r border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] p-5 backdrop-blur-2xl transition-transform duration-300 lg:static lg:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[.34em] text-[var(--gold)]">AURELIUS</div>
                <div className="mt-1 text-[17px] font-semibold tracking-tight text-[var(--text)]">{t.product}</div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-xl p-2 text-[var(--text-muted)] lg:hidden"
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="mt-10 space-y-1">
              {nav.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setActiveNav(item.key);
                      setMobileOpen(false);
                    }}
                    className={`group flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm transition ${
                      active
                        ? "border border-[var(--line)] bg-[var(--gold)]/7 text-[var(--text)]"
                        : "border border-transparent text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-soft)]"
                    }`}
                  >
                    <Icon className="icon-lift" size={17} color={active ? "var(--gold)" : "currentColor"} />
                    <span>{lang === "ru" ? item.ru : item.en}</span>
                    {item.key === "tasks" && (
                      <span className="ml-auto rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                        3
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="glass mt-8 rounded-2xl p-4 panel-hover">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--gold)]">
                <ShieldCheck size={14} />
                {t.memory}
              </div>
              <div className="mt-3 text-2xl font-semibold text-[var(--text)]">12,480</div>
              <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t.known}</div>
            </div>

            <div className="mt-auto space-y-1">
              <button
                className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3.5 py-3 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                onClick={() => setActiveNav("research")}
              >
                <Settings2 size={17} />
                {lang === "ru" ? "Настройки" : "Settings"}
              </button>

              <div className="mt-3 border-t border-[var(--line-soft)] pt-4">
                <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#f0cf63] via-[#d4af37] to-[#765814] text-xs font-bold text-black">
                    TK
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--text-soft)]">Lead Workspace</div>
                    <div className="truncate text-xs text-[var(--text-faint)]">prototype • 2026</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {mobileOpen && (
          <button
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
        )}

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-[74px] items-center justify-between border-b border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] px-4 backdrop-blur-2xl sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] p-2 text-[var(--text-muted)] lg:hidden"
                aria-label="Open navigation"
              >
                <PanelLeft size={18} />
              </button>

              <div className="hidden items-center gap-2 text-xs text-[var(--text-faint)] sm:flex">
                <span>{t.workspace}</span>
                <span>/</span>
                <span className="text-[var(--text-soft)]">
                  {lang === "ru"
                    ? nav.find((item) => item.key === activeNav)?.ru
                    : nav.find((item) => item.key === activeNav)?.en}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-faint)] md:flex">
                <Command size={13} /> K
              </div>

              <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--gold)]/6 px-3 py-1.5 text-[11px] text-[var(--gold-bright)]">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                {t.live}
              </div>

              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="panel-hover grid h-9 w-9 place-items-center rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] text-[var(--text-muted)]"
                aria-label={theme === "dark" ? t.light : t.dark}
                title={theme === "dark" ? t.light : t.dark}
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </button>

              <div className="flex overflow-hidden rounded-xl border border-[var(--line-soft)] bg-[var(--surface)]">
                <button
                  onClick={() => setLang("ru")}
                  className={`px-2.5 py-1.5 text-[10px] ${lang === "ru" ? "bg-[var(--gold)]/10 text-[var(--gold-bright)]" : "text-[var(--text-muted)]"}`}
                >
                  RU
                </button>
                <button
                  onClick={() => setLang("en")}
                  className={`px-2.5 py-1.5 text-[10px] ${lang === "en" ? "bg-[var(--gold)]/10 text-[var(--gold-bright)]" : "text-[var(--text-muted)]"}`}
                >
                  EN
                </button>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1540px] px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-14 lg:pt-9">
            <div className="space-y-6 soft-focus">{renderActiveView()}</div>
          </div>
        </section>
      </div>

      {selectedResult && (
        <div className="fixed inset-0 z-[80] flex justify-end bg-black/55 backdrop-blur-sm">
          <button
            className="absolute inset-0"
            aria-label="Close result"
            onClick={() => setSelectedResult(null)}
          />
          <aside className="float-in relative h-full w-full max-w-[560px] overflow-y-auto border-l border-[var(--line)] bg-[var(--surface-strong)] p-5 shadow-2xl backdrop-blur-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--gold)]">
                  {t.details}
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">
                  {selectedResult.title}
                </h2>
              </div>
              <button
                onClick={() => setSelectedResult(null)}
                className="rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] p-2 text-[var(--text-muted)]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {[
                [t.location, selectedResult.location],
                [t.area, selectedResult.area],
                [t.price, selectedResult.price],
                [t.match, `${selectedResult.match}%`],
              ].map(([label, value]) => (
                <div className="glass-soft rounded-xl p-4" key={String(label)}>
                  <div className="text-[10px] text-[var(--text-faint)]">{String(label)}</div>
                  <div className="mt-1 text-sm text-[var(--text-soft)]">{String(value)}</div>
                </div>
              ))}
            </div>

            <div className="glass-soft mt-5 rounded-2xl p-5">
              <div className="text-xs font-medium text-[var(--text-soft)]">{t.why}</div>
              <div className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                {selectedResult.why}
              </div>
            </div>

            <div className="glass-soft mt-5 rounded-2xl p-5">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-soft)]">
                <ShieldCheck size={14} className="text-[var(--gold)]" />
                {t.evidenceCol}
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                {selectedResult.evidence}
              </div>
              <div className="mt-4 text-[10px] text-[var(--text-faint)]">
                {t.retrieved}: demo timestamp
              </div>
              <div className="mt-1 text-[10px] text-[var(--text-faint)]">
                {t.extraction}: public source / browser / parser (demo)
              </div>
            </div>

            <a
              href={selectedResult.url}
              target="_blank"
              rel="noreferrer"
              className="shine-button mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f0cf63] via-[#d4af37] to-[#9d7618] px-4 py-3 text-sm font-semibold text-black"
            >
              <ExternalLink size={15} />
              {t.open}
            </a>
          </aside>
        </div>
      )}

      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-[10px] text-[var(--text-muted)] shadow-2xl backdrop-blur-xl">
        <span className="inline-flex items-center gap-2">
          <Sparkles size={12} className="text-[var(--gold)]" />
          {t.voice} • {t.noRealTime}
        </span>
      </div>

      <button
        onClick={() => {
          setActiveNav("research");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className="shine-button fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#f0cf63] via-[#d4af37] to-[#9d7618] text-black shadow-[0_14px_42px_rgba(212,175,55,.24)] ring-4 ring-[var(--bg)] lg:hidden"
        aria-label={t.newResearch}
      >
        <Sparkles size={19} />
      </button>
    </main>
  );
}
