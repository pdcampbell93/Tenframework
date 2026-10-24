import { type NextRequest, NextResponse } from "next/server";
import { cancelRun, executeApproved, prepare, sandboxStatus } from "@/lib/server/sandbox";
import { isSameOriginRequest } from "@/lib/server/sameOrigin";
import { SANDBOX_LIMITS } from "@/lib/sandboxTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export async function GET() {
  try { return respond(await sandboxStatus()); }
  catch { return respond({ error: "Sandbox safety status unavailable. Execution is disabled." }, 503); }
}
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return respond({ error: "Same-origin request required." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return respond({ error: "JSON required." }, 415);
  try {
    if (!request.body) return respond({ error: "Request required." }, 400);
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 100000) { await reader.cancel(); return respond({ error: "Request too large." }, 413); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "Object required." }, 400);
    if (body.action === "cancel") {
      if (typeof body.id !== "string") return respond({ error: "Run identifier required." }, 400);
      return respond(await cancelRun(body.id));
    }
    if (typeof body.code !== "string" || !body.code.trim() || Buffer.byteLength(body.code) > SANDBOX_LIMITS.codeBytes)
      return respond({ error: "Python code must contain 1–16000 bytes." }, 400);
    if (body.action === "prepare") return respond(await prepare(body.code));
    if (body.action === "run" && typeof body.id === "string" && typeof body.codeHash === "string" && body.acknowledgeCost === true) {
      const abort = () => { void cancelRun(body.id).catch(() => {}); };
      request.signal.addEventListener("abort", abort, { once: true });
      try { return respond(await executeApproved({ id: body.id, code: body.code, codeHash: body.codeHash, acknowledgeCost: true })); }
      finally { request.signal.removeEventListener("abort", abort); }
    }
    return respond({ error: "Review and explicit usage-cost approval are required." }, 400);
  } catch { return respond({ error: "Sandbox request rejected or unavailable. Check safety status, review expiry, and active runs. No automatic retry." }, 409); }
}
