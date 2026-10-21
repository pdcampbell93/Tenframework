"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isFieldCommand } from "@/lib/spokenCommands";
import LightField, { type FieldMode, type FormKind, type Manifestation } from "./LightField";
import CameraGaze from "./CameraGaze";
import styles from "./simulation.module.css";

const INITIAL = { focus: 62, calm: 71, frequency: 43, intensity: 58 };
const MAX_OBJECTS = 20;

export default function SimulationPage() {
  const [focus, setFocus] = useState(INITIAL.focus);
  const [calm, setCalm] = useState(INITIAL.calm);
  const [frequency, setFrequency] = useState(INITIAL.frequency);
  const [intensity, setIntensity] = useState(INITIAL.intensity);
  const [lightAngle, setLightAngle] = useState(34);
  const [shadowBend, setShadowBend] = useState(52);
  const [mode, setMode] = useState<FieldMode>("resonance");
  const [form, setForm] = useState<FormKind>("orb");
  const [paused, setPaused] = useState(false);
  const [spokenFeedback, setSpokenFeedback] = useState("");
  const [systemOpen, setSystemOpen] = useState(false);
  const [objects, setObjects] = useState<Manifestation[]>([]);
  const [unsupported, setUnsupported] = useState(false);

  const manifest = useCallback((x?: number, y?: number, requestedForm?: FormKind) => {
    if (paused || objects.length >= MAX_OBJECTS) return;
    const index = objects.length;
    const fallbackX = .2 + (((index * 37 + 23) % 61) / 100);
    const fallbackY = .22 + (((index * 29 + 18) % 55) / 100);
    setObjects((current) => {
      if (current.length >= MAX_OBJECTS) return current;
      return [...current, {
        id: Date.now() + current.length,
        x: x ?? fallbackX,
        y: y ?? fallbackY,
        form: requestedForm ?? form,
        born: performance.now(),
        seed: (current.length + 1) * 1.71,
      }];
    });
  }, [form, objects.length, paused]);

  const reset = () => {
    setFocus(INITIAL.focus);
    setCalm(INITIAL.calm);
    setFrequency(INITIAL.frequency);
    setIntensity(INITIAL.intensity);
    setLightAngle(34);
    setShadowBend(52);
    setMode("resonance");
    setForm("orb");
    setPaused(false);
    setSystemOpen(false);
    setObjects([]);
  };

  useEffect(() => {
    const receive = (event: Event) => {
      const command: unknown = (event as CustomEvent).detail;
      if (!isFieldCommand(command)) return;
      switch (command.type) {
        case "pause": setPaused(true); setSpokenFeedback("Effects paused."); break;
        case "resume": setPaused(false); setSpokenFeedback("Effects resumed."); break;
        case "manifest":
          if (paused) { setSpokenFeedback("Effects are paused. Say “TEN, resume” before manifesting."); break; }
          if (objects.length >= MAX_OBJECTS) { setSpokenFeedback("The field is full. Clear forms before manifesting more."); break; }
          setForm(command.form);
          manifest(undefined, undefined, command.form);
          setSpokenFeedback(`Placed ${command.form}.`);
          break;
        case "light": setLightAngle(command.value); setSpokenFeedback(`Light direction set to ${command.value}.`); break;
        case "shadow": setShadowBend(command.value); setSpokenFeedback(`Shadow bend set to ${command.value}.`); break;
        case "clear": setObjects([]); setSpokenFeedback("Field forms cleared."); break;
        case "reset": reset(); setSpokenFeedback("Field and controls reset."); break;
      }
    };
    const hide = () => setPaused(true);
    window.addEventListener("ten:lightcraft-command", receive);
    window.addEventListener("ten:lightcraft-hidden", hide);
    return () => {
      window.removeEventListener("ten:lightcraft-command", receive);
      window.removeEventListener("ten:lightcraft-hidden", hide);
    };
  }, [manifest]);

  const profile = useMemo(() => {
    const average = Math.round((focus + calm) / 2);
    if (average >= 72) return "Soft focus";
    if (average >= 48) return "Even drift";
    return "Loose orbit";
  }, [focus, calm]);

  const controls = [
    { label: "Focus", value: focus, setter: setFocus, hint: "Attention" },
    { label: "Calm", value: calm, setter: setCalm, hint: "Stillness" },
    { label: "Frequency", value: frequency, setter: setFrequency, hint: "Wave spacing" },
    { label: "Intensity", value: intensity, setter: setIntensity, hint: "Light energy" },
  ];

  return (
    <main className={styles.page}>
      {spokenFeedback && <p role="status" className={styles.assistNote}>{spokenFeedback}</p>}
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true"><i className={styles.brandDot} /></span>
            <div><div className={styles.brandName}>TEN LIGHTCRAFT</div><div className={styles.brandSub}>A personal light playground</div></div>
          </div>
          <div className={styles.topMeta}>
            <span className={styles.simPill}>Simulated signals / fictional effects</span>
            <span className={styles.sessionPill}>Local session · no sensing</span>
          </div>
        </header>
        <nav className={styles.navigation} aria-label="TEN navigation">
          <a href="/" target="_blank" rel="noopener noreferrer">TEN voice assistant (new tab)</a>
          <a href="/security" target="_blank" rel="noopener noreferrer">Security controls (new tab)</a>
        </nav>

        <section className={styles.headingRow} aria-labelledby="page-title">
          <div>
            <div className={styles.eyebrow}>01 / The field</div>
            <h1 id="page-title" className={styles.title}>Shape a little <span>stillness.</span></h1>
            <p className={styles.subtitle}>Tune a fictional light field, then invite something into it. Every signal here is a control you set—not something the device senses.</p>
          </div>
        </section>

        <div className={styles.layout}>
          <section className={styles.stageCard} aria-label="Interactive light field">
            <div className={styles.stageHeader}>
              <div className={styles.stageLabel}><span className={styles.liveDot} /> {paused ? "Field paused" : "Light field active"}</div>
              <div className={styles.stageActions}>
                <button className={styles.tinyButton} type="button" onClick={() => setPaused((value) => !value)} aria-pressed={paused} data-testid="button-pause">
                  {paused ? "Resume field" : "Pause field"}
                </button>
                <button className={styles.tinyButton} type="button" onClick={() => setObjects([])} disabled={!objects.length} data-testid="button-clear">
                  Clear forms
                </button>
              </div>
            </div>
            <div className={styles.canvasWrap}>
              <LightField
                focus={focus} calm={calm} frequency={frequency} intensity={intensity}
                lightAngle={lightAngle} shadowBend={shadowBend}
                mode={mode} paused={paused} form={form} objects={objects}
                onManifest={manifest} onUnsupported={setUnsupported}
              />
              {unsupported && <div className={styles.fallback} role="status"><div><strong>Canvas is unavailable here.</strong>This browser could not create a 2D drawing context. Controls remain available; try another browser to view the field.</div></div>}
              <span className={styles.canvasStatus}>{mode} mode · {objects.length} / {MAX_OBJECTS} forms</span>
              <span className={styles.canvasHint}>{paused ? "Paused · resume to place a form" : "Tap the field to place a form"}</span>
            </div>
            <div className={styles.telemetry} aria-label="Simulation state">
              <Metric label="Focus control" value={`${focus}%`} note="set by you" />
              <Metric label="Calm control" value={`${calm}%`} note="set by you" />
              <Metric label="Wave controls" value={mode === "resonance" ? "Resonance" : "Interference"} note={`frequency ${frequency}%`} />
              <Metric label="Form count" value={`${objects.length}`} note="of 20 max" />
            </div>
          </section>

          <aside className={styles.controlCard} aria-label="Field controls">
            <div className={styles.controlTitleRow}>
              <h2 className={styles.controlTitle}>Field controls</h2>
              <button type="button" className={styles.resetButton} onClick={reset} data-testid="button-reset">Reset all</button>
            </div>
            <div className={styles.controlsGrid}>
              <div className={styles.sectionLabel}>Wave behavior</div>
              <div className={styles.modeGroup} role="group" aria-label="Field mode">
                <button className={styles.modeButton} type="button" aria-pressed={mode === "resonance"} onClick={() => setMode("resonance")} data-testid="mode-resonance">Resonance</button>
                <button className={styles.modeButton} type="button" aria-pressed={mode === "interference"} onClick={() => setMode("interference")} data-testid="mode-interference">Interference</button>
              </div>
              {controls.map(({ label, value, setter, hint }) => (
                <div className={styles.sliderBlock} key={label}>
                  <div className={styles.sliderHeading}>
                    <label className={styles.sliderLabel} htmlFor={`control-${label.toLowerCase()}`}>{label}</label>
                    <span className={styles.sliderValue}>{value}<span className={styles.srOnly}> percent</span></span>
                  </div>
                  <input
                    className={styles.range}
                    id={`control-${label.toLowerCase()}`}
                    type="range" min="0" max="100" value={value}
                    aria-label={`${label} simulation control`}
                    aria-valuetext={`${value} percent, ${hint}`}
                    onChange={(event) => setter(Number(event.target.value))}
                    data-testid={`slider-${label.toLowerCase()}`}
                  />
                  <div className={styles.sliderEnds}><span>Quiet</span><span>{hint}</span><span>Open</span></div>
                </div>
              ))}
              <div className={styles.sliderBlock}>
                <div className={styles.sliderHeading}><label className={styles.sliderLabel} htmlFor="form-select">Manifestation</label></div>
                <select className={styles.formSelect} id="form-select" value={form} onChange={(event) => setForm(event.target.value as FormKind)} data-testid="select-form">
                  <option value="orb">Orbiting orb</option>
                  <option value="crystal">Light crystal</option>
                  <option value="portal">Wave portal</option>
                </select>
              </div>
              <div className={styles.sectionLabel}>Light &amp; shadow study</div>
              <div className={styles.sliderBlock}>
                <div className={styles.sliderHeading}><label className={styles.sliderLabel} htmlFor="light-angle">Light direction</label><span className={styles.sliderValue}>{lightAngle}°</span></div>
                <input className={styles.range} id="light-angle" type="range" min="0" max="100" value={lightAngle} aria-label="Fictional light direction" aria-valuetext={`${lightAngle} degrees`} onChange={(event) => setLightAngle(Number(event.target.value))} />
                <div className={styles.sliderEnds}><span>Left</span><span>Across the field</span><span>Right</span></div>
              </div>
              <div className={styles.sliderBlock}>
                <div className={styles.sliderHeading}><label className={styles.sliderLabel} htmlFor="shadow-bend">Shadow bend</label><span className={styles.sliderValue}>{shadowBend}</span></div>
                <input className={styles.range} id="shadow-bend" type="range" min="0" max="100" value={shadowBend} aria-label="Fictional shadow bending" aria-valuetext={`${shadowBend} of 100`} onChange={(event) => setShadowBend(Number(event.target.value))} />
                <div className={styles.sliderEnds}><span>Direct</span><span>Shape</span><span>Curved</span></div>
              </div>
              <button className={styles.manifestButton} type="button" onClick={() => manifest()} disabled={paused || objects.length >= MAX_OBJECTS} data-testid="button-manifest">
                <span className={styles.buttonGlyph} aria-hidden="true" />
                {paused ? "Resume to manifest" : objects.length >= MAX_OBJECTS ? "Field is full" : "Manifest a form"}
              </button>
              <p className={styles.assistNote}>Choose a form, then place it with the button or tap anywhere in the field. Light and shadow controls reshape the canvas only.</p>
            </div>
          </aside>
        </div>

        {systemOpen && (
          <section className={styles.systemPanel} aria-label="Fictional system overlay">
            <div><div className={styles.systemTitle}>Virtual field · fictional overlay</div><p className={styles.systemCopy}>A visual model only. No virtual machine, external telemetry, or hardware connection is running.</p></div>
            <div className={styles.systemReadout} aria-live="polite">MODE // {mode.toUpperCase()}<br />FORMS // {objects.length.toString().padStart(2, "0")}<br />PROFILE // {profile.toUpperCase()}</div>
          </section>
        )}

        <section className={styles.hardwareNote} aria-label="Hardware status">
          <strong>Simulated controls only</strong>
          <p>EEG and RF are not connected. External devices would be required for those signals; an iPhone alone cannot provide them. Focus and calm remain manual controls.</p>
        </section>
        <CameraGaze onAutoPause={() => setPaused(true)} />

        <div className={styles.disclaimer} role="note">
          <span className={styles.disclaimerMark} aria-hidden="true">i</span>
          <p><strong>Fiction, by design.</strong> Focus, calm, frequency, and intensity are user-controlled simulation parameters—not sensed brainwaves, health measurements, or radio readings. The optional camera helper estimates face direction locally; it is not awareness, medical, safety, or liveness monitoring, and a photo may fool it. Light effects are visual play, not a claim about manifestation.</p>
        </div>

        <footer className={styles.footer}>
          <span>Independent by nature · runs in this browser</span>
          <button type="button" className={styles.resetButton} onClick={() => setSystemOpen((open) => !open)} aria-expanded={systemOpen} data-testid="button-system">
            {systemOpen ? "Hide system overlay" : "Show system overlay"}
          </button>
        </footer>
        <span className={styles.srOnly} aria-live="polite">{unsupported ? "Canvas unavailable." : paused ? "Animation paused." : "Animation running."} {objects.length} manifestations in the field.</span>
      </div>
    </main>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className={styles.metric} data-testid={`metric-${label.toLowerCase().replaceAll(" ", "-")}`}>
    <div className={styles.metricLabel}>{label}</div>
    <div className={styles.metricValue}>{value} <span>{note}</span></div>
  </div>;
}
