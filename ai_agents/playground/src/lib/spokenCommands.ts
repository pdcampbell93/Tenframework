/** Small allowlisted grammar. No model decisions, arbitrary URLs, or stored speech. */
export type SpokenCommand =
  | { type: "navigate"; view: "ten" | "simulation" | "chat" | "memory" }
  | { type: "pause" | "resume" | "clear" | "reset" | "disable" }
  | { type: "manifest"; form: "orb" | "crystal" | "portal" }
  | { type: "light" | "shadow"; value: number };

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function controlValue(raw: string): number | null {
  const text = raw.replace(/(?: percent| degrees|%)$/, "").trim();
  if (/^(?:100|[0-9]{1,2})$/.test(text)) return Number(text);
  if (text === "one hundred" || text === "a hundred") return 100;
  if (Object.hasOwn(ONES, text)) return ONES[text];
  if (Object.hasOwn(TENS, text)) return TENS[text];
  const words = text.split(" ");
  if (words.length === 2 && Object.hasOwn(TENS, words[0]) && Object.hasOwn(ONES, words[1]) &&
      ONES[words[1]] > 0 && ONES[words[1]] < 10) return TENS[words[0]] + ONES[words[1]];
  return null;
}

export function parseSpokenCommand(input: unknown): SpokenCommand | null {
  if (typeof input !== "string" || input.length > 160) return null;
  // Keep negative signs: "minus one"/"-1" must not silently become 1.
  const text = input.toLowerCase().trim().replace(/[,.!?]+$/g, "");
  const wake = /^(?:ten|10)[,.:]?\s+(.+)$/.exec(text);
  if (!wake) return null;
  const command = wake[1].replace(/^please\s+/, "").replace(/\s+please$/, "").replace(/\s+/g, " ").trim();
  if (/^(?:pause|pause effects|pause simulation)$/.test(command)) return { type: "pause" };
  if (/^(?:resume|resume effects|resume simulation)$/.test(command)) return { type: "resume" };
  if (/^(?:clear field|clear the field)$/.test(command)) return { type: "clear" };
  if (/^(?:reset field|reset simulation)$/.test(command)) return { type: "reset" };
  if (/^(?:stop commands|disable commands|turn commands off)$/.test(command)) return { type: "disable" };
  const destinations: Record<string, "ten" | "simulation" | "chat" | "memory"> = {
    ten: "ten", "voice assistant": "ten", "voice controls": "ten",
    lightcraft: "simulation", simulation: "simulation", chat: "chat",
    conversation: "chat", memory: "memory", memories: "memory",
  };
  const navigation = /^(?:open|show|go to|back to) (.+)$/.exec(command);
  if (navigation && Object.hasOwn(destinations, navigation[1])) {
    return { type: "navigate", view: destinations[navigation[1]] };
  }
  const manifestation = /^manifest (?:(?:an?|the) )?(orb|crystal|portal)$/.exec(command);
  if (manifestation) return { type: "manifest", form: manifestation[1] as "orb" | "crystal" | "portal" };
  const adjustment = /^(?:set )?(light direction|shadow bend)(?: to)? (.+)$/.exec(command);
  if (adjustment) {
    const value = controlValue(adjustment[2].replace(/-/g, " "));
    // A leading minus is never a hyphenated number word.
    if (value !== null && !/^-|^minus\b|^negative\b/.test(adjustment[2])) {
      return { type: adjustment[1] === "light direction" ? "light" : "shadow", value };
    }
  }
  return null;
}

export function commandLabel(command: SpokenCommand): string {
  switch (command.type) {
    case "navigate": return `Open ${command.view === "simulation" ? "Lightcraft" : command.view}`;
    case "manifest": return `Manifest ${command.form}`;
    case "light": return `Light direction: ${command.value}`;
    case "shadow": return `Shadow bend: ${command.value}`;
    case "pause": return "Pause effects";
    case "resume": return "Resume effects";
    case "clear": return "Clear field (confirmation required)";
    case "reset": return "Reset field (confirmation required)";
    case "disable": return "Disable spoken commands";
  }
}

/** Event guard is independent of React/Agora and testable without a microphone. */
export function createSpokenCommandHandler(onCommand: (command: SpokenCommand) => void) {
  const seen = new Set<string>();
  let accepting = true;
  return (event: unknown) => {
    if (!accepting || !event || typeof event !== "object") return;
    const item = event as Record<string, unknown>;
    if (item.type !== "user" || item.data_type !== "text" || item.isFinal !== true ||
        typeof item.time !== "number" || !Number.isFinite(item.time) ||
        !["number", "string"].includes(typeof item.userId)) return;
    const command = parseSpokenCommand(item.text);
    if (!command) return;
    const key = JSON.stringify([item.userId, item.time, command]);
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 128) seen.delete(seen.values().next().value!);
    if (command.type === "disable") accepting = false;
    onCommand(command);
  };
}

/** Validate UI events too; an event payload cannot introduce extra operations. */
export function isFieldCommand(value: unknown): value is Exclude<SpokenCommand, { type: "navigate" }> {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  if (["pause", "resume", "clear", "reset"].includes(String(command.type))) return true;
  if (command.type === "manifest") return ["orb", "crystal", "portal"].includes(String(command.form));
  return (command.type === "light" || command.type === "shadow") &&
    typeof command.value === "number" && Number.isFinite(command.value) &&
    command.value >= 0 && command.value <= 100;
}
