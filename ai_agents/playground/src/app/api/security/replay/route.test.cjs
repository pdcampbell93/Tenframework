/* No Next server, provider calls, or credentials. Run with node route.test.cjs.
 * Tests the actual compiled route using synthetic subprocess responses.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { promisify } = require("node:util");
const test = require("node:test");
const calls = [];
const execute = async (file, args, options) => {
  calls.push({ file, args: Array.from(args), options });
  return { stdout: JSON.stringify({ model: "gpt-4o-mini", report: null, note: "synthetic" }) };
};
const execFile = () => {};
execFile[promisify.custom] = execute;
const source = fs.readFileSync(path.join(__dirname, "route.ts"), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const exportsObject = {};
vm.runInNewContext(js, {
  exports: exportsObject,
  require: name => name === "node:child_process" ? { execFile } :
    name === "next/server" ? { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } } : require(name),
  process, console, URL,
});
const limits = { requests: 3, tokens: 4096, output_tokens: 128, seconds: 45, budget_cents: 10 };
function request(body, override = {}) {
  return {
    headers: new Headers({
      origin: "https://synthetic.test", host: "synthetic.test",
      "content-type": "application/json", ...override,
    }),
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  };
}
test("polling never starts a worker", async () => {
  const result = await exportsObject.GET();
  assert.equal(result.status, 200);
  assert.deepEqual(calls.at(-1).args.slice(1), ["status"]);
});
test("approval and limits gate paid starts", async () => {
  for (const approved of [undefined, false, "true", 1]) {
    const count = calls.length;
    assert.equal((await exportsObject.POST(request({ action: "start", approved, limits }))).status, 400);
    assert.equal(calls.length, count);
  }
  for (const bad of [0, 7, 1.5, "3", true]) {
    assert.equal((await exportsObject.POST(request({ action: "start", approved: true, limits: { ...limits, requests: bad } }))).status, 400);
  }
  assert.equal((await exportsObject.POST(request({ action: "start", approved: true, limits: { ...limits, prompt: "arbitrary" } }))).status, 400);
  assert.equal((await exportsObject.POST(request({ action: "start", approved: true, limits }))).status, 200);
  assert.deepEqual(calls.at(-1).args.slice(1), ["start", "--approve-paid", "--limits", JSON.stringify(limits)]);
  assert.deepEqual(Object.keys(calls.at(-1).options.env).sort(), ["HOME", "NODE_ENV", "PATH"]);
});
test("cross-origin and malformed requests never reach Python", async () => {
  const count = calls.length;
  assert.equal((await exportsObject.POST(request({}, { origin: "https://other.test" }))).status, 403);
  assert.equal((await exportsObject.POST(request({}, { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await exportsObject.POST(request({}, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await exportsObject.POST(request("{"))).status, 400);
  assert.equal((await exportsObject.POST(request("x".repeat(1025)))).status, 413);
  assert.equal(calls.length, count);
});
test("cancel requires a run UUID and never uses the paid-start flag", async () => {
  assert.equal((await exportsObject.POST(request({ action: "cancel", id: "--approve-paid" }))).status, 400);
  const id = "12345678-1234-1234-1234-123456789abc";
  assert.equal((await exportsObject.POST(request({ action: "cancel", id }))).status, 200);
  assert.deepEqual(calls.at(-1).args.slice(1), ["cancel", "--run-id", id]);
});
