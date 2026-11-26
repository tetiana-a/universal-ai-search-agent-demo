// Schedule of the AURELIUS background queue (Graphile Worker crontab syntax).
// Times are UTC, the same as the Vercel crons it replaces. Each line: retries (max=3,
// exponential backoff by Graphile) and a job key, so a slot is never queued twice.
export const CRONTAB = [
  "*/5 * * * * dispatch ?max=3&jobKey=dispatch",
  "0 6 * * * daily_scout ?max=3&jobKey=daily_scout",
  "0 7 * * * daily_groups ?max=3&jobKey=daily_groups",
  "0 8 * * * daily_campaigns ?max=2&jobKey=daily_campaigns",
].join("\n");

