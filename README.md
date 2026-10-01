# AURELIUS — Universal AI Search Agent

> **AI Research & Data Acquisition Engine**  
> A bilingual, responsive research-platform demo for turning natural-language requests into structured, evidence-aware search results.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://vercel.com/)

**Live demo:**  
https://universal-ai-search-agent-demo.vercel.app/

**GitHub:**  
https://github.com/tetiana-a/universal-ai-search-agent-demo

---

## Overview

AURELIUS is a demo of a **universal AI search and data-acquisition workflow**.

The user describes a research task in natural language. The system is designed to turn that request into a structured research process:

**User Query → Query Understanding → Search Plan → Source Discovery → Web Acquisition → Extraction → Deduplication → Quality Gate → Evidence → Structured Results → Export**

The architecture is intentionally **domain-independent**. The same research engine can be applied to different categories such as:

- real estate and land
- investors
- companies and specialists
- suppliers
- manufacturers
- business partners
- events and communities
- funds and other public information sources

The current demo focuses on demonstrating the research workflow rather than pretending that every source on the public internet is automatically accessible.

---

## What the current demo demonstrates

The current live research flow includes:

- natural-language search input
- query understanding
- Search Plan
- live public web research
- source discovery and source accounting
- page acquisition
- structured extraction
- duplicate removal
- server-side Quality Gate
- evidence and confidence fields
- results preview
- CSV export
- live source visibility
- Research / Tasks / Sources / Results views
- interactive Settings workspace

### Example query

Try a request such as:

> **Find 5 real land parcels in Germany larger than 1,000 m² suitable for commercial, industrial, warehouse or logistics use. Prioritize Berlin, Brandenburg, Munich, Frankfurt and Hamburg.**

The result flow is designed to make the research process visible instead of returning only a final answer.

---

## Research pipeline

```text
┌────────────────────┐
│    User Query     │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ Query Understanding│
└─────────┬──────────┘
          ↓
┌────────────────────┐
│   Search Plan      │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ Source Discovery   │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ Web Acquisition    │
│ HTTP / Jina /      │
│ Firecrawl /        │
│ Playwright / API   │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ Extraction         │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ Dedup / Entity     │
│ Resolution         │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ Quality Gate       │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ Evidence /         │
│ Confidence         │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ Structured Results │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ CSV / XLSX Export  │
└────────────────────┘
```

---

## Quality Gate

Each live result is evaluated server-side before being presented as a qualified result.

The current Quality Gate checks for:

- source URL
- source name
- evidence
- title
- location
- area and/or price
- verification status

Each live result receives:

```text
PASS
REVIEW
FAIL
```

The UI also keeps **independent second-source verification** separate and explicitly marks it as not yet enabled in the current demo.

This is important: the system should distinguish between a result that was actually evidenced and a result that is simply plausible.

---

## Live source accounting

The live dashboard separates different levels of measurement:

| Metric | Meaning |
|---|---|
| Sources Found | Unique source domains identified |
| Sources Checked | Domains actually processed |
| Pages / URLs | Individual pages or result URLs processed |
| Records Extracted | Structured records produced by extraction |
| Duplicates Removed | Records removed during deduplication |
| Qualified Results | Results that pass the current qualification rules |
| Evidence Coverage | Share of results with usable evidence |

This prevents source counts, page counts and result counts from being mixed together.

---

## Current demo architecture

### Frontend

- **Next.js 16**
- **React 19**
- **TypeScript (strict)**
- **Tailwind CSS 4**
- **Lucide React**
- **App Router**

### Live research layer

The current demo uses:

1. **OpenAI Responses API**
2. built-in **web_search**
3. strict `emit_research_results` function calling
4. server-side validation
5. client-side defensive error handling

Using a structured function-call contract avoids relying on tool-enabled model output being plain JSON text.

---

## Web acquisition strategy

The intended acquisition ladder is:

```text
HTTP
  ↓
Jina
  ↓
Firecrawl
  ↓
Playwright
  ↓
Licensed / allowed provider or API
  ↓
Manual review
```

Source-specific constraints are treated explicitly.

The system is **not designed to bypass**:

- CAPTCHA
- private accounts
- unauthorized authentication
- anti-bot restrictions through prohibited methods
- source usage restrictions

When a source cannot be legitimately or technically accessed, the system should represent that state rather than turning it into a false success.

Typical states include:

```text
checked
partial
unavailable
blocked
auth required
```

---

## Source Registry

AURELIUS is designed around the idea that research should build reusable knowledge about sources over time.

The broader production architecture uses concepts such as:

- Source Registry
- Source Health
- Search History
- Evidence Store
- Entity Resolution
- Freshness
- Cost per qualified result

The purpose is to avoid rediscovering and re-evaluating the same sources from zero on every future search.

---

## Settings workspace

The demo includes an interactive Settings workspace with local browser persistence.

### General

- language
- theme

### Research

- research depth
- source limits
- page limits
- worker limits
- Source Registry reuse

### AI Model Router

- model roles
- fallback provider
- token limits
- cost limits
- timeouts
- retries
- audit trail

### Search

- Brave
- Exa
- Tavily
- Serper
- request caps

### Web Acquisition

- httpx
- Jina
- Firecrawl
- Playwright
- licensed provider
- manual review
- robots / policy
- CAPTCHA policy
- authentication policy

### Quality & Evidence

- Quality Gate
- evidence requirements
- deduplication
- freshness
- geographic consistency

### Budget & Limits

- task budget
- daily budget
- monthly budget
- hard stop
- approval flow

### Security

- prompt injection handling
- SSRF controls
- secrets handling
- file sandbox
- audit logs
- tenant isolation

