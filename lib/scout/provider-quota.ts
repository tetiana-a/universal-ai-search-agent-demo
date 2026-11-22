import { getValue, setValue } from "@/lib/scout/store";

// Paid/trial providers pause themselves for a day when they report an exhausted
// balance or plan limit, so one empty wallet never breaks the whole search.
const KEY = (name: string) => "provider-paused:" + name;

export async function providerPaused(name: string) {
  return Boolean(await getValue<string>(KEY(name)).catch(() => null));
}

export async function pauseProvider(name: string, reason: string, hours = 24) {
  await setValue(KEY(name), reason.slice(0, 160), hours * 3600).catch(() => undefined);
}

// 402 Payment Required / 403 plan forbids / 429 quota: all mean "out of limit".
export function isQuotaStatus(status?: number) {
  return status === 402 || status === 403 || status === 429;
}
