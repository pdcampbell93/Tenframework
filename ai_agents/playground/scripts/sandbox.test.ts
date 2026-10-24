/** Run only from a disposable archive: real local metadata, fake E2B, no paid calls. */
// @ts-ignore Bun supplies its test module at runtime; it is not an app dependency.
import { test, expect, mock } from "bun:test";
import { isSameOriginRequest } from "../src/lib/server/sameOrigin";
process.env.E2B_API_KEY = "synthetic-invalid-key";
let creates = 0, kills = 0, shouldFailKill = false, failCreate = false;
let receivedOptions: Record<string, unknown>;
let output = "5\n", waitCommand = 0;
let waitCreate = 0, commands = 0;
const fake = {
  sandboxId: "fake-box",
  files: {
    write: async () => {},
    read: async (name: string) => new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(name.endsWith("stdout") ? output : ""));
      controller.close();
    } }),
  },
  commands: { run: async () => { commands++; if (waitCommand) await new Promise(r => setTimeout(r, waitCommand)); return { exitCode: 0 }; } },
  kill: async () => { kills++; if (shouldFailKill) throw new Error("synthetic cleanup failure"); },
};
mock.module("e2b", () => ({ Sandbox: {
  create: async (options: Record<string, unknown>) => {
    creates++; receivedOptions = options;
    if (waitCreate) await new Promise(r => setTimeout(r, waitCreate));
    if (failCreate) throw new Error("synthetic create timeout");
    return fake;
  },
  kill: async () => { kills++; if (shouldFailKill) throw new Error("synthetic cleanup failure"); return true; },
} }));
const { prepare, executeApproved, cancelRun, state, sandboxStatus } = await import("../src/lib/server/sandbox");
const code = "print(2 + 3)";
async function run() {
  const review = await prepare(code);
  return executeApproved({ ...review, code, acknowledgeCost: true });
}

test("same-origin guard handles normalized forwarded hosts and protocols", () => {
  const proxied = new Request("http://upstream.internal/api/companion", {
    method: "POST",
    headers: {
      origin: "https://ten-preview.example",
      host: "upstream.internal",
      "x-forwarded-host": "upstream.internal, ten-preview.example:443",
      "x-forwarded-proto": "http, https",
      "sec-fetch-site": "cross-site",
    },
  });
  expect(isSameOriginRequest(proxied)).toBe(true);

  const local = new Request("http://localhost:3000/api/companion", {
    method: "POST",
    headers: { origin: "http://localhost:3000", host: "localhost:3000" },
  });
  expect(isSameOriginRequest(local)).toBe(true);
});

test("same-origin guard works when the proxy omits its forwarded protocol", () => {
  const tlsTerminated = new Request("http://upstream.internal/api/companion", {
    method: "POST",
    headers: {
      origin: "https://ten-preview.example",
      host: "upstream.internal",
      "x-forwarded-host": "upstream.internal, ten-preview.example:443",
    },
  });
  expect(isSameOriginRequest(tlsTerminated)).toBe(true);
});

test("same-origin guard rejects missing, malformed, and foreign origins", () => {
  expect(isSameOriginRequest(new Request("https://ten-preview.example/api/companion"))).toBe(false);
  expect(isSameOriginRequest(new Request("https://ten-preview.example/api/companion", {
    method: "POST",
    headers: { origin: "null", host: "ten-preview.example" },
  }))).toBe(false);
  expect(isSameOriginRequest(new Request("https://ten-preview.example/api/companion", {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      host: "ten-preview.example",
      "x-forwarded-host": "ten-preview.example",
      "x-forwarded-proto": "https",
    },
  }))).toBe(false);
});

