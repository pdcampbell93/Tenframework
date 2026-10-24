/** Direct dismissal only; quoted stories and assistant speech are not commands. */
export const STOP_KEY = "ten:disengaged";
export const STOP_EVENT = "ten:disengage";
export function isDisengagement(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 200) return false;
  const text = value.normalize("NFKC").toLowerCase().trim().replace(/\p{Cf}/gu, "");
  return /^(?:(?:ten|10|assistant)[,.:! ]+\s*)?(?:please\s+)?(?:fuck|f\*{2,3}k?)\s+off(?:[,!.\s]+(?:please|(?:and\s+)?leave me alone))?[.!?]*$/.test(text);
}
export function createDismissalHandler(stop: () => void) {
  let stopped = false;
  return (value: unknown) => {
    if (stopped || !value || typeof value !== "object") return;
    const event = value as Record<string, unknown>;
    if (event.type !== "user" || event.data_type !== "text" || event.isFinal !== true ||
        typeof event.time !== "number" || !Number.isFinite(event.time) ||
        !["number", "string"].includes(typeof event.userId) || !isDisengagement(event.text)) return;
    stopped = true;
    stop();
  };
}
