import assert from "node:assert/strict";
import { isDisengagement, createDismissalHandler } from "../src/lib/sessionSafety.ts";

for (const text of ["fuck off", "TEN, fuck off.", "Please fuck off!", "fuck off and leave me alone", "TEN: f*** off!"]) assert.equal(isDisengagement(text), true);
for (const text of ['What does "fuck off" mean?', '"fuck off"', "don't fuck off", "He said fuck off", "fuck off tomorrow", "", null]) assert.equal(isDisengagement(text), false);
let calls = 0;
const handle = createDismissalHandler(() => calls++);
const event = { type: "user", data_type: "text", isFinal: true, userId: 123, time: 1, text: "fuck off" };
for (const patch of [{ type: "agent" }, { isFinal: false }, { data_type: "reason" }, { time: "1" }, { userId: null }]) handle({ ...event, ...patch });
assert.equal(calls, 0);
handle(event);
handle({ ...event, time: 2 });
assert.equal(calls, 1);
console.log("Session-safety synthetic checks passed.");
