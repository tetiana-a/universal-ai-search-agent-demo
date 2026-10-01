"use client";

import {
  Activity,
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
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Lang,
  Result,
  Scenario,
  resultsByScenario,
  scenarios,
  sourceRegistry,
} from "@/lib/data";

type NavKey = "research" | "tasks" | "sources" | "results";
type ResultFilter = "All" | "Verified" | "High match";
type AudioState = "idle" | "listening" | "transcribing";

const dictionary = {
  ru: {
    product: "Универсальный AI Research Engine",
    research: "Исследование",
    tasks: "Задачи",
    sources: "Источники",
    results: "Результаты",
    settings: "Настройки",
    sourceMemory: "Память источников",
    knownSources: "известных источников",
    live: "Система активна",
    workspace: "Рабочее пространство",
    tell: "Скажите агенту, что нужно найти.",
    sub:
      "Один запрос → обнаружение источников → глубокое исследование → доказательства → дедупликация → структурированный результат.",
    start: "Начать поиск",
    pause: "Пауза",
    resume: "Продолжить",
    stop: "Остановить",
    currentRun: "Текущее исследование",
    progress: "Прогресс",
    remaining: "осталось",
    sourcesFound: "Источников найдено",
    sourcesChecked: "Источников проверено",
    qualified: "Подходящих результатов",
    duplicates: "Удалено дублей",
    evidence: "Качество доказательств",
    confidence: "уверенность",
    verified: "Проверено",
    reviewed: "Проверено",
    manual: "Ручная проверка",
    qualifiedResults: "Подходящие результаты",
    export: "Экспорт CSV",
    all: "Все",
    highMatch: "Высокое совпадение",
    location: "Местоположение",
    area: "Площадь / профиль",
    price: "Цена / раунд",
    match: "Совпадение",
    evidenceCol: "Доказательство",
    source: "Источник",
    sourceRegistry: "Source Registry",
    health: "Состояние",
    method: "Метод доступа",
    lastChecked: "Проверено",
    quality: "Качество",
    status: "Статус",
    demoScenario: "Демо-сценарий",
    voice: "Голос и аудио",
    mic: "Говорить",
    mp3: "Распознать MP3",
    listening: "Слушаю…",
    transcribing: "Распознаю аудио…",
    transcriptReady: "Текст получен.",
    demoMode: "Демо-режим",
    realSources: "Реальные источники",
    open: "Открыть источник",
    details: "Подробнее",
    why: "Почему подходит",
    retrieved: "Получено",
    extraction: "Метод извлечения",
    land: "Земля",
    investors: "Инвесторы",
    companies: "Компании",
    newResearch: "Новое исследование",
  },
  en: {
    product: "Universal AI Research Engine",
    research: "Research",
    tasks: "Tasks",
    sources: "Sources",
    results: "Results",
    settings: "Settings",
    sourceMemory: "Source Memory",
    knownSources: "known sources",
    live: "System live",
    workspace: "Workspace",
    tell: "Tell the agent what you need to find.",
    sub:
      "One request → source discovery → deep research → evidence → deduplication → structured results.",
    start: "Start research",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    currentRun: "Current research",
    progress: "Progress",
    remaining: "remaining",
    sourcesFound: "Sources found",
    sourcesChecked: "Sources checked",
    qualified: "Qualified results",
    duplicates: "Duplicates removed",
    evidence: "Evidence health",
    confidence: "confidence",
    verified: "Verified evidence",
    reviewed: "Reviewed",
    manual: "Manual review",
    qualifiedResults: "Qualified results",
    export: "Export CSV",
    all: "All",
    highMatch: "High match",
    location: "Location",
    area: "Area / profile",
    price: "Price / round",
    match: "Match",
    evidenceCol: "Evidence",
    source: "Source",
    sourceRegistry: "Source Registry",
    health: "Health",
    method: "Access method",
    lastChecked: "Last checked",
    quality: "Quality",
    status: "Status",
    demoScenario: "Demo scenario",
    voice: "Voice & audio",
    mic: "Speak",
    mp3: "Transcribe MP3",
    listening: "Listening…",
    transcribing: "Transcribing audio…",
    transcriptReady: "Transcript ready.",
    demoMode: "Demo mode",
    realSources: "Real sources",
    open: "Open source",
    details: "Details",
    why: "Why it matches",
    retrieved: "Retrieved",
    extraction: "Extraction method",
    land: "Land",
    investors: "Investors",
    companies: "Companies",
    newResearch: "New research",
  },
} as const;

