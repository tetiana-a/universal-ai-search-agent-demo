import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockFetch } from "./helpers";
import { POST } from "@/app/api/transcribe/route";

beforeEach(() => { vi.unstubAllGlobals(); vi.stubEnv("GEMINI_API_KEY", "g"); vi.stubEnv("OPENAI_API_KEY", "paid"); });

describe("web voice input", () => {
  it("transcribes a browser recording with free Gemini (any language), not the paid OpenAI key", async () => {
    const calls: string[] = [];
    mockFetch([{ match: (u) => { calls.push(u); return true; }, respond: () => json({ candidates: [{ content: { parts: [{ text: "Vendo piso en Valencia" }] } }] }) }]);
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "voice.webm", { type: "audio/webm;codecs=opus" }));
    const res = await POST(new Request("http://x/api/transcribe", { method: "POST", body: form }));
    expect(await res.json()).toEqual({ text: "Vendo piso en Valencia", model: "gemini" });
    expect(calls.every((u) => u.includes("generativelanguage.googleapis.com"))).toBe(true);
  });
});
