"use client";

import { STOP_EVENT } from "@/lib/sessionSafety";
import { SANDBOX_LIMITS, type SandboxResult, type SandboxReview, type SandboxStatus } from "@/lib/sandboxTypes";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./CodeRunner.module.css";

type CodeRunnerProps = { suggestedCode?: string };
type CancelResponse = { id: string; state: string };
type ActionBody =
  | { action: "prepare"; code: string }
  | { action: "run"; id: string; code: string; codeHash: string; acknowledgeCost: true }
  | { action: "cancel"; id: string };

async function request<T>(body?: ActionBody, keepalive = false): Promise<T> {
  const response = await fetch("/api/sandbox", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
    keepalive,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result && typeof result.error === "string" ? result.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return result as T;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export default function CodeRunner({ suggestedCode }: CodeRunnerProps) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [statusLoading, setStatusLoading] = useState(true);
  const [locallyDisengaged, setLocallyDisengaged] = useState(false);
  const [review, setReview] = useState<SandboxReview | null>(null);
  const [reviewedCode, setReviewedCode] = useState("");
  const [reviewUsed, setReviewUsed] = useState(false);
  const [approved, setApproved] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const mountedRef = useRef(false);
  const activeStatusRef = useRef<SandboxStatus | null>(null);
  const ownedRunIdRef = useRef<string | null>(null);
  const cancellingIdsRef = useRef<Set<string>>(new Set());
  const statusRequestRef = useRef(false);
  const requestStatusRef = useRef<() => Promise<void>>(async () => {});

  const loadStatus = useCallback(async () => {
    if (statusRequestRef.current) return;
    statusRequestRef.current = true;
    try {
      const latest = await request<SandboxStatus>();
      if (!mountedRef.current) return;
      activeStatusRef.current = latest;
      setStatus(latest);
      setStatusError("");
    } catch (error) {
      if (mountedRef.current) setStatusError(error instanceof Error ? error.message : "Could not check the Python console.");
    } finally {
      statusRequestRef.current = false;
      if (mountedRef.current) setStatusLoading(false);
    }
  }, []);

  requestStatusRef.current = loadStatus;

  const sendCancel = useCallback(async (id: string, keepalive = false) => {
    if (!id || cancellingIdsRef.current.has(id)) return;
    cancellingIdsRef.current.add(id);
    if (mountedRef.current && !keepalive) {
      setCancelling(true);
      setActionError("");
      setCancelNote("");
    }
    try {
      const response = await request<CancelResponse>({ action: "cancel", id }, keepalive);
      if (mountedRef.current && !keepalive) {
        setCancelNote(`Stop requested. The service reports “${response.state}”; cleanup is not assumed complete.`);
      }
      await requestStatusRef.current();
    } catch (error) {
      if (mountedRef.current && !keepalive) {
        setActionError(error instanceof Error ? error.message : "The stop request could not be confirmed.");
      }
      cancellingIdsRef.current.delete(id);
    } finally {
      cancellingIdsRef.current.delete(id);
      if (mountedRef.current && !keepalive) setCancelling(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadStatus();
    const poll = window.setInterval(() => { void loadStatus(); }, 5000);
    const onFocus = () => { void loadStatus(); };
    const onPageHide = () => {
      const id = ownedRunIdRef.current;
      const current = activeStatusRef.current?.active;
      if (id && (!current || current.id === id)) {
        void sendCancel(id, true);
      }
    };
    const onDisengage = () => {
      setLocallyDisengaged(true);
      onPageHide();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener(STOP_EVENT, onDisengage);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener(STOP_EVENT, onDisengage);
      onPageHide();
      mountedRef.current = false;
    };
  }, [loadStatus, sendCancel]);

  useEffect(() => {
    if (!running && !status?.active) return;
    const timer = window.setInterval(() => { void loadStatus(); }, 1000);
    return () => window.clearInterval(timer);
  }, [running, status?.active?.id, loadStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeJob = status?.active ?? null;
  // The status endpoint only includes a job while it is active. Treat unknown
  // provider states as active too; only the two cleanup states are non-cancellable.
  const active = !!activeJob;
  const runtimeBlocked = !status || !!statusError || !status.configured || !status.available || status.paused || status.disengaged || locallyDisengaged || active || running;
  const expired = !!review && review.expiresAt <= now;
  const reviewMatches = !!review && !reviewUsed && !expired && code === reviewedCode;
  const canPrepare = !!status?.configured && !statusError && !!status.available && !status.paused && !status.disengaged && !locallyDisengaged && !active && !running && !preparing && !!code.trim();
  const canRun = reviewMatches && approved && !runtimeBlocked && !preparing && !cancelling;
  const reviewRemaining = review ? Math.max(0, Math.ceil((review.expiresAt - now) / 1000)) : 0;

  function updateCode(value: string) {
    setCode(value);
    setReview(null);
    setReviewedCode("");
    setReviewUsed(false);
    setApproved(false);
    setActionError("");
    setResult(null);
    setCancelNote("");
  }

  function useSuggestedCode() {
    if (!suggestedCode) return;
    updateCode(suggestedCode);
  }

  async function prepareCode() {
    if (!canPrepare) return;
    setPreparing(true);
    setActionError("");
    setCancelNote("");
    setReview(null);
    setReviewedCode("");
    setReviewUsed(false);
    setApproved(false);
    try {
      const snapshot = code;
      const prepared = await request<SandboxReview>({ action: "prepare", code: snapshot });
      if (!mountedRef.current) return;
      if (code !== snapshot) {
        setActionError("The editor changed while review was being prepared. Prepare the current code again.");
        return;
      }
      setReview(prepared);
      setReviewedCode(snapshot);
    } catch (error) {
      if (mountedRef.current) setActionError(error instanceof Error ? error.message : "Code review could not be prepared.");
    } finally {
      if (mountedRef.current) setPreparing(false);
    }
  }

  async function runCode() {
    if (!review || !canRun) return;
    const exactCode = reviewedCode;
    const reviewId = review.id;
    ownedRunIdRef.current = reviewId;
    setRunning(true);
    setReviewUsed(true);
    setApproved(false);
    setActionError("");
    setCancelNote("");
    setResult(null);
    try {
      const response = await request<SandboxResult>({
        action: "run",
        id: reviewId,
        code: exactCode,
        codeHash: review.codeHash,
        acknowledgeCost: true,
      });
      if (mountedRef.current) setResult(response);
    } catch (error) {
      if (mountedRef.current) setActionError(error instanceof Error ? error.message : "The run did not return a confirmed result.");
    } finally {
      if (mountedRef.current) setRunning(false);
      void requestStatusRef.current();
    }
  }

  async function stopActiveRun() {
    const id = activeJob?.id || ownedRunIdRef.current;
    if (!id) return;
    await sendCancel(id);
  }

  const stopUnavailable = !activeJob || cancelling || cancellingIdsRef.current.has(activeJob.id);

  let statusMessage = "Checking the console service before any action is enabled.";
  let statusTone: "neutral" | "warning" | "error" = "neutral";
  if (statusError) {
    statusMessage = `Status could not be refreshed. ${statusError}`;
    statusTone = "error";
  } else if (statusLoading && !status) {
    statusMessage = "Checking the Python console status…";
  } else if (status?.disengaged || locallyDisengaged) {
    statusMessage = "TEN is disengaged. The console will not prepare or start a run.";
    statusTone = "warning";
  } else if (status?.paused) {
    statusMessage = "TEN is paused. New runs are unavailable; an active run can still be stopped.";
    statusTone = "warning";
  } else if (status && !status.configured) {
    statusMessage = "The Python execution provider is not configured. No run can be started.";
    statusTone = "warning";
  } else if (activeJob) {
    const otherSession = activeJob.id !== ownedRunIdRef.current;
    statusMessage = `${otherSession ? "An active run" : "Your run"} is ${activeJob.state.replaceAll("_", " ")}. ` +
      (activeJob.state === "cancelling" || activeJob.state === "cleanup_pending"
        ? "Cancellation or cleanup is still in progress; it is not yet stopped."
        : "Only one run can be active at a time.");
    statusTone = "warning";
  } else if (status && !status.available) {
    statusMessage = "The Python console is currently unavailable. Check again shortly.";
    statusTone = "warning";
  } else if (status) {
    statusMessage = "Ready when you are. Nothing runs until you review this exact code and approve each run.";
  }

  return (
    <section className={styles.runner} aria-labelledby="code-runner-title">
      <div className={styles.card}>
        <div className={styles.topline}>
          <span>PRIVATE TOOL · PYTHON</span>
          <span>{activeJob ? `RUN ${activeJob.state.replaceAll("_", " ")}` : "No active run"}</span>
        </div>

        <div className={styles.heading}>
          <div className={styles.eyebrow}>Technical help, with your hand on the switch</div>
          <h2 id="code-runner-title">Python / game logic console</h2>
          <p>Review ordinary Python logic in a fresh, short-lived environment. This is not a desktop, game engine, or rendered game. Output is shown as text only.</p>
        </div>

        <div className={`${styles.status} ${styles[statusTone]}`} role={statusError ? "alert" : "status"} aria-live="polite">
          <strong>Console status</strong>
          {statusMessage}
          {activeJob && active && (
            <div className={styles.buttonRow} style={{ marginTop: 9 }}>
              <button className={styles.stopButton} type="button" onClick={() => void stopActiveRun()} disabled={stopUnavailable}>
                {cancelling ? "Requesting stop…" : activeJob.state === "cleanup_pending" || activeJob.state === "cancelling" ? "Retry stop / cleanup" : "Stop active run"}
              </button>
              {activeJob.expiresAt > 0 && <span className={styles.helper}>Run lock expires by {formatTime(activeJob.expiresAt)}.</span>}
            </div>
          )}
          {statusError && <div className={styles.buttonRow} style={{ marginTop: 8 }}><button type="button" className={styles.quietButton} onClick={() => void loadStatus()}>Check status again</button></div>}
          {cancelNote && <div className={styles.helper} style={{ marginTop: 8 }}>{cancelNote}</div>}
        </div>

        <div className={styles.workspace}>
          <label className={styles.editorLabel} htmlFor="ten-python-code">
            <span>Your editable Python</span>
            <span>{new TextEncoder().encode(code).length.toLocaleString()} / {SANDBOX_LIMITS.codeBytes.toLocaleString()} bytes</span>
          </label>
          <textarea
            id="ten-python-code"
            className={styles.editor}
            value={code}
            onChange={(event) => updateCode(event.target.value)}
            placeholder={"# Paste or write Python here.\n# Nothing executes until you prepare a review and approve a run."}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            disabled={preparing || running || active}
            aria-describedby="ten-python-boundaries"
          />
          <div className={styles.toolbar}>
            <div className={styles.buttonRow}>
              {suggestedCode && <button type="button" className={styles.quietButton} onClick={useSuggestedCode} disabled={preparing || running || active}>Use latest Python snippet</button>}
              <button type="button" className={styles.primaryButton} onClick={() => void prepareCode()} disabled={!canPrepare || new TextEncoder().encode(code).length > SANDBOX_LIMITS.codeBytes}>
                {preparing ? "Preparing review…" : review ? "Prepare review again" : "Prepare for review"}
              </button>
            </div>
            <span className={styles.helper}>Editing clears the review and approval.</span>
          </div>
          <p className={styles.helperError} role="alert">{actionError}</p>

          {review && (
            <div className={styles.review} aria-label="Reviewed exact code">
              <div className={styles.reviewHeader}>
                <div>
                  <strong>{reviewMatches ? "Review ready" : expired ? "Review expired" : reviewUsed ? "Review already used" : "Code changed"}</strong>
                  <span>{reviewMatches ? `Expires in ${reviewRemaining}s · prepare again after expiry` : "This code cannot be run from this review. Prepare the current code again."}</span>
                </div>
                <span className={styles.eyebrow}>Exact snapshot</span>
              </div>
              <div className={styles.hash}>SHA-256 · {review.codeHash}</div>
              <pre className={styles.reviewCode}>{reviewedCode}</pre>
              <div className={styles.approval}>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(event) => setApproved(event.target.checked)}
                    disabled={!reviewMatches || runtimeBlocked || preparing || running}
                  />
                  <span>I reviewed the exact code above and approve running it once. I acknowledge the provider may charge usage for this execution.</span>
                </label>
                <div className={styles.runActions}>
                  <span>One approval per run. A new review is required after this run.</span>
                  <button type="button" className={styles.primaryButton} onClick={() => void runCode()} disabled={!canRun}>
                    {running ? "Run in progress…" : "Run approved code"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {(running || result) && (
          <div className={styles.results} aria-live="polite">
            <div className={styles.resultsHeader}>
              <h3>{running ? "Run in progress" : "Run result"}</h3>
              <span>{running ? "Up to 30 seconds of code · 60-second VM lifetime" : result ? `State: ${result.state.replaceAll("_", " ")}` : ""}</span>
            </div>
            {running && <p className={styles.copy}>Waiting for the execution result. You can request a stop above. Status checks continue while this request is in flight.</p>}
            {running && !activeJob && <button type="button" className={styles.stopButton} onClick={() => void stopActiveRun()} disabled={cancelling}>Stop requested run</button>}
            {result && (
              <>
                {result.message && <p className={styles.copy}>{result.message}</p>}
                {result.exitCode !== null && <p className={styles.helper}>Exit code: {result.exitCode}</p>}
                {result.truncated && <p className={styles.helperError}>Output was truncated by the service. The display limit is {SANDBOX_LIMITS.outputChars.toLocaleString()} characters.</p>}
                <div className={styles.outputSection}>
                  <h4>Standard output</h4>
                  {result.stdout ? <pre className={styles.output}>{result.stdout}</pre> : <div className={styles.emptyOutput}>No standard output.</div>}
                </div>
                <div className={styles.outputSection}>
                  <h4>Errors / standard error</h4>
                  {result.stderr ? <pre className={styles.output}>{result.stderr}</pre> : <div className={styles.emptyOutput}>No error output.</div>}
                </div>
                <p className={`${styles.status} ${result.cleanupConfirmed ? "" : styles.warning}`} style={{ margin: "12px 0 0" }}>
                  <strong>{result.cleanupConfirmed ? "Cleanup confirmed" : "Cleanup not confirmed"}</strong>
                  {result.cleanupConfirmed
                    ? "The service confirmed cleanup for this run."
                    : "The service has not confirmed cleanup. A result is not evidence that the VM was destroyed."}
                </p>
              </>
            )}
          </div>
        )}

        <p id="ten-python-boundaries" className={styles.footnote}>
          Runs use a fresh environment with internet disabled, no host mounts, no chat or memory export, default provider CPU/RAM limits, up to 30 seconds of code, and a 60-second VM lifetime. Installed packages are not promised. Status checks never fetch past output; results remain only in this tab and are never sent back to TEN’s chat model.
        </p>
      </div>
    </section>
  );
}
