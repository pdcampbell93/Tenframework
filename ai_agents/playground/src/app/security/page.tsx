"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ReplayControls from "./ReplayControls";

type SecurityState = {
  paused: boolean;
  scope: string;
  allowed_tools: string[];
  events: { timestamp: number; stage: string; decision: string; rule: string }[];
  report: null | {
    timestamp: number; kind: string; passed: number; total: number; note: string;
    cases: { name: string; expected: string | boolean; actual: string | boolean; passed: boolean }[];
  };
  limits: string[];
};

export default function SecurityPage() {
  const [state, setState] = useState<SecurityState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/security", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load status.");
      setState(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load status.");
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(action: "pause" | "resume" | "selftest") {
    setBusy(action);
    setNotice("");
    try {
      const response = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Action failed.");
      setState(data);
      setError("");
      setNotice(action === "selftest" ? "Synthetic tests finished." : action === "pause" ? "Response pause is enabled." : "Responses resumed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy("");
    }
  }

  const button = "min-h-12 rounded-lg border border-white/20 px-5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <main className="min-h-screen bg-[#10151d] px-5 py-10 text-slate-100 sm:px-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-3">
          <Link href="/" className="text-sm text-cyan-300 underline underline-offset-4">Back to TEN voice assistant</Link>
          <p className="pt-4 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">TEN / Security</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">Test safely. Stay in control.</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Local guardrails and synthetic attack tests for your voice assistant.
            No external targets, real secrets in tests, or automatic file deletion.
          </p>
        </header>
        {error && <div role="alert" className="rounded-xl border border-red-400/40 bg-red-950/40 p-4 text-red-200">{error} Status may be stale. <button onClick={() => void load()} className="underline">Retry</button></div>}
        <div role="status" aria-live="polite" className="text-sm text-cyan-200">{notice}</div>
        {!state ? <p className="text-slate-300">Loading security controls…</p> : <>
          <section aria-labelledby="control-title" className="space-y-5 rounded-2xl border border-cyan-300/20 bg-[#172330] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="control-title" className="text-xl font-semibold">Response controls</h2>
              <span className={`rounded-full px-3 py-1 text-sm ${error ? "bg-red-950 text-red-200" : state.paused ? "bg-amber-950 text-amber-200" : "bg-cyan-950 text-cyan-200"}`}>
                {error ? "Status unavailable" : state.paused ? "Paused" : "Responses enabled"}
              </span>
            </div>
            <p className="text-sm leading-6 text-slate-300">Pause stops new model responses at security checkpoints. It does not end the call, mute the microphone, or recall audio already queued. Use Disconnect in TEN to end the session.</p>
            <div className="flex flex-wrap gap-3">
              <button disabled={!!busy || !!error} onClick={() => void act(state.paused ? "resume" : "pause")} className={`${button} ${state.paused ? "bg-cyan-700" : "bg-amber-900/60"}`}>
                {busy === "pause" || busy === "resume" ? "Updating…" : state.paused ? "Resume responses" : "Pause responses"}
              </button>
              <button disabled={!!busy || !!error} onClick={() => void act("selftest")} className={button}>{busy === "selftest" ? "Running tests…" : "Run synthetic attack tests"}</button>
            </div>
            <p className="text-xs leading-5 text-slate-400">Protected configuration: {state.scope}. Tool execution: {state.allowed_tools.length ? state.allowed_tools.join(", ") : "denied by default"}. Keep all Codespaces ports private; this page relies on GitHub access control.</p>
          </section>
          <section aria-labelledby="test-title" className="space-y-4">
            <h2 id="test-title" className="text-xl font-semibold">Attack-test results</h2>
            {!state.report ? <p className="text-sm text-slate-400">No tests run yet. Tests use isolated temporary state and never change your live pause setting.</p> : <>
              <p className="text-sm text-slate-300"><strong className="text-cyan-300">{state.report.passed}/{state.report.total} passed</strong> · {new Date(state.report.timestamp * 1000).toLocaleString()}</p>
              <p className="text-sm text-slate-400">{state.report.note}</p>
              <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
                {state.report.cases.map(item => <li key={item.name} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
                  <span>{item.name}</span><span className={item.passed ? "text-cyan-300" : "text-red-300"}>{item.passed ? "Pass" : `Fail: expected ${item.expected}, got ${item.actual}`}</span>
                </li>)}
              </ul>
            </>}
          </section>
          <ReplayControls />
          <section aria-labelledby="audit-title" className="space-y-4">
            <h2 id="audit-title" className="text-xl font-semibold">Recent security decisions</h2>
            <p className="text-sm text-slate-400">Metadata only—no transcripts, prompts, credentials, or tool arguments in this audit. Refreshes every five seconds.</p>
            {!state.events.length ? <p className="text-sm text-slate-400">No decisions recorded yet.</p> : <ul className="max-h-80 divide-y divide-white/10 overflow-y-auto rounded-xl border border-white/10">
              {state.events.map((event, i) => <li key={`${event.timestamp}-${i}`} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-xs leading-5">
                <span className="text-slate-400">{new Date(event.timestamp * 1000).toLocaleTimeString()}</span>
                <span>{event.stage} / {event.decision}</span><span className="text-cyan-200">{event.rule}</span>
              </li>)}
            </ul>}
          </section>
          <section aria-labelledby="limits-title" className="space-y-3 rounded-xl bg-white/5 p-5">
            <h2 id="limits-title" className="font-semibold">Coverage and limitations</h2>
            <p className="text-sm leading-6 text-slate-300">Full model output is checked before release. This adds voice-response latency. This is a first defensive layer, not Straiker, antivirus, or a guarantee against unknown attacks.</p>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-5 text-slate-400">{state.limits.map(limit => <li key={limit}>{limit}</li>)}</ul>
          </section>
        </>}
      </div>
    </main>
  );
}
