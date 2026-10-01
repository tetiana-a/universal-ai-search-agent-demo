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
