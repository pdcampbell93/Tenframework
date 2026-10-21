// Run with TEN's installed dev dependencies: node src/app/api/companion/route.test.cjs
// Synthetic key, fake subprocess only. Never starts a worker or calls a provider.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "route.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics.length, 0);
const syntheticKey = Buffer.alloc(32, 71).toString("base64");
let lastSpawn;
let lastBody;
let result = { privacy: { storage: "AES-256-GCM" }, memories: [] };
let exitCode = 0;
const fakeSpawn = (command, args, options) => {
  lastSpawn = { command, args, options };
  const child = new EventEmitter();
  child.kill = () => {};
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stdin = new EventEmitter();
  child.stdin.end = (body) => queueMicrotask(() => {
    lastBody = JSON.parse(body);
    child.stdout.emit("data", JSON.stringify(result));
    child.emit("close", exitCode);
  });
  return child;
};
const sandbox = {
  exports: {},
  require: (name) => {
    if (name === "node:child_process") return { spawn: fakeSpawn };
    if (name === "next/server") return { NextResponse: { json: (data, options) => ({ data, options }) } };
    return require(name);
  },
  process: {
    cwd: () => "/synthetic/playground",
    env: { TEN_MEMORY_KEY: syntheticKey, PATH: "/synthetic/bin", UNRELATED_SECRET: "not-forwarded" },
  },
  setTimeout, clearTimeout, Buffer, URL,
};
vm.runInNewContext(compiled.outputText, sandbox);

(async () => {
  const response = await sandbox.exports.GET();
  assert.equal(lastSpawn.command, "python3");
  assert.equal(lastSpawn.options.env.TEN_MEMORY_KEY, syntheticKey);
  assert.equal(lastSpawn.options.env.UNRELATED_SECRET, undefined);
  assert.equal(lastSpawn.options.env.NEXT_PUBLIC_TEN_MEMORY_KEY, undefined);
  assert.equal(response.options.status, 200);
  assert.equal(response.options.headers["Cache-Control"], "no-store");
  assert.ok(!JSON.stringify(response).includes(syntheticKey));
  result = { error: "Memory locked: key mismatch or damaged encrypted data." };
  exitCode = 2;
  const locked = await sandbox.exports.GET();
  assert.equal(locked.options.status, 400);
  assert.ok(!JSON.stringify(locked).includes(syntheticKey));
  assert.equal(locked.options.headers["Cache-Control"], "no-store");
  const rejected = await sandbox.exports.POST({
    headers: new Headers({ origin: "https://other.invalid", host: "private.invalid" }),
  });
  assert.equal(rejected.options.status, 403);
  const post = (body, contentType = "application/json") => sandbox.exports.POST({
    headers: new Headers({ origin: "https://private.invalid", host: "private.invalid", "content-type": contentType }),
    body: new ReadableStream({ start(controller) {
      controller.enqueue(Buffer.from(body));
      controller.close();
    } }),
  });
  exitCode = 0;
  result = { notes: [], limits: { batch: 10 } };
  const file = JSON.stringify({ exported: "2026-10-21T00:00:00Z", memories: [] }) + " ".repeat(70000);
  const preview = await post(JSON.stringify({ action: "import_preview", file }));
  assert.equal(preview.options.status, 200);
  assert.equal(lastBody.file, file);
  assert.equal(preview.options.headers["Cache-Control"], "no-store");
  const selection = { action: "import_save", approved: true, provider_consent: true, texts: ["Synthetic reviewed note"] };
  assert.equal((await post(JSON.stringify(selection))).options.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(lastBody)), selection);
  assert.equal((await post("x".repeat(4 * 1024 * 1024 + 1025))).options.status, 413);
  assert.equal((await post(JSON.stringify({ action: "save", text: "x".repeat(60000) }))).options.status, 413);
  assert.equal((await post("not json")).options.status, 400);
  assert.equal((await post("{}", "text/plain")).options.status, 415);
  console.log("Companion route: server-only key, no-store, same-origin, import forwarding and bounded upload checks passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
