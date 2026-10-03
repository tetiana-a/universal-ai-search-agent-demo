# AURELIUS — Universal AI Search Agent Demo v1.1

A bilingual, responsive research-platform demo for the Universal AI Research & Data Acquisition Engine.

## What changed in v1.1

- Fixed CSV export syntax/build issue.
- Fixed strict TypeScript query state typing.
- Added functional navigation views:
  - Research
  - Tasks
  - Sources
  - Results
- Added Light / Dark theme switch with localStorage persistence.
- Added translucent glass surfaces, ambient gradients and premium motion.
- Added responsive mobile drawer and mobile-safe tables.
- Removed `example.com` placeholders from Source Registry and result links.
- Added only real public source URLs to demo data.
- Added animated progress, staggered entrance, hover lift, pulse states, shimmer and subtle CTA shine.
- Added reduced-motion support.
- Kept browser microphone input and MP3 transcription endpoint.

## Stack

- Next.js 16
- React 19
- TypeScript strict
- Tailwind CSS 4
- Lucide React
- App Router

The visual direction is aligned with current 2026 shadcn/ui/Base UI trends and uses lightweight CSS motion instead of adding another animation dependency. shadcn/ui made Base UI the default for new projects in July 2026, while Motion remains an optional production-grade animation system for richer gesture/layout work.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Audio

Real MP3/M4A/WAV transcription requires:

```env
OPENAI_API_KEY=your_key_here
```

Store the real key only in Vercel Environment Variables or local `.env.local`.

## Demo data

Counts/results are illustrative demo data. Source URLs in the Source Registry and result drawers point to real public domains; the demo does not claim that the displayed mock records are live verified records.

## Vercel

Connect the GitHub repository to Vercel and deploy the `main` branch.


## v1.2 Settings

The demo now includes a real interactive Settings workspace with local persistence for:

- General / language / theme
- Research depth, source/page/worker limits and Source Registry reuse
- AI Model Router roles, fallback, token/cost/timeouts/retries and audit trail
- Search providers (Brave, Exa, Tavily, Serper) and request cap
- Web Acquisition ladder (httpx, Jina, Firecrawl, Playwright, licensed provider, manual review)
- robots/policy, CAPTCHA and authentication policy
- Quality Gate, evidence, deduplication, freshness and geographic consistency
- task/daily/monthly budgets and hard stop / approval
- Security: prompt injection, SSRF, secrets, file sandbox, audit logs, tenant isolation
- CSV/XLSX and Evidence/Source metadata export controls

Settings are stored in browser localStorage for demo purposes. Production secrets/API keys are intentionally not editable or persisted in the UI.


## v1.3 Live Demo Research Flow

- Search now visibly runs a staged local demo engine: query understanding → Search Plan → source discovery → page acquisition → extraction → dedup/entity resolution → quality/evidence.
- The selected scenario is inferred from the user's query.
- Results appear incrementally in a live result stream and the completed run scrolls to the result preview.
- The progress area exposes simulated source/page/extraction/qualified counters and an agent event stream.
- The CTA and progress line use a continuous multi-color spectrum animation rather than a gold-only accent.
- This is still demo orchestration: displayed records are demo data. Real internet acquisition belongs to the production backend described in the technical plan.


## v1.5 — Timeout-safe live demo

- Vercel function max duration is now set to 300 seconds for the live research route.
- The demo uses a smaller live result payload (8 results, medium search context) to reduce latency and cost.
- The client no longer blindly assumes every error response is JSON.
- A 504/timeout now stays visibly failed at 94% and shows "LIVE RESEARCH NOT COMPLETED".
- Failed live searches no longer display the old demo counters or demo result table.


## v1.6 — Structured function-call output

The live research route now uses two tools in the Responses API:

1. built-in `web_search` for current public web research;
2. strict `emit_research_results` function calling for the typed result contract.

This avoids relying on `response.output_text` being a raw JSON string after a tool-enabled response. The client still has a defensive fallback parser and never displays demo counters after a failed live run.


## v1.7 — Build fix

- Removed the duplicate `const output` declaration that caused the Vercel TypeScript/build failure in v1.6.
- Web source extraction now also checks message annotations as a compatibility fallback.


## v1.8 — Quality Gate + live source accounting + Excel-safe CSV

- Live sources are now counted by unique domain; pages/URLs are counted separately.
- Current live source URLs are visible in the Research dashboard and Sources page.
- Server-side Quality Gate validates: source URL, source name, evidence, title, location, area/price, and verification status.
- Each live result carries `qualityGate: PASS | REVIEW | FAIL`.
- Independent second-source verification is explicitly shown as a separate, not-yet-enabled check.
- CSV export uses UTF-8 BOM, semicolon delimiters, CRLF and escaped quoted cells for better Excel compatibility.


## v2.0 — Universal acquisition upgrade

This working package upgrades the v1.8 demo toward the production architecture: query understanding, multi-branch Search Plan, supplemental Brave/Exa/Tavily discovery, Source Registry/access policy, evidence quote/confidence/freshness fields, deterministic deduplication, richer Quality Gate, and expanded exports (CSV, XLSX, printable PDF, Google Docs-compatible DOC, JSON).

