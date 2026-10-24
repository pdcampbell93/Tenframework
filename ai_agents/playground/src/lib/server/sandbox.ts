import { spawn } from "node:child_process";
import path from "node:path";
import { Sandbox } from "e2b";
import { SANDBOX_LIMITS, type SandboxResult, type SandboxStatus, type SandboxReview } from "../sandboxTypes";

const script = path.resolve(process.cwd(), "../agents/ten_packages/extension/openai_llm2_python/sandbox_state.py");
export function state<T = Record<string, unknown>>(body: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [script], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "", settled = false;
    const fail = () => {
      if (settled) return;
      settled = true; clearTimeout(timer); child.kill();
      reject(new Error("Sandbox controls unavailable or request rejected. Check safety status and review again."));
    };
    const timer = setTimeout(fail, 10000);
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stdout.on("data", chunk => { output += chunk; if (output.length > 128000) fail(); });
    child.on("close", code => {
      if (settled) return;
      if (code !== 0) return fail();
      try { const result = JSON.parse(output); settled = true; clearTimeout(timer); resolve(result); }
      catch { fail(); }
    });
    child.stdin.end(JSON.stringify(body));
  });
}

export function containsCredential(text: string) {
  return ["E2B_API_KEY", "OPENAI_API_KEY", "DEEPGRAM_API_KEY", "ELEVENLABS_TTS_KEY", "AGORA_APP_CERTIFICATE"]
    .some(key => { const value = process.env[key]; return value && value.length >= 12 && text.includes(value); })
    || /\be2b_[A-Za-z0-9_-]{20,}\b/.test(text);
}

export async function sandboxStatus(): Promise<SandboxStatus> {
  const status = await state<Pick<SandboxStatus, "paused" | "disengaged" | "active">>({ action: "status" });
  const configured = Boolean(process.env.E2B_API_KEY);
  return { ...status, configured, available: configured && !status.paused && !status.disengaged && !status.active, limits: SANDBOX_LIMITS };
}

export async function prepare(code: string) {
  if (!process.env.E2B_API_KEY || containsCredential(code)) throw new Error("Configure E2B and remove credentials from code before review.");
  return state<SandboxReview>({ action: "prepare", code });
}

export async function cancelRun(id: string) {
  const result = await state<{ id: string; state: string }>({ action: "cancel", id });
  const check = await state<{ sandbox: string | null }>({ action: "check", id });
  if (check.sandbox) {
    try {
      await Sandbox.kill(check.sandbox, { requestTimeoutMs: 5000 });
      await state({ action: "finish", id, state: "cancelled" });
      return { id, state: "cancelled" };
    } catch { /* Do not claim termination. Worker retries; VM also has provider expiry. */ }
  }
  return result;
}

export async function cancelActiveRun() {
  const status = await state<Pick<SandboxStatus, "active">>({ action: "status" });
  if (status.active) await cancelRun(status.active.id);
}

async function boundedFile(box: Sandbox, name: string): Promise<{ text: string; truncated: boolean }> {
  const stream = await box.files.read(`/home/user/ten.${name}`, { format: "stream", requestTimeoutMs: 5000 });
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0, truncated = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const remain = 24000 - bytes;
      if (value.length > remain) { chunks.push(value.subarray(0, remain)); truncated = true; break; }
      chunks.push(value); bytes += value.length;
      if (bytes >= 24000) { truncated = true; break; }
    }
  } finally { await reader.cancel().catch(() => {}); }
  const raw = Buffer.concat(chunks).toString("utf8");
  return { text: raw.slice(0, SANDBOX_LIMITS.outputChars), truncated: truncated || raw.length > SANDBOX_LIMITS.outputChars };
}

