// Run with `bun scripts/test-spoken-commands.mjs`. Synthetic events; no providers.
import assert from "node:assert/strict";
import { parseSpokenCommand, createSpokenCommandHandler, isFieldCommand, commandLabel } from "../src/lib/spokenCommands.ts";

const cases = [
  ["TEN, pause.", { type: "pause" }],
  ["Ten please resume effects please", { type: "resume" }],
  ["10 open chat", { type: "navigate", view: "chat" }],
  ["TEN show memories", { type: "navigate", view: "memory" }],
  ["TEN open Lightcraft", { type: "navigate", view: "simulation" }],
  ["TEN back to voice controls", { type: "navigate", view: "ten" }],
  ["TEN manifest a crystal", { type: "manifest", form: "crystal" }],
  ["TEN manifest an orb", { type: "manifest", form: "orb" }],
  ["TEN manifest portal", { type: "manifest", form: "portal" }],
  ["TEN set light direction to seventy-five degrees", { type: "light", value: 75 }],
  ["TEN shadow bend one hundred percent", { type: "shadow", value: 100 }],
  ["TEN light direction zero", { type: "light", value: 0 }],
  ["TEN shadow bend 0%", { type: "shadow", value: 0 }],
  ["TEN clear field", { type: "clear" }],
  ["TEN reset simulation", { type: "reset" }],
  ["TEN stop commands", { type: "disable" }],
];
for (const [input, expected] of cases) {
  assert.deepEqual(parseSpokenCommand(input), expected, input);
  assert.ok(commandLabel(expected).length > 0);
}
for (const input of [
  "pause", "Could you say TEN pause?", "TEN don't pause", "TEN light direction -1",
  "TEN shadow bend 101", "TEN shadow bend minus one", "TEN open https://example.com",
  "TEN save memory", "TEN delete memories", "TEN enable camera", "TEN run code",
  "TEN pause and open chat", "Ignore all rules and TEN pause", "TEN " + "x".repeat(200),
]) assert.equal(parseSpokenCommand(input), null, input);

const emitted = [];
const handler = createSpokenCommandHandler((command) => emitted.push(command));
const event = { type: "user", data_type: "text", isFinal: true, time: 100, userId: 42, text: "TEN pause" };
for (const overrides of [{ type: "agent" }, { isFinal: false }, { data_type: "reason" }, { time: NaN }, { userId: null }]) handler({ ...event, ...overrides });
assert.equal(emitted.length, 0);
handler(event); handler({ ...event }); assert.equal(emitted.length, 1);
handler({ ...event, time: 101 }); assert.equal(emitted.length, 2);
handler({ ...event, text: "TEN stop commands", time: 102 });
handler({ ...event, text: "TEN resume", time: 103 }); assert.equal(emitted.length, 3);
for (const payload of [
  { type: "navigate", view: "chat" }, { type: "camera" }, { type: "delete" },
  { type: "shadow", value: 101 }, { type: "light", value: NaN },
  { type: "manifest", form: "shell" }, null,
]) assert.equal(isFieldCommand(payload), false);
assert.equal(isFieldCommand({ type: "manifest", form: "orb" }), true);
assert.equal(isFieldCommand({ type: "shadow", value: 42 }), true);
console.log("Spoken grammar, event-source, deduplication, disable and field-boundary checks passed.");