export default function Home() {
  const [lang, setLang] = useState<Lang>("ru");
  const t = dictionary[lang];

  const [scenario, setScenario] = useState<Scenario>("realEstate");
  const [activeNav, setActiveNav] = useState<NavKey>("research");
  const [query, setQuery] = useState(scenarios.realEstate.query);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedResult, setSelectedResult] = useState<Result | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("All");
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [transcript, setTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const recognitionRef = useRef<any>(null);

  const current = scenarios[scenario];
  const results = resultsByScenario[scenario];

  useEffect(() => {
    setQuery(lang === "ru" ? current.query : current.queryEn);
  }, [current.query, current.queryEn, lang]);

  useEffect(() => {
    if (!running || progress >= 100) return;

    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(100, value + 2));
    }, 800);

    return () => window.clearInterval(timer);
  }, [progress, running]);

  useEffect(() => {
    if (progress >= 100) {
      setRunning(false);
    }
  }, [progress]);

  const shownResults = useMemo(() => {
    if (resultFilter === "Verified") {
      return results.filter((item) => item.status === "Verified");
    }

    if (resultFilter === "High match") {
      return results.filter((item) => item.match >= 90);
    }

    return results;
  }, [resultFilter, results]);

  function startResearch() {
    setProgress(0);
    setRunning(true);
    setActiveNav("research");
  }

  function exportCsv() {
    const rows = [
      [
        "Title",
        "Location",
        "Area/Profile",
        "Price/Round",
        "Match",
        "Evidence",
        "Source",
        "URL",
      ],
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
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8",
    });

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
          : "This browser does not support the Web Speech API. Use an MP3 file.",
      );
      return;
    }

    if (audioState === "listening") {
      recognitionRef.current?.stop();
      setAudioState("idle");
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = lang === "ru" ? "ru-RU" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setAudioState("listening");
    };

    recognition.onresult = (event: any) => {
      const text = Array.from(event.results)
        .map((result: any) => result[0]?.transcript || "")
        .join(" ");

      setTranscript(text);
      setQuery(text);
    };

    recognition.onerror = (event: any) => {
      setVoiceError(
        event?.error ||
          (lang === "ru"
            ? "Ошибка распознавания."
            : "Speech recognition error."),
      );
      setAudioState("idle");
    };

    recognition.onend = () => {
      setAudioState("idle");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  async function transcribeFile(file: File) {
    setVoiceError("");
    setTranscript("");
    setAudioState("transcribing");

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
        throw new Error(
          data?.error ||
            (lang === "ru"
              ? "Не удалось распознать аудио."
              : "Transcription failed."),
        );
      }

      setTranscript(data.text || "");
      setQuery(data.text || "");
    } catch (error) {
      setVoiceError(
        error instanceof Error ? error.message : "Transcription failed.",
      );
    } finally {
      setAudioState("idle");
    }
  }

  function faviconUrl(domain: string) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  }

  return (
    <main className="min-h-screen bg-[#040403]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_88%_-8%,rgba(212,175,55,.12),transparent_30%),radial-gradient(circle_at_0%_22%,rgba(255,255,255,.035),transparent_23%),radial-gradient(circle_at_65%_85%,rgba(212,175,55,.04),transparent_30%)]" />

      <div className="mx-auto flex min-h-screen max-w-[1820px]">
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-[270px] border-r border-white/6 bg-[#060605]/96 p-5 backdrop-blur-2xl transition-transform duration-200 lg:static lg:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between px-1">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.30em] text-[#d4af37]">
                  AURELIUS
                </div>
                <div className="mt-1 text-[17px] font-semibold tracking-tight text-[#f4ead0]">
                  {t.product}
                </div>
              </div>

              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-2 text-white/35 hover:bg-white/5 lg:hidden"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="mt-9 space-y-1">
              {(
                [
                  ["research", t.research, Sparkles],
                  ["tasks", t.tasks, Layers3],
                  ["sources", t.sources, Globe2],
                  ["results", t.results, BarChart3],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => {
                    setActiveNav(key);
                    setMobileOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm transition ${
                    activeNav === key
                      ? "bg-[#d4af37]/8 text-[#f4ead0] ring-1 ring-[#d4af37]/14"
                      : "text-white/48 hover:bg-white/[.03] hover:text-white/75"
                  }`}
                >
                  <Icon
                    size={17}
                    className={activeNav === key ? "text-[#d4af37]" : ""}
                  />
                  <span>{label}</span>

                  {key === "tasks" && (
                    <span className="ml-auto rounded-full bg-white/7 px-2 py-0.5 text-[10px] text-white/35">
                      3
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className="mt-8 rounded-2xl border border-[#d4af37]/14 bg-[#d4af37]/4 p-4">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d4af37]">
                <ShieldCheck size={14} />
                {t.sourceMemory}
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">
                12,480
              </div>
              <div className="mt-1 text-xs leading-5 text-white/34">
                {t.knownSources}
              </div>
            </div>

            <div className="mt-auto">
              <button className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm text-white/45 hover:bg-white/[.03]">
                <Settings2 size={17} />
                {t.settings}
              </button>

              <div className="mt-3 border-t border-white/6 pt-4">
                <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#f0cf63] via-[#d4af37] to-[#765814] text-xs font-bold text-black">
                    TK
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white/76">
                      Lead Workspace
                    </div>
                    <div className="truncate text-xs text-white/28">
                      prototype • 2026
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {mobileOpen && (
          <button
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-white/6 bg-[#040403]/80 px-4 backdrop-blur-2xl sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="rounded-xl p-2 text-white/55 hover:bg-white/5 lg:hidden"
                aria-label="Open navigation"
              >
                <Menu size={20} />
              </button>

              <div className="hidden items-center gap-2 text-xs text-white/28 sm:flex">
                <span>{t.workspace}</span>
                <span>/</span>
                <span className="text-white/65">
                  {t[activeNav]}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-white/7 bg-white/[.02] px-3 py-1.5 text-xs text-white/34 md:flex">
                <Command size={13} />
                K
              </div>

              <div className="flex items-center gap-2 rounded-full border border-[#d4af37]/15 bg-[#d4af37]/5 px-3 py-1.5 text-[11px] text-[#e9d58f]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#8bd7a1] shadow-[0_0_10px_#8bd7a1]" />
                {t.live}
              </div>

              <div className="relative">
                <button
                  onClick={() => setLangMenuOpen((value) => !value)}
                  className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs text-white/50 hover:bg-white/5"
                >
                  {lang.toUpperCase()}
                  <ChevronDown size={13} />
                </button>

                {langMenuOpen && (
                  <div className="absolute right-0 mt-2 w-28 rounded-xl border border-white/8 bg-[#0b0b09] p-1 shadow-2xl">
                    {(["ru", "en"] as Lang[]).map((value) => (
                      <button
                        key={value}
                        onClick={() => {
                          setLang(value);
                          setLangMenuOpen(false);
                        }}
                        className={`w-full rounded-lg px-3 py-2 text-left text-xs ${
                          lang === value
                            ? "bg-[#d4af37]/10 text-[#f0cf63]"
                            : "text-white/45 hover:bg-white/5"
                        }`}
                      >
                        {value === "ru" ? "Русский" : "English"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1520px] px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-9">
            <div className="space-y-6">
              <section className="relative overflow-hidden rounded-[28px] border border-[#d4af37]/16 bg-gradient-to-b from-white/[.035] to-white/[.012] p-5 shadow-[0_18px_70px_rgba(0,0,0,.38)] backdrop-blur-2xl sm:p-7 lg:p-9">
                <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#d4af37]/8 blur-3xl" />

                <div className="relative max-w-4xl">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#d4af37]">
                    <Sparkles size={14} />
                    {t.product}
                  </div>

                  <h1 className="mt-4 text-3xl font-semibold tracking-[-.035em] text-[#f7f0df] sm:text-4xl lg:text-[48px]">
                    {t.tell}
                  </h1>

                  <p className="mt-3 max-w-2xl text-sm leading-6 text-white/38 sm:text-base">
                    {t.sub}
                  </p>

                  <div className="mt-7 rounded-2xl border border-[#d4af37]/14 bg-black/25 p-2">
                    <div className="rounded-xl bg-[#080807]/85 p-3 ring-1 ring-white/6">
                      <textarea
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        rows={3}
                        aria-label="Research query"
                        className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-white/82 outline-none placeholder:text-white/22"
                      />

                      <div className="flex flex-col gap-3 border-t border-white/6 pt-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/8 bg-white/[.025] px-2.5 py-1 text-[10px] text-white/44">
                            {scenario === "realEstate"
                              ? t.land
                              : scenario === "investors"
                                ? t.investors
                                : t.companies}
                          </span>

                          <span className="rounded-full border border-white/8 bg-white/[.025] px-2.5 py-1 text-[10px] text-white/44">
                            {scenario === "realEstate"
                              ? "Madrid"
                              : scenario === "investors"
                                ? "Amsterdam"
                                : "China → EU"}
                          </span>

                          <span className="rounded-full border border-white/8 bg-white/[.025] px-2.5 py-1 text-[10px] text-white/44">
                            {scenario === "realEstate"
                              ? "≥ 10,000 m²"
                              : scenario === "investors"
                                ? "Series A–B"
                                : "EU export"}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={startMic}
                            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs ${
                              audioState === "listening"
                                ? "border-[#d4af37]/30 bg-[#d4af37]/10 text-[#f0cf63]"
                                : "border-white/8 bg-white/[.025] text-white/58 hover:bg-white/5"
                            }`}
                          >
                            <Mic size={14} />
                            {audioState === "listening" ? t.listening : t.mic}
                          </button>

                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/8 bg-white/[.025] px-3 py-2.5 text-xs text-white/58 hover:bg-white/5">
                            <Upload size={14} />
                            {t.mp3}
                            <input
                              type="file"
                              accept=".mp3,.m4a,.wav,.webm,.ogg,.flac,.mp4,audio/*"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0];

                                if (file) {
                                  void transcribeFile(file);
                                }

                                event.currentTarget.value = "";
                              }}
                            />
                          </label>

                          <button
                            onClick={startResearch}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f0cf63] via-[#d4af37] to-[#a77d18] px-4 py-2.5 text-xs font-semibold text-black shadow-[0_10px_30px_rgba(212,175,55,.15)] transition hover:brightness-110"
                          >
                            <Search size={14} />
                            {t.start}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {(transcript ||
                    voiceError ||
                    audioState === "transcribing") && (
                    <div className="mt-4 rounded-2xl border border-white/7 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-xs text-white/40">
                        <FileAudio size={14} className="text-[#d4af37]" />
                        {audioState === "transcribing"
                          ? t.transcribing
                          : t.transcriptReady}
                      </div>

                      {transcript && (
                        <div className="mt-2 text-sm leading-6 text-white/68">
                          {transcript}
                        </div>
                      )}

                      {voiceError && (
                        <div className="mt-2 text-xs leading-5 text-[#d97c72]">
                          {voiceError}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  [
                    t.sourcesFound,
                    current.sourcesFound.toLocaleString(),
                    "+18 today",
                    Globe2,
                  ],
                  [
                    t.sourcesChecked,
                    current.sourcesChecked.toLocaleString(),
                    `${((current.sourcesChecked / current.sourcesFound) * 100).toFixed(1)}% coverage`,
                    Activity,
                  ],
                  [t.qualified, current.qualified.toLocaleString(), "12 new", Target],
                  [t.duplicates, current.duplicates.toLocaleString(), "dedupe engine", FileSearch],
                ].map(([label, value, note, Icon]) => (
                  <div
                    className="rounded-2xl border border-[#d4af37]/12 bg-white/[.018] p-5 shadow-[0_18px_60px_rgba(0,0,0,.22)] backdrop-blur-xl"
                    key={String(label)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-white/34">{String(label)}</div>
                      <Icon size={17} className="text-[#d4af37]" />
                    </div>

                    <div className="mt-4 text-3xl font-semibold tracking-tight text-white/90">
                      {String(value)}
                    </div>

                    <div className="mt-1 text-[11px] text-white/28">
                      {String(note)}
                    </div>
                  </div>
                ))}
              </section>

              <section className="grid gap-5 xl:grid-cols-[1.45fr_.85fr]">
                <div className="rounded-[24px] border border-[#d4af37]/12 bg-white/[.018] p-5 shadow-[0_18px_60px_rgba(0,0,0,.30)] backdrop-blur-2xl sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-white/78">
                        <Activity size={16} className="text-[#d4af37]" />
                        {t.currentRun}
                      </div>

                      <div className="mt-1 text-xs text-white/28">
                        {lang === "ru" ? "Сценарий" : "Scenario"}: {current.label} · task #AURE-0427
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setRunning((value) => !value)}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/8 bg-white/[.03] px-3 py-2 text-xs text-white/58 hover:bg-white/5"
                      >
                        {running ? (
                          <CirclePause size={14} />
                        ) : (
                          <CirclePlay size={14} />
                        )}
                        {running ? t.pause : t.resume}
                      </button>

                      <button
                        onClick={() => {
                          setRunning(false);
                          setProgress(0);
                        }}
                        className="rounded-xl border border-white/8 bg-white/[.03] px-3 py-2 text-xs text-white/38 hover:text-white/58"
                      >
                        {t.stop}
                      </button>
                    </div>
                  </div>

                  <div className="mt-7">
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-4xl font-semibold text-white">
                          {progress}%
                        </div>
                        <div className="mt-1 text-xs text-white/28">
                          {t.progress}
                        </div>
                      </div>

                      <div className="text-right text-xs text-white/28">
                        <Clock3 size={13} className="mr-1 inline" />
                        {current.remaining} {t.remaining}
                      </div>
                    </div>

                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/6">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#8b6d20] via-[#d4af37] to-[#f6dfa0] transition-all duration-700"
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      {current.categories.map(([name, count, quality, state]) => (
                        <div
                          className="rounded-2xl border border-white/6 bg-white/[.018] p-3.5"
                          key={name}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  state === "strong"
                                    ? "bg-[#8bd7a1]"
                                    : state === "medium"
                                      ? "bg-[#e0c16d]"
                                      : "bg-white/20"
                                }`}
                              />

                              <span className="truncate text-xs text-white/65">
                                {name}
                              </span>
                            </div>

                            <span className="text-[10px] text-white/27">
                              {count}
                            </span>
                          </div>

                          <div className="mt-3 flex justify-between text-[10px] text-white/28">
                            <span>source quality</span>
                            <span>{quality}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-[#d4af37]/12 bg-white/[.018] p-5 shadow-[0_18px_60px_rgba(0,0,0,.30)] backdrop-blur-2xl sm:p-6">
                  <div className="flex items-center gap-2 text-sm font-medium text-white/78">
                    <ShieldCheck size={16} className="text-[#d4af37]" />
                    {t.evidence}
                  </div>

                  <div className="mt-1 text-xs text-white/28">
                    field-level confidence
                  </div>

                  <div className="mt-7 flex justify-center">
                    <div
                      className="relative grid h-40 w-40 place-items-center rounded-full"
                      style={{
                        background: `conic-gradient(#d4af37 0deg ${current.evidence * 3.6}deg, rgba(255,255,255,.06) ${current.evidence * 3.6}deg)`,
                      }}
                    >
                      <div className="grid h-32 w-32 place-items-center rounded-full bg-[#090908] ring-1 ring-white/6">
                        <div className="text-center">
                          <div className="text-3xl font-semibold text-white">
                            {current.evidence}%
                          </div>
                          <div className="mt-1 text-[10px] uppercase tracking-[.18em] text-white/24">
                            {t.confidence}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-7 space-y-2">
                    {[
                      [t.verified, 78, "#8bd7a1"],
                      [t.reviewed, 13, "#e0c16d"],
                      [t.manual, 9, "rgba(255,255,255,.26)"],
                    ].map(([label, value, color]) => (
                      <div
                        className="flex items-center gap-2 text-xs"
                        key={String(label)}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: String(color) }}
                        />
                        <span className="text-white/45">
                          {String(label)}
                        </span>
                        <span className="ml-auto text-white/65">
                          {String(value)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-[24px] border border-[#d4af37]/12 bg-white/[.018] shadow-[0_18px_60px_rgba(0,0,0,.30)] backdrop-blur-2xl">
                <div className="flex flex-col gap-4 border-b border-white/6 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-white/78">
                      <BarChart3 size={16} className="text-[#d4af37]" />
                      {t.qualifiedResults}
                    </div>

                    <div className="mt-1 text-xs text-white/28">
                      {current.qualified} matches in demo data
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["All", t.all],
                        ["Verified", t.verified],
                        ["High match", t.highMatch],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setResultFilter(key)}
                        className={`rounded-full px-3 py-1.5 text-[10px] ${
                          resultFilter === key
                            ? "bg-[#d4af37]/12 text-[#e9d58f] ring-1 ring-[#d4af37]/14"
                            : "bg-white/[.03] text-white/34 hover:text-white/60"
                        }`}
                      >
                        {label}
                      </button>
                    ))}

                    <button
                      onClick={exportCsv}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[.03] px-3 py-1.5 text-[10px] text-white/52 hover:bg-white/5"
                    >
                      <Download size={12} />
                      {t.export}
                    </button>
                  </div>
                </div>

                <div className="thin-scroll overflow-x-auto">
                  <table className="min-w-[900px] w-full border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-left text-[10px] uppercase tracking-[.16em] text-white/21">
                        <th className="px-6 py-4 font-medium">Result</th>
                        <th className="px-4 py-4 font-medium">{t.location}</th>
                        <th className="px-4 py-4 font-medium">{t.area}</th>
                        <th className="px-4 py-4 font-medium">{t.price}</th>
                        <th className="px-4 py-4 font-medium">{t.match}</th>
                        <th className="px-4 py-4 font-medium">
                          {t.evidenceCol}
                        </th>
                        <th className="px-4 py-4 font-medium">{t.source}</th>
                        <th className="px-4 py-4" />
                      </tr>
                    </thead>

                    <tbody>
                      {shownResults.map((item) => (
                        <tr
                          key={item.id}
                          className="border-b border-white/5 last:border-0 hover:bg-white/[.018]"
                        >
                          <td className="px-6 py-4">
                            <div className="font-medium text-white/76">
                              {item.title}
                            </div>
                            <div className="mt-1 text-[10px] text-white/26">
                              {item.status}
                            </div>
                          </td>

                          <td className="px-4 py-4 text-xs text-white/46">
                            {item.location}
                          </td>

                          <td className="px-4 py-4 text-xs text-white/54">
                            {item.area}
                          </td>

                          <td className="px-4 py-4 text-xs text-white/60">
                            {item.price}
                          </td>

                          <td className="px-4 py-4">
                            <span className="rounded-full bg-[#8bd7a1]/7 px-2.5 py-1 text-[10px] text-[#8bd7a1]">
                              {item.match}%
                            </span>
                          </td>

                          <td className="px-4 py-4">
                            <div className="flex items-center gap-1.5 text-[10px] text-white/44">
                              <Check size={12} className="text-[#8bd7a1]" />
                              {item.evidence}
                            </div>
                          </td>

                          <td className="px-4 py-4">
                            <button
                              onClick={() => setSelectedResult(item)}
                              className="inline-flex items-center gap-2 text-left text-xs text-[#d9be62] hover:text-[#f0cf63]"
                            >
                              {item.source}
                              <ExternalLink size={12} />
                            </button>
                          </td>

                          <td className="px-4 py-4">
                            <button
                              onClick={() => setSelectedResult(item)}
                              className="rounded-lg p-2 text-white/24 hover:bg-white/5 hover:text-white/65"
                              aria-label={t.details}
                            >
                              <ChevronDown size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-[24px] border border-[#d4af37]/12 bg-white/[.018] p-5 shadow-[0_18px_60px_rgba(0,0,0,.30)] backdrop-blur-2xl sm:p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-white/76">
                      {t.sourceRegistry}
                    </div>
                    <div className="mt-1 text-xs text-white/28">
                      {t.realSources}
                    </div>
                  </div>

                  <div className="text-[10px] uppercase tracking-[.16em] text-white/22">
                    public / official / demo
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {sourceRegistry.map((source) => (
                    <div
                      key={`${source.name}-${source.domain}`}
                      className="group rounded-2xl border border-white/6 bg-white/[.018] p-4 transition hover:-translate-y-0.5 hover:border-[#d4af37]/22"
                    >
                      <div className="flex gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/8 bg-white/[.04]">
                          <img
                            src={faviconUrl(source.domain)}
                            alt=""
                            className="h-6 w-6"
                            referrerPolicy="no-referrer"
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="truncate text-sm font-medium text-white/76">
                                {source.name}
                              </div>
                              <div className="mt-1 text-[10px] text-white/27">
                                {source.category}
                              </div>
                            </div>

                            <span
                              className={`rounded-full px-2 py-1 text-[9px] ${
                                source.health === "Healthy"
                                  ? "bg-[#8bd7a1]/8 text-[#8bd7a1]"
                                  : source.health === "Warning"
                                    ? "bg-[#e0c16d]/8 text-[#e0c16d]"
                                    : "bg-white/[.05] text-white/40"
                              }`}
                            >
                              {source.health}
                            </span>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3 text-[10px]">
                            <div>
                              <div className="text-white/22">{t.quality}</div>
                              <div className="mt-1 text-white/62">
                                {source.quality}%
                              </div>
                            </div>

                            <div>
                              <div className="text-white/22">
                                {t.lastChecked}
                              </div>
                              <div className="mt-1 text-white/62">
                                {source.lastChecked}
                              </div>
                            </div>

                            <div>
                              <div className="text-white/22">{t.method}</div>
                              <div className="mt-1 text-white/46">
                                {source.method}
                              </div>
                            </div>

                            <div>
                              <div className="text-white/22">{t.status}</div>
                              <div className="mt-1 text-white/46">
                                {source.status}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 text-[11px] leading-5 text-white/30">
                            {source.description}
                          </div>

                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-medium text-[#d5b850] hover:text-[#f0cf63]"
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

              <section className="rounded-[24px] border border-[#d4af37]/12 bg-white/[.018] p-5 shadow-[0_18px_60px_rgba(0,0,0,.30)] backdrop-blur-2xl sm:p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[.2em] text-[#d4af37]">
                      ONE AGENT.
                    </div>
                    <div className="mt-1 text-xl font-semibold tracking-tight text-white/82">
                      MANY RESEARCH TASKS.
                    </div>
                  </div>

                  <div className="text-xs text-white/25">
                    {t.demoScenario}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["realEstate", t.land, "10,000 m² / Madrid"],
                      ["investors", t.investors, "Amsterdam / Series A–B"],
                      ["companies", t.companies, "China → EU / B2B"],
                    ] as const
                  ).map(([key, label, note]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setScenario(key);
                        setProgress(0);
                        setRunning(false);
                        setResultFilter("All");
                      }}
                      className={`rounded-2xl border p-4 text-left transition ${
                        scenario === key
                          ? "border-[#d4af37]/25 bg-[#d4af37]/6"
                          : "border-white/6 bg-white/[.018] hover:border-white/10 hover:bg-white/[.03]"
                      }`}
                    >
                      <div className="text-sm font-medium text-white/76">
                        {label}
                      </div>
                      <div className="mt-1 text-[10px] text-[#d6ba58]">
                        {note}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="grid gap-5 lg:grid-cols-3">
                {[
                  [t.land, "Find land parcels in Madrid", Globe2],
                  [
                    t.investors,
                    "Find potential investors in Amsterdam",
                    Target,
                  ],
                  [t.companies, "Find manufacturers in China", Layers3],
                ].map(([title, body, Icon]) => (
                  <div
                    className="rounded-2xl border border-white/6 bg-white/[.018] p-5"
                    key={String(title)}
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#d4af37]/8 text-[#d4af37] ring-1 ring-[#d4af37]/12">
                      <Icon size={17} />
                    </div>

                    <div className="mt-4 text-sm font-medium text-white/72">
                      {String(title)}
                    </div>

                    <div className="mt-2 text-xs leading-5 text-white/29">
                      {String(body)}
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </div>
        </section>
      </div>

      {selectedResult && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/60 backdrop-blur-sm">
          <button
            onClick={() => setSelectedResult(null)}
            className="absolute inset-0 cursor-default"
            aria-label="Close details"
          />

          <aside className="relative h-full w-full max-w-[560px] overflow-y-auto border-l border-[#d4af37]/12 bg-[#080806]/96 p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#d4af37]">
                  {t.details}
                </div>

                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white/88">
                  {selectedResult.title}
                </h2>
              </div>

              <button
                onClick={() => setSelectedResult(null)}
                className="rounded-xl p-2 text-white/35 hover:bg-white/5"
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
                <div
                  className="rounded-xl border border-white/6 bg-white/[.018] p-4"
                  key={String(label)}
                >
                  <div className="text-[10px] text-white/25">
                    {String(label)}
                  </div>
                  <div className="mt-1 text-sm text-white/72">
                    {String(value)}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-white/6 bg-white/[.018] p-5">
              <div className="text-xs font-medium text-white/62">
                {t.why}
              </div>
              <div className="mt-2 text-sm leading-6 text-white/40">
                {selectedResult.why}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/6 bg-white/[.018] p-5">
              <div className="flex items-center gap-2 text-xs font-medium text-white/62">
                <ShieldCheck size={14} className="text-[#d4af37]" />
                {t.evidenceCol}
              </div>

              <div className="mt-2 text-sm leading-6 text-white/43">
                {selectedResult.evidence}
              </div>

              <div className="mt-4 text-[10px] text-white/24">
                {t.retrieved}: just now (demo)
              </div>

              <div className="mt-1 text-[10px] text-white/24">
                {t.extraction}: public source / browser / parser (demo)
              </div>
            </div>

            <a
              href={selectedResult.url}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#d4af37]/20 bg-[#d4af37]/7 px-4 py-3 text-sm text-[#ebd37d] hover:bg-[#d4af37]/10"
            >
              <ExternalLink size={15} />
              {t.open}
            </a>
          </aside>
        </div>
      )}

      <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#d4af37]/15 bg-[#090908]/85 px-3 py-2 text-[10px] text-white/40 shadow-2xl backdrop-blur-xl">
        <Sparkles size={12} className="text-[#d4af37]" />
        {t.voice} • {t.demoMode}
      </div>

      <button
        onClick={startResearch}
        className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#f0cf63] via-[#d4af37] to-[#9d7618] text-black shadow-[0_14px_42px_rgba(212,175,55,.24)] ring-4 ring-[#040403] lg:hidden"
        aria-label={t.newResearch}
        title={t.newResearch}
      >
        <Sparkles size={19} />
      </button>
    </main>
  );
}
