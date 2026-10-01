# AURELIUS — Universal AI Search Agent Demo

RU/EN responsive frontend demo in a dark transparent gold theme.

## Includes
- Desktop / tablet / mobile adaptive UI
- RU / EN switch
- simulated research progress
- scenario switcher: land / investors / companies
- result detail drawer
- CSV export
- real public/official source links and source favicons
- microphone input via Web Speech API where supported
- MP3/M4A/WAV/WEBM upload ready for server transcription
- `/api/transcribe` route using `gpt-4o-transcribe` when `OPENAI_API_KEY` is configured

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Enable real audio transcription

Copy `.env.example` to `.env.local` and set:

```env
OPENAI_API_KEY=your_key_here
```

Restart the dev server. Keep the key server-side; never expose it as `NEXT_PUBLIC_*`.

## GitHub

```bash
git init
git add .
git commit -m "feat: bilingual universal ai research demo"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/universal-ai-search-agent-demo.git
git push -u origin main
```

## Demo disclaimer
The UI uses mock result counts and mock result rows. The source links are real public/official sources. Live search, crawling, database and AI orchestration are intentionally not connected in this demo.
