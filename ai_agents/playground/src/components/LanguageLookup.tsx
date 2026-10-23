"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { STOP_EVENT } from "@/lib/sessionSafety";

type Sense = {
  id: number; part_of_speech: string; definition: string; register: string;
  synonyms: string[]; sources: string[]; attribution: string;
  license: string; license_url: string;
};
type Result = {
  status: "ok" | "empty" | "unavailable"; term: string;
  mode: "definition" | "synonyms" | "slang"; senses: Sense[];
  notice: string; limited: boolean; message: string; slang_url: string;
};

/** Separate from chat/notes: nothing leaves this form until explicit submit. */
export default function LanguageLookup() {
  const [term, setTerm] = useState("");
  const [mode, setMode] = useState<Result["mode"]>("definition");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [part, setPart] = useState("");
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const clear = () => {
    generation.current++;
    pending.current?.abort();
    pending.current = null;
    setBusy(false); setResult(null); setError(""); setPart("");
  };
  useEffect(() => {
    const stop = () => { clear(); setTerm(""); setConsent(false); };
    window.addEventListener(STOP_EVENT, stop);
    return () => {
      generation.current++;
      pending.current?.abort();
      window.removeEventListener(STOP_EVENT, stop);
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!consent || !term.trim() || busy) return;
    clear();
    const current = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/companion", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ action: "lookup", term: term.trim(), mode, consent: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Lookup unavailable.");
      if (current === generation.current) setResult(data as Result);
    } catch (cause) {
      if (current === generation.current) setError(
        cause instanceof Error && cause.name !== "AbortError"
          ? cause.message : "Lookup cancelled or timed out. No result was saved.",
      );
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) { setBusy(false); pending.current = null; }
    }
  }

  const parts = [...new Set(result?.senses.map(sense => sense.part_of_speech) || [])];
  return (
    <section aria-label="Language lookup" className="space-y-3 rounded border border-teal-300/30 bg-white p-4 text-slate-800">
      <h2 className="text-xl font-semibold">Word meanings, synonyms &amp; slang</h2>
      <p>Optional English lookup, not a complete dictionary or Urban Dictionary database.
        Only the term below goes to Free Dictionary API when you submit. No chat, notes,
        voice, or OpenAI request is included. The provider receives the term and server IP;
        its retention policy applies. Results are not saved to memory.</p>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">Word or short phrase
          <input className="block w-full rounded border bg-transparent p-2" value={term}
            maxLength={64} required autoComplete="off" placeholder="e.g. cool"
            onChange={event => { clear(); setTerm(event.target.value); setConsent(false); }} />
        </label>
        <label className="block">Look up
          <select className="ml-2 rounded border bg-white p-2" value={mode}
            onChange={event => { clear(); setMode(event.target.value as Result["mode"]); }}>
            <option value="definition">Definitions</option>
            <option value="synonyms">Sense-specific synonyms</option>
            <option value="slang">Slang / usage context</option>
          </select>
        </label>
        <label className="block"><input type="checkbox" checked={consent}
          onChange={event => { clear(); setConsent(event.target.checked); }} /> I approve sending
          this term only. I have not included private text.</label>
        <div className="flex flex-wrap gap-3">
          <button className="rounded border p-2 disabled:opacity-50" disabled={busy || !consent || !term.trim()}>
            {busy ? "Looking up…" : "Look up term"}
          </button>
          <button className="rounded border p-2" type="button"
            onClick={() => { clear(); setTerm(""); setConsent(false); }}>Cancel &amp; clear</button>
        </div>
      </form>
      {busy && <p role="status">Waiting for the dictionary provider…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <div aria-live="polite" className="space-y-3">
        <h3>{result.term} — {result.mode}</h3>
        <p role="status">{result.status === "unavailable" ? "Unavailable: " : result.status === "empty" ? "No results: " : ""}{result.message}</p>
        <p>{result.notice}</p>
        {result.mode === "slang" && <p>These are dictionary senses, not verified slang-only matches.
          Slang can vary by community and date. Only explicit leading source usage annotations
          are shown as register labels; otherwise register is not supplied.
          Consult the original entry for context.</p>}
        {result.limited && <p>Results are limited: up to 24 senses; unsafe or unsupported content
          may be omitted. Long text is shortened with “…”. This is not an exhaustive entry.</p>}
        {!!parts.length && <label className="block">Part of speech
          <select className="ml-2 rounded border bg-white p-2" value={part}
            onChange={event => setPart(event.target.value)}>
            <option value="">All listed senses</option>
            {parts.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>}
        {result.senses.filter(sense => !part || part === sense.part_of_speech).map(sense => (
          <article className="space-y-2 border-t border-teal-300/20 py-3" key={sense.id}>
            <h4>Sense {sense.id} · {sense.part_of_speech}</h4>
            <p>{sense.definition}</p>
            <p>Register: {sense.register}</p>
            <p>Synonyms for this sense: {sense.synonyms.length ? sense.synonyms.join(", ") : "None supplied. TEN has not invented alternatives."}</p>
            <p>{sense.attribution} · <a className="underline" href={sense.license_url} target="_blank" rel="noreferrer">{sense.license}</a> · Excerpted / limited, not paraphrased.</p>
            {sense.sources.map(url => <a className="block underline break-all" key={url} href={url}
              target="_blank" rel="noreferrer">Original source: {url}</a>)}
          </article>
        ))}
        {result.mode === "slang" && <p>
          <a className="underline" href={result.slang_url} target="_blank" rel="noreferrer">
            Open Urban Dictionary separately (unreviewed user-submitted content)
          </a>. Not retrieved or verified by TEN. Opening this link sends the term to that site;
          entries may be offensive, sexual or inaccurate, not authoritative definitions.
        </p>}
      </div>}
    </section>
  );
}