test("real approval metadata and fake provider: successful run, exact fixed isolation", async () => {
  const result = await run();
  expect(result.state).toBe("completed"); expect(result.stdout).toBe("5\n");
  expect(result.cleanupConfirmed).toBe(true);
  expect(receivedOptions!).toMatchObject({ timeoutMs: 60000, secure: true, allowInternetAccess: false, envs: {} });
  expect(JSON.stringify(receivedOptions!)).not.toContain("synthetic-invalid-key");
  expect((await sandboxStatus()).active).toBeNull();
});
test("changed code and missing acknowledgement never create a provider VM", async () => {
  const before = creates;
  const review = await prepare(code);
  await expect(executeApproved({ ...review, code: "print(6)", acknowledgeCost: true })).rejects.toThrow();
  await expect(executeApproved({ ...review, code, acknowledgeCost: false })).rejects.toThrow();
  expect(creates).toBe(before);
});
test("output is bounded and screened", async () => {
  output = "x".repeat(50000);
  const bounded = await run();
  expect(bounded.stdout.length).toBeLessThanOrEqual(12000); expect(bounded.truncated).toBe(true);
  output = "ghp_" + "x".repeat(30);
  const screened = await run();
  expect(screened.stdout).toBe(""); expect(screened.message).toContain("withheld");
  output = "5\n";
});
test("code containing the control credential is rejected before transfer", async () => {
  const before = creates;
  await expect(prepare("print('synthetic-invalid-key')")).rejects.toThrow();
  expect(creates).toBe(before);
});
test("cancellation while creating prevents the command from running", async () => {
  waitCreate = 700;
  const review = await prepare(code), before = creates, beforeCommands = commands;
  const running = executeApproved({ ...review, code, acknowledgeCost: true });
  while (creates === before) await new Promise(r => setTimeout(r, 20));
  await cancelRun(review.id);
  const result = await running;
  expect(result.state).toBe("cancelled"); expect(commands).toBe(beforeCommands);
  waitCreate = 0;
});
test("cancellation during execution kills and suppresses results", async () => {
  waitCommand = 1500;
  const review = await prepare(code);
  const running = executeApproved({ ...review, code, acknowledgeCost: true });
  await new Promise(r => setTimeout(r, 600));
  await cancelRun(review.id);
  const result = await running;
  expect(result.state).toBe("cancelled"); expect(result.stdout).toBe("");
  expect(kills).toBeGreaterThan(0);
  waitCommand = 0;
});
test("unconfirmed termination blocks new runs until explicit cleanup", async () => {
  shouldFailKill = true;
  const result = await run();
  expect(result.state).toBe("cleanup_pending"); expect(result.cleanupConfirmed).toBe(false);
  expect((await sandboxStatus()).available).toBe(false);
  shouldFailKill = false; await cancelRun(result.id);
  expect((await sandboxStatus()).active).toBeNull();
});
test("ambiguous creation failure is not falsely reported as destroyed", async () => {
  failCreate = true;
  const result = await run();
  expect(result.state).toBe("cleanup_pending"); expect(result.cleanupConfirmed).toBe(false);
  expect((await sandboxStatus()).available).toBe(false);
  // Test-owned lease cleanup only. A real unknown sandbox is left to its hard timeout.
  await state({ action: "finish", id: result.id, state: "cancelled" });
  failCreate = false;
});
test("HTTP boundary rejects cross-origin, absent approval and oversized JSON before any VM", async () => {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../src/app/api/sandbox/route");
  const before = creates;
  const send = (body: string, origin?: string) => POST(new NextRequest("http://localhost/api/sandbox", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json", ...(origin ? { origin } : {}) }, body,
  }));
  expect((await send(JSON.stringify({ action: "prepare", code }))).status).toBe(403);
  expect((await send(JSON.stringify({ action: "prepare", code }), "https://attacker.invalid")).status).toBe(403);
  expect((await send(JSON.stringify({ action: "run", code }), "http://localhost")).status).toBe(400);
  expect((await send("x".repeat(100001), "http://localhost")).status).toBe(413);
  const proxied = new NextRequest("http://upstream.internal/api/sandbox", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "upstream.internal",
      "x-forwarded-host": "upstream.internal, ten-preview.example:443",
      origin: "https://ten-preview.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ action: "prepare", code }),
  });
  const accepted = await POST(proxied);
  expect(accepted.status).toBe(200);
  const review = await accepted.json();
  await cancelRun(review.id);
  expect(creates).toBe(before);
});
