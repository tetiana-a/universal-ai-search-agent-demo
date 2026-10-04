# AURELIUS Zero-Cost Local Mode

This mode is designed for development, demos and single-operator use with **no paid AI/search API**.

## What is free

- Web discovery: DuckDuckGo HTML/Lite, no key.
- Optional self-hosted SearXNG, no vendor key.
- Public page reading: direct HTTP with robots/policy checks.
- AI: local Ollama. If Ollama is unavailable, deterministic extraction still works and uncertain results are marked for manual review.
- Telegram control: Telegram Bot API is free.
- Telegram delivery: messages, inline buttons, CSV/XLSX delivery through the same bot.
- Local hosting: your own PC.

## What "without API" means

A Telegram bot cannot exist without Telegram's Bot API. In this mode **no paid provider API is required**. The only required external protocol is Telegram Bot API, which is free.

No OpenAI, Brave, Tavily, Exa, Firecrawl, Browserbase, Jina or paid search key is required.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Create a Telegram bot with @BotFather and put its token in `TELEGRAM_BOT_TOKEN`.
3. Put your Telegram user/chat ID in `TELEGRAM_CHAT_ID` and `TELEGRAM_ALLOWED_CHAT_IDS`.
4. Optional local AI:
   - install Ollama;
   - run `ollama pull qwen2.5:7b`;
   - keep `OLLAMA_BASE_URL=http://127.0.0.1:11434`.
5. Start AURELIUS:
   - terminal 1: `npm run dev`
   - terminal 2: `npm run telegram:poll`
6. Send `/panel` to the bot.

Local polling removes the need for a public Telegram webhook or paid server.

## Telegram control panel

The panel contains buttons for:

- New search
- Status
- Daily report
- Source scan
- Sources
- Drafts
- Leads
- Settings
- Web dashboard

Search can also be started by simply replying to the bot with a natural-language task.

## Zero-cost acquisition ladder

AURELIUS uses:

`known source memory → SearXNG (if configured) → DuckDuckGo → direct public read → manual review`

It does not solve CAPTCHA, steal cookies, spoof fingerprints or bypass access controls. Restricted sources become human-assisted checkpoints or alternate-source tasks.

## Important limits

A zero-cost system has real trade-offs:

- DuckDuckGo may rate-limit automated traffic.
- Some sites cannot be read automatically.
- A local PC must stay running for continuous Telegram operation.
- Local Ollama speed depends on your RAM/GPU.
- Without a persistent storage backend, cloud/serverless process memory can disappear after restart.

For a single-machine local deployment, the next production step is local persistent storage (SQLite/PostgreSQL) plus a durable local worker. These can also be self-hosted without subscription fees.