### Export

- CSV / XLSX
- Evidence metadata
- Source metadata

> **Demo note:** Settings are stored in browser `localStorage`. Production API keys and secrets are intentionally not editable or stored in the UI.

---

## Navigation

The current interface contains functional views for:

- **Research**
- **Tasks**
- **Sources**
- **Results**
- **Settings**

The UI includes:

- responsive desktop/mobile layout
- light/dark theme
- mobile drawer
- mobile-safe tables
- translucent glass surfaces
- ambient gradients
- hover and pulse states
- shimmer effects
- subtle CTA motion
- reduced-motion support

---

## Error handling

The live research route is designed to fail visibly rather than show stale demo data as if it were live.

### Examples

- Vercel timeout → research stops visibly
- failed live request → old demo counters/results are not reused
- invalid structured output → constrained retry / defensive parsing
- source extraction failure → source remains unavailable or degraded
- Quality Gate failure → result does not silently become a qualified match

The core principle is:

> **Never turn `ERROR` into `FAKE SUCCESS`.**

---

## CSV export

The current CSV exporter is designed for better Excel compatibility:

- UTF-8 BOM
- semicolon delimiters
- CRLF line endings
- escaped quoted cells

This is intended to reduce common encoding and column-parsing problems when opening the exported file in Excel.

---

## Audio input

The UI keeps browser microphone input and an MP3/M4A/WAV transcription endpoint.

For real transcription, configure:

```env
OPENAI_API_KEY=your_key_here
```

Store the real key only in:

- Vercel Environment Variables, or
- local `.env.local`

Never put production API keys into the frontend or commit them to Git.

---

## Installation

Clone the repository:

```bash
git clone https://github.com/tetiana-a/universal-ai-search-agent-demo.git
cd universal-ai-search-agent-demo
```

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

---

## Environment variables

Create `.env.local` when live API functionality is needed:

```env
OPENAI_API_KEY=your_key_here
```

Keep secrets server-side.

Do not commit `.env.local` or production credentials.

---

## Production deployment

The project is designed to run on Vercel.

Typical flow:

```text
GitHub
   ↓
Vercel
   ↓
Next.js build
   ↓
Production deployment
```

Connect the repository to Vercel and deploy the `main` branch.

Production API keys should be configured through **Vercel Environment Variables**.

---

## Version history

### v1.8 — Quality Gate + live source accounting + Excel-safe CSV

- live sources counted by unique domain
- pages / URLs counted separately
- current live source URLs shown in Research and Sources
- server-side Quality Gate
- result-level `PASS | REVIEW | FAIL`
- independent second-source verification shown separately
- Excel-safe CSV export

### v1.7 — Build fix

- removed duplicate `const output`
- web source extraction also checks message annotations

### v1.6 — Structured function-call output

- built-in `web_search`
- strict `emit_research_results` function
- defensive fallback parser
- failed live research never falls back to stale demo metrics

### v1.5 — Timeout-safe live research

- Vercel function max duration: 300 seconds
- smaller live result payload
- improved timeout/error handling
- failed searches stop visibly instead of pretending to complete

### v1.3 — Live research interaction layer

- staged research workflow
- query-driven scenario inference
- incremental result stream
- source/page/extraction/qualified counters
- agent event stream
- animated research states

### v1.2 — Settings workspace

- interactive Settings
- local persistence
- model routing configuration
- search providers
- acquisition ladder
- Quality Gate controls
- budget/security/export controls

### v1.1 — UI / navigation foundation

- fixed CSV export syntax/build issue
- fixed strict TypeScript state typing
- Research / Tasks / Sources / Results views
- Light / Dark theme
- responsive mobile drawer and tables
- removal of placeholder `example.com` URLs
- real public source URLs in demo data
- premium motion and reduced-motion support

---

## Demo scope vs production scope

The purpose of this repository is to demonstrate the **product workflow, live research path and architecture direction**.

It is not yet a full production implementation of the complete Universal AI Research & Data Acquisition Engine.

The wider production architecture is expected to include components such as:

- FastAPI backend
- PostgreSQL / pgvector
- Redis + Celery
- worker orchestration
- persistent Source Registry
- evidence storage
- entity resolution
- checkpoints and recovery
- source health
- structured export
- observability
- security controls
- additional search and acquisition providers
- multi-user / tenant isolation as the product scales

---

## Example use cases

The architecture is intended to support different research categories through the same core engine.

### Real estate

> Find land parcels in Germany above 1,000 m² suitable for logistics use.

### Investors

> Find potential investors in Amsterdam for a specific project.

### Companies

> Find companies in Europe that manufacture a specific type of product.

### Suppliers

> Find suppliers that meet these technical and geographic criteria.

### Specialists

> Find specialists with a specified profile and public professional information.

The important design principle is:

> **Change the task and criteria — not the underlying research engine.**

---

## Product principles

### 1. Evidence over appearance

A result should be tied to a source and evidence whenever possible.

### 2. Honest failure states

Unavailable or restricted sources should be represented as such.

### 3. Reusable source knowledge

Sources should become reusable assets rather than being rediscovered from scratch every time.

### 4. Budget-aware research

Search depth, model selection and acquisition paths should be controllable by cost limits.

### 5. Modular providers

Models, search engines and acquisition tools should be replaceable without rewriting the whole application.

### 6. Universal architecture

The research engine should generalize across multiple information domains.

---

## Status

**Current repository state:** functional demonstration with live public web research, structured output, Quality Gate, source accounting and export.

This repository is best viewed as a **working product demonstration / vertical slice** that shows the core interaction model and a path toward the planned production architecture.

---

## License

Add the project license here when the licensing decision is finalized.
