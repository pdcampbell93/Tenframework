import { spawn } from "node:child_process";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const script = path.resolve(process.cwd(), "../agents/ten_packages/extension/openai_llm2_python/companion.py");
const recentCalls: number[] = [];
let active = 0;

async function run(body: object) {
  if (active >= 2) return NextResponse.json({ error: "Companion is busy. Please wait and retry." }, { status: 429 });
  active++;
  try {
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn("python3", [script], {
        env: {
          PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          OPENAI_MODEL: process.env.OPENAI_MODEL,
          TEN_MEMORY_KEY: process.env.TEN_MEMORY_KEY,
          DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
          ELEVENLABS_TTS_KEY: process.env.ELEVENLABS_TTS_KEY,
          AGORA_APP_CERTIFICATE: process.env.AGORA_APP_CERTIFICATE,
        },
        stdio: ["pipe", "pipe", "ignore"],
      });
      let output = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Timeout")); }, 75_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 2_000_000) child.kill("SIGKILL");
      });
      child.on("error", () => { clearTimeout(timer); reject(new Error("Companion unavailable")); });
      child.on("close", code => { clearTimeout(timer); resolve({ code, output }); });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(body));
    });
    const data = JSON.parse(result.output);
    return NextResponse.json(data, {
      status: result.code === 0 ? 200 : result.code === 2 ? 400 : 503,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "Companion unavailable. Refresh saved memories before retrying a save." }, { status: 503 });
  } finally { active--; }
}

export async function GET() {
  return run({ action: "status" });
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
    if (!origin || new URL(origin).host !== host || request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return NextResponse.json({ error: "JSON required." }, { status: 415 });
    }
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "JSON object required." }, { status: 400 });
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 60000) {
        await reader.cancel();
        return NextResponse.json({ error: "Request too large." }, { status: 413 });
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || Array.isArray(body) || typeof body !== "object") {
      return NextResponse.json({ error: "JSON object required." }, { status: 400 });
    }
    const now = Date.now();
    while (recentCalls.length && now - recentCalls[0] > 60_000) recentCalls.shift();
    if (body.action !== "delete") {
      if (recentCalls.length >= 30) return NextResponse.json({ error: "Please wait a minute before more companion requests." }, { status: 429 });
      recentCalls.push(now);
    }
    return run(body);
  } catch {
    return NextResponse.json({ error: "Invalid companion request." }, { status: 400 });
  }
}
