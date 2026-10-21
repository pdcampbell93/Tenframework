"use client";

import { useCallback, useEffect, useState } from "react";

type Limits = { requests: number; tokens: number; output_tokens: number; seconds: number; budget_cents: number };
type Report = {
  id: string; channel: string; status: string; reason: string;
  requests_attempted: number; reserved_tokens: number; reserved_microdollars: number;
  limits: Limits;
  cases: { name: string; outcome: string; rule?: string; fixture_violation_released?: boolean }[];
};
type State = { model: string; note: string; report: Report | null };
const fields: { key: keyof Limits; label: string; min: number; max: number }[] = [
  { key: "requests", label: "Paid requests (maximum)", min: 1, max: 6 },
  { key: "tokens", label: "Total reserved tokens", min: 512, max: 8192 },
  { key: "output_tokens", label: "Output tokens per request", min: 32, max: 512 },
  { key: "seconds", label: "Deadline (seconds)", min: 5, max: 120 },
  { key: "budget_cents", label: "Cost reservation cap (US cents)", min: 1, max: 10 },
];

export default function ReplayControls() {
  const [state, setState] = useState<State | null>(null);
  const [limits, setLimits] = useState<Limits>({ requests: 3, tokens: 4096, output_tokens: 128, seconds: 45, budget_cents: 10 });
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/security/replay", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load replay status.");
      setState(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load replay status.");
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [load]);

  const active = state?.report?.status === "running" || state?.report?.status === "cancelling";
  const valid = fields.every(({ key, min, max }) => Number.isInteger(limits[key]) && limits[key] >= min && limits[key] <= max);
  async function act(action: "start" | "cancel") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/security/replay", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "start" ? { action, approved, limits } : { action, id: state?.report?.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Replay action failed.");
      setState(data);
      setApproved(false); // Every new paid run requires fresh approval.
      setNotice(action === "cancel" ? "Cancellation requested. A request already sent may still be billed." : "Isolated synthetic replay started.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replay action failed.");
    } finally {
      setBusy(false);
    }
  }
  const report = state?.report;
  const button = "min-h-12 rounded-lg border border-white/20 px-5 py-3 text-sm font-semibold disabled:opacity-50";
  return <section aria-labelledby="replay-title" className="space-y-4 rounded-2xl border border-white/15 bg-white/5 p-6">
    <h2 id="replay-title" className="text-xl font-semibold">Live AI replay — paid, opt-in</h2>
    <p className="text-sm leading-6 text-slate-300">
      Fixed synthetic attacks only, using {state?.model || "gpt-4o-mini"} on OpenAI. Each case gets a fresh test adapter and temporary state.
      No microphone, speech, personal chats, external targets, or changes to your live pause setting.
      Starting does not send any test prompts to your active conversation.
    </p>
    <p className="text-xs leading-5 text-slate-400">{state?.note || "No requests run automatically. Status checks and offline tests are free of model calls."}</p>
    {error && <p role="alert" className="text-sm text-red-300">{error} <button className="underline" onClick={() => void load()}>Refresh status</button></p>}
    <div role="status" aria-live="polite" className="text-sm text-cyan-200">{notice}</div>
    <fieldset disabled={active || busy} className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-semibold">Hard limits for the next run</legend>
      {fields.map(({ key, label, min, max }) => <label key={key} className="space-y-1 text-sm">
        <span>{label} ({min}–{max})</span>
        <input type="number" min={min} max={max} step={1} value={Number.isNaN(limits[key]) ? "" : limits[key]}
          onChange={event => { setApproved(false); setLimits({ ...limits, [key]: event.target.value === "" ? NaN : Number(event.target.value) }); }}
          className="block w-full rounded-lg border border-white/20 bg-[#10151d] px-3 py-2" />
      </label>)}
    </fieldset>
    <label className="flex items-start gap-3 text-sm leading-6">
      <input type="checkbox" checked={approved} disabled={active || busy} onChange={event => setApproved(event.target.checked)} className="mt-1.5" />
      <span>I approve paid synthetic requests with these limits. The cost reservation uses a conservative $20/million-token rate, not verified billing.
        I have checked provider pricing and understand cancellation cannot undo a charge already incurred.</span>
    </label>
    <div className="flex flex-wrap gap-3">
      <button className={`${button} bg-cyan-900`} disabled={!state || !!error || active || busy || !approved || !valid}
        onClick={() => void act("start")}>Start paid replay</button>
      <button className={button} disabled={!active || busy} onClick={() => void act("cancel")}>Cancel replay</button>
    </div>
    {report && <div className="space-y-3 text-sm">
      <p><strong>{report.status}</strong> · {report.reason || "Processing synthetic cases"} · {report.requests_attempted}/{report.limits.requests} paid requests attempted</p>
      <p className="break-all text-xs text-slate-400">Test channel: {report.channel}</p>
      <p className="text-slate-300">{report.reserved_tokens}/{report.limits.tokens} tokens reserved · ${(report.reserved_microdollars / 1_000_000).toFixed(4)} reserved / ${(report.limits.budget_cents / 100).toFixed(2)} cap. Failed or cancelled requests keep their reservation.</p>
      <p className="text-xs text-slate-400">“Allowed” means the guard released a reply, not that it was safe. A model refusal is still allowed output. Blocked inputs never reach OpenAI. Unknown errors, empty replies, and truncated replies are not passes. No overall security score is claimed.</p>
      <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
        {report.cases.map(item => <li key={item.name} className="space-y-1 px-4 py-3">
          <p className="flex flex-wrap justify-between gap-2"><span>{item.name.replaceAll("_", " ")}</span><strong>{item.outcome.replaceAll("_", " ")}</strong></p>
          {item.rule && <p className="text-xs text-slate-400">Rule: {item.rule}</p>}
          {item.fixture_violation_released && <p className="text-red-300">Unsafe fixture marker released: this test exposed a protection gap.</p>}
        </li>)}
      </ul>
    </div>}
  </section>;
}
