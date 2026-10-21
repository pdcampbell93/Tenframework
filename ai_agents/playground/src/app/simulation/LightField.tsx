"use client";

import type { MouseEvent } from "react";
import { useEffect, useRef } from "react";
import styles from "./simulation.module.css";

export type FieldMode = "resonance" | "interference";
export type FormKind = "orb" | "crystal" | "portal";
export type Manifestation = { id: number; x: number; y: number; form: FormKind; born: number; seed: number };

type Props = {
  focus: number;
  calm: number;
  frequency: number;
  intensity: number;
  lightAngle: number;
  shadowBend: number;
  mode: FieldMode;
  paused: boolean;
  form: FormKind;
  objects: Manifestation[];
  onManifest: (x: number, y: number) => void;
  onUnsupported: (unsupported: boolean) => void;
};

const TAU = Math.PI * 2;
const colors = ["#a9f3dc", "#7bd9d4", "#ffc0aa", "#f4e4a5"];

export default function LightField(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clock = useRef(0);
  const births = useRef(new Map<number, number>());
  const latest = useRef(props);
  const onManifest = useRef(props.onManifest);
  const unsupportedCallback = useRef(props.onUnsupported);
  latest.current = props;
  onManifest.current = props.onManifest;
  unsupportedCallback.current = props.onUnsupported;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !ctx) {
      unsupportedCallback.current(true);
      return;
    }
    unsupportedCallback.current(false);
    let raf = 0;
    let lastTick: number | null = null;
    let width = 1;
    let height = 1;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = document.visibilityState === "visible";

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const draw = () => {
      const state = latest.current;
      const t = clock.current * .00072;
      const cx = width * .5;
      const cy = height * .49;
      const base = Math.min(width, height);
      const frequency = state.frequency / 100;
      const intensity = state.intensity / 100;
      const calm = state.calm / 100;
      const lightDirection = state.lightAngle / 100;
      const bend = state.shadowBend / 100;
      ctx.fillStyle = "#0b171b";
      ctx.fillRect(0, 0, width, height);

      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * .49);
      halo.addColorStop(0, `rgba(70, 158, 146, ${.1 + intensity * .12})`);
      halo.addColorStop(.45, "rgba(27, 77, 77, .12)");
      halo.addColorStop(1, "rgba(11, 23, 27, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      // Fictional light source and a bendable cast-shadow silhouette, both driven by manual controls.
      const sourceX = width * (.12 + lightDirection * .76);
      const sourceY = height * .12;
      const beam = ctx.createRadialGradient(sourceX, sourceY, 2, sourceX, sourceY, base * .78);
      beam.addColorStop(0, `rgba(255, 222, 174, ${.12 + intensity * .12})`);
      beam.addColorStop(.42, `rgba(255, 201, 155, ${.045 + intensity * .05})`);
      beam.addColorStop(1, "rgba(255, 201, 155, 0)");
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, width, height);
      const shadowTop = height * (.68 + bend * .08);
      const shadow = ctx.createLinearGradient(0, shadowTop, 0, height);
      shadow.addColorStop(0, `rgba(5, 12, 16, ${.24 + bend * .15})`);
      shadow.addColorStop(1, "rgba(5, 12, 16, .02)");
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, shadowTop + bend * 18);
      ctx.bezierCurveTo(width * .22, shadowTop - bend * 44, width * .28, shadowTop + bend * 55, width * .51, shadowTop + Math.sin(lightDirection * TAU) * 19);
      ctx.bezierCurveTo(width * .75, shadowTop - bend * 38, width * .78, shadowTop + bend * 42, width, shadowTop - bend * 9);
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      // Quiet cartographic ticks anchor the field without implying any sensor data.
      ctx.strokeStyle = "rgba(161, 214, 202, .075)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const r = base * (.12 + i * .085);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([2, 8]);
      ctx.strokeStyle = "rgba(161, 214, 202, .11)";
      ctx.beginPath(); ctx.moveTo(cx, 22); ctx.lineTo(cx, height - 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(22, cy); ctx.lineTo(width - 22, cy); ctx.stroke();
      ctx.setLineDash([]);

      const focus = state.focus / 100;
      const rings = 4 + Math.round(frequency * 7) + Math.round(focus * 2);
      for (let i = 0; i < rings; i++) {
        const phase = t * (1 + frequency * 1.8) + i * (TAU / rings);
        const radius = base * (.095 + i * (.035 + calm * .006)) + Math.sin(phase) * (4 + intensity * 10);
        const alpha = (.09 + intensity * .13) * (1 - i / (rings + 2));
        ctx.beginPath();
        if (state.mode === "resonance") {
          ctx.ellipse(cx, cy, radius * (1.05 + focus * .42), radius * (.68 + calm * .22), Math.sin(t * .2) * .08, 0, TAU);
        } else {
          const segments = 72;
          for (let j = 0; j <= segments; j++) {
            const a = (j / segments) * TAU;
            const interference = Math.sin(a * 5 + phase) * (3 + frequency * 8) + Math.sin(a * 9 - phase * .5) * 2;
            const rx = cx + Math.cos(a) * (radius * 1.18 + interference);
            const ry = cy + Math.sin(a) * (radius * .72 + interference);
            if (j === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
          }
          ctx.closePath();
        }
        ctx.strokeStyle = `rgba(139, 226, 208, ${alpha})`;
        ctx.lineWidth = 1 + intensity * .6;
        ctx.stroke();
      }

      // Fine luminous grains drift slowly around the center, driven only by controls.
      const grains = Math.min(86, 28 + Math.round(intensity * 48));
      for (let i = 0; i < grains; i++) {
        const seed = i * 2.399;
        const angle = seed + t * (.08 + frequency * .16) * (i % 2 ? 1 : -1);
        const orbit = base * (.12 + ((i * 37) % 100) / 100 * .3);
        const wobble = Math.sin(t + seed) * (2 + calm * 7);
        const x = cx + Math.cos(angle) * (orbit + wobble);
        const y = cy + Math.sin(angle) * (orbit * .62 + wobble);
        const radius = .7 + ((i * 13) % 10) / 10 * (1 + intensity);
        ctx.globalAlpha = .28 + ((i * 7) % 10) / 18;
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;

      const currentIds = new Set(state.objects.map(object => object.id));
      for (const id of births.current.keys()) {
        if (!currentIds.has(id)) births.current.delete(id);
      }
      for (const object of state.objects) {
        if (!births.current.has(object.id)) births.current.set(object.id, clock.current);
        const age = reducedMotion ? 1 : Math.max(0, (clock.current - births.current.get(object.id)!) / 1000);
        const pulse = 1 + Math.sin(t * 2 + object.seed) * .035;
        drawObject(ctx, object, width, height, base, pulse, age, intensity);
      }
      ctx.fillStyle = "rgba(193, 238, 224, .75)";
      ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, TAU); ctx.fill();
    };

    const loop = (timestamp: number) => {
      if (!visible) return;
      if (lastTick !== null) clock.current += Math.min(50, timestamp - lastTick);
      lastTick = timestamp;
      draw();
      if (!latest.current.paused && !reducedMotion) raf = window.requestAnimationFrame(loop);
    };
    const start = () => {
      window.cancelAnimationFrame(raf);
      lastTick = null;
      draw();
      if (visible && !latest.current.paused && !reducedMotion) raf = window.requestAnimationFrame(loop);
    };
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible) start(); else window.cancelAnimationFrame(raf);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    start();
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [props.paused, props.mode, props.focus, props.calm, props.frequency, props.intensity, props.lightAngle, props.shadowBend, props.objects]);

  const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (latest.current.paused) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onManifest.current(
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    );
  };
  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      aria-label={`Animated fictional light field with light direction ${latest.current.lightAngle} and shadow bend ${latest.current.shadowBend}. Activate to place a manifestation.`}
      role="img"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !latest.current.paused) {
          event.preventDefault();
          onManifest.current(.5, .5);
        }
      }}
    />
  );
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  object: Manifestation,
  width: number,
  height: number,
  base: number,
  pulse: number,
  age: number,
  intensity: number,
) {
  const x = object.x * width;
  const y = object.y * height;
  const materialize = Math.max(.025, Math.min(1, age * 2));
  const size = Math.min(base * .11, 38) * pulse * materialize;
  const fade = Math.max(.25, 1 - age / 18);
  ctx.save();
  ctx.globalAlpha = fade;
  const glow = ctx.createRadialGradient(x, y, 1, x, y, size * 1.9);
  glow.addColorStop(0, `rgba(169, 243, 220, ${.2 + intensity * .14})`);
  glow.addColorStop(1, "rgba(123, 217, 212, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, size * 1.9, 0, TAU); ctx.fill();
  ctx.strokeStyle = object.form === "crystal" ? "#ffc0aa" : "#a9f3dc";
  ctx.fillStyle = "rgba(145, 231, 211, .12)";
  ctx.lineWidth = 1.2;
  if (object.form === "orb") {
    ctx.beginPath(); ctx.arc(x, y, size * .52, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y, size * .88, size * .27, -.35, 0, TAU); ctx.stroke();
    ctx.fillStyle = "rgba(234,255,244,.75)";
    ctx.beginPath(); ctx.arc(x - size * .14, y - size * .18, size * .08, 0, TAU); ctx.fill();
  } else if (object.form === "crystal") {
    ctx.beginPath();
    ctx.moveTo(x, y - size); ctx.lineTo(x + size * .48, y - size * .2);
    ctx.lineTo(x + size * .34, y + size * .72); ctx.lineTo(x - size * .38, y + size * .72);
    ctx.lineTo(x - size * .5, y - size * .18); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - size); ctx.lineTo(x, y + size * .7); ctx.moveTo(x - size * .5, y - size * .18); ctx.lineTo(x + size * .48, y - size * .2); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.ellipse(x, y, size * .7, size, .15, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y, size * .38, size * .72, -.16, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - size, y); ctx.lineTo(x + size, y); ctx.stroke();
  }
  ctx.restore();
}
