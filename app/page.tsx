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
  SlidersHorizontal,
  Database,
  Bot,
  Radar,
  Globe,
  Gauge,
  LockKeyhole,
  DownloadCloud,
  BellRing,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Upload,
  X,
  Radio as RadioIcon,
  Music2,
  Play as PlayIcon,
  Pause as PauseIcon,
  Share2,
  Send,
  Mail,
  Volume2,
  SkipForward,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NavKey, Result, Scenario, Lang, Task } from "@/lib/data";
import type { AppSettings, SettingsTab } from "@/lib/settings";
import { defaultSettings } from "@/lib/settings";
import {
  exportCsvFile,
  exportExcelFile,
  exportPdfFile,
  exportJsonFile,
  type ResearchExportPayload,
} from "@/lib/exporters";
import { resultsByScenario, scenarios, sourceRegistry, tasks } from "@/lib/data";

type Theme = "dark" | "light";
type ResultFilter = "All" | "Verified" | "High match";
type AudioState = "idle" | "listening" | "transcribing";

type RadioStation = {
  stationuuid: string;
  name: string;
  country: string;
  language: string;
  tags: string;
  favicon: string;
  homepage: string;
  streamUrl: string;
  codec: string;
  bitrate: number;
  votes: number;
};

const nav: Array<{ key: NavKey; icon: typeof Sparkles; ru: string; en: string }> = [
  { key: "research", icon: Sparkles, ru: "Исследование", en: "Research" },
  { key: "tasks", icon: Layers3, ru: "Задачи", en: "Tasks" },
  { key: "sources", icon: Globe2, ru: "Источники", en: "Sources" },
  { key: "results", icon: BarChart3, ru: "Результаты", en: "Results" },
  { key: "settings", icon: Settings2, ru: "Настройки", en: "Settings" },
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
    noRealTime: "LIVE WEB • результаты из реального поиска",
    engineRunning: "AI-движок выполняет исследование",
    engineComplete: "Исследование завершено",
    stageUnderstanding: "Понимание запроса",
    stagePlanning: "Создание Search Plan",
    stageDiscovery: "Обнаружение источников",
    stageAcquisition: "Исследование страниц",
    stageExtraction: "Извлечение данных",
    stageDedup: "Дедупликация и Entity Resolution",
    stageQuality: "Quality Gate + Evidence",
    liveFeed: "Живой поток исследования",
    resultPreview: "Поток результатов",
    recordsFound: "записей найдено",
    simulated: "LIVE WEB • real search",
    settingsTitle: "Настройки системы",
    settingsSub: "Здесь управляются параметры, которые в production будут передаваться Model Router, Search Engine, Acquisition Workers, Quality Gate, Budget Engine и Security Layer.",
    settingsSaved: "Сохранено",
    demoOnly: "Настройки демонстрации",
    apply: "Сохранить изменения",
    reset: "Сбросить",
    general: "Общие",
    researchSettings: "Исследование",
    models: "AI-модели",
    searchSettings: "Поиск",
    acquisition: "Web Acquisition",
    qualitySettings: "Качество и Evidence",
    budgetSettings: "Бюджет и лимиты",
    securitySettings: "Безопасность",
    exportSettings: "Экспорт",
    language: "Язык",
    theme: "Тема",
    confirmSearch: "Подтверждать Search Plan перед запуском",
    autoResults: "Открывать результаты после завершения",
    depth: "Глубина исследования",
    maxSources: "Максимум источников",
    maxPages: "Максимум страниц",
    workers: "Параллельных workers",
    reuseRegistry: "Переиспользовать Source Registry",
    multilingual: "Мультиязычное расширение запросов",
    relatedLinks: "Исследовать связанные страницы",
    planning: "Planning",
    extractionModel: "Extraction",
    hardMatch: "Hard Match",
    qualityCheck: "Quality Check",
    vision: "Vision",
    deepResearch: "Deep Research",
    maxCost: "Max cost / task (€)",
    maxTokens: "Max tokens",
    timeout: "Timeout (sec)",
    retries: "Retry limit",
    fallback: "Fallback provider",
    audit: "Audit trail",
    enabled: "Включён",
    disabled: "Выключен",
    searchProviders: "Search providers",
    languageSearch: "Язык поиска",
    maxSearchRequests: "Максимум Search API requests",
    acquisitionOrder: "Порядок acquisition",
    pageRuntime: "Максимальный runtime страницы (sec)",
    robots: "Учитывать robots/policy",
    captcha: "CAPTCHA",
    auth: "Авторизация",
    minConfidence: "Минимальная confidence",
    evidenceRequired: "Evidence обязательно",
    dedupe: "Deduplication",
    duplicateThreshold: "Порог duplicate match",
    freshness: "Freshness window (days)",
    locationConsistency: "Проверять согласованность географии",
    perTask: "Лимит на задачу (€)",
    daily: "Дневной лимит (€)",
    monthly: "Месячный лимит (€)",
    hardStop: "Hard stop при достижении лимита",
    budgetApproval: "Подтверждение перерасхода",
    promptInjection: "Prompt Injection",
    ssrf: "SSRF",
    secrets: "Secrets",
    sandbox: "Sandbox для файлов",
    tenant: "Tenant isolation",
    csv: "CSV",
    xlsx: "XLSX",
    includeEvidence: "Включать Evidence",
    includeMetadata: "Включать Source metadata",
    exportExcel: "Excel",
    exportPdf: "PDF",
    exportGoogleDocs: "Google Docs",
    exportJson: "JSON",
    testMode: "TEST MODE • экономия",
    share: "Поделиться",
    telegram: "Telegram",
    email: "Почта",
    systemShare: "Поделиться",
    radio: "Радио",
    radioOn: "Радио играет",
    radioOff: "Открыть радио",
    radioLoading: "Ищем станции…",
    radioEmpty: "Подходящих станций нет",
    radioError: "Не удалось загрузить радио",
    listen: "Слушать",
    stopRadio: "Выключить",
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
    noRealTime: "LIVE WEB • results from live search",
    engineRunning: "AI engine is researching",
    engineComplete: "Research completed",
    stageUnderstanding: "Understanding request",
    stagePlanning: "Building Search Plan",
    stageDiscovery: "Discovering sources",
    stageAcquisition: "Researching pages",
    stageExtraction: "Extracting data",
    stageDedup: "Deduplication & Entity Resolution",
    stageQuality: "Quality Gate + Evidence",
    liveFeed: "Live research feed",
    resultPreview: "Result stream",
    recordsFound: "records found",
    simulated: "DEMO • acquisition simulation",
    settingsTitle: "System Settings",
    settingsSub: "These controls represent the production configuration layer for the Model Router, Search Engine, Acquisition Workers, Quality Gate, Budget Engine and Security Layer.",
    settingsSaved: "Saved",
    demoOnly: "Demo configuration",
    apply: "Save changes",
    reset: "Reset",
    general: "General",
    researchSettings: "Research",
    models: "AI Models",
    searchSettings: "Search",
    acquisition: "Web Acquisition",
    qualitySettings: "Quality & Evidence",
    budgetSettings: "Budget & Limits",
    securitySettings: "Security",
    exportSettings: "Export",
    language: "Language",
    theme: "Theme",
    confirmSearch: "Confirm Search Plan before start",
    autoResults: "Open results automatically after completion",
    depth: "Research depth",
    maxSources: "Max sources",
    maxPages: "Max pages",
    workers: "Parallel workers",
    reuseRegistry: "Reuse Source Registry",
    multilingual: "Multilingual query expansion",
    relatedLinks: "Explore related pages",
    planning: "Planning",
    extractionModel: "Extraction",
    hardMatch: "Hard Match",
    qualityCheck: "Quality Check",
    vision: "Vision",
    deepResearch: "Deep Research",
    maxCost: "Max cost / task (€)",
    maxTokens: "Max tokens",
    timeout: "Timeout (sec)",
    retries: "Retry limit",
    fallback: "Fallback provider",
    audit: "Audit trail",
    enabled: "Enabled",
    disabled: "Disabled",
    searchProviders: "Search providers",
    languageSearch: "Search language",
    maxSearchRequests: "Max Search API requests",
    acquisitionOrder: "Acquisition order",
    pageRuntime: "Max page runtime (sec)",
    robots: "Respect robots/policy",
    captcha: "CAPTCHA",
    auth: "Authentication",
    minConfidence: "Minimum confidence",
    evidenceRequired: "Evidence required",
    dedupe: "Deduplication",
    duplicateThreshold: "Duplicate match threshold",
    freshness: "Freshness window (days)",
    locationConsistency: "Validate geographic consistency",
    perTask: "Per-task limit (€)",
    daily: "Daily limit (€)",
    monthly: "Monthly limit (€)",
    hardStop: "Hard stop at budget limit",
    budgetApproval: "Require approval to exceed budget",
    promptInjection: "Prompt Injection",
    ssrf: "SSRF",
    secrets: "Secrets",
    sandbox: "File sandbox",
    tenant: "Tenant isolation",
    csv: "CSV",
    xlsx: "XLSX",
    includeEvidence: "Include Evidence",
    includeMetadata: "Include Source metadata",
    exportExcel: "Excel",
    exportPdf: "PDF",
    exportGoogleDocs: "Google Docs",
    exportJson: "JSON",
    testMode: "TEST MODE • low cost",
    share: "Share",
    telegram: "Telegram",
    email: "Email",
    systemShare: "Share",
    radio: "Radio",
    radioOn: "Radio playing",
    radioOff: "Open radio",
    radioLoading: "Finding stations…",
    radioEmpty: "No matching stations",
    radioError: "Radio unavailable",
    listen: "Listen",
    stopRadio: "Stop",
  },
} as const;

