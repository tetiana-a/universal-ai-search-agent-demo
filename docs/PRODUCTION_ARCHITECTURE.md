# AURELIUS Production Architecture

AURELIUS is implemented as a modular monolith on Next.js/Vercel. The current production priority is the zero-cost path: Telegram Bot API, Upstash Redis, keyless web discovery and deterministic fallbacks. Paid providers are optional enhancements, not correctness dependencies.

## Runtime boundaries

1. **Telegram control plane** — accepts authenticated webhook updates, enforces control access, de-duplicates `update_id`, and returns quickly.
2. **Research orchestration** — owns the task lifecycle and persisted checkpoints.
3. **Search layer** — keyless provider routing (SearXNG when configured, otherwise DuckDuckGo) plus optional provider fallbacks.
4. **Reading/extraction** — public page reading, deterministic extraction and optional AI-assisted verification.
5. **Quality layer** — evidence grounding, relevance gate, entity de-duplication, verification statuses and task-level quality metrics.
6. **Persistence** — Redis-backed Scout collections and active task pointers.
7. **Operations** — structured action log, protected health endpoint, Telegram /health and dashboard Health view.
8. **Delivery** — Telegram cards, CSV/XLSX export and the Scout web dashboard.

## Research lifecycle

A persisted task has two views of state:

- business state: `clarifying | running | stopped | done | failed`
- operational stage: `clarifying | queued | searching | merging | delivering | completed | stopped | failed`

Every meaningful transition appends a bounded event to the task and persists the task record. The active task remains addressable by chat while recent tasks are stored as first-class `research_tasks` records for operations and history.

### Invariants

- A newer `runId` owns the chat; an older worker cannot overwrite it.
- A Telegram `update_id` is processed once per idempotency TTL.
- Cancellation is persisted. Clarification can be stopped immediately; active search stops at a safe checkpoint.
- Partial research data is retained when a downstream stage fails.
- A result is never promoted to Verified solely because an AI model says so; evidence and quality checks control status.

## Quality signals

Every task records:

- evidence coverage
- quality-gate pass rate
- verified rate
- review rate
- source diversity
- aggregate quality score

The aggregate score is informational. It never overrides a critical per-result REVIEW/FAIL condition.

## Security boundaries

- Telegram webhook requests require the Telegram secret token.
- Privileged Telegram actions require configured control user/chat IDs.
- `SCOUT_ADMIN_KEY` protects dashboard/API state when configured.
- Health responses expose status only, never secret values.
- Public reading must continue to use URL-safety checks. Authentication, CAPTCHA and access-control bypass are out of scope.

## Zero-cost production mode

Recommended deployment:

```env
ZERO_COST_MODE=on
RESEARCH_AI_PROVIDER=free
KEYLESS_SEARCH=always
DIRECT_READ=on
OPENROUTER_MODEL=openrouter/free
```

OpenRouter is optional for the deterministic fallback path. Telegram and Redis still require their normal infrastructure credentials.

## Deliberate non-goals

The current system does not pretend to automate private Facebook groups, closed Telegram chats, CAPTCHA-protected sites or authenticated portals without an approved integration. Those sources must be represented as `auth_required`, `captcha_required`, `policy_restricted` or `human_required`.
