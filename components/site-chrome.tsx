"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { BarChart3, Compass, Moon, Pause, Radio, Send, Sparkles, Sun, Users, Telescope } from "lucide-react";

// One site-wide shell (mounted in the root layout, so it survives page changes):
// theme, the single radio <audio> element and the dock to switch Главная → Группы → Scout.
// Pages read and change the same state, so everything stays in sync and the music never stops.

export type Theme = "dark" | "light";
export type Station = { stationuuid: string; name: string; streamUrl: string; [key: string]: unknown };

type Site = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  audioRef: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  station: Station | null;
  setStation: (s: Station | null) => void;
};

const SiteContext = createContext<Site | null>(null);

export function useSite() {
  const site = useContext(SiteContext);
  if (!site) throw new Error("useSite must be used inside <SiteChrome>");
  return site;
}

export function Atmosphere() {
  const { playing } = useSite();
  return <div className={"music-atmosphere pointer-events-none fixed inset-0 z-0 " + (playing ? "is-live" : "")} aria-hidden="true" />;
}

// Developer's Telegram; NEXT_PUBLIC_DEVELOPER_TELEGRAM in Vercel can change it without code.
const DEV_TG = String(process.env.NEXT_PUBLIC_DEVELOPER_TELEGRAM || "tetiana_K888").trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "");
const DEV_LINK = /^[a-z0-9_]{4,32}$/i.test(DEV_TG) ? "https://t.me/" + DEV_TG : "https://tetianakotolup.com/";

const TABS = [
  { href: "/", label: "Главная", icon: Sparkles },
  { href: "/groups", label: "Группы", icon: Users },
  { href: "/scout", label: "Scout", icon: Telescope },
  { href: "/advisor", label: "Советник", icon: Compass },
  { href: "/analytics", label: "Аналитика", icon: BarChart3 },
];

export default function SiteChrome({ children }: Readonly<{ children: ReactNode }>) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [playing, setPlaying] = useState(false);
  const [station, setStation] = useState<Station | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pathname = usePathname() || "/";

  useEffect(() => {
    try { if (window.localStorage.getItem("aurelius-theme") === "light") setThemeState("light"); } catch { /* storage blocked */ }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    try { window.localStorage.setItem("aurelius-theme", theme); } catch { /* storage blocked */ }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  // Dock button: resume the chosen station, or start the first one of the default genre.
  const toggleRadio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    try {
      if (!audio.src) {
        const res = await fetch("/api/radio?tag=chillout&limit=12", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const first: Station | undefined = (data.stations || [])[0];
        if (!first) return;
        setStation(first);
        audio.src = first.streamUrl;
      }
      await audio.play();
    } catch { /* blocked or stream down: the button simply stays off */ }
  }, []);

  const base = pathname === "/" ? "/" : "/" + pathname.split("/")[1];

  return (
    <SiteContext.Provider value={{ theme, setTheme, audioRef, playing, station, setStation }}>
      <div className={playing ? "radio-live contents" : "contents"}>{children}</div>
      <audio ref={audioRef} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setPlaying(false)} preload="none">
        <track kind="captions" src="/radio-captions.vtt" srcLang="en" label="Radio captions" />
      </audio>
      <nav aria-label="Разделы" className="site-dock fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] p-1 text-[13px] shadow-2xl backdrop-blur-xl">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = base === href;
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={"inline-flex h-8 items-center gap-1.5 rounded-full px-3 transition " + (active ? "bg-[var(--gold)]/15 text-[var(--gold-bright)]" : "text-[var(--text-soft)] hover:text-[var(--text)]")}>
              <Icon size={14} /><span className={active ? "" : "hidden sm:inline"}>{label}</span>
            </Link>
          );
        })}
        <span className="mx-1 h-5 w-px bg-[var(--line)]" aria-hidden="true" />
        <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="grid h-8 w-8 place-items-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)]"
          aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"} title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}>
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button type="button" onClick={() => void toggleRadio()} className={"inline-flex h-8 items-center gap-1.5 rounded-full px-3 " + (playing ? "bg-[var(--success)]/12 text-[var(--success)]" : "text-[var(--text-muted)] hover:text-[var(--text)]")}
          aria-label={playing ? "Выключить радио" : "Включить радио"} title={station ? station.name : "Радио"}>
          {playing ? <Pause size={14} /> : <Radio size={14} />}
          <span className="hidden max-w-[110px] truncate sm:inline">{playing ? station?.name || "Радио" : "Радио"}</span>
        </button>
      </nav>
      <a href={DEV_LINK} target="_blank" rel="noreferrer" className="dev-chat fixed bottom-4 right-4 z-[60] inline-flex h-10 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] pl-1 pr-1 text-[13px] text-[var(--text)] shadow-2xl backdrop-blur-xl"
        aria-label="Написать разработчику в Telegram" title="Написать разработчику">
        <span className="dev-chat-ring grid h-8 w-8 place-items-center rounded-full"><Send size={14} className="dev-chat-icon" /></span>
        <span className="dev-chat-label">Написать разработчику</span>
      </a>
    </SiteContext.Provider>
  );
}
