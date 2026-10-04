import type { Meeting } from "@/lib/scout/types";
import { randomId, nowIso } from "@/lib/scout/text";

// Meetings: an .ics file and a Google Calendar link work today with zero setup;
// two-way Google Calendar sync needs the client's OAuth consent (adapter "calendar").

export function timezone() {
  return process.env.SCOUT_TIMEZONE || "Europe/Madrid";
}

function offsetMs(utcMs: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz = timezone()) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(guess, tz);
  return new Date(guess - offsetMs(first, tz));
}

// "18.10 11:00 Zoom — Engel & Völkers Valencia" → meeting.
export function parseMeetingCommand(text: string, now = new Date()): Omit<Meeting, "id" | "createdAt"> | null {
  const m = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s+(\d{1,2})[:.](\d{2})\s*([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]); const month = Number(m[2]);
  let year = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : now.getUTCFullYear();
  const rest = (m[6] || "").trim();
  let starts = zonedToUtc(year, month, day, Number(m[4]), Number(m[5]));
  if (!m[3] && starts.getTime() < now.getTime() - 86400000) { year += 1; starts = zonedToUtc(year, month, day, Number(m[4]), Number(m[5])); }
  const [whereRaw, ...withParts] = rest.split(/\s+[—–-]\s+/);
  const where = /zoom|meet|teams|call|звон|офис|office|lugar|оф[іi]с/i.test(whereRaw || "") ? whereRaw : "Zoom";
  const withWhom = withParts.join(" — ") || (where === whereRaw ? "" : whereRaw) || "контакт";
  return { title: "Встреча: " + withWhom, startsAt: starts.toISOString(), durationMin: 45, where, with: withWhom };
}

export function newMeeting(input: Omit<Meeting, "id" | "createdAt">): Meeting {
  return { ...input, id: randomId("mt"), createdAt: nowIso() };
}

function icsDate(iso: string) {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
}

export function buildIcs(meeting: Meeting) {
  const end = new Date(Date.parse(meeting.startsAt) + meeting.durationMin * 60000).toISOString();
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AURELIUS//Scout//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + meeting.id + "@aurelius-scout",
    "DTSTAMP:" + icsDate(nowIso()),
    "DTSTART:" + icsDate(meeting.startsAt),
    "DTEND:" + icsDate(end),
    "SUMMARY:" + icsEscape(meeting.title),
    "LOCATION:" + icsEscape(meeting.where),
    "DESCRIPTION:" + icsEscape("С кем: " + meeting.with),
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:" + icsEscape(meeting.title), "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

export function googleCalendarLink(meeting: Meeting) {
  const end = new Date(Date.parse(meeting.startsAt) + meeting.durationMin * 60000).toISOString();
  const params = new URLSearchParams({ action: "TEMPLATE", text: meeting.title, dates: icsDate(meeting.startsAt) + "/" + icsDate(end), location: meeting.where, details: "С кем: " + meeting.with });
  return "https://calendar.google.com/calendar/render?" + params.toString();
}

export function formatLocal(iso: string, withDate = true) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: timezone(), ...(withDate ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function isTomorrow(iso: string, now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone(), year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date(iso)) === fmt.format(new Date(now.getTime() + 86400000));
}