/** No local eval/subprocess of submitted code. Only fixed remote commands run. */
export async function executeApproved(body: { id: string; code: string; codeHash: string; acknowledgeCost: boolean }): Promise<SandboxResult> {
  if (!process.env.E2B_API_KEY || containsCredential(body.code)) throw new Error("Sandbox is not configured or code contains credentials.");
  await state({ ...body, action: "acquire" });
  let box: Sandbox | undefined, stop = false, pendingCheck: Promise<void> | null = null, creationAttempted = false, created = false;
  const result: SandboxResult = { id: body.id, state: "failed", stdout: "", stderr: "", exitCode: null, truncated: false, cleanupConfirmed: false, message: "" };
  const check = (): Promise<void> => {
    if (pendingCheck) return pendingCheck;
    pendingCheck = (async () => {
      try {
        const control = await state<{ stop: boolean }>({ action: "check", id: body.id });
        if (control.stop) stop = true;
      } catch { stop = true; }
      if (stop && box) await box.kill({ requestTimeoutMs: 5000 }).catch(() => {});
    })().finally(() => { pendingCheck = null; });
    return pendingCheck;
  };
  const timer = setInterval(() => void check(), 750);
  try {
    await check();
    if (stop) throw new Error("cancelled");
    creationAttempted = true;
    box = await Sandbox.create({
      timeoutMs: SANDBOX_LIMITS.lifetimeSeconds * 1000,
      requestTimeoutMs: 15000, secure: true, allowInternetAccess: false,
      envs: {}, metadata: { application: "ten-reviewed-python", run: body.id },
    });
    created = true;
    await state({ action: "attach", id: body.id, sandbox: box.sandboxId });
    await check();
    if (stop) throw new Error("cancelled");
    await box.files.write("/home/user/approved.py", body.code, { requestTimeoutMs: 5000 });
    await check();
    if (stop) throw new Error("cancelled");
    const execution = await box.commands.run(
      "ulimit -c 0; ulimit -f 32; ulimit -t 25; exec timeout -s KILL 30s env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/user python3 -I /home/user/approved.py > /home/user/ten.stdout 2> /home/user/ten.stderr",
      { user: "user", timeoutMs: 35000, requestTimeoutMs: 40000,
        onStdout: () => { stop = true; void box?.kill({ requestTimeoutMs: 5000 }).catch(() => {}); throw new Error("Unexpected output channel"); },
        onStderr: () => { stop = true; void box?.kill({ requestTimeoutMs: 5000 }).catch(() => {}); throw new Error("Unexpected output channel"); } }
    ).catch(error => {
      // CommandExitError includes a bounded numeric status; never expose raw provider errors.
      const code = typeof error?.exitCode === "number" ? error.exitCode : null;
      if (code === null) throw new Error("execution");
      return { exitCode: code };
    });
    result.exitCode = execution.exitCode;
    await check();
    if (stop) throw new Error("cancelled");
    const out = await boundedFile(box, "stdout"), err = await boundedFile(box, "stderr");
    result.stdout = out.text; result.stderr = err.text.slice(0, Math.max(0, SANDBOX_LIMITS.outputChars - out.text.length));
    result.truncated = out.truncated || err.truncated || out.text.length + err.text.length > SANDBOX_LIMITS.outputChars;
    const output = result.stdout + "\n" + result.stderr;
    const screened = await state<{ allowed: boolean }>({ action: "screen", text: output });
    if (!screened.allowed || containsCredential(output)) {
      result.stdout = ""; result.stderr = ""; result.message = "Output withheld by TEN's safety checks.";
    }
    await check();
    if (stop) throw new Error("cancelled");
    result.state = execution.exitCode === 0 ? "completed" : "failed";
    if (!result.message) result.message = execution.exitCode === 0 ? "Python run completed." : "Python exited with an error or reached a resource limit.";
  } catch {
    result.stdout = ""; result.stderr = "";
    result.state = stop ? "cancelled" : "failed";
    result.message = stop ? "Stop requested. Confirming sandbox termination." : "Execution unavailable or interrupted. Check E2B access, credits, and limits. No automatic retry.";
  } finally {
    clearInterval(timer);
    if (box) {
      try { await box.kill({ requestTimeoutMs: 5000 }); result.cleanupConfirmed = true; }
      catch { /* Keep lease until expiry if termination cannot be confirmed. */ }
    } else if (!creationAttempted) result.cleanupConfirmed = true;
    // A create timeout can leave an unknown sandbox; keep the lease until its hard expiry.
    if (!result.cleanupConfirmed) {
      result.state = "cleanup_pending";
      result.message += created ? " Termination is unconfirmed; new runs stay blocked until cleanup or expiry." : " Creation may have reached E2B; new runs stay blocked until expiry.";
    }
    await state({ action: "finish", id: body.id, state: result.state });
  }
  return result;
}
