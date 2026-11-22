import { describe, expect, it } from "vitest";
import { pcmToMp3, stripForSpeech } from "@/lib/advisor";
import { CLIENT_PROFILE, profilePlan } from "@/lib/scout/client-profile";

describe("client profile plan", () => {
  it("covers every theme in every region once", () => {
    const plan = profilePlan();
    expect(plan.length).toBe(CLIENT_PROFILE.themes.length * CLIENT_PROFILE.regions.length);
    const keys = new Set(plan.map((p) => p.topic + "|" + (p.country || "") + "|" + (p.city || "")));
    expect(keys.size).toBe(plan.length);
    // the first batch already spans several regions
    expect(new Set(plan.slice(0, 5).map((p) => p.country)).size).toBeGreaterThan(3);
  });
});

describe("advisor voice", () => {
  it("encodes Gemini PCM to MP3", () => {
    const pcm = Buffer.alloc(24000 * 2);
    for (let i = 0; i < 24000; i += 1) pcm.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), i * 2);
    const mp3 = pcmToMp3(pcm);
    expect(mp3.length).toBeGreaterThan(1000);
    expect(mp3[0]).toBe(0xff); // MPEG frame sync
  });
  it("strips markup before speech", () => {
    expect(stripForSpeech("**Вывод:** <b>да</b>\n• шаг")).toBe("Вывод: да шаг");
  });
});
