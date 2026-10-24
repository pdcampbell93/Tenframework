"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createDismissalHandler, STOP_EVENT, STOP_KEY } from "@/lib/sessionSafety";

/** Global media gate. Security controls remain accessible for manual recovery. */
export default function SessionSafety({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const controls = pathname === "/security";
  const [phase, setPhase] = useState<"checking" | "ready" | "stopped" | "error">("checking");
  const stopping = useRef(false);
  const mediaMounted = useRef(false);
  const stop = useCallback((persist = true) => {
    if (stopping.current) return;
    stopping.current = true;
    try { localStorage.setItem(STOP_KEY, "1"); } catch { /* Server latch remains authoritative. */ }
    setPhase("stopped");
    window.dispatchEvent(new Event("ten:lightcraft-hidden"));
    window.speechSynthesis?.cancel();
    for (const media of document.querySelectorAll<HTMLMediaElement>("audio,video")) {
      media.pause();
      if (media.srcObject instanceof MediaStream) media.srcObject.getTracks().forEach(track => track.stop());
    }
    void import("@/manager").then(({ rtcManager }) => rtcManager.destroy()).catch(() => {});
    if (persist) {
      // This request contains a fixed action only, never the triggering transcript.
      void fetch("/api/security", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disengage" }), keepalive: true,
      }).catch(() => {});
    }
    // A new document kills pending capture/join promises and queued SDK playback.
    // No automatic navigation back from the controls page.
    window.location.replace("/security");
  }, []);

  useEffect(() => {
    if (controls) return;
    let alive = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 8000);
      try {
        const response = await fetch("/api/security", { cache: "no-store", signal: abort.signal });
        const data = await response.json();
        if (!response.ok || typeof data.disengaged !== "boolean") throw new Error("Unavailable");
        if (!alive) return;
        let localStop = false;
        try { localStop = localStorage.getItem(STOP_KEY) === "1"; } catch { /* Server check still required. */ }
        if (data.disengaged || localStop) {
          if (mediaMounted.current) stop(false);
          else setPhase("stopped");
        } else {
          mediaMounted.current = true;
          setPhase("ready");
        }
      } catch {
        if (!alive) return;
        if (mediaMounted.current) window.location.replace("/security");
        else setPhase("error");
      } finally {
        clearTimeout(timeout);
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2500);
    const requested = () => stop();
    const storage = (event: StorageEvent) => { if (event.key === STOP_KEY && event.newValue === "1") stop(false); };
    window.addEventListener(STOP_EVENT, requested);
    window.addEventListener("storage", storage);
    return () => {
      alive = false; clearInterval(timer);
      window.removeEventListener(STOP_EVENT, requested);
      window.removeEventListener("storage", storage);
    };
  }, [controls, stop]);

  useEffect(() => {
    if (controls || phase !== "ready") return;
    let alive = true;
    let remove: (() => void) | undefined;
    void import("@/manager").then(({ rtcManager }) => {
      if (!alive) return;
      const listener = createDismissalHandler(() => stop());
      rtcManager.on("textChanged", listener);
      remove = () => { rtcManager.off("textChanged", listener); };
    }).catch(() => { if (alive) window.location.replace("/security"); });
    return () => { alive = false; remove?.(); };
  }, [controls, phase, stop]);

  if (controls) return <>{children}</>;
  if (phase !== "ready") return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-xl space-y-5 py-16">
        <h1 className="text-2xl font-semibold">{phase === "checking" ? "Checking TEN safety status…" : phase === "stopped" ? "TEN is disengaged" : "Safety status unavailable"}</h1>
        <p role="status">{phase === "checking" ? "Microphone, camera and companion panels have not been started." : phase === "stopped" ? "No automatic return. Use Security controls to explicitly re-enable responses, then return to TEN yourself." : "TEN will not start until its safety status can be checked."}</p>
        <a href="/security" className="inline-block rounded border border-cyan-300 p-3 text-cyan-200">Open Security controls</a>
        {phase === "error" && <button className="ml-3 rounded border p-3" onClick={() => window.location.reload()}>Retry status check</button>}
      </div>
    </main>
  );
  return <>
    <aside className="flex flex-wrap items-center justify-between gap-3 border-b border-teal-300/30 bg-slate-950 px-4 py-3 text-sm text-slate-100" aria-label="Session safety">
      <span>Private companion · dismissal works even with command mode off. Stopping closes unsaved chat/drafts; saved notes stay.</span>
      <button type="button" className="min-h-11 rounded border border-amber-300 px-4 text-amber-100" onClick={() => stop()}>Stop session</button>
    </aside>
    {children}
  </>;
}
