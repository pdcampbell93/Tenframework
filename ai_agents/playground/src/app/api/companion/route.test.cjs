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
let result = { privacy: { storage: "AES-256-GCM" }, memories: [] };
let exitCode = 0;
const fakeSpawn = (command, args, options) => {
  lastSpawn = { command, args, options };
  const child = new EventEmitter();
  child.kill = () => {};
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stdin = new EventEmitter();
  child.stdin.end = () => queueMicrotask(() => {
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
  console.log("Companion route: server-only key forwarding, no-store success/errors and same-origin checks passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
