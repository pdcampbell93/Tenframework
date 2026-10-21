"use client";

import { useEffect, useRef, useState } from "react";
import { createSpokenCommandHandler, type SpokenCommand } from "./spokenCommands";

/** Reuses the existing TEN RTC transcription; never acquires another mic. */
export function useSpokenCommands(enabled: boolean, onCommand: (command: SpokenCommand) => void) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const callback = useRef(onCommand);
  callback.current = onCommand;
  useEffect(() => {
    if (!enabled) return;
    setState("loading");
    let alive = true;
    let unsubscribe = () => {};
    const listener = createSpokenCommandHandler((command) => {
      if (alive && document.visibilityState === "visible") callback.current(command);
    });
    // Agora is browser-only. Do not import its SDK during Next.js SSR.
    void import("@/manager").then(({ rtcManager }) => {
      if (!alive) return;
      rtcManager.on("textChanged", listener);
      unsubscribe = () => { rtcManager.off("textChanged", listener); };
      setState("ready");
    }).catch(() => { if (alive) setState("error"); });
    return () => { alive = false; unsubscribe(); };
  }, [enabled]);
  return enabled ? state : "off";
}
