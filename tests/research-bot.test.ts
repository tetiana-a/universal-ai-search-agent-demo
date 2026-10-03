import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockFetch } from "./helpers";
import { handleUpdate } from "@/lib/scout/bot";
import { loadTask, mergeRound, newTask, runRounds, saveTask, type RoundRunner } from "@/lib/scout/research-bot";
import { resetMemoryStore, setValue } from "@/lib/scout/store";

const GROUP = "-5415363237";
const OWNER = "8213865630";

beforeEach(() => {
  resetMemoryStore();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("TELEGRAM_CHAT_ID", GROUP);
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", GROUP + "," + OWNER);
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "AURELIUS8_bot");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function telegram() {
  return mockFetch([{ match: (url) => url.startsWith("https://api.telegram.org/bottest-bot-token/"), respond: () => json({ ok: true, result: { message_id: 42 } }) }]);
}
const sent = (calls: Array<{ url: string; init?: RequestInit }>) => calls.filter((c) => c.url.endsWith("/sendMessage") || c.url.endsWith("/editMessageText")).map((c) => JSON.parse(String(c.init?.body)));
const documents = (calls: Array<{ url: string; init?: RequestInit }>) => calls.filter((c) => c.url.endsWith("/sendDocument"));

function result(url: string, status = "Verified", match = 80) {
  return { title: "Northwave Ventures", organization: "Northwave Ventures", url, status, match, confidence: 70, pageType: "entity", sourceDomain: new URL(url).hostname };
}

const roundOne: RoundRunner = async () => ({
  results: [result("https://northwave.vc/"), result("https://seedfund.nl/about", "Manual review", 55)],
  sourceRegistry: [
    { url: "https://northwave.vc/", domain: "northwave.vc", accessStatus: "checked" },
    { url: "https://linkedin.com/company/x", domain: "linkedin.com", accessStatus: "auth_required" },
    { url: "https://dealroom.co/", domain: "dealroom.co", accessStatus: "checked" },
  ],
  progressCounters: { sourcesDiscovered: 40, resultsFound: 9 },
  continuation: { round: 1, seenUrls: ["https://northwave.vc/"], canContinue: true },
});

describe("universal research in Telegram", () => {
  it("asks clarifying questions for an open task, then runs the search", async () => {
    const calls = telegram();
    const message = { chat: { id: Number(OWNER), type: "private" }, from: { id: Number(OWNER), first_name: "T" }, text: "Найди инвесторов для моего проекта" };
    const first = await handleUpdate({ message });
    expect(first.background).toBeUndefined();
    const task = await loadTask(OWNER);
    expect(task?.state).toBe("clarifying");
    expect(sent(calls).at(-1).text).toContain("Где искать");

    // Three answers close the questions; the last one starts the search.
    let last: any = {};
    for (const answer of ["Амстердам", "B2B SaaS", "seed, 500 тыс. €", "VC и ангелы"]) {
      last = await handleUpdate({ message: { ...message, text: answer } });
      if (last.background) break;
    }
    expect(last.background).toBeTypeOf("function");
    const running = await loadTask(OWNER);
    expect(running?.state).toBe("running");
    expect(running?.query).toContain("Амстердам");
    expect(running?.query).toContain("B2B SaaS");
    expect(sent(calls).at(-1).reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual(["rs:stop", "rs:edit"]);
  });

  it("ignores group chatter that is not addressed to the bot", async () => {
    const calls = telegram();
    const result = await handleUpdate({ message: { chat: { id: Number(GROUP), type: "supergroup" }, from: { id: 5 }, text: "привет всем, как дела?" } });
    expect(result.background).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("takes a task in the group by mention or /find", async () => {
    telegram();
    await handleUpdate({ message: { chat: { id: Number(GROUP), type: "supergroup" }, from: { id: 5 }, text: "@AURELIUS8_bot найди производителей упаковки в Китае, ISO 9001" } });
    expect((await loadTask(GROUP))?.baseQuery).toBe("найди производителей упаковки в Китае, ISO 9001");
    await handleUpdate({ message: { chat: { id: Number(GROUP), type: "supergroup" }, from: { id: 5 }, text: "/find земельные участки в Мадриде от 10 000 м², бюджет до 2 млн €, под застройку" } });
    const task = await loadTask(GROUP);
    expect(task?.baseQuery).toContain("земельные участки в Мадриде");
    expect(["clarifying", "running"]).toContain(task?.state);
  });

  it("merges rounds without duplicates and recomputes the TZ counters", () => {
    let task = newTask(OWNER, OWNER, "Find VC investors in Amsterdam for B2B SaaS seed round");
    task = mergeRound(task, {
      results: [result("https://northwave.vc/"), result("https://seedfund.nl/", "Manual review", 50)],
      sourceRegistry: [{ url: "https://northwave.vc/", accessStatus: "checked" }, { url: "https://x.com/", accessStatus: "blocked" }],
      progressCounters: { sourcesDiscovered: 30, resultsFound: 12 },
      continuation: { round: 1, seenUrls: ["https://northwave.vc/"], canContinue: true },
    });
    task = mergeRound(task, {
      results: [result("https://northwave.vc"), result("https://angels.nl/", "Reviewed", 90)],
      sourceRegistry: [{ url: "https://northwave.vc/", accessStatus: "checked" }, { url: "https://angels.nl/", accessStatus: "checked" }],
      progressCounters: { sourcesDiscovered: 25, resultsFound: 8 },
      continuation: { round: 2, seenUrls: ["https://angels.nl/"], canContinue: false },
    });
    expect(task.results.map((r) => r.url)).toEqual(["https://angels.nl/", "https://northwave.vc/", "https://seedfund.nl/"]);
    expect(task.counters).toMatchObject({ sourcesDiscovered: 55, sourcesChecked: 2, sourcesUnavailable: 1, resultsFound: 20, afterDedupe: 3, matchingCriteria: 2, needsReview: 1 });
    expect(task.round).toBe(2);
    expect(task.seenUrls).toEqual(["https://northwave.vc/", "https://angels.nl/"]);
    expect(task.canContinue).toBe(false);
  });

  it("runs rounds, updates the status message and delivers Excel + CSV", async () => {
    const calls = telegram();
    const task = { ...newTask(OWNER, OWNER, "Find VC investors in Amsterdam for B2B SaaS, seed €500k, VC and angels"), state: "running" as const, runId: "run_1", statusMessageId: 42 };
    await saveTask(task);
    let rounds = 0;
    await runRounds(OWNER, async (input) => { rounds += 1; expect(input.round).toBe(rounds - 1); return { ...(await roundOne(input)), continuation: { round: rounds, canContinue: rounds < 2 } }; });
    expect(rounds).toBe(2);
    const done = await loadTask(OWNER);
    expect(done?.state).toBe("done");
    expect(done?.results).toHaveLength(2);
    const texts = sent(calls).map((m) => m.text).join("\n");
    expect(texts).toContain("Search finished");
    expect(documents(calls).map((c) => (c.init?.body as FormData).get("document") as File).map((f) => f.name)).toEqual([expect.stringMatching(/\.xlsx$/), expect.stringMatching(/\.csv$/)]);
  });

  it("stops after the current round when Stop was pressed", async () => {
    telegram();
    await saveTask({ ...newTask(GROUP, OWNER, "Найди юристов по недвижимости в Испании, русский язык, 5+ лет"), state: "running", runId: "run_2" });
    let rounds = 0;
    await runRounds(GROUP, async (input) => { rounds += 1; await setValue("research-stop:" + GROUP, true); return roundOne(input); });
    expect(rounds).toBe(1);
    expect((await loadTask(GROUP))?.state).toBe("stopped");
  });

  it("a changed-criteria run supersedes the old one, which exits without writing", async () => {
    telegram();
    await saveTask({ ...newTask(GROUP, OWNER, "Найди юристов по недвижимости в Испании, русский язык, 5+ лет"), state: "running", runId: "old" });
    await runRounds(GROUP, async (input) => {
      const current = await loadTask(GROUP);
      await saveTask({ ...current!, runId: "new", query: "changed" });
      return roundOne(input);
    });
    const task = await loadTask(GROUP);
    expect(task?.runId).toBe("new");
    expect(task?.results).toHaveLength(0);
  });

  it("Change criteria asks for a reply and restarts with the new criteria", async () => {
    const calls = telegram();
    await saveTask({ ...newTask(OWNER, OWNER, "Найди инвесторов в Амстердаме для B2B SaaS, seed, VC"), state: "done", runId: "r" });
    await handleUpdate({ callback_query: { id: "cb1", data: "rs:edit", from: { id: Number(OWNER) }, message: { message_id: 42, chat: { id: Number(OWNER), type: "private" } } } });
    expect(sent(calls).at(-1).reply_markup.force_reply).toBe(true);
    const next = await handleUpdate({ message: { chat: { id: Number(OWNER), type: "private" }, from: { id: Number(OWNER) }, text: "только family office" } });
    expect(next.background).toBeTypeOf("function");
    const task = await loadTask(OWNER);
    expect(task?.query).toContain("Изменение критериев: только family office");
    expect(task?.results).toHaveLength(0);
  });
});