function readSourceMemoryFromStorage() {
  try {
    const raw = window.localStorage.getItem("aurelius-source-memory-v1");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 120) : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("ru");
  const [theme, setTheme] = useState<Theme>("dark");
  const [activeNav, setActiveNav] = useState<NavKey>("research");
  const [scenario, setScenario] = useState<Scenario>("realEstate");
  const [query, setQuery] = useState<string>(scenarios.realEstate.query);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [researchStage, setResearchStage] = useState(0);
  const [completedSearch, setCompletedSearch] = useState(false);
  const [liveResults, setLiveResults] = useState<Result[] | null>(null);
  const [liveAttempted, setLiveAttempted] = useState(false);
  const [liveStats, setLiveStats] = useState({
    sourcesFound: 0,
    sourcesChecked: 0,
    pagesProcessed: 0,
    recordsExtracted: 0,
    duplicatesRemoved: 0,
    qualified: 0,
    evidenceCoverage: 0,
    sourcesBlocked: 0,
    sourcesManualReview: 0,
    averageConfidence: 0,
  });
  const [liveSources, setLiveSources] = useState<string[]>([]);
  const [liveSourceRegistry, setLiveSourceRegistry] = useState<any[]>([]);
  const [accessEvents, setAccessEvents] = useState<any[]>([]);
  const [accessCheckpoints, setAccessCheckpoints] = useState<any[]>([]);
  const [searchBranches, setSearchBranches] = useState<string[]>([]);
  const [queryUnderstanding, setQueryUnderstanding] = useState<any>(null);
  const [researchSummary, setResearchSummary] = useState("");
  const [liveBilling, setLiveBilling] = useState<Record<string, unknown> | undefined>(undefined);
  const [activeTask, setActiveTask] = useState<{ id: string; responseId: string; query: string; language: Lang; depth: "Quick" | "Balanced" | "Deep"; maxResults: number; maxSources: number; maxPages: number } | null>(null);
  const pollingTaskRef = useRef<string | null>(null);
  const [qualityGate, setQualityGate] = useState({
    total: 0,
    pass: 0,
    review: 0,
    fail: 0,
    independentVerification: false,
    ruleSet: [] as string[],
  });
  const [searchPlan, setSearchPlan] = useState("");
  const [liveError, setLiveError] = useState("");
  const [selectedResult, setSelectedResult] = useState<Result | null>(null);
  const [filter, setFilter] = useState<ResultFilter>("All");
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [transcript, setTranscript] = useState("");
  const [radioOpen, setRadioOpen] = useState(false);
  const [radioGenre, setRadioGenre] = useState("chillout");
  const [radioStations, setRadioStations] = useState<RadioStation[]>([]);
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioPlaying, setRadioPlaying] = useState(false);
  const [radioError, setRadioError] = useState("");
  const [radioVolume, setRadioVolume] = useState(0.55);
  const [currentStation, setCurrentStation] = useState<RadioStation | null>(null);
  const radioAudioRef = useRef<HTMLAudioElement | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const recognitionRef = useRef<any>(null);
  const t = labels[lang];

  const [testMode, setTestMode] = useState(true);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [settingsSaved, setSettingsSaved] = useState(false);

  const current = scenarios[scenario];
  const results = liveAttempted
    ? (liveResults ?? [])
    : resultsByScenario[scenario];
  const usingLiveData = liveAttempted && liveResults !== null;

  useEffect(() => {
    return () => {
      radioAudioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!radioOpen) return;
    let cancelled = false;
    setRadioLoading(true);
    setRadioError("");
    fetch("/api/radio?tag=" + encodeURIComponent(radioGenre) + "&limit=12", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data?.ok) throw new Error(String(data?.error || "Radio unavailable"));
        return Array.isArray(data.stations) ? data.stations : [];
      })
      .then((stations: RadioStation[]) => {
        if (!cancelled) setRadioStations(stations);
      })
      .catch((error) => {
        if (!cancelled) {
          setRadioStations([]);
          setRadioError(error instanceof Error ? error.message : t.radioError);
        }
      })
      .finally(() => {
        if (!cancelled) setRadioLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [radioOpen, radioGenre, t.radioError]);

  useEffect(() => {
    const audio = radioAudioRef.current;
    if (audio) audio.volume = radioVolume;
  }, [radioVolume]);

  useEffect(() => {
    if (!radioPlaying || !currentStation || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      const ctor = (window as typeof window & { MediaMetadata?: typeof MediaMetadata }).MediaMetadata;
      if (ctor) {
        navigator.mediaSession.metadata = new ctor({
          title: currentStation.name,
          artist: currentStation.country || "Internet Radio",
          album: currentStation.tags || "Aurelius Radio",
          artwork: currentStation.favicon ? [{ src: currentStation.favicon, sizes: "96x96", type: "image/png" }] : [],
        });
      }
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("play", () => void radioAudioRef.current?.play());
      navigator.mediaSession.setActionHandler("pause", () => radioAudioRef.current?.pause());
    } catch {}
  }, [radioPlaying, currentStation]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("aurelius-theme") as Theme | null;
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    }

    const storedSettings = window.localStorage.getItem("aurelius-settings");
    if (storedSettings) {
      try {
        const parsed = JSON.parse(storedSettings) as Partial<AppSettings>;
        setSettings({ ...defaultSettings, ...parsed });
      } catch {
        setSettings(defaultSettings);
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    window.localStorage.setItem("aurelius-theme", theme);
    setSettings((currentSettings) => ({ ...currentSettings, theme }));
  }, [theme]);

  useEffect(() => {
    setSettings((currentSettings) => ({ ...currentSettings, language: lang }));
  }, [lang]);

  useEffect(() => {
    setQuery(lang === "ru" ? current.query : current.queryEn);
  }, [current.query, current.queryEn, lang]);

  useEffect(() => {
    if (progress >= 100 && running) {
      setRunning(false);
      setCompletedSearch(true);
      window.setTimeout(() => {
        document.getElementById("results-preview")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 650);
    }
  }, [progress, running]);

  const shownResults = useMemo(() => {
    if (filter === "Verified") return results.filter((item) => item.status === "Verified");
    if (filter === "High match") return results.filter((item) => item.match >= 90);
    return results;
  }, [filter, results]);

  function buildShareText() {
    const rows = shownResults.slice(0, 12).map((item, index) =>
      [
        (index + 1) + ". " + item.title,
        item.organization ? "Организация: " + item.organization : "",
        item.specialization ? "Профиль: " + item.specialization : "",
        item.geography ? "География: " + item.geography : "Место: " + item.location,
        item.investmentType ? "Тип: " + item.investmentType : "",
        item.stage ? "Стадия: " + item.stage : "",
        item.ticket ? "Ticket: " + item.ticket : "Цена/параметр: " + item.price,
        "Источник: " + item.source,
        "URL: " + item.url,
        item.evidenceQuote ? "Evidence: " + item.evidenceQuote : item.evidence ? "Evidence: " + item.evidence : "",
      ].filter(Boolean).join("\n")
    );
    return ["AURELIUS — Universal AI Research Engine", "Запрос: " + query, rows.join("\n\n")].join("\n\n");
  }

  function shareViaTelegram() {
    const text = buildShareText();
    const url = "https://t.me/share/url?url=" + encodeURIComponent(window.location.href) + "&text=" + encodeURIComponent(text);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function shareViaEmail() {
    const subject = "Aurelius research: " + query.slice(0, 80);
    const body = buildShareText();
    window.location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  async function shareViaSystem() {
    const text = buildShareText();
    try {
      if (navigator.share) {
        await navigator.share({ title: "Aurelius Research", text, url: window.location.href });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    } catch {}
  }

  async function playRadioStation(station: RadioStation) {
    const audio = radioAudioRef.current;
    if (!audio) return;
    setRadioError("");
    try {
      if (currentStation?.stationuuid === station.stationuuid) {
        if (audio.paused) {
          await audio.play();
          setRadioPlaying(true);
        } else {
          audio.pause();
          setRadioPlaying(false);
        }
        return;
      }
      audio.pause();
      audio.src = station.streamUrl;
      audio.volume = radioVolume;
      audio.load();
      setCurrentStation(station);
      await audio.play();
      setRadioPlaying(true);
    } catch (error) {
      setRadioPlaying(false);
      setRadioError(error instanceof Error ? error.message : "Unable to start this station.");
    }
  }

  function stopRadio() {
    radioAudioRef.current?.pause();
    setRadioPlaying(false);
  }

  function skipRadio() {
    if (!radioStations.length) return;
    const index = currentStation ? radioStations.findIndex((station) => station.stationuuid === currentStation.stationuuid) : -1;
    const next = radioStations[(index + 1 + radioStations.length) % radioStations.length];
    if (next) void playRadioStation(next);
  }

  function renderShareActions(compact = false) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={shareViaTelegram} className="panel-hover inline-flex items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
          <Send size={12} /> {t.telegram}
        </button>
        <button onClick={shareViaEmail} className="panel-hover inline-flex items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
          <Mail size={12} /> {t.email}
        </button>
        <button onClick={() => void shareViaSystem()} className="panel-hover inline-flex items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
          <Share2 size={12} /> {compact ? t.systemShare : t.share}
        </button>
      </div>
    );
  }

  function detectScenarioFromQuery(text: string): Scenario {
    const q = text.toLowerCase();
    if (/(инвестор|инвести|investor|vc|angel|fund)/i.test(q)) return "investors";
    if (/(компан|производ|manufacturer|supplier|producer|компан)/i.test(q)) return "companies";
    return "realEstate";
  }

  function saveSourceMemory(registry: any[]) {
    try {
      const existing = readSourceMemoryFromStorage();
      const merged = new Map<string, any>();
      [...existing, ...(Array.isArray(registry) ? registry : [])].forEach((item: any) => {
        const key = String(item?.url || item?.domain || item?.name || "").trim().toLowerCase();
        if (key) merged.set(key, { ...item, lastChecked: item?.lastChecked || new Date().toISOString() });
      });
      window.localStorage.setItem("aurelius-source-memory-v1", JSON.stringify(Array.from(merged.values()).slice(-500)));
    } catch { return; }
  }

  function saveActiveTask(task: any) {
    window.localStorage.setItem("aurelius-active-task-v1", JSON.stringify(task));
    setActiveTask(task);
  }

  function clearActiveTask() {
    window.localStorage.removeItem("aurelius-active-task-v1");
    setActiveTask(null);
  }

  // NOSONAR - stateful polling orchestrates several UI lifecycle transitions.
  async function pollResearchTask(task: any) {
    if (!task?.responseId || pollingTaskRef.current === task.responseId) return;
    pollingTaskRef.current = task.responseId;
    setRunning(true);

    try {
      for (;;) {
        const params = new URLSearchParams({
          responseId: task.responseId,
          query: task.query,
          language: task.language === "en" ? "en" : "ru",
          depth: task.depth,
          maxResults: String(task.maxResults),
          maxSources: String(task.maxSources),
          maxPages: String(task.maxPages),
        });
        const response = await fetch("/api/research/task?" + params.toString(), {
          cache: "no-store",
        });
        const raw = await response.text();
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = null;
        }

        if (!response.ok) {
          throw new Error(data?.error || ("Research task polling failed (HTTP " + response.status + ")."));
        }

        if (data?.task?.progress !== undefined) {
          const nextProgress = Math.max(0, Math.min(100, Number(data.task.progress)));
          setProgress(nextProgress);
          setResearchStage(Math.max(0, Math.min(6, Number(data.task.stage || 0))));
        }

        const status = String(data?.task?.status || "");
        if (status === "queued" || status === "in_progress") {
          await new Promise((resolve) => window.setTimeout(resolve, status === "queued" ? 2200 : 4200));
          continue;
        }

        if (data?.partial === true || data?.error) {
          throw new Error(String(data?.error || "Background research did not complete."));
        }

        if (data?.live === true && Array.isArray(data.results)) {
          setLiveResults(data.results);
          setLiveStats({
            sourcesFound: Number(data.stats?.sourcesFound || 0),
            sourcesChecked: Number(data.stats?.sourcesChecked || 0),
            pagesProcessed: Number(data.stats?.pagesProcessed || 0),
            recordsExtracted: Number(data.stats?.recordsExtracted || 0),
            duplicatesRemoved: Number(data.stats?.duplicatesRemoved || 0),
            qualified: Number(data.stats?.qualified || 0),
            evidenceCoverage: Number(data.stats?.evidenceCoverage || 0),
            sourcesBlocked: Number(data.stats?.sourcesBlocked || 0),
            sourcesManualReview: Number(data.stats?.sourcesManualReview || 0),
            averageConfidence: Number(data.stats?.averageConfidence || 0),
          });
          setSearchPlan(String(data.searchPlan || ""));
          setResearchSummary(String(data.summary || ""));
          setLiveBilling(data.billing || undefined);
          setQueryUnderstanding(data.queryUnderstanding || null);
          setSearchBranches(Array.isArray(data.searchBranches) ? data.searchBranches : []);
          setLiveSources(Array.isArray(data.sourceUrls) ? data.sourceUrls : []);
          setLiveSourceRegistry(Array.isArray(data.sourceRegistry) ? data.sourceRegistry : []);
          setAccessEvents(Array.isArray(data.accessEvents) ? data.accessEvents : []);
          setAccessCheckpoints(Array.isArray(data.accessCheckpoints) ? data.accessCheckpoints : []);
          setQualityGate({
            total: Number(data.qualityGate?.total || 0),
            pass: Number(data.qualityGate?.pass || 0),
            review: Number(data.qualityGate?.review || 0),
            fail: Number(data.qualityGate?.fail || 0),
            independentVerification: Boolean(data.qualityGate?.independentVerification),
            ruleSet: Array.isArray(data.qualityGate?.ruleSet) ? data.qualityGate.ruleSet : [],
          });
          saveSourceMemory(Array.isArray(data.sourceRegistry) ? data.sourceRegistry : []);
          setProgress(100);
          setResearchStage(6);
          setCompletedSearch(true);
          setRunning(false);
          clearActiveTask();
          window.setTimeout(() => document.getElementById("results-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
          break;
        }

        throw new Error("Research task returned an unexpected status.");
      }
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Live research failed.");
      setRunning(false);
      setCompletedSearch(false);
      setLiveResults([]);
      clearActiveTask();
    } finally {
      if (pollingTaskRef.current === task.responseId) pollingTaskRef.current = null;
    }
  }

  async function cancelResearch() {
    const task = activeTask;
    if (!task?.responseId) {
      setRunning(false);
      return;
    }

    try {
      await fetch("/api/research/task?responseId=" + encodeURIComponent(task.responseId), {
        method: "DELETE",
        cache: "no-store",
      });
    } catch {}
    setRunning(false);
    setCompletedSearch(false);
    setProgress(0);
    setResearchStage(0);
    setLiveError(lang === "ru" ? "Исследование остановлено пользователем." : "Research stopped by the user.");
    clearActiveTask();
  }

  useEffect(() => {
    const stored = window.localStorage.getItem("aurelius-active-task-v1");
    if (!stored) return;
    try {
      const task = JSON.parse(stored);
      if (task?.responseId) {
        setActiveTask(task);
        setLiveAttempted(true);
        void pollResearchTask(task);
      }
    } catch {
      window.localStorage.removeItem("aurelius-active-task-v1");
    }
  }, []);

  // NOSONAR - orchestration function intentionally coordinates task initialization, API start and polling.
  async function startResearch() {
    const detected = detectScenarioFromQuery(query);
    setScenario(detected);
    setActiveNav("research");
    setProgress(0);
    setResearchStage(0);
    setCompletedSearch(false);
    setSelectedResult(null);
    setLiveAttempted(true);
    setLiveResults(null);
    setLiveStats({ sourcesFound: 0, sourcesChecked: 0, pagesProcessed: 0, recordsExtracted: 0, duplicatesRemoved: 0, qualified: 0, evidenceCoverage: 0, sourcesBlocked: 0, sourcesManualReview: 0, averageConfidence: 0 });
    setLiveSources([]);
    setLiveSourceRegistry([]);
    setAccessEvents([]);
    setAccessCheckpoints([]);
    setSearchBranches([]);
    setQueryUnderstanding(null);
    setResearchSummary("");
    setLiveBilling(undefined);
    setQualityGate({ total: 0, pass: 0, review: 0, fail: 0, independentVerification: false, ruleSet: [] });
    setSearchPlan("");
    setLiveError("");
    setRunning(true);

    try {
      const sourceMemory = readSourceMemoryFromStorage();
      const payload = {
        query,
        language: lang,
        depth: testMode ? "Quick" : (settings.defaultDepth as "Quick" | "Balanced" | "Deep"),
        maxResults: testMode ? 3 : Math.min(20, Math.max(8, Math.floor(settings.maxSources / 5))),
        maxSources: testMode ? 8 : Math.min(120, Math.max(20, settings.maxSources)),
        maxPages: testMode ? 20 : Math.min(1500, Math.max(50, settings.maxPages)),
        testMode,
        multilingual: testMode ? false : settings.multilingualSearch,
        followRelatedLinks: testMode ? false : settings.followRelatedLinks,
        sourceMemory,
      };

      const response = await fetch("/api/research/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

      if (!response.ok) {
        throw new Error(data?.error || ("Unable to start research task (HTTP " + response.status + ")."));
      }

      const task = {
        ...(data?.task ?? null),
        query,
        language: lang,
        depth: payload.depth,
        maxResults: payload.maxResults,
        maxSources: payload.maxSources,
        maxPages: payload.maxPages,
      };

      if (!task?.responseId) throw new Error("The research task did not return a background response ID.");

      saveActiveTask(task);
      await pollResearchTask(task);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Live research failed.");
      setRunning(false);
      setCompletedSearch(false);
      setLiveResults([]);
      clearActiveTask();
    }
  }

  function buildExportPayload(): ResearchExportPayload {
    return {
      query,
      generatedAt: new Date().toISOString(),
      searchPlan,
      searchSummary: researchSummary,
      stats: { ...(liveStats as Record<string, number | string>) },
      billing: liveBilling,
      results: shownResults,
      sourceRegistry: liveSourceRegistry,
    };
  }

  function exportCsv() {
    exportCsvFile(buildExportPayload());
  }

  async function exportExcel() {
    try {
      await exportExcelFile(buildExportPayload());
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Excel export failed.");
    }
  }

  async function exportPdf() {
    try {
      await exportPdfFile(buildExportPayload());
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "PDF export failed.");
    }
  }

  function exportJson() {
    exportJsonFile(buildExportPayload());
  }

  /* legacy CSV implementation moved to lib/exporters.ts */
  function legacyExportCsvDisabled() {
    return;
  }
  /*
    const headers = [
      "Title",
      "Location",
      "Area/Profile",
      "Price/Round",
      "Match",
      "Evidence",
      "Source",
      "URL",
      "Status",
      "Quality Gate",
    ];

    const escapeCell = (value: unknown) => {
      const text = String(value ?? "");
      return `"${text.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
    };

    const rows = shownResults.map((item: any) => [
      item.title,
      item.location,
      item.area,
      item.price,
      `${item.match}%`,
      item.evidence,
      item.source,
      item.url,
      item.status,
      item.qualityGate?.gate || "",
    ]);

    const csv = "\uFEFF" + [
      headers.map(escapeCell).join(";"),
      ...rows.map((row: unknown[]) => row.map(escapeCell).join(";")),
    ].join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aurelius-${scenario}-results.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  */

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


  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((currentSettings) => ({ ...currentSettings, [key]: value }));
    setSettingsSaved(false);
  }

  function saveSettings() {
    window.localStorage.setItem("aurelius-settings", JSON.stringify(settings));
    setTheme(settings.theme);
    setLang(settings.language);
    setSettingsSaved(true);
    window.setTimeout(() => setSettingsSaved(false), 2200);
  }

  function resetSettings() {
    setSettings(defaultSettings);
    setTheme(defaultSettings.theme);
    setLang(defaultSettings.language);
    window.localStorage.setItem("aurelius-settings", JSON.stringify(defaultSettings));
    setSettingsSaved(true);
    window.setTimeout(() => setSettingsSaved(false), 2200);
  }

  function SettingToggle({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }) {
    return (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="flex w-full items-center justify-between gap-4 rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-4 py-3 text-left transition hover:border-[var(--line)]"
      >
        <span className="text-sm text-[var(--text-soft)]">{label}</span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full p-1 transition ${
            value ? "bg-[var(--gold)]" : "bg-white/15"
          }`}
        >
          <span
            className={`block h-4 w-4 rounded-full bg-white shadow transition ${
              value ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </span>
      </button>
    );
  }

  function SettingNumber({
    label,
    value,
    onChange,
    min = 0,
    max = 1000000,
    step = 1,
  }: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
  }) {
    return (
      <label className="block">
        <span className="mb-2 block text-xs text-[var(--text-muted)]">{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-3.5 py-3 text-sm text-[var(--text-soft)] outline-none focus:border-[var(--line)]"
        />
      </label>
    );
  }

  function SettingSelect({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: string[];
    onChange: (value: string) => void;
  }) {
    return (
      <label className="block">
        <span className="mb-2 block text-xs text-[var(--text-muted)]">{label}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-3.5 py-3 text-sm text-[var(--text-soft)] outline-none focus:border-[var(--line)]"
        >
          {options.map((option) => (
            <option key={option} value={option} className="bg-[#111]">
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function SettingSection({
    title,
    icon,
    children,
    description,
  }: {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    description?: string;
  }) {
    return (
      <div className="glass panel-hover rounded-2xl p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-[var(--gold)]/7 text-[var(--gold)]">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-soft)]">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{description}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 space-y-3">{children}</div>
      </div>
    );
  }

  function renderSettings() {
    const tabs: Array<{ key: SettingsTab; label: string; icon: typeof Settings2 }> = [
      { key: "general", label: t.general, icon: Settings2 },
      { key: "research", label: t.researchSettings, icon: Radar },
      { key: "models", label: t.models, icon: Bot },
      { key: "search", label: t.searchSettings, icon: Search },
      { key: "acquisition", label: t.acquisition, icon: Globe },
      { key: "quality", label: t.qualitySettings, icon: Gauge },
      { key: "budget", label: t.budgetSettings, icon: BarChart3 },
      { key: "security", label: t.securitySettings, icon: LockKeyhole },
      { key: "exports", label: t.exportSettings, icon: DownloadCloud },
    ];

    return (
      <section className="space-y-5">
        <div className="glass glow rounded-[28px] p-6 sm:p-8 float-in">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.24em] text-[var(--gold)]">
                AURELIUS • SYSTEM CONFIG
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] text-[var(--text)] sm:text-4xl">
                {t.settingsTitle}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
                {t.settingsSub}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {settingsSaved ? (
                <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--success)]/20 bg-[var(--success)]/7 px-4 py-2.5 text-xs text-[var(--success)]">
                  <CheckCircle2 size={14} />
                  {t.settingsSaved}
                </div>
              ) : null}
              <button
                onClick={resetSettings}
                className="panel-hover rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--text-muted)]"
              >
                {t.reset}
              </button>
              <button
                onClick={saveSettings}
                className="shine-button inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#f0cf63] via-[#d4af37] to-[#9d7618] px-4 py-2.5 text-xs font-semibold text-black"
              >
                <CheckCircle2 size={14} />
                {t.apply}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
          <div className="glass h-fit rounded-2xl p-2 lg:sticky lg:top-[94px]">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = settingsTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setSettingsTab(tab.key)}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs transition ${
                    active
                      ? "bg-[var(--gold)]/9 text-[var(--text)] ring-1 ring-[var(--gold)]/15"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <Icon size={15} className={active ? "text-[var(--gold)]" : ""} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="space-y-4">
            {settingsTab === "general" && (
              <>
                <SettingSection
                  title={t.general}
                  icon={<Settings2 size={18} />}
                  description={lang === "ru" ? "Рабочее пространство и интерфейс." : "Workspace and interface preferences."}
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <SettingSelect
                      label={t.language}
                      value={settings.language}
                      options={["ru", "en"]}
                      onChange={(value) => updateSetting("language", value as AppSettings["language"])}
                    />
                    <SettingSelect
                      label={t.theme}
                      value={settings.theme}
                      options={["dark", "light"]}
                      onChange={(value) => updateSetting("theme", value as Theme)}
                    />
                  </div>
                  <SettingToggle
                    label={t.confirmSearch}
                    value={settings.confirmBeforeSearch}
                    onChange={(value) => updateSetting("confirmBeforeSearch", value)}
                  />
                  <SettingToggle
                    label={t.autoResults}
                    value={settings.autoOpenResults}
                    onChange={(value) => updateSetting("autoOpenResults", value)}
                  />
                </SettingSection>
              </>
            )}

            {settingsTab === "research" && (
              <SettingSection
                title={t.researchSettings}
                icon={<Radar size={18} />}
                description={lang === "ru" ? "Лимиты, глубина и память исследования." : "Depth, limits and reusable source memory."}
              >
                <SettingSelect
                  label={t.depth}
                  value={settings.defaultDepth}
                  options={["Quick", "Balanced", "Deep"]}
                  onChange={(value) => updateSetting("defaultDepth", value as AppSettings["defaultDepth"])}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <SettingNumber label={t.maxSources} value={settings.maxSources} onChange={(v) => updateSetting("maxSources", v)} min={1} max={1000} />
                  <SettingNumber label={t.maxPages} value={settings.maxPages} onChange={(v) => updateSetting("maxPages", v)} min={10} max={100000} />
                  <SettingNumber label={t.workers} value={settings.concurrentWorkers} onChange={(v) => updateSetting("concurrentWorkers", v)} min={1} max={64} />
                </div>
                <SettingToggle label={t.reuseRegistry} value={settings.reuseSourceRegistry} onChange={(v) => updateSetting("reuseSourceRegistry", v)} />
                <SettingToggle label={t.multilingual} value={settings.multilingualSearch} onChange={(v) => updateSetting("multilingualSearch", v)} />
                <SettingToggle label={t.relatedLinks} value={settings.followRelatedLinks} onChange={(v) => updateSetting("followRelatedLinks", v)} />
              </SettingSection>
            )}

            {settingsTab === "models" && (
              <SettingSection
                title={t.models}
                icon={<Bot size={18} />}
                description={lang === "ru" ? "Model Router из production-плана: отдельные модели для planning, extraction, hard matching, quality и vision." : "Production Model Router with separate planning, extraction, matching, quality and vision routes."}
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <SettingSelect label={t.planning} value={settings.planningModel} options={["GPT-6.1 Sol", "Claude Sonnet 5.5"]} onChange={(v) => updateSetting("planningModel", v)} />
                  <SettingSelect label={t.extractionModel} value={settings.extractionModel} options={["GPT-6 Luna", "Claude Haiku 4.5"]} onChange={(v) => updateSetting("extractionModel", v)} />
                  <SettingSelect label={t.hardMatch} value={settings.hardMatchModel} options={["Claude Sonnet 5.5", "GPT-6.1 Sol"]} onChange={(v) => updateSetting("hardMatchModel", v)} />
                  <SettingSelect label={t.qualityCheck} value={settings.qualityCheckModel} options={["Claude Sonnet 5.5", "GPT-6.1 Sol"]} onChange={(v) => updateSetting("qualityCheckModel", v)} />
                  <SettingSelect label={t.vision} value={settings.visionModel} options={["GPT / Gemini Vision", "GPT Vision", "Gemini Vision"]} onChange={(v) => updateSetting("visionModel", v)} />
                  <SettingSelect label={t.deepResearch} value={settings.deepResearchProvider} options={["Provider-specific research worker", "OpenAI Deep Research", "Gemini Deep Research"]} onChange={(v) => updateSetting("deepResearchProvider", v)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SettingNumber label={t.maxCost} value={settings.maxCostPerTask} onChange={(v) => updateSetting("maxCostPerTask", v)} min={0.1} max={1000} step={0.5} />
                  <SettingNumber label={t.maxTokens} value={settings.maxTokens} onChange={(v) => updateSetting("maxTokens", v)} min={1000} max={1000000} step={1000} />
                  <SettingNumber label={t.timeout} value={settings.timeoutSeconds} onChange={(v) => updateSetting("timeoutSeconds", v)} min={5} max={600} />
                  <SettingNumber label={t.retries} value={settings.retryLimit} onChange={(v) => updateSetting("retryLimit", v)} min={0} max={10} />
                </div>
                <SettingSelect label={t.fallback} value={settings.fallbackProvider} options={["Claude / secondary provider", "OpenAI only", "Disabled"]} onChange={(v) => updateSetting("fallbackProvider", v)} />
                <SettingToggle label={t.audit} value={settings.auditTrail} onChange={(v) => updateSetting("auditTrail", v)} />
              </SettingSection>
            )}

            {settingsTab === "search" && (
              <SettingSection
                title={t.searchSettings}
                icon={<Search size={18} />}
                description={lang === "ru" ? "Основные и резервные Search API." : "Primary and fallback search providers."}
              >
                {[
                  ["Brave Search", settings.braveEnabled, "Primary discovery"],
                  ["Exa Search", settings.exaEnabled, "Secondary / semantic"],
                  ["Tavily", settings.tavilyEnabled, "Fallback / agent-oriented"],
                  ["Serper", settings.serperEnabled, "Google-oriented fallback"],
                ].map(([name, value, note]) => (
                  <div key={String(name)} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-4 py-3">
                    <div>
                      <div className="text-sm text-[var(--text-soft)]">{String(name)}</div>
                      <div className="mt-1 text-[10px] text-[var(--text-muted)]">{String(note)}</div>
                    </div>
                    <SettingToggle
                      label=""
                      value={Boolean(value)}
                      onChange={(next) => {
                        const key =
                          name === "Brave Search"
                            ? "braveEnabled"
                            : name === "Exa Search"
                              ? "exaEnabled"
                              : name === "Tavily"
                                ? "tavilyEnabled"
                                : "serperEnabled";
                        updateSetting(key as keyof AppSettings, next as never);
                      }}
                    />
                  </div>
                ))}
                <SettingSelect label={t.languageSearch} value={settings.searchLanguage} options={["Auto", "Russian", "English", "Spanish", "Italian"]} onChange={(v) => updateSetting("searchLanguage", v as AppSettings["searchLanguage"])} />
                <SettingNumber label={t.maxSearchRequests} value={settings.maxSearchRequests} onChange={(v) => updateSetting("maxSearchRequests", v)} min={1} max={100000} />
              </SettingSection>
            )}

            {settingsTab === "acquisition" && (
              <SettingSection
                title={t.acquisition}
                icon={<Globe size={18} />}
                description={lang === "ru" ? "Fallback ladder: HTTP → Jina → Firecrawl → Playwright → licensed provider → manual review." : "Fallback ladder: HTTP → Jina → Firecrawl → Playwright → licensed provider → manual review."}
              >
                {[
                  ["httpxEnabled", "httpx", settings.httpxEnabled],
                  ["jinaEnabled", "Jina", settings.jinaEnabled],
                  ["firecrawlEnabled", "Firecrawl", settings.firecrawlEnabled],
                  ["playwrightEnabled", "Playwright", settings.playwrightEnabled],
                  ["licensedProviderEnabled", lang === "ru" ? "Лицензированный provider" : "Licensed provider", settings.licensedProviderEnabled],
                  ["manualReviewEnabled", lang === "ru" ? "Manual review" : "Manual review", settings.manualReviewEnabled],
                ].map(([key, name, value]) => (
                  <SettingToggle
                    key={String(key)}
                    label={String(name)}
                    value={Boolean(value)}
                    onChange={(v) => updateSetting(key as keyof AppSettings, v as never)}
                  />
                ))}
                <SettingNumber label={t.pageRuntime} value={settings.maxPageRuntimeSeconds} onChange={(v) => updateSetting("maxPageRuntimeSeconds", v)} min={5} max={300} />
                <SettingToggle label={t.robots} value={settings.respectRobots} onChange={(v) => updateSetting("respectRobots", v)} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <SettingSelect label={t.captcha} value={settings.captchaPolicy} options={["manual", "stop"]} onChange={(v) => updateSetting("captchaPolicy", v as AppSettings["captchaPolicy"])} />
                  <SettingSelect label={t.auth} value={settings.authPolicy} options={["manual", "stop"]} onChange={(v) => updateSetting("authPolicy", v as AppSettings["authPolicy"])} />
                </div>
              </SettingSection>
            )}

            {settingsTab === "quality" && (
              <SettingSection
                title={t.qualitySettings}
                icon={<Gauge size={18} />}
                description={lang === "ru" ? "Quality Gate, evidence, deduplication, freshness и entity consistency." : "Quality Gate, evidence, deduplication, freshness and entity consistency."}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <SettingNumber label={t.minConfidence} value={settings.minConfidence} onChange={(v) => updateSetting("minConfidence", v)} min={0} max={1} step={0.01} />
                  <SettingNumber label={t.duplicateThreshold} value={settings.duplicateThreshold} onChange={(v) => updateSetting("duplicateThreshold", v)} min={0} max={1} step={0.01} />
                  <SettingNumber label={t.freshness} value={settings.freshnessDays} onChange={(v) => updateSetting("freshnessDays", v)} min={1} max={3650} />
                </div>
                <SettingToggle label={t.evidenceRequired} value={settings.requireEvidence} onChange={(v) => updateSetting("requireEvidence", v)} />
                <SettingToggle label={t.dedupe} value={settings.dedupeEnabled} onChange={(v) => updateSetting("dedupeEnabled", v)} />
                <SettingToggle label={t.locationConsistency} value={settings.requireLocationConsistency} onChange={(v) => updateSetting("requireLocationConsistency", v)} />
              </SettingSection>
            )}

            {settingsTab === "budget" && (
              <SettingSection
                title={t.budgetSettings}
                icon={<BarChart3 size={18} />}
                description={lang === "ru" ? "Hard budget stop и approval перед перерасходом." : "Hard budget stop and approval before overspend."}
              >
                <div className="grid gap-3 md:grid-cols-3">
                  <SettingNumber label={t.perTask} value={settings.taskBudget} onChange={(v) => updateSetting("taskBudget", v)} min={0} max={10000} step={0.5} />
                  <SettingNumber label={t.daily} value={settings.dailyBudget} onChange={(v) => updateSetting("dailyBudget", v)} min={0} max={100000} step={1} />
                  <SettingNumber label={t.monthly} value={settings.monthlyBudget} onChange={(v) => updateSetting("monthlyBudget", v)} min={0} max={1000000} step={5} />
                </div>
                <SettingToggle label={t.hardStop} value={settings.hardBudgetStop} onChange={(v) => updateSetting("hardBudgetStop", v)} />
                <SettingToggle label={t.budgetApproval} value={settings.requireBudgetApproval} onChange={(v) => updateSetting("requireBudgetApproval", v)} />
                <div className="rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/6 px-4 py-3 text-xs leading-5 text-[var(--warning)]">
                  {lang === "ru"
                    ? "Production: budget должен останавливать задачу до превышения лимита без подтверждения."
                    : "Production: the budget engine should pause a task before the limit is exceeded without approval."}
                </div>
              </SettingSection>
            )}

            {settingsTab === "security" && (
              <SettingSection
                title={t.securitySettings}
                icon={<LockKeyhole size={18} />}
                description={lang === "ru" ? "Безопасность web-content workers, secrets, SSRF, prompt injection и isolation." : "Security policy for web-content workers, secrets, SSRF, prompt injection and isolation."}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <SettingSelect label={t.promptInjection} value={settings.promptInjectionPolicy} options={["block", "flag"]} onChange={(v) => updateSetting("promptInjectionPolicy", v as AppSettings["promptInjectionPolicy"])} />
                  <SettingSelect label={t.ssrf} value={settings.ssrfPolicy} options={["block", "flag"]} onChange={(v) => updateSetting("ssrfPolicy", v as AppSettings["ssrfPolicy"])} />
                  <SettingSelect label={t.secrets} value={settings.secretsPolicy} options={["server-only"]} onChange={(v) => updateSetting("secretsPolicy", v as AppSettings["secretsPolicy"])} />
                </div>
                <SettingToggle label={t.sandbox} value={settings.fileSandbox} onChange={(v) => updateSetting("fileSandbox", v)} />
                <SettingToggle label={t.audit} value={settings.auditLogs} onChange={(v) => updateSetting("auditLogs", v)} />
                <SettingToggle label={t.tenant} value={settings.tenantIsolation} onChange={(v) => updateSetting("tenantIsolation", v)} />
                <div className="rounded-xl border border-[var(--success)]/20 bg-[var(--success)]/6 px-4 py-3 text-xs leading-5 text-[var(--success)]">
                  {lang === "ru"
                    ? "API keys не редактируются в UI и не сохраняются в localStorage. Production secrets должны задаваться в Vercel/secret manager."
                    : "API keys are not editable in the UI and are not stored in localStorage. Production secrets belong in Vercel or a secret manager."}
                </div>
              </SettingSection>
            )}

            {settingsTab === "exports" && (
              <SettingSection
                title={t.exportSettings}
                icon={<DownloadCloud size={18} />}
                description={lang === "ru" ? "Настройки CSV/XLSX и состава результата." : "CSV/XLSX export and result payload controls."}
              >
                <SettingToggle label={t.csv} value={settings.csvExport} onChange={(v) => updateSetting("csvExport", v)} />
                <SettingToggle label={t.xlsx} value={settings.xlsxExport} onChange={(v) => updateSetting("xlsxExport", v)} />
                <SettingToggle label={t.includeEvidence} value={settings.includeEvidence} onChange={(v) => updateSetting("includeEvidence", v)} />
                <SettingToggle label={t.includeMetadata} value={settings.includeSourceMetadata} onChange={(v) => updateSetting("includeSourceMetadata", v)} />
              </SettingSection>
            )}
          </div>
        </div>
      </section>
    );
  }

  const researchStages = [
    { ru: "Понимание запроса", en: "Understanding request", icon: Sparkles, from: 0, to: 12 },
    { ru: "Создание Search Plan", en: "Building Search Plan", icon: Radar, from: 12, to: 27 },
    { ru: "Обнаружение источников", en: "Discovering sources", icon: Globe2, from: 27, to: 48 },
    { ru: "Исследование страниц", en: "Researching pages", icon: FileSearch, from: 48, to: 70 },
    { ru: "Извлечение данных", en: "Extracting data", icon: Database, from: 70, to: 84 },
    { ru: "Дедупликация и Entity Resolution", en: "Deduplication & Entity Resolution", icon: Layers3, from: 84, to: 94 },
    { ru: "Quality Gate + Evidence", en: "Quality Gate + Evidence", icon: ShieldCheck, from: 94, to: 100 },
  ];

  let liveResultCount = 0;
  if (completedSearch) {
    liveResultCount = results.length;
  } else if (running) {
    liveResultCount = Math.max(0, Math.min(results.length, Math.ceil((progress / 100) * results.length)));
  }

  const startButtonLabel = lang === "ru" ? "Исследование..." : "Researching...";
  const taskStateLabel = running ? "LIVE BACKGROUND" : completedSearch ? "COMPLETED" : "READY";

  function renderResearchProcess() {
    const stage = researchStages[researchStage] ?? researchStages[0];

    return (
      <section id="engine-progress" className="glass glow relative overflow-hidden rounded-[28px] p-5 sm:p-6">
        <div className="absolute inset-x-0 top-0 h-1 spectrum-line" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-soft)]">
              <span className="spectrum-icon grid h-8 w-8 place-items-center rounded-xl">
                <Activity size={15} />
              </span>
              {running ? t.engineRunning : completedSearch ? t.engineComplete : t.liveFeed}
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {current.label} · {activeTask?.id || "—"} · {taskStateLabel}
            </div>
          </div>
          <div className="text-left lg:text-right">
            <div className="text-3xl font-semibold tracking-[-.04em] text-[var(--text)]">{progress}%</div>
            <div className="mt-1 text-[10px] uppercase tracking-[.16em] text-[var(--text-faint)]">{stage[lang === "ru" ? "ru" : "en"]}</div>
          </div>
        </div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/7">
          <div
            className="spectrum-progress h-full rounded-full transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {liveAttempted && !running && !usingLiveData && liveError ? (
          <div className="mt-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-4 py-3 text-xs leading-5 text-[var(--warning)]">
            Live search reached the API, but the response was not converted into the structured result contract. No demo metrics are being counted as real results.
          </div>
        ) : null}

        {(searchPlan || liveError) && (
          <div className="mt-4 grid gap-3 lg:grid-cols-[1.5fr_.7fr]">
            {searchPlan ? (
              <div className="glass-soft rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-[.16em] text-[var(--text-faint)]">
                  Search Plan
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                  {searchPlan}
                </div>
              </div>
            ) : null}
            {liveError ? (
              <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/6 p-4 text-xs leading-5 text-[var(--danger)]">
                {liveError}
              </div>
            ) : null}
          </div>
        )}

        {usingLiveData && (queryUnderstanding || searchBranches.length || researchSummary) ? (
          <div className="mt-4 grid gap-3 xl:grid-cols-[1.1fr_.9fr]">
            <div className="glass-soft rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-[.16em] text-[var(--gold)]">AI QUERY UNDERSTANDING</div>
                <div className="text-[10px] text-[var(--text-faint)]">{queryUnderstanding?.entityType || "—"}</div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {[
                  ["Intent", queryUnderstanding?.intent],
                  ["Geography", Array.isArray(queryUnderstanding?.geography) ? queryUnderstanding.geography.join(", ") : ""],
                  ["Criteria", Array.isArray(queryUnderstanding?.criteria) ? queryUnderstanding.criteria.join(" · ") : ""],
                  ["Required fields", Array.isArray(queryUnderstanding?.requiredFields) ? queryUnderstanding.requiredFields.join(" · ") : ""],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border border-[var(--line-soft)] bg-white/[.012] p-3">
                    <div className="text-[9px] uppercase tracking-[.13em] text-[var(--text-faint)]">{label}</div>
                    <div className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">{String(value || "—")}</div>
                  </div>
                ))}
              </div>
              {researchSummary ? <div className="mt-3 rounded-lg border border-[var(--line-soft)] bg-white/[.012] p-3 text-[10px] leading-4 text-[var(--text-muted)]">{researchSummary}</div> : null}
            </div>
            <div className="glass-soft rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-[.16em] text-[var(--cyan)]">SEARCH BRANCHES</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {searchBranches.slice(0, 16).map((branch) => <span key={branch} className="rounded-full border border-[var(--line-soft)] bg-white/[.02] px-2.5 py-1.5 text-[9px] text-[var(--text-muted)]">{branch}</span>)}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-5 grid gap-2 md:grid-cols-7">
          {researchStages.map((item, index) => {
            const Icon = item.icon;
            const state = completedSearch || progress >= item.to ? "done" : researchStage === index && running ? "active" : "idle";
            return (
              <div key={item.ru} className={`rounded-xl border p-3 transition-all duration-300 ${state === "done" ? "border-[var(--success)]/20 bg-[var(--success)]/6" : state === "active" ? "border-[var(--gold)]/25 bg-[var(--gold)]/8" : "border-[var(--line-soft)] bg-[var(--surface)]"}`}>
                <div className="flex items-center gap-2">
                  <Icon size={14} className={state === "done" ? "text-[var(--success)]" : state === "active" ? "spectrum-icon-text" : "text-[var(--text-faint)]"} />
                  {state === "done" ? <Check size={12} className="ml-auto text-[var(--success)]" /> : null}
                </div>
                <div className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">{item[lang === "ru" ? "ru" : "en"]}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              "Sources",
              liveAttempted
                ? (usingLiveData ? liveStats.sourcesFound.toLocaleString() : "—")
                : Math.max(0, Math.floor((current.sourcesFound * progress) / 100)).toLocaleString(),
            ],
            [
              "Pages / URLs",
              liveAttempted
                ? (usingLiveData ? liveStats.pagesProcessed.toLocaleString() : "—")
                : Math.max(0, Math.floor((current.sourcesChecked * 3.2 * progress) / 100)).toLocaleString(),
            ],
            [
              "Extracted",
              liveAttempted
                ? (usingLiveData ? liveStats.recordsExtracted.toLocaleString() : "—")
                : Math.max(0, Math.floor((current.qualified * progress) / 100)).toLocaleString(),
            ],
            [
              "Qualified",
              liveAttempted
                ? (usingLiveData ? liveStats.qualified.toLocaleString() : "—")
                : Math.max(0, Math.floor((current.qualified * Math.min(progress, 100)) / 100)).toLocaleString(),
            ],
          ].map(([label, value]) => (
            <div key={label} className="glass-soft rounded-xl p-3">
              <div className="text-[10px] uppercase tracking-[.15em] text-[var(--text-faint)]">{label}</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-soft)]">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-[var(--line-soft)] bg-black/10 p-4">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[.16em] text-[var(--text-faint)]">
            <span>Agent event stream</span>
            <span>{running ? "LIVE" : completedSearch ? "DONE" : "READY"}</span>
          </div>
          <div className="mt-3 space-y-2 font-mono text-[10px] text-[var(--text-muted)]">
            {researchStages.slice(0, Math.max(1, researchStage + 1)).map((item, index) => (
              <div key={item.ru} className="flex items-center gap-2">
                <span className={index < researchStage || completedSearch ? "text-[var(--success)]" : "spectrum-icon-text"}>●</span>
                <span>{index < researchStage || completedSearch ? "DONE" : "RUN "}</span>
                <span className="text-[var(--text-soft)]">{item[lang === "ru" ? "ru" : "en"]}</span>
                <span className="ml-auto text-[var(--text-faint)]">{Math.min(100, Math.max(0, progress - item.from))}%</span>
              </div>
            ))}
          </div>
        </div>

        {liveResultCount > 0 && (
          <div id="results-preview" className="mt-5 scroll-mt-28 rounded-2xl border border-[var(--line-soft)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-soft)]">
                  <Target size={15} className="spectrum-icon-text" />
                  {t.resultPreview}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {liveResultCount} / {results.length} {t.recordsFound}
                </div>
              </div>
              {completedSearch ? (
                <button onClick={() => setActiveNav("results")} className="panel-hover rounded-xl border border-[var(--line)] bg-[var(--gold)]/7 px-3 py-2 text-[10px] text-[var(--gold-bright)]">
                  {lang === "ru" ? "Открыть все результаты" : "Open all results"}
                </button>
              ) : null}
              {completedSearch ? renderShareActions(true) : null}
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {results.slice(0, liveResultCount).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedResult(item)}
                  className="panel-hover rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-[var(--text-soft)]">{item.title}</div>
                      <div className="mt-1 text-[10px] text-[var(--text-muted)]">{item.location} · {item.area} · {item.price}</div>
                    </div>
                    <span className="rounded-full bg-[var(--success)]/8 px-2 py-1 text-[9px] text-[var(--success)]">{item.match}%</span>
                  </div>
                  <div className="mt-2 text-[10px] text-[var(--text-faint)]">{item.source} · {item.evidence}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    );
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
                      type="button"
                      onClick={() => setTestMode((value) => !value)}
                      disabled={running}
                      title={lang === "ru" ? "Дешёвый контрольный запуск: Quick, 3 результата, 8 источников, 20 страниц. Дополнительные провайдеры отключены." : "Low-cost control run: Quick, 3 results, 8 sources, 20 pages. Supplemental providers are disabled."}
                      className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs transition ${
                        testMode
                          ? "border-[var(--success)]/35 bg-[var(--success)]/8 text-[var(--success)]"
                          : "border-[var(--line-soft)] bg-[var(--surface)] text-[var(--text-muted)]"
                      }`}
                    >
                      <Gauge size={14} />
                      {t.testMode}
                    </button>

                    <button
                      onClick={startResearch}
                      disabled={running}
                      className="shine-button spectrum-button inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold text-black shadow-[0_12px_38px_rgba(212,175,55,.18)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Search size={14} />
                      {running ? startButtonLabel : t.start}
                    </button>
                    {running ? (
                      <button
                        onClick={() => void cancelResearch()}
                        className="inline-flex items-center gap-2 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger)]/5 px-3.5 py-2.5 text-xs text-[var(--danger)]"
                      >
                        <CirclePause size={14} />
                        {lang === "ru" ? "Остановить" : "Stop"}
                      </button>
                    ) : null}
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

        {running || progress > 0 || completedSearch ? renderResearchProcess() : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              t.found,
              liveAttempted
                ? (usingLiveData ? liveStats.sourcesFound.toLocaleString() : "—")
                : current.sourcesFound.toLocaleString(),
              liveAttempted ? (usingLiveData ? "live web sources" : "not available") : "demo baseline",
              Globe2,
            ],
            [
              t.checked,
              liveAttempted
                ? (usingLiveData ? liveStats.sourcesChecked.toLocaleString() : "—")
                : current.sourcesChecked.toLocaleString(),
              liveAttempted
                ? (usingLiveData ? `${liveStats.pagesProcessed.toLocaleString()} pages/URLs` : "not available")
                : `${((current.sourcesChecked / current.sourcesFound) * 100).toFixed(1)}% coverage`,
              Activity,
            ],
            [
              t.qualified,
              liveAttempted
                ? (usingLiveData ? liveStats.qualified.toLocaleString() : "—")
                : current.qualified.toLocaleString(),
              liveAttempted ? (usingLiveData ? `${liveStats.evidenceCoverage}% evidence` : "not available") : "demo baseline",
              Target,
            ],
            [
              t.duplicates,
              liveAttempted
                ? (usingLiveData ? liveStats.duplicatesRemoved.toLocaleString() : "—")
                : current.duplicates.toLocaleString(),
              liveAttempted ? (usingLiveData ? "live dedup estimate" : "not available") : "demo baseline",
              FileSearch,
            ],
          ].map(([label, value, note, Icon], index) => (
            <div
              key={String(label)}
              className={`glass panel-hover rounded-2xl p-5 float-in ${index > 0 ? `float-in-delay-${Math.min(index, 3)}` : ""}`}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs text-[var(--text-muted)]">{String(label)}</div>
                <Icon size={17} className="spectrum-icon-text" />
              </div>
              <div className="mt-4 text-3xl font-semibold tracking-tight text-[var(--text)]">
                {String(value)}
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-faint)]">{String(note)}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            ["AI Models", settings.planningModel, Bot],
            ["Search", settings.braveEnabled && settings.exaEnabled ? "Brave + Exa" : "Configured providers", Search],
            ["Acquisition", settings.playwrightEnabled ? "HTTP → Browser" : "HTTP only", Globe2],
          ].map(([label, value, Icon]) => (
            <div key={String(label)} className="glass-soft panel-hover rounded-2xl p-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.15em] text-[var(--text-faint)]"><Icon size={13} className="spectrum-icon-text" />{String(label)}</div>
              <div className="mt-2 text-sm text-[var(--text-soft)]">{String(value)}</div>
            </div>
          ))}
        </section>

        <section className="glass overflow-hidden rounded-[26px]">
          <div className="flex flex-col gap-4 border-b border-[var(--line-soft)] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-soft)]">
                <BarChart3 size={16} className="text-[var(--gold)]" />
                {t.resultsTitle}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {liveAttempted
                  ? (usingLiveData ? `${shownResults.length} live web results` : "live research not completed")
                  : `${shownResults.length} demo baseline matches`}
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
                CSV
              </button>
              <button
                onClick={() => void exportExcel()}
                disabled={!usingLiveData}
                className="panel-hover inline-flex items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                XLSX
              </button>
              <button
                onClick={() => void exportPdf()}
                disabled={!usingLiveData}
                className="panel-hover inline-flex items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                PDF
              </button>
              <button
                onClick={exportJson}
                disabled={!usingLiveData}
                className="panel-hover inline-flex items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                JSON
              </button>
            </div>
          </div>

          <div className="thin-scroll overflow-x-auto">
            {liveAttempted && !usingLiveData ? (
              <div className="p-10 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-[var(--danger)]/20 bg-[var(--danger)]/6 text-[var(--danger)]">
                  <Activity size={18} />
                </div>
                <div className="mt-3 text-sm font-medium text-[var(--text-soft)]">
                  LIVE RESEARCH NOT COMPLETED
                </div>
                <div className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--text-muted)]">
                  {liveError || "No live results were returned."}
                </div>
              </div>
            ) : shownResults.length === 0 ? (
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

        
        {usingLiveData ? (
          <section className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
            <div className="glass rounded-[26px] p-6 sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[.18em] text-[var(--gold)]">
                    QUALITY GATE
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-[var(--text)]">
                    {lang === "ru" ? "Проверка доказательств" : "Evidence validation"}
                  </h3>
                </div>
                <div className="rounded-full border border-[var(--line)] bg-white/[.02] px-3 py-1 text-[10px] text-[var(--text-muted)]">
                  {qualityGate.pass}/{qualityGate.total} PASS
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  ["PASS", qualityGate.pass, "text-[var(--success)]"],
                  ["REVIEW", qualityGate.review, "text-[var(--warning)]"],
                  ["FAIL", qualityGate.fail, "text-[var(--danger)]"],
                ].map(([label, value, tone]) => (
                  <div key={String(label)} className="rounded-xl border border-[var(--line-soft)] bg-white/[.012] p-4">
                    <div className={`text-[10px] uppercase tracking-[.14em] ${tone}`}>{String(label)}</div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--text)]">{String(value)}</div>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-2">
                {qualityGate.ruleSet.map((rule) => (
                  <div
                    key={rule}
                    className="flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white/[.012] px-3 py-2 text-[11px] text-[var(--text-muted)]"
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--success)]/10 text-[var(--success)]">
                      ✓
                    </span>
                    {rule}
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/5 p-4 text-[11px] leading-5 text-[var(--warning)]">
                {lang === "ru"
                  ? "PASS означает, что структурные проверки пройдены. Независимая проверка вторым источником пока не включена."
                  : "PASS means the structural checks passed. Independent second-source verification is not enabled yet."}
              </div>
            </div>

            <div className="glass rounded-[26px] p-6 sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[.18em] text-[var(--cyan)]">
                    LIVE SOURCES
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-[var(--text)]">
                    {lang === "ru" ? "Источники текущего поиска" : "Sources used in this search"}
                  </h3>
                </div>
                <div className="rounded-full border border-[var(--line)] bg-white/[.02] px-3 py-1 text-[10px] text-[var(--text-muted)]">
                  {liveStats.sourcesFound}
                </div>
              </div>

              <div className="mt-5 space-y-2">
                {liveSources.slice(0, 12).map((url) => {
                  let host = url;
                  try {
                    host = new URL(url).hostname.replace(/^www\./, "");
                  } catch {}
                  return (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-center gap-3 rounded-xl border border-[var(--line-soft)] bg-white/[.012] px-3 py-3 hover:border-[var(--line)]"
                    >
                      <img
                        src={sourceFavicon(host)}
                        alt=""
                        className="h-5 w-5 shrink-0"
                        referrerPolicy="no-referrer"
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-soft)]">
                        {host}
                      </span>
                      <ExternalLink
                        size={12}
                        className="shrink-0 text-[var(--text-faint)] group-hover:text-[var(--gold-bright)]"
                      />
                    </a>
                  );
                })}
              </div>

              {liveSources.length === 0 ? (
                <div className="mt-5 rounded-xl border border-[var(--line-soft)] bg-white/[.012] p-4 text-xs text-[var(--text-faint)]">
                  {lang === "ru" ? "URL источников не вернулись из текущего ответа. Результаты ниже всё равно содержат прямые ссылки." : "Source URLs were not returned in the current response. Results below still contain direct links."}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {usingLiveData && (liveSourceRegistry.length || accessEvents.length || accessCheckpoints.length) ? (
          <section className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
            <div className="glass rounded-[26px] p-6 sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[.18em] text-[var(--gold)]">SOURCE REGISTRY / ACCESS POLICY</div>
                  <h3 className="mt-2 text-xl font-semibold text-[var(--text)]">{lang === "ru" ? "Что реально было доступно" : "What was actually accessible"}</h3>
                </div>
                <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] text-[var(--text-muted)]">{liveSourceRegistry.length}</span>
              </div>
              <div className="mt-5 thin-scroll overflow-x-auto">
                <table className="mobile-table w-full border-collapse">
                  <thead><tr className="border-b border-[var(--line-soft)] text-left text-[9px] uppercase tracking-[.14em] text-[var(--text-faint)]"><th className="px-3 py-3">Source</th><th className="px-3 py-3">Access</th><th className="px-3 py-3">Method</th><th className="px-3 py-3">Evidence</th><th className="px-3 py-3">Quality</th></tr></thead>
                  <tbody>{liveSourceRegistry.slice(0, 25).map((source: any) => (
                    <tr key={`${source.domain}-${source.url}`} className="border-b border-[var(--line-soft)] last:border-0">
                      <td className="px-3 py-3"><div className="text-[10px] font-medium text-[var(--text-soft)]">{source.name}</div><div className="mt-1 text-[9px] text-[var(--text-faint)]">{source.domain}</div></td>
                      <td className="px-3 py-3 text-[9px] text-[var(--text-muted)]">{source.accessStatus}</td>
                      <td className="px-3 py-3 text-[9px] text-[var(--text-muted)]">{source.accessMethod}</td>
                      <td className="px-3 py-3 text-[9px]">{source.evidenceAvailable ? "YES" : "NO"}</td>
                      <td className="px-3 py-3 text-[9px] text-[var(--text-muted)]">{source.quality}%</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div className="glass rounded-[26px] p-6 sm:p-7">
              <div className="text-[10px] uppercase tracking-[.18em] text-[var(--cyan)]">ACCESS EVENTS</div>
              <div className="mt-4 space-y-2">
                {accessEvents.slice(0, 14).map((event: any, index: number) => (
                  <div key={`${event.url}-${index}`} className="rounded-xl border border-[var(--line-soft)] bg-white/[.012] p-3">
                    <div className="flex items-center gap-2"><span className="rounded-full bg-white/[.04] px-2 py-1 text-[9px] text-[var(--gold-bright)]">{event.status}</span><span className="text-[9px] text-[var(--text-faint)]">{event.method}</span></div>
                    <div className="mt-2 break-all text-[9px] text-[var(--text-muted)]">{event.url}</div>
                    <div className="mt-1 text-[9px] leading-4 text-[var(--text-faint)]">{event.reason}</div>
                    <div className="mt-1 text-[9px] leading-4 text-[var(--cyan)]">Fallback: {event.fallback}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {usingLiveData && accessCheckpoints.length ? (
          <section className="mt-6 glass rounded-[26px] p-6 sm:p-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[.18em] text-[var(--warning)]">ACCESS ESCALATION</div>
                <h3 className="mt-2 text-xl font-semibold text-[var(--text)]">
                  {lang === "ru" ? "Требуется ручной доступ к отдельным источникам" : "Manual access is required for some sources"}
                </h3>
                <p className="mt-2 max-w-3xl text-[11px] leading-5 text-[var(--text-muted)]">
                  {lang === "ru"
                    ? "Агент не обходит CAPTCHA или защиту сайта. Он открывает безопасную точку ручной проверки и продолжает работу с разрешёнными альтернативными источниками."
                    : "The agent does not bypass CAPTCHA or site access controls. It provides a safe manual checkpoint and continues with allowed alternate sources."}
                </p>
              </div>
              <div className="rounded-full border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-1.5 text-[10px] text-[var(--warning)]">
                {accessCheckpoints.length} {lang === "ru" ? "точек" : "checkpoints"}
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              {accessCheckpoints.slice(0, 12).map((checkpoint: any, index: number) => (
                <div key={String(checkpoint.url || "") + "-" + index} className="rounded-2xl border border-[var(--line-soft)] bg-white/[.012] p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[var(--warning)]/10 px-2 py-1 text-[9px] uppercase tracking-[.12em] text-[var(--warning)]">
                          {checkpoint.kind}
                        </span>
                        <span className="text-[9px] text-[var(--text-faint)]">
                          {lang === "ru" ? "действует" : "valid"} {checkpoint.expiresInMinutes} min
                        </span>
                      </div>
                      <div className="mt-2 break-all text-[10px] text-[var(--text-soft)]">{checkpoint.url}</div>
                      <div className="mt-2 text-[10px] leading-5 text-[var(--text-muted)]">{checkpoint.instructions}</div>
                    </div>
                    <a
                      href={checkpoint.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[10px] text-[var(--gold-bright)] hover:border-[var(--gold)]/30"
                    >
                      <ExternalLink size={12} />
                      {lang === "ru" ? "Открыть вручную" : "Open manually"}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

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
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.22em] text-[var(--gold)]">
                STAGE 1 • SOURCE FEASIBILITY GATE
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-.035em] text-[var(--text)]">
                {lang === "ru" ? "20–30 источников недвижимости Мадрида" : "20–30 Madrid land sources"}
              </h1>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--text-muted)]">
                {lang === "ru"
                  ? "Реальные публичные URL для демонстрации Source Feasibility Matrix. Статусы ниже — первоначальная оценка; финальная проверка доступности, robots/Terms и rate limits выполняется live worker."
                  : "Real public URLs for the Source Feasibility Matrix demo. Statuses below are an initial assessment; final access, robots/Terms and rate-limit checks are performed by the live worker."}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--gold)]/6 px-4 py-3 text-xs text-[var(--gold-bright)]">
              30 sources loaded
            </div>
          </div>
        </div>

        
        <div className="glass rounded-[26px] p-6">
          <div className="text-[10px] font-semibold uppercase tracking-[.18em] text-[var(--cyan)]">
            LIVE SEARCH SOURCES
          </div>
          <h2 className="mt-2 text-lg font-semibold text-[var(--text)]">
            {lang === "ru" ? "Источники последнего реального поиска" : "Sources from the latest live search"}
          </h2>
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
            {lang === "ru"
              ? "Эти домены добавляются из фактических live-результатов. Ниже остаётся Stage 1 матрица из 30 предварительно выбранных источников."
              : "These domains come from actual live results. The 30-source Stage 1 matrix remains below as the planned source baseline."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(liveSources.length ? liveSources.slice(0, 20) : ["REALTOR.UA", "DIM.RIA", "OLX", "Prozorro.Sale"]).map((item) => {
              let label = item;
              let href = item.startsWith("http") ? item : `https://${item}`;
              try {
                label = new URL(item).hostname.replace(/^www\./, "");
              } catch {}
              return (
                <a
                  key={item}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-[var(--line-soft)] bg-white/[.02] px-3 py-1.5 text-[10px] text-[var(--text-muted)] hover:border-[var(--line)] hover:text-[var(--gold-bright)]"
                >
                  {label}
                </a>
              );
            })}
          </div>
        </div>

<div className="glass overflow-hidden rounded-[26px]">
          <div className="thin-scroll overflow-x-auto">
            <table className="mobile-table w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--line-soft)] text-left text-[10px] uppercase tracking-[.12em] text-[var(--text-faint)]">
                  <th className="px-4 py-4">Source</th>
                  <th className="px-4 py-4">Category</th>
                  <th className="px-4 py-4">{lang === "ru" ? "Доступ" : "Access"}</th>
                  <th className="px-4 py-4">{lang === "ru" ? "Метод" : "Method"}</th>
                  <th className="px-4 py-4">{lang === "ru" ? "Данные" : "Data available"}</th>
                  <th className="px-4 py-4">Rate limits</th>
                  <th className="px-4 py-4">Robots / Terms</th>
                  <th className="px-4 py-4">Cost</th>
                  <th className="px-4 py-4">{lang === "ru" ? "Качество" : "Quality"}</th>
                  <th className="px-4 py-4">{lang === "ru" ? "Решение" : "Decision"}</th>
                  <th className="px-4 py-4" />
                </tr>
              </thead>
              <tbody>
                {sourceRegistry.map((source, index) => (
                  <tr
                    key={`${source.name}-${source.url}`}
                    className="border-b border-[var(--line-soft)] last:border-0 hover:bg-white/[.018]"
                  >
                    <td className="px-4 py-4 align-top">
                      <div className="flex gap-2">
                        <img
                          src={sourceFavicon(source.domain)}
                          alt=""
                          className="mt-0.5 h-5 w-5 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <div>
                          <div className="max-w-[230px] text-xs font-semibold text-[var(--text-soft)]">
                            {index + 1}. {source.name}
                          </div>
                          <div className="mt-1 text-[9px] text-[var(--text-faint)]">
                            {source.lastChecked}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-[10px] text-[var(--text-muted)]">{source.category}</td>
                    <td className="px-4 py-4 text-[10px] text-[var(--text-muted)]">{source.access}</td>
                    <td className="px-4 py-4 text-[10px] text-[var(--text-muted)]">{source.method}</td>
                    <td className="max-w-[250px] px-4 py-4 text-[10px] leading-4 text-[var(--text-muted)]">{source.dataAvailable}</td>
                    <td className="px-4 py-4 text-[10px] text-[var(--text-muted)]">{source.rateLimits}</td>
                    <td className="px-4 py-4 text-[10px] text-[var(--warning)]">{source.robotsTerms}</td>
                    <td className="px-4 py-4 text-[10px] text-[var(--text-muted)]">{source.cost}</td>
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-[var(--success)]/8 px-2 py-1 text-[10px] text-[var(--success)]">
                        {source.quality}%
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] ${
                          source.decision === "Keep"
                            ? "bg-[var(--success)]/8 text-[var(--success)]"
                            : "bg-[var(--warning)]/8 text-[var(--warning)]"
                        }`}
                      >
                        {source.decision}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-lg border border-[var(--line-soft)] p-2 text-[var(--gold-bright)] hover:border-[var(--line)]"
                        title={t.open}
                      >
                        <ExternalLink size={12} />
                      </a>
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

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {renderShareActions(true)}
              <button onClick={exportCsv} className="panel-hover inline-flex items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                <Download size={12} /> CSV
              </button>
              <button onClick={() => void exportExcel()} className="panel-hover rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">Excel</button>
              <button onClick={() => void exportPdf()} className="panel-hover rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">PDF</button>
              <button onClick={exportJson} className="panel-hover rounded-full border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">JSON</button>
            </div>
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
    if (activeNav === "settings") return renderSettings();
    return renderResearch();
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-300 spectrum-shell">
      <div className={"music-atmosphere pointer-events-none fixed inset-0 -z-10 " + (radioPlaying ? "is-live" : "")} aria-hidden="true" />
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
                className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition ${
                  activeNav === "settings"
                    ? "border-[var(--line)] bg-[var(--gold)]/7 text-[var(--text)]"
                    : "border-transparent text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                }`}
                onClick={() => {
                  setActiveNav("settings");
                  setMobileOpen(false);
                }}
              >
                <Settings2 size={17} className={activeNav === "settings" ? "text-[var(--gold)]" : ""} />
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
                onClick={() => setRadioOpen((value) => !value)}
                className={"panel-hover inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[10px] " + (radioPlaying ? "border-[var(--success)]/30 bg-[var(--success)]/8 text-[var(--success)]" : "border-[var(--line-soft)] bg-[var(--surface)] text-[var(--text-muted)]")}
                aria-label={radioPlaying ? t.radioOn : t.radioOff}
                title={radioPlaying ? t.radioOn : t.radioOff}
              >
                <RadioIcon size={15} />
                <span className="hidden md:inline">{radioPlaying ? t.radioOn : t.radio}</span>
              </button>

              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")
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
                [lang === "ru" ? "Уверенность" : "Confidence", `${selectedResult.confidence ?? 0}%`],
                [lang === "ru" ? "Контроль качества" : "Quality Gate", selectedResult.qualityGate?.gate || "-"],
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
              {selectedResult.evidenceQuote ? (
                <div className="mt-4 rounded-xl border border-[var(--line-soft)] bg-white/[.02] p-3 text-[11px] leading-5 text-[var(--text-soft)]">
                  <div className="mb-1 text-[9px] uppercase tracking-[.14em] text-[var(--text-faint)]">Evidence quote</div>
                  “{selectedResult.evidenceQuote}”
                </div>
              ) : null}
              <div className="mt-4 text-[10px] text-[var(--text-faint)]">
                {t.retrieved}: {selectedResult.retrievedAt || "—"}
              </div>
              <div className="mt-1 text-[10px] text-[var(--text-faint)]">
                {t.extraction}: {selectedResult.sourceType || "web"} · {selectedResult.sourceDomain || "—"}
              </div>
              <div className="mt-1 text-[10px] text-[var(--text-faint)]">
                Freshness: {selectedResult.freshnessDays ?? 0} day(s) · Independent check: {selectedResult.independentVerification ? "YES" : "NO"}
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

      {radioOpen && (
        <div className="radio-panel fixed right-4 top-[82px] z-[65] w-[calc(100vw-2rem)] max-w-[390px] overflow-hidden rounded-[24px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-strong)_94%,transparent)] shadow-2xl backdrop-blur-2xl">
          <div className="spectrum-line h-px opacity-80" />
          <div className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--gold)]">
                  <Music2 size={14} />
                  {t.radio}
                </div>
                <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                  {currentStation?.name || (lang === "ru" ? "Международное онлайн-радио" : "International online radio")}
                </div>
                {currentStation ? (
                  <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                    {currentStation.country} · {currentStation.codec} {currentStation.bitrate ? currentStation.bitrate + " kbps" : ""}
                  </div>
                ) : null}
              </div>
              <button onClick={() => setRadioOpen(false)} className="rounded-xl border border-[var(--line-soft)] p-2 text-[var(--text-muted)]" aria-label="Close radio">
                <X size={15} />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {[
                ["chillout", lang === "ru" ? "Chill / Ambient" : "Chill / Ambient"],
                ["jazz", "Jazz"],
                ["classical", "Classical"],
                ["electronic", "Electronic"],
                ["pop", lang === "ru" ? "International Pop" : "International Pop"],
              ].map(([tag, label]) => (
                <button
                  key={tag}
                  onClick={() => setRadioGenre(tag)}
                  className={"rounded-full border px-2.5 py-1.5 text-[9px] transition " + (radioGenre === tag ? "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold-bright)]" : "border-[var(--line-soft)] text-[var(--text-muted)]")}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[var(--line-soft)] bg-black/10 p-3">
              <button
                onClick={() => (currentStation ? void playRadioStation(currentStation) : radioStations[0] ? void playRadioStation(radioStations[0]) : undefined)}
                disabled={!currentStation && radioStations.length === 0}
                className={"grid h-10 w-10 shrink-0 place-items-center rounded-xl " + (radioPlaying ? "bg-[var(--success)]/12 text-[var(--success)]" : "bg-[var(--gold)]/12 text-[var(--gold-bright)]") + " disabled:opacity-30"}
                aria-label={radioPlaying ? t.stopRadio : t.listen}
              >
                {radioPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
              </button>
              <button
                onClick={skipRadio}
                disabled={radioStations.length < 2}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--line-soft)] text-[var(--text-muted)] disabled:opacity-30"
                aria-label="Next station"
              >
                <SkipForward size={15} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-[9px] uppercase tracking-[.14em] text-[var(--text-faint)]">
                  <span>{radioPlaying ? t.radioOn : t.radioOff}</span>
                  <span>{Math.round(radioVolume * 100)}%</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Volume2 size={12} className="shrink-0 text-[var(--text-faint)]" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={radioVolume}
                    onChange={(event) => setRadioVolume(Number(event.target.value))}
                    className="w-full accent-[var(--gold)]"
                    aria-label="Radio volume"
                  />
                </div>
              </div>
            </div>

            {radioError ? (
              <div className="mt-3 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger)]/5 p-3 text-[10px] leading-4 text-[var(--danger)]">
                {radioError}
              </div>
            ) : null}

            <div className="mt-4 max-h-[290px] space-y-1.5 overflow-y-auto pr-1">
              {radioLoading ? (
                <div className="rounded-xl border border-[var(--line-soft)] bg-white/[.02] p-4 text-xs text-[var(--text-muted)]">{t.radioLoading}</div>
              ) : radioStations.length === 0 ? (
                <div className="rounded-xl border border-[var(--line-soft)] bg-white/[.02] p-4 text-xs text-[var(--text-muted)]">{t.radioEmpty}</div>
              ) : (
                radioStations.map((station) => (
                  <button
                    key={station.stationuuid}
                    onClick={() => void playRadioStation(station)}
                    className={"group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition " + (currentStation?.stationuuid === station.stationuuid ? "border-[var(--gold)]/25 bg-[var(--gold)]/7" : "border-[var(--line-soft)] bg-white/[.012] hover:bg-white/[.025]")}
                  >
                    {station.favicon ? (
                      <img src={station.favicon} alt="" className="h-8 w-8 rounded-lg object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--gold)]/8 text-[var(--gold)]"><RadioIcon size={14} /></span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-[var(--text-soft)]">{station.name}</span>
                      <span className="mt-0.5 block truncate text-[9px] text-[var(--text-faint)]">{station.country} · {station.tags || station.language || "international"}</span>
                    </span>
                    <PlayIcon size={12} className={currentStation?.stationuuid === station.stationuuid && radioPlaying ? "text-[var(--success)]" : "text-[var(--text-faint)]"} />
                  </button>
                ))
              )}
            </div>

            <div className="mt-3 text-[9px] leading-4 text-[var(--text-faint)]">
              {lang === "ru"
                ? "Открытое интернет-радио. Запуск только после клика — так браузеры не блокируют звук."
                : "Open internet radio. Playback starts only after a click so browsers can allow audio."}
            </div>
          </div>
        </div>
      )}

      <audio
        ref={radioAudioRef}
        onPlay={() => setRadioPlaying(true)}
        onPause={() => setRadioPlaying(false)}
        onError={() => {
          setRadioPlaying(false);
          setRadioError(lang === "ru" ? "Поток станции недоступен. Выберите другую станцию." : "This station stream is unavailable. Choose another station.");
        }}
        preload="none"
      />

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
