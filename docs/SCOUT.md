# Разведчик (Scout): AI agent for real estate, investors and agencies

The Разведчик module of AURELIUS implements the "AI-агент «Разведчик»" spec (v1.0, August 2026). The module needs no access from the client to work, and every client-only source is an adapter that switches on when its key exists.

- Dashboard: `/scout`
- Telegram: commands and buttons in the AURELIUS group and in a private chat with the bot
- Daily run: Vercel Cron `0 6 * * *` (06:00 UTC, 08:00 Madrid in summer) on `/api/scout/cron`

## Spec coverage

| Spec | Status | Where |
|---|---|---|
| 1. Daily object search by country/city, type, price, area, yield, status | ✅ open web, public TG channels, RSS/XML feeds; Idealista API with a key | `lib/scout/scan.ts`, `extract.ts`, `adapters.ts` |
| 1. Dedupe (one object on 5 portals) | ✅ URL + city/type/price ±2%/area ±3%/title | `scoring.ts → dedupeObjects` |
| 1. Interest scoring (below market by X%, yield, liquidity) | ✅ €/m² vs a reference price that can be edited in settings | `scoring.ts → scoreObject` |
| 1. Object card (link, photo, price, area, location, seller contact, date) | ✅ | `types.ts → ObjectCard` |
| 2. Investors: family offices, funds, private | ✅ web + CSV import (LinkedIn export, event lists) + commenters | `extractInvestor`, `investors.import` |
| 3. Agencies by city, partnership letter | ✅ web; Google Places with a key; co-brokerage template | `extractAgency`, `placesAgencies` |
| 3. Meetings into the client's calendar | ⚠️ .ics + Google Calendar link; two-way sync needs the client's OAuth | `calendar.ts` |
| 4. Scripted dialogue, investor (8) and object (6) checklists | ✅ | `qualification.ts` |
| 4. Hand-over only when the checklist is closed; escalation of money and disputes | ✅ summary to the group with "Беру в работу" | `bot.ts → handleInbound` |
| 5.1 Watchlist of people, parsing posts | ✅ public Telegram channels (t.me/s); FB/IG/LinkedIn are level B, see below | `readTelegramChannel` |
| 5.1 Commenters: explicit > general > neutral | ✅ "Комментаторы" form and `/comments`; only the first two categories become cards | `classifyComment`, `importComments` |
| 5.2 New groups/channels by keywords, "join / ignore" | ✅ | `extractSource`, `monitorQueries` |
| 5.3 New platforms (crowdfunding, PropTech, ECSP) with a brief and API detection | ✅ | `extractSource` |
| 5.4 New agencies | ✅ | `agencyQueries` |
| 5.5 Self-learning: approved → used tomorrow; 30 days without results → "dead" | ✅ | `sources.ts` |
| 5.5 Watchlist editable without a programmer | ✅ dashboard + `/watch add …` | |
| 3. Daily report in the spec's format, every line clickable | ✅ + Одобрить/Отклонить buttons | `report.ts` |
| 4. First-contact rule: who/where from/why/opt-out, stop-list, daily limits, approved templates | ✅ | `outreach.ts` |
| 5. Reminders at most every 3 days, at most 2 | ✅ | `scan.ts → processReminders` |
| 5. Real-time matching object ↔ investor | ✅ on every run + "Сделать стыковку" button | `findMatches` |
| 6. Telegram bot (main) + web dashboard | ✅ | `bot.ts`, `/scout` |
| 6. Single CRM | ✅ Upstash Redis (in-memory fallback) | `store.ts` |
| 6. Languages RU/EN/ES/UK with auto-detection | ✅ templates and dialogue | `detectLang` |
| 6. Logging of every action | ✅ "Журнал" | `logAction` |
| 6. Human-in-the-loop: Отправить / Изменить / Отклонить | ✅ in Telegram and the dashboard | `decideDraft` |
| 6. GDPR: right to erasure, EU storage | ✅ `/forget`; pick an EU region for Upstash | `forgetContact` |

## Deliberately not automated (spec, level B)

- Scraping Facebook groups, closed Telegram chats, or portals without an API: not implemented, because it breaks platform rules and gets accounts banned.
- Automatic DMs to strangers: not implemented. The agent writes a draft, and the human presses "Отправить" and sends it from their own account. The dialogue runs automatically only with people who wrote to the bot first (the spec's "safe alternative").
- Commenters under FB/IG/LinkedIn posts: the human pastes the comments they can see, and the agent classifies them and drafts a public reply in the thread.

## Setup (Vercel → Settings → Environment Variables)

| Variable | Needed | What it does |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes (already set) | the @AURELIUS8_bot bot |
| `TELEGRAM_CHAT_ID` | yes | the AURELIUS group for the report. After the upgrade to a supergroup the id is `-100…`; the bot also picks up the new id by itself and remembers it |
| `TELEGRAM_ALLOWED_CHAT_IDS` | yes (already set) | who may control the agent (group + personal id) |
| Upstash Redis (Vercel → Storage → Upstash → Connect) | strongly recommended | creates `KV_REST_API_URL` / `KV_REST_API_TOKEN`; without it the CRM lives until a restart. EU region |
| `SCOUT_ADMIN_KEY` | recommended | password for the dashboard (the CRM holds personal data) |
| `CRON_SECRET` | recommended | Vercel signs cron calls with it |
| `SCOUT_TIMEZONE` | no | defaults to `Europe/Madrid` |
| `SCOUT_FEEDS` | when available | portal / MLS partner RSS/XML feeds, separated by commas |
| `IDEALISTA_API_KEY`, `IDEALISTA_API_SECRET` | from the client | official Idealista API |
| `GOOGLE_PLACES_API_KEY` | optional | agencies from Google Maps |
| `SEARXNG_URL` or `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY` … | optional | steadier search than keyless DuckDuckGo |

After deploying, open `/scout` and press "Подключить управление ботом" once. This sets the webhook and the command menu.

## Telegram commands

`/report` `/scan` `/objects [город]` `/investors` `/matches` `/drafts` `/leads` `/sources` `/watch` (`add person|group|keyword|domain …`, `del …`) `/comments` `/meet 18.10 11:00 Zoom — Имя` `/stop` `/forget` `/settings` (`price 100000-900000`, `discount 15`) `/help`

## Needs the client

1. Idealista API keys, partner feeds from Fotocasa/Habitaclia/Kyero, MLS access (InmoMLS, AMPSI, Inmovilla).
2. LinkedIn Sales Navigator (export goes in through the CSV import).
3. OAuth consent for two-way Google Calendar sync.
4. Approved first-contact template texts (defaults are in place and can be edited in Settings), the company name and the sender.
5. Reference €/m² prices for their cities (defaults are rough 2026 asking prices).
6. The watchlist: Telegram channels of the brokers and bloggers they follow.
