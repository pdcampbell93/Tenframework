import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execute = promisify(execFile);
const actions = new Set(["pause", "resume", "disengage", "selftest"]);
const script = path.resolve(
  process.cwd(),
  "../agents/ten_packages/extension/openai_llm2_python/security.py"
);

async function run(action: string) {
  const { stdout } = await execute("python3", [script, action], {
    timeout: 15_000,
    maxBuffer: 128 * 1024,
    encoding: "utf8",
    // The control process never needs the app's provider credentials.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV },
  });
  return NextResponse.json(JSON.parse(stdout), {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET() {
  try {
    return await run("status");
  } catch {
    return NextResponse.json(
      { error: "Security status unavailable. Do not assume protection is working." },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Codespaces' private port provides authentication. This is NOT safe to expose
  // publicly. Require same-origin browser mutations in addition to that boundary.
  const origin = request.headers.get("origin");
  const host = (
    request.headers.get("x-forwarded-host") || request.headers.get("host") || ""
  ).split(",")[0].trim();
  try {
    if (
      !origin ||
      new URL(origin).host !== host ||
      request.headers.get("sec-fetch-site") === "cross-site"
    ) {
      return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "JSON required." }, { status: 415 });
  }
  try {
    const body = await request.text();
    if (body.length > 256) {
      return NextResponse.json({ error: "Request too large." }, { status: 413 });
    }
    const { action } = JSON.parse(body);
    if (!actions.has(action)) {
      return NextResponse.json({ error: "Unknown security action." }, { status: 400 });
    }
    return await run(action);
  } catch {
    return NextResponse.json({ error: "Security action failed." }, { status: 503 });
  }
}
