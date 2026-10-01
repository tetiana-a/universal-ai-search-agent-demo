import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
]);

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not configured. The UI is ready; add the server-side key to enable real MP3 transcription.",
      },
      { status: 503 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const language = String(formData.get("language") || "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
  }

  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "For the demo, keep audio files under 25 MB." },
      { status: 413 },
    );
  }

  if (!ALLOWED.has(file.type) && !file.name.toLowerCase().match(/\.(mp3|mp4|m4a|wav|webm|ogg|flac)$/)) {
    return NextResponse.json(
      { error: "Unsupported audio format." },
      { status: 415 },
    );
  }

  const upstream = new FormData();
  upstream.append("file", file, file.name);
  upstream.append("model", "gpt-4o-transcribe");

  if (language) {
    upstream.append("language", language);
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: upstream,
  });

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      { error: data?.error?.message || "Transcription failed." },
      { status: response.status },
    );
  }

  return NextResponse.json({
    text: data.text ?? "",
    model: "gpt-4o-transcribe",
  });
}
