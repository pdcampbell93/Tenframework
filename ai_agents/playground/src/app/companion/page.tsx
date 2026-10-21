"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import styles from "./companion.module.css";
import MemoryImport from "./memory-import";

type Message = { role: "user" | "assistant"; content: string };
type Memory = { id: number; text: string; created: number; updated: number };
type Knowledge = { id: string; title: string; text: string; sources: { title: string; url: string }[] };
type CompanionData = {
  memories: Memory[];
  knowledge: Knowledge[];
  privacy: { approval_required: boolean; embedding_model: string; storage: string; recent_limit: number };
};
type Recall = { id: number; text: string; score: number };
type ChatResponse = { reply: string; recalls: Recall[]; sources: { title: string; url: string }[]; memory_warning?: string };

const SEED: Message[] = [];

async function request<T>(body?: object): Promise<T> {
  const response = await fetch("/api/companion", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
}

export default function CompanionPage() {
  const [data, setData] = useState<CompanionData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [messages, setMessages] = useState<Message[]>(SEED);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [chatSources, setChatSources] = useState<{ title: string; url: string }[]>([]);
  const [memoryWarning, setMemoryWarning] = useState("");
  const [draft, setDraft] = useState("");
  const [draftTouched, setDraftTouched] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [memoryEdit, setMemoryEdit] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Recall[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSummaryAttempted = useRef(false);
  const draftRef = useRef("");
  const draftTouchedRef = useRef(false);

  const load = useCallback(async () => {
    setLoadError("");
    try { setData(await request<CompanionData>()); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Could not load your companion."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  }, [messages, busy]);

  const createSummary = useCallback(async (automatic: boolean) => {
    if (messages.filter((m) => m.role === "user").length < 1 || summaryBusy) return;
    if (draftRef.current.trim() || draftTouchedRef.current) {
      if (!automatic) setSummaryError("A draft is already in progress. Save it or discard it before suggesting another.");
      return;
    }
    setSummaryBusy(true); setSummaryError("");
    try {
      const result = await request<{ draft: string }>({ action: "summary", messages });
      if (!draftRef.current.trim() && !draftTouchedRef.current) {
        setDraft(result.draft);
        draftRef.current = result.draft;
        setDraftTouched(false);
        draftTouchedRef.current = false;
      }
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Summary could not be suggested.");
    } finally { setSummaryBusy(false); }
  }, [messages, summaryBusy, draft, draftTouched]);

  const userTurns = messages.filter((message) => message.role === "user").length;
  useEffect(() => {
    if (userTurns >= 4 && !busy && messages.at(-1)?.role === "assistant" && !autoSummaryAttempted.current) {
      autoSummaryAttempted.current = true;
      if (!draft.trim() && !draftTouched) void createSummary(true);
    }
  }, [userTurns, draft, draftTouched, createSummary, busy, messages]);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = composer.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }].slice(-24);
    setMessages(next); setComposer(""); setBusy(true); setChatError(""); setRecalls([]); setChatSources([]); setMemoryWarning("");
    try {
      const result = await request<ChatResponse>({ action: "chat", messages: next });
      setMessages((current) => [...current, { role: "assistant" as const, content: result.reply }].slice(-24));
      setRecalls(result.recalls || []); setChatSources(result.sources || []); setMemoryWarning(result.memory_warning || "");
    } catch (error) {
      // Keep the user's message visible and in memory for retry; never persist transcripts locally.
      setChatError(error instanceof Error ? error.message : "Message could not be sent.");
    } finally { setBusy(false); }
  }

  async function retryLastMessage() {
    if (busy) return;
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    setBusy(true); setChatError("");
    try {
      const result = await request<ChatResponse>({ action: "chat", messages });
      setMessages((current) => [...current, { role: "assistant" as const, content: result.reply }].slice(-24));
      setRecalls(result.recalls || []); setChatSources(result.sources || []); setMemoryWarning(result.memory_warning || "");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Message could not be sent.");
    } finally { setBusy(false); }
  }

  async function saveMemory() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true); setSaveError("");
    try {
      const result = await request<{ memory: Memory; memories: Memory[] }>({ action: "save", text, approved: true });
      setData((current) => current ? { ...current, memories: result.memories } : current);
      setDraft(""); draftRef.current = ""; setDraftTouched(false); draftTouchedRef.current = false;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Memory was not saved."); }
    finally { setSaving(false); }
  }

  async function updateMemory(id: number) {
    if (!memoryEdit.trim()) return;
    setSaving(true); setSaveError("");
    try {
      const result = await request<{ memory: Memory; memories: Memory[] }>({ action: "save", id, text: memoryEdit.trim(), approved: true });
      setData((current) => current ? { ...current, memories: result.memories } : current);
      setEditingId(null); setMemoryEdit("");
      setSearchResults(null);
      setRecalls((current) => current.map((item) => item.id === id ? { ...item, text: result.memory.text } : item));
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Memory was not updated."); }
    finally { setSaving(false); }
  }

  async function deleteMemory(id: number) {
    if (!window.confirm("Delete this approved memory? This cannot be undone.")) return;
    setSaveError("");
    try {
      const result = await request<{ memories: Memory[] }>({ action: "delete", id });
      setData((current) => current ? { ...current, memories: result.memories } : current);
      setSearchResults((current) => current?.filter((item) => item.id !== id) ?? null);
      setRecalls((current) => current.filter((item) => item.id !== id));
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Memory was not deleted."); }
  }

  async function searchMemories(event: FormEvent) {
    event.preventDefault();
    if (!search.trim()) return;
    setSearchBusy(true); setSearchError("");
    try {
      const result = await request<{ matches: Recall[] }>({ action: "search", query: search.trim() });
      setSearchResults(result.matches);
    } catch (error) { setSearchError(error instanceof Error ? error.message : "Search failed."); }
    finally { setSearchBusy(false); }
  }

  function exportMemories() {
    const content = JSON.stringify({ exported: new Date().toISOString(), memories: data?.memories || [] }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "ten-approved-memories.json"; link.click();
    URL.revokeObjectURL(url);
  }

  const prompts = composer.trim()
    ? [`${composer.trim().slice(0, 120)} — help me find the next step`, `${composer.trim().slice(0, 120)} — what am I missing?`]
    : !messages.length ? ["Help me untangle a technical problem", "I need a steady perspective", "What should I remember from this?"] : [];
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <a className={styles.brand} href="/companion" aria-label="TEN Companion home"><span className={styles.brandMark}>T</span><span>TEN <i>companion</i></span></a>
          <nav aria-label="Main navigation"><a className={styles.activeLink} href="/companion">Companion</a><a href="/simulation">Lightcraft</a></nav>
          <span className={styles.privateTag}><span /> PRIVATE SESSION</span>
        </header>

        <section className={styles.intro}>
          <div className={styles.eyebrow}>A place to think out loud</div>
          <h1>Here with you.<br /><em>Long-term memory is your choice.</em></h1>
          <p>Supportive or technical, at your pace. This tab keeps recent chat until it reloads. You choose which notes to review and save.</p>
        </section>

        {loadError ? <div className={styles.errorBox} role="alert"><strong>Couldn’t connect to your companion.</strong><span>{loadError}</span><button onClick={() => void load()}>Try again</button></div> : !data ? (
          <section className={styles.loading} aria-label="Loading companion"><div className={styles.skeletonLine} /><div className={styles.skeletonCard} /><div className={styles.skeletonLine} /></section>
        ) : (
          <div className={styles.columns}>
            <section className={styles.chatPanel} aria-label="Conversation">
              <div className={styles.panelTop}><div><span className={styles.liveMark} /> PRIVATE TEXT SESSION</div><span>{messages.length}/24 recent messages</span></div>
              <div className={styles.actionsRow}><button className={styles.quietButton} type="button" disabled={busy || summaryBusy || !messages.length} onClick={() => {
                if (!window.confirm("Clear this tab’s recent conversation? Approved memories and your summary draft will not be deleted.")) return;
                setMessages([]); setChatError(""); setRecalls([]); setChatSources([]); setMemoryWarning("");
                autoSummaryAttempted.current = false;
              }}>Clear recent chat</button></div>
              <div className={styles.conversation} ref={scrollRef} aria-live="polite">
                {!messages.length ? <div className={styles.welcome}><div className={styles.orbit} aria-hidden="true"><span /></div><h2>Start anywhere.</h2><p>A difficult question, a half-formed idea, or simply what is on your mind.</p></div> :
                  messages.map((message, index) => <article className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.assistantMessage}`} key={`${index}-${message.role}`}><span className={styles.messageBy}>{message.role === "user" ? "YOU" : "TEN"}</span><p>{message.content}</p></article>)}
                {busy && <div className={styles.typing} role="status"><span /><span /><span /> Thinking through it…</div>}
              </div>
              {(recalls.length > 0 || chatSources.length > 0 || memoryWarning) && <div className={styles.responseContext}>
                {memoryWarning && <p className={styles.warning}>{memoryWarning}</p>}
                {!!recalls.length && <div><strong>Memory considered</strong>{recalls.map((item) => <p key={item.id}>{item.text}</p>)}</div>}
                {!!chatSources.length && <div className={styles.sourceList}><strong>References</strong>{chatSources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div>}
              </div>}
              {chatError && <div className={styles.inlineError} role="alert">{chatError} <button type="button" onClick={() => void retryLastMessage()}>Retry</button></div>}
              {!!prompts.length && <div className={styles.suggestions} aria-label={composer.trim() ? "Local editable writing completions" : "Suggested prompts"}>{prompts.map((item) => <button key={item} type="button" onClick={() => setComposer(item)}>{item}<span className="localTag">EDIT</span></button>)}</div>}
              {userTurns >= 4 && <div className={styles.summaryNudge}>A conversation summary can be prepared for your review. <button type="button" onClick={() => void createSummary(false)} disabled={summaryBusy}>{summaryBusy ? "Preparing…" : "Suggest summary"}</button></div>}
              <form className={styles.composer} onSubmit={sendMessage}>
                <label className={styles.srOnly} htmlFor="companion-message">Your message</label>
                <textarea id="companion-message" rows={2} value={composer} onChange={(event) => setComposer(event.target.value)} placeholder="Write what you’re thinking…" maxLength={6000} />
                <button type="submit" disabled={busy || !composer.trim()} aria-label="Send message"><span>Send</span><b aria-hidden="true">↗</b></button>
              </form>
              <p className={styles.transientNote}>Recent messages stay only in this page session; they are not saved to local storage.</p>
            </section>

            <aside className={styles.sideColumn}>
              <section className={styles.memoryCard}>
                <div className={styles.sideHeading}><div><span className={styles.eyebrow}>01 / Keep only what helps</span><h2>Memory, by permission</h2></div><span className={styles.count}>{data.memories.length}</span></div>
                <p className={styles.smallCopy}>Suggested summaries are drafts. Nothing is added until you edit if needed, then choose save.</p>
                {summaryError && <p className={styles.inlineError} role="alert">{summaryError}</p>}
                <label className={styles.srOnly} htmlFor="memory-draft">Editable memory draft</label>
                <textarea className={styles.draft} id="memory-draft" value={draft} onChange={(event) => { const value = event.target.value; setDraft(value); draftRef.current = value; setDraftTouched(true); draftTouchedRef.current = true; }} placeholder="A reviewable summary will appear here. You can also write a memory yourself." />
                <div className={styles.actionsRow}><button className={styles.quietButton} type="button" onClick={() => void createSummary(false)} disabled={summaryBusy || messages.length === 0}>{summaryBusy ? "Preparing…" : "Suggest summary"}</button>{(draft || draftTouched) && <button className={styles.quietButton} type="button" onClick={() => { setDraft(""); draftRef.current = ""; setDraftTouched(false); draftTouchedRef.current = false; setSummaryError(""); }}>Discard draft</button>}<button className={styles.primaryButton} type="button" onClick={() => void saveMemory()} disabled={saving || !draft.trim()}>{saving ? "Saving…" : "Approve & save"}</button></div>
                {saveError && <p className={styles.inlineError} role="alert">{saveError}</p>}
                <div className={styles.memoryToolbar}><span>APPROVED MEMORIES</span><button type="button" onClick={exportMemories} disabled={!data.memories.length}>Export JSON</button></div>
                <MemoryImport request={request} onMemories={(memories) => {
                  setData((current) => current ? { ...current, memories } : current);
                  setSearchResults(null);
                }} />
                {!data.memories.length ? <div className={styles.emptyMemory}>No approved memories yet. Your space stays yours until you choose otherwise.</div> :
                  <ul className={styles.memoryList}>{data.memories.map((memory) => <li key={memory.id}>
                    {editingId === memory.id ? <div className={styles.editMemory}><textarea value={memoryEdit} onChange={(event) => setMemoryEdit(event.target.value)} aria-label="Edit approved memory" /><div><button type="button" onClick={() => void updateMemory(memory.id)} disabled={saving || !memoryEdit.trim()}>Save changes</button><button type="button" onClick={() => { setEditingId(null); setMemoryEdit(""); }}>Cancel</button></div></div> :
                      <><p>{memory.text}</p><div className={styles.memoryActions}><time>{new Date(memory.updated * 1000).toLocaleDateString()}</time><button type="button" onClick={() => { setEditingId(memory.id); setMemoryEdit(memory.text); }}>Edit</button><button type="button" onClick={() => void deleteMemory(memory.id)}>Delete</button></div></>}
                  </li>)}</ul>}
                <form className={styles.searchForm} onSubmit={searchMemories}><label htmlFor="memory-search">Search approved memory</label><div><input id="memory-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find something…" /><button type="submit" disabled={searchBusy || !search.trim()}>{searchBusy ? "…" : "Search"}</button></div></form>
                {searchError && <p className={styles.inlineError} role="alert">{searchError}</p>}
                {searchResults && <div className={styles.searchResults} aria-live="polite"><strong>{searchResults.length ? "Closest matches" : "No matching memories"}</strong>{searchResults.map((match) => <p key={match.id}>{match.text}</p>)}</div>}
              </section>
              <section className={styles.knowledgeCard}>
                <div className={styles.eyebrow}>02 / Reference shelf</div><h2>Curated knowledge</h2>
                {!data.knowledge.length ? <p className={styles.emptyMemory}>No references are available right now.</p> : data.knowledge.map((item) => <article className={styles.knowledgeItem} key={item.id}><h3>{item.title}</h3><p>{item.text}</p>{item.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<span aria-hidden="true"> ↗</span></a>)}</article>)}
              </section>
            </aside>
          </div>
        )}

        {data && <section className={styles.privacy} aria-label="Privacy details"><div className={styles.privacyIcon} aria-hidden="true">i</div><div><strong>Your approval controls long-term memory.</strong><p>Chat and summary requests go to OpenAI. Approved memory text is also sent to OpenAI for embeddings ({data.privacy.embedding_model}) and text plus vectors are stored in {data.privacy.storage}. These provider requests can incur API charges. IDs, timestamps, model names, and note counts are not encrypted. Losing the server encryption key makes encrypted notes and backups unreadable; keep a separate secure recovery copy. JSON exports are plaintext: protect them separately. Encryption does not hide notes from the running app, authorized browser, or providers. Approved memory is shared with the voice assistant after its worker reconnects; voice transcripts never appear in this text chat or its summary drafts. You can edit, delete, or export approved memories at any time. Deleting a note does not erase past replies, exports, backups, or provider records; clear recent chat separately if needed.</p></div></section>}
        <footer className={styles.footer}><span>TEN COMPANION · PRIVATE BY CHOICE</span><a href="/simulation">Explore fictional Lightcraft →</a></footer>
      </div>
    </main>
  );
}
