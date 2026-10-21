import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execute = promisify(execFile);
const script = path.resolve(
  process.cwd(),
  "../agents/ten_packages/extension/openai_llm2_python/security_replay.py"
);

async function run(args: string[]) {
  try {
    const { stdout } = await execute("python3", [script, ...args], {
      timeout: 10_000, maxBuffer: 64 * 1024, encoding: "utf8",
      // The detached worker reads only OPENAI_API_KEY from ai_agents/.env.
      // Controls never inherit the app's provider credentials.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV },
    });
    return NextResponse.json(JSON.parse(stdout), {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json(
      { error: "Replay unavailable or rejected. Check limits and whether a replay is already active." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function GET() {
  return run(["status"]);
}

export async function POST(request: NextRequest) {
  // Same private Codespaces access boundary as the existing security controls.
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
  try {
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).host !== host || request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "JSON required." }, { status: 415 });
  }
  try {
    const text = await request.text();
    if (text.length > 1024) {
      return NextResponse.json({ error: "Request too large." }, { status: 413 });
    }
    const body = JSON.parse(text);
    if (body.action === "start" && body.approved === true) {
      const ranges: Record<string, [number, number]> = {
        requests: [1, 6], tokens: [512, 8192], output_tokens: [32, 512],
        seconds: [5, 120], budget_cents: [1, 10],
      };
      const limits = body.limits;
      if (!limits || Object.keys(limits).length !== 5 || Object.entries(ranges).some(([key, [low, high]]) =>
        !Number.isInteger(limits[key]) || limits[key] < low || limits[key] > high
      )) {
        return NextResponse.json({ error: "Invalid replay limits." }, { status: 400 });
      }
      return run(["start", "--approve-paid", "--limits", JSON.stringify(limits)]);
    }
    if (body.action === "cancel" && typeof body.id === "string" && /^[0-9a-f-]{36}$/.test(body.id)) {
      return run(["cancel", "--run-id", body.id]);
    }
    return NextResponse.json({ error: "Explicit approval or a valid cancellation is required." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Invalid replay request." }, { status: 400 });
  }
}
