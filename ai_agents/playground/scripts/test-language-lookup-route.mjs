/** Synthetic route checks: fake Python only, no live state or provider calls.
 * Run with the playground's existing TypeScript dev dependency installed.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/api/companion/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const calls = [];
let now = 1000;
let output = { status: "unavailable", senses: [], message: "Source unavailable" };
class Clock extends Date { static now() { return now; } }
function spawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stdin = new EventEmitter();
  child.stdin.end = body => {
    calls.push(JSON.parse(body));
    queueMicrotask(() => {
      child.stdout.emit("data", JSON.stringify(output));
      child.emit("close", 0);
    });
  };
  child.kill = () => {};
  return child;
}
const module = { exports: {} };
vm.runInNewContext(compiled, {
  module, exports: module.exports, process: { env: {}, cwd: () => "/synthetic/playground" },
  setTimeout, clearTimeout, Buffer, URL, Date: Clock,
  require(name) {
    if (name === "node:child_process") return { spawn };
    if (name === "node:path") return path;
    if (name === "next/server") return {
      NextResponse: { json: (data, options) => new Response(JSON.stringify(data), options) },
    };
    throw new Error(`Unexpected module ${name}`);
  },
});
const { POST } = module.exports;
function request(body, origin = "https://private.test") {
  return new Request("https://private.test/api/companion", {
    method: "POST", headers: {
      origin, host: "private.test", "content-type": "application/json",
    }, body: JSON.stringify(body),
  });
}
const body = { action: "lookup", term: "cool", mode: "synonyms", consent: true };
assert.equal((await POST(request(body, "https://other.test"))).status, 403);
assert.equal(calls.length, 0);
let response = await POST(request(body));
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.equal((await response.json()).status, "unavailable");
assert.deepEqual(calls, [body]);
response = await POST(request({ ...body, term: "another" }));
assert.equal(response.status, 503);
assert.equal(response.headers.get("cache-control"), "no-store");
const unavailable = await response.json();
assert.match(unavailable.error, /15 seconds/);
assert.equal(JSON.stringify(unavailable).includes("cool"), false);
assert.equal(calls.length, 1);
now += 15001;
output = { status: "ok", senses: [{ definition: "Synthetic dictionary sense" }] };
response = await POST(request({ ...body, term: "another" }));
assert.equal((await response.json()).status, "ok");
assert.equal(calls.length, 2);
// Success is not cached, including for the same word.
await POST(request({ ...body, term: "another" }));
assert.equal(calls.length, 3);
for (let i = 0; i < 30; i++) await POST(request(body));
assert.equal((await POST(request(body))).status, 429);
console.log("Lexical same-origin, no-store, metadata-only backoff, fresh result and rate-limit checks passed.");