The project **does not bypass CAPTCHA, access controls, borrowed credentials or anti-bot systems**. Restricted sources are surfaced as blocked/manual-review states and the engine falls back to allowed APIs, indexes, feeds or licensed providers.

See `docs/PRODUCTION_READINESS.md` and `docs/MASTER_CODING_PROMPT.md` for the current implementation boundary and the next production steps.

For the global-search layer, also see `docs/GLOBAL_SEARCH_AND_PUBLIC_COMMUNITIES.md`, `docs/SEARCH_PROVIDER_SOURCES_2026-10-02.md` and `docs/SEARCH_PROVIDER_REGISTRY.json`. These define the multi-engine and public-community discovery matrix and the provider lifecycle notes.


## v2.1 — Production results, Telegram delivery, persistent memory

- Live research now preserves real search candidates when structured LLM output is empty instead of silently returning an empty result set.
- Direct Telegram Bot API delivery is server-side via `/api/telegram/send`; the bot token and chat ID never enter the browser.
- Persistent Source Memory / learning is supported through Upstash Redis REST or compatible KV REST credentials:
  - `KV_REST_API_URL`
  - `KV_REST_API_TOKEN`
  - or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- `/api/memory` exposes memory health and query-relevant learned sources.
- Source memory records access/evidence/verification outcomes, duplicates, CAPTCHA/blocked events, quality score, task categories and recent query examples.
- Future searches reuse learned public sources while still performing live search; memory does not replace current verification for volatile facts.
- The browser localStorage source memory remains only as a client-side convenience. Persistent learning requires the server-side Redis/KV variables above.
- CAPTCHA/access controls are not bypassed. Blocked sources become manual-review/fallback states.

### Required free-research configuration

Free mode uses Jina Search/Reader plus OpenRouter free-model inference. Jina Search requires a suitable Jina API-key/rate-limit configuration for reliable production use; OpenRouter's `openrouter/free` routes to currently available free models.


## v2.2 — Production exports and outbound delivery

- CSV, XLSX, PDF and JSON exports now use the server-side \`/api/export\` route so browser bundling does not block Excel/PDF downloads.
- XLSX is formatted as a professional workbook with Results, Executive Summary and Source Registry sheets, frozen headers, filters, wrapped evidence and source hyperlinks.
- PDF is generated as an A4 landscape report with an executive summary, readable result table and evidence detail pages.
- Telegram delivery is server-side and can send a formatted HTML report plus XLSX/PDF attachments.
- Telegram recipients are protected by \`TELEGRAM_ALLOWED_CHAT_IDS\`; the configured target must be a real user/group/channel Chat ID. A bot's own user ID is rejected.
- For multiple Telegram users, each user must first open the bot and press Start; add their resulting Chat IDs to the allowlist.
- Email delivery uses the Resend REST API, with a styled HTML report and XLSX/PDF attachments. Configure \`RESEND_API_KEY\`, \`EMAIL_FROM\` and \`EMAIL_ALLOWED_RECIPIENTS\`.
- Gmail/Outlook compose links remain available as a client-side fallback.


## v2.3 — Production hardening

- **No more silent zero results.** Missing `JINA_API_KEY` → `503 JINA_API_KEY_MISSING`; every provider failing → `502 SEARCH_PROVIDERS_FAILED` with per-provider HTTP status; a real "nothing found" → `200` with `outcome: "no_candidates"` and an explanation. Every error has a stable `code`.
- **Provider fallback.** Any configured Brave/Tavily/Exa/Serper/Mojeek/Yandex/Naver/DataForSEO key is used automatically when Jina fails, is rate limited or returns fewer than 5 candidates.
- **Manual Review instead of empty output.** If AI extraction fails, times out or confirms nothing, live candidates are kept as `Manual review` (`outcome: "candidates_for_review"`).
- **Investor relevance.** Events, conferences, networking, jobs, IPO/stock and news pages are rejected; directory pages and investors without confirmed geography/sector go to review. The old Cyprus/SaaS hard-coding is gone: geography and sector come from the query.
- **Evidence.** `Verified` is only granted when the quote is found in page text the app retrieved itself; AI results with URLs that were never retrieved are dropped.
- **Quality Gate** scores four independent dimensions (relevance, evidence, source validity, confidence). `REVIEW` keeps the result visible.
- **Deduplication** resolves organisations across URLs (legal suffixes, own domain, LinkedIn/Crunchbase aware).
- **Source Registry** stores one record per domain with health (`healthy/degraded/failing`), reuses only related sources and stops reusing sources that failed three times.
- **Telegram**: precise diagnostics (invalid token, chat not found, bot blocked, no rights), messages packed under the 4096-char limit, retry on 429, and a failed XLSX/PDF no longer blocks the report.
- **Exports**: XLSX no longer crashes when results exist (exceljs table error), CSV/XLSX formula-injection guard, export errors are shown separately from research errors.
- **Free / Pro plans** — see `docs/PLANS_AND_BILLING.md` (includes the n8n decision).
- **Security**: SSRF guard for all URLs read on the server, client-supplied source memory is sanitized, e-mail validation regex fixed.
- **Tests**: `npm test` (Vitest, 44 regression tests), `npm run typecheck`; CI runs both before `next build`.
