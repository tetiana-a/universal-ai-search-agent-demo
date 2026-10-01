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
