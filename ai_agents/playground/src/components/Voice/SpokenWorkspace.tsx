"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSelector } from "@/common";
import { useSpokenCommands } from "@/lib/useSpokenCommands";
import { type SpokenCommand, commandLabel } from "@/lib/spokenCommands";
import "@/app/companion/companion-tweaks.css";
import styles from "./SpokenWorkspace.module.css";

const SimulationPanel = dynamic<{ onReady: () => void }>(async () => {
  const { default: Page } = await import("@/app/simulation/page");
  return function ReadySimulation({ onReady }: { onReady: () => void }) {
    useEffect(onReady, [onReady]);
    return <Page />;
  };
}, { ssr: false });
const CompanionPanel = dynamic(() => import("@/app/companion/page"), { ssr: false });
type View = "ten" | "simulation" | "chat" | "memory";
type Confirmation = "clear" | "reset" | null;

export default function SpokenWorkspace({ children }: { children: React.ReactNode }) {
  const roomConnected = useAppSelector((state) => state.global.roomConnected);
  const agentConnected = useAppSelector((state) => state.global.agentConnected);
  const [view, setView] = useState<View>("ten");
  const [optedIn, setOptedIn] = useState(false);
  const [simulationMounted, setSimulationMounted] = useState(false);
  const [simulationReady, setSimulationReady] = useState(false);
  const [companionMounted, setCompanionMounted] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [lastCommand, setLastCommand] = useState("");
  const [queuedCommands, setQueuedCommands] = useState<SpokenCommand[]>([]);
  const priorView = useRef<View>("ten");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const wasConnected = useRef(false);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const connected = roomConnected && agentConnected;
  const enabled = optedIn && connected;

  const showView = useCallback((next: View) => {
    if (priorView.current === "simulation" && next !== "simulation" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("ten:lightcraft-hidden"));
    }
    priorView.current = next;
    if (next !== "simulation") setQueuedCommands([]);
    setNavigationRequest((current) => current + 1);
    setView(next);
    if (next === "simulation") setSimulationMounted(true);
    if (next === "chat" || next === "memory") setCompanionMounted(true);
  }, []);

  const handleCommand = useCallback((command: SpokenCommand) => {
    setConfirmation(null);
    setLastCommand(commandLabel(command));
    if (command.type === "navigate") {
      showView(command.view);
      return;
    }
    if (command.type === "disable") {
      setOptedIn(false);
      return;
    }
    if (command.type === "clear" || command.type === "reset") {
      setQueuedCommands([]);
      setConfirmation(command.type);
      return;
    }
    setQueuedCommands((current) => current.length < 16 ? [...current, command] : current);
    showView("simulation");
  }, [showView]);

  const listenerState = useSpokenCommands(enabled, handleCommand);

  useEffect(() => {
    if (!enabled || view !== "simulation" || !simulationReady || !queuedCommands.length) return;
    const command = queuedCommands[0];
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent<SpokenCommand>("ten:lightcraft-command", { detail: command }));
      setQueuedCommands((current) => current.slice(1));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, view, simulationReady, queuedCommands]);

  useEffect(() => {
    if (!optedIn) {
      setQueuedCommands([]);
      setConfirmation(null);
    }
  }, [optedIn]);

  const markSimulationReady = useCallback(() => setSimulationReady(true), []);

  useEffect(() => {
    if (simulationReady && view !== "simulation") window.dispatchEvent(new Event("ten:lightcraft-hidden"));
  }, [simulationReady, view]);

  useEffect(() => {
    const hide = () => {
      if (document.visibilityState !== "visible") {
        setOptedIn(false);
        setConfirmation(null);
        setQueuedCommands([]);
        window.dispatchEvent(new Event("ten:lightcraft-hidden"));
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  useEffect(() => {
    if (wasConnected.current && !connected) {
      setOptedIn(false);
      setQueuedCommands([]);
      setConfirmation(null);
    }
    wasConnected.current = connected;
  }, [connected]);

  useEffect(() => {
    if (!confirmation || !dialogRef.current) return;
    const previous = document.activeElement;
    dialogRef.current.showModal();
    dialogRef.current.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [confirmation]);

  useEffect(() => () => {
    window.dispatchEvent(new Event("ten:lightcraft-hidden"));
  }, []);

  useEffect(() => {
    if ((view !== "memory" && view !== "chat") || !companionMounted) return;
    const root = document.getElementById("embedded-companion");
    if (!root) return;
    const move = () => {
      const target = view === "memory" ? root.querySelector("#memory-draft")?.closest("section") :
        root.querySelector("[aria-label='Conversation']");
      if (!target) return false;
      target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      return true;
    };
    if (move()) return;
    const observer = new MutationObserver(() => { if (move()) observer.disconnect(); });
    observer.observe(root, { childList: true, subtree: true });
    const timer = window.setTimeout(() => observer.disconnect(), 30_000);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [view, companionMounted, navigationRequest]);

  const confirmAction = () => {
    if (!confirmation) return;
    const command: SpokenCommand = { type: confirmation };
    setLastCommand(commandLabel(command));
    setQueuedCommands((current) => [...current, command]);
    setConfirmation(null);
    showView("simulation");
  };

  const statusText = !optedIn ? "Off" : !connected ? "Armed · waiting for TEN" :
    listenerState === "ready" ? "Listening for TEN text" :
    listenerState === "error" ? "Listener unavailable · disable and re-arm" : "Connecting command listener";
  const statusClass = !optedIn ? "" : connected && listenerState === "ready" ? styles.dotLive : styles.dotArmed;
  const navItems: { view: View; label: string }[] = [
    { view: "ten", label: "TEN" },
    { view: "simulation", label: "Lightcraft" },
    { view: "chat", label: "Chat" },
    { view: "memory", label: "Memory" },
  ];

  return (
    <div className={styles.workspace}>
      <header className={styles.bar}>
        <div className={styles.brand} aria-label="TEN spoken workspace">
          <span className={styles.mark} aria-hidden="true">T</span>
          <span className={styles.brandText}>TEN WORKSPACE<small>Same tab · one voice session</small></span>
        </div>
        <nav className={styles.nav} aria-label="Workspace panels">
          {navItems.map(({ view: target, label }) => (
            <button key={target} type="button" aria-current={view === target ? "page" : undefined} onClick={() => showView(target)}>{label}</button>
          ))}
        </nav>
        <div className={styles.tools}>
          <span className={styles.state} role="status" aria-live="polite"><i className={`${styles.dot} ${statusClass}`} />{statusText}</span>
          <button className={styles.commandToggle} type="button" aria-pressed={optedIn} onClick={() => setOptedIn((value) => !value)}>{optedIn ? "Disable commands" : "Arm commands"}</button>
          <button className={styles.backButton} type="button" onClick={() => showView("ten")}>Back to TEN</button>
        </div>
      </header>
      <aside className={styles.notice} aria-label="Spoken command information">
        <div><strong>Commands are opt-in.</strong> Turning command mode off does not mute TEN. Your original microphone and disconnect controls stay on the TEN panel.</div>
        {lastCommand && <div role="status">Last command: <strong>{lastCommand}</strong></div>}
        <details className={styles.help}><summary>Command examples and microphone details</summary>
          <div className={styles.examples}><span>Try one command per utterance:</span> “TEN, open Lightcraft” · “TEN, open chat” · “TEN, open memory” · “TEN, pause” · “TEN, resume” · “TEN, manifest an orb” · “TEN, manifest a crystal” · “TEN, manifest a portal” · “TEN, set light direction to 40” · “TEN, set shadow bend to 40” · “TEN, clear field” · “TEN, reset field” · “TEN, disable commands”</div>
          <div className={styles.examples}>Commands use finalized TEN RTC text only—no new browser speech engine or microphone session. Normal speech may still reach TEN’s ASR/model and be answered; provider usage may incur your usual account charges. Nearby voices may trigger commands. Switching browser tabs or disconnecting disables commands; arm them again to continue. Separate pages remain manual.</div>
        </details>
      </aside>
      <main className={styles.main}>
        <div className={`${styles.panel} ${styles.tenPanel}`} hidden={view !== "ten"}>{children}</div>
        {simulationMounted && <section className={styles.panel} hidden={view !== "simulation"} aria-label="Lightcraft panel"><SimulationPanel onReady={markSimulationReady} /></section>}
        {companionMounted && <section id="embedded-companion" className={styles.panel} hidden={view !== "chat" && view !== "memory"} aria-label="TEN companion panel"><CompanionPanel /></section>}
      </main>
      {confirmation && <dialog ref={dialogRef} className={styles.confirm} aria-labelledby="confirm-title" aria-describedby="confirm-copy" onCancel={() => setConfirmation(null)}>
          <h2 id="confirm-title">{confirmation === "clear" ? "Clear Lightcraft forms?" : "Reset Lightcraft?"}</h2>
          <p id="confirm-copy">This changes fictional field objects and controls only. Approved memory and chat are not removed or changed.</p>
          <div className={styles.confirmActions}>
            <button className={styles.cancelButton} type="button" onClick={() => setConfirmation(null)}>Cancel</button>
            <button className={styles.confirmButton} type="button" onClick={confirmAction}>Continue</button>
          </div>
      </dialog>}
    </div>
  );
}
