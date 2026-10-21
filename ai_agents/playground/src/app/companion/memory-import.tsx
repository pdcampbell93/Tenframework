"use client";

import { useRef, useState } from "react";
import styles from "./companion.module.css";

type Memory = { id: number; text: string; created: number; updated: number };
type Note = { index: number; text: string; status: "new" | "duplicate_existing" | "duplicate_file" };
type Preview = {
  notes: Note[];
  limits: { file_bytes: number; notes: number; characters: number; batch: number; remaining: number };
};
type Result = { index: number; status: "saved" | "duplicate" | "failed" | "not_attempted" | "limit"; message: string };
type Props = {
  request: <T>(body?: object) => Promise<T>;
  onMemories: (memories: Memory[]) => void;
};

export default function MemoryImport({ request, onMemories }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<{ source: number; result: Result }[]>([]);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  function discard() {
    generation.current++;
    setPreview(null); setSelected([]); setConsent(false); setReport([]); setError("");
    if (input.current) input.current.value = "";
  }

  async function chooseFile(file?: File) {
    discard();
    if (!file) return;
    const current = generation.current;
    if (!file.name.toLowerCase().endsWith(".json") || file.size > 2 * 1024 * 1024) {
      setError("Choose a .json approved-note export no larger than 2 MiB.");
      return;
    }
    setBusy(true);
    try {
      // No execution, transcript extraction, localStorage or automatic saving.
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const result = await request<Preview>({ action: "import_preview", file: raw });
      if (generation.current === current) setPreview(result);
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : "Could not validate this backup.");
    } finally { setBusy(false); }
  }

  async function saveSelection() {
    if (!preview || !consent || !selected.length || busy) return;
    const sources = [...selected];
    setBusy(true); setError(""); setReport([]);
    try {
      const response = await request<{ results: Result[]; memories: Memory[] }>({
        action: "import_save", approved: true, provider_consent: true,
        texts: sources.map((index) => preview.notes[index].text),
      });
      onMemories(response.memories);
      setReport(response.results.map((result) => ({ source: sources[result.index], result })));
      const completed = new Set(response.results
        .filter((result) => result.status === "saved" || result.status === "duplicate")
        .map((result) => sources[result.index]));
      setPreview({
        ...preview,
        notes: preview.notes.map((note) => completed.has(note.index) ? { ...note, status: "duplicate_existing" } : note),
        limits: { ...preview.limits, remaining: Math.max(0, 500 - response.memories.length) },
      });
      setSelected(sources.filter((source) => !completed.has(source)));
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Connection interrupted."} Some notes may already be saved. Review and retry the same selection; existing matching notes are skipped without replacement.`);
    } finally { setConsent(false); setBusy(false); }
  }

  return <section aria-label="Restore approved memories" className={styles.importPanel}>
    <h3>Import approved-note JSON</h3>
    <p className={styles.smallCopy}>Choose a TEN approved-note export, review the validated notes, then select what to restore. Nothing is saved by uploading. Conversation transcripts, summary drafts, credentials, vectors and encrypted database backups are not accepted.</p>
    <p className={styles.smallCopy}>Limits: 2 MiB per file, 500 notes, 2,000 characters per note; up to 10 selected notes per confirmation and 500 stored notes total. Imported IDs and dates are not reused. Existing notes are never replaced.</p>
    <label htmlFor="memory-import-file">Approved-note export (.json)</label>
    <input ref={input} id="memory-import-file" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} />
    {busy && <p role="status">Processing… Keep this page open. Completed saves persist even if the connection is interrupted.</p>}
    {error && <p className={styles.inlineError} role="alert">{error}</p>}
    {preview && <>
      <p role="status">{preview.notes.length} validated notes · {preview.notes.filter((note) => note.status !== "new").length} duplicates · {preview.limits.remaining} available slots · {selected.length}/{preview.limits.batch} selected</p>
      <p className={styles.smallCopy}>Duplicates use case-insensitive, Unicode-normalized text with repeated whitespace ignored. Similar wording is not merged. No notes are selected automatically.</p>
      {!preview.notes.length && <p>This export contains no notes.</p>}
      <ul className={styles.importList}>{preview.notes.map((note) => <li key={note.index}>
        <label>
          <input type="checkbox" aria-label={`Select note ${note.index + 1}`}
            checked={selected.includes(note.index)}
            disabled={busy || note.status !== "new" || (!selected.includes(note.index) && selected.length >= Math.min(preview.limits.batch, preview.limits.remaining))}
            onChange={(event) => {
              setConsent(false);
              setSelected((current) => event.target.checked ? [...current, note.index] : current.filter((index) => index !== note.index));
            }} />
          Note {note.index + 1} — {note.status === "new" ? "Ready for review" : note.status === "duplicate_file" ? "Duplicate in this file; skipped" : "Already saved; skipped"}
        </label>
        <p>{note.text}</p>
      </li>)}</ul>
      <p className={styles.smallCopy}>Only selected approved text is sent to OpenAI for new embeddings (text-embedding-3-small); API charges may apply. Validation uses the private TEN server without provider calls. Successful imports are encrypted in the current store and become available to existing voice retrieval. JSON exports remain plaintext; protect the file. No chat or summary is imported.</p>
      <label className={styles.importConsent}><input type="checkbox" checked={consent} disabled={busy || !selected.length} onChange={(event) => setConsent(event.target.checked)} /> I reviewed these selected notes and approve saving them and sending their text to OpenAI, including possible API charges.</label>
      <div className={styles.actionsRow}>
        <button type="button" className={styles.primaryButton} disabled={busy || !consent || !selected.length} onClick={() => void saveSelection()}>Approve & import {selected.length} selected</button>
        <button type="button" className={styles.quietButton} disabled={busy} onClick={discard}>Discard import</button>
      </div>
    </>}
    {!!report.length && <div role="status">
      <strong>Import result: {report.filter(({ result }) => result.status === "saved").length} saved, {report.filter(({ result }) => result.status === "duplicate").length} skipped, {report.filter(({ result }) => !["saved", "duplicate"].includes(result.status)).length} unresolved.</strong>
      <ul>{report.map(({ source, result }) => <li key={source}>Note {source + 1}: {result.status} — {result.message}</li>)}</ul>
      <p>Successful notes stay saved. Unresolved notes stay selected for review and a new confirmation. Retry skips matching saved text without adding duplicates. A failed or timed-out provider request may still incur charges.</p>
    </div>}
  </section>;
}
