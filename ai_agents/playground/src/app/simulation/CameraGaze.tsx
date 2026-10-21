"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { directionFromGaze, estimateGaze, type GazePoint } from "./gaze";
import styles from "./simulation.module.css";

type Props = { onAutoPause: () => void };
type CameraState = "off" | "loading" | "ready" | "denied" | "unsupported" | "error";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export default function CameraGaze({ onAutoPause }: Props) {
  const [state, setState] = useState<CameraState>("off");
  const [direction, setDirection] = useState("uncertain");
  const [faceSeen, setFaceSeen] = useState(false);
  const [autoPause, setAutoPause] = useState(true);
  const [calibrated, setCalibrated] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<{ detectForVideo: (video: HTMLVideoElement, timestamp: number) => { faceLandmarks?: { x: number; y: number }[][] }; close: () => void } | null>(null);
  const generation = useRef(0);
  const center = useRef<GazePoint | null>(null);
  const latestPoint = useRef<GazePoint | null>(null);
  const lastFaceAt = useRef(0);
  const pauseCalled = useRef(false);
  const onAutoPauseRef = useRef(onAutoPause);
  onAutoPauseRef.current = onAutoPause;

  const stop = useCallback(() => {
    generation.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current?.close();
    detectorRef.current = null;
    const video = videoRef.current;
    if (video) { video.pause(); video.srcObject = null; }
    setState("off"); setFaceSeen(false); setDirection("uncertain"); setCalibrated(false);
    center.current = null; latestPoint.current = null; pauseCalled.current = false;
  }, []);

  const enable = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setState("unsupported"); return; }
    const token = ++generation.current;
    setState("loading");
    try {
      // Import the vision runtime only after the user explicitly enables camera access.
      const vision = await import("@mediapipe/tasks-vision");
      if (generation.current !== token) return;
      const files = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
      if (generation.current !== token) return;
      const detector = await vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
        runningMode: "VIDEO", numFaces: 1,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
      });
      if (generation.current !== token) { detector.close(); return; }
      detectorRef.current = detector;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (generation.current !== token) { stream.getTracks().forEach((track) => track.stop()); detector.close(); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stop(); return; }
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      if (generation.current !== token) return;
      setState("ready");
    } catch (error) {
      if (generation.current !== token) return;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null; detectorRef.current?.close(); detectorRef.current = null;
      const name = error instanceof Error ? error.name : "";
      setState(name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : "error");
    }
  }, [stop]);

  useEffect(() => {
    if (state !== "ready") return;
    let frame = 0;
    let lastDetection = 0;
    let missingTimer = 0;
    const tick = (timestamp: number) => {
      const video = videoRef.current;
      if (video && timestamp - lastDetection >= 200 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        lastDetection = timestamp;
        try {
          const result = detectorRef.current?.detectForVideo(video, timestamp);
          const point = result?.faceLandmarks?.[0] ? estimateGaze(result.faceLandmarks[0]) : null;
          latestPoint.current = point;
          if (point) {
            lastFaceAt.current = timestamp; setFaceSeen(true);
            setDirection(directionFromGaze(point, center.current));
            pauseCalled.current = false;
          } else {
            setFaceSeen(false); setDirection("uncertain");
            if (!missingTimer) missingTimer = timestamp;
            if (autoPause && timestamp - missingTimer >= 1500 && !pauseCalled.current) {
              pauseCalled.current = true;
              onAutoPauseRef.current();
            }
          }
          if (point) missingTimer = 0;
          if (lastFaceAt.current && timestamp - lastFaceAt.current > 1500 && autoPause && !pauseCalled.current) {
            pauseCalled.current = true;
            onAutoPauseRef.current();
          }
        } catch {
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          detectorRef.current?.close(); detectorRef.current = null;
          const videoElement = videoRef.current;
          if (videoElement) { videoElement.pause(); videoElement.srcObject = null; }
          setState("error");
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state, autoPause]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState !== "visible") stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stop]);
  useEffect(() => () => {
    generation.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    detectorRef.current?.close();
  }, []);

  const status = state === "ready" ? (faceSeen ? `Tracked · ${direction}` : "Face not found · uncertain") :
    state === "loading" ? "Loading local vision model…" :
    state === "denied" ? "Camera permission was denied. You can continue without it." :
    state === "unsupported" ? "Camera capture is not supported in this browser." :
    state === "error" ? "Camera or model could not start. Turn it off and try again." : "Camera is off.";

  return <section className={styles.cameraCard} aria-label="Optional camera direction helper">
    <div className={styles.cameraHead}><div><span className={styles.sectionLabel}>Optional · local only</span><h3>Camera direction helper</h3></div><span className={styles.cameraStatus} data-state={state}>{state === "ready" ? "ON" : state === "loading" ? "LOADING" : "OFF"}</span></div>
    <p className={styles.cameraCopy}>Uses front-camera face and iris landmarks to estimate a rough direction. Camera access is opt-in; no audio, video upload, or video storage.</p>
    {state !== "off" && <div className={styles.cameraPreview}><video ref={videoRef} muted playsInline aria-label="Mirrored local camera preview" /><span>{status}</span></div>}
    {state === "off" ? <button type="button" className={styles.cameraButton} onClick={() => void enable()}>Enable camera</button> :
      <button type="button" className={styles.cameraButton} onClick={stop}>{state === "loading" || state === "ready" ? "Turn camera off" : "Reset camera state"}</button>}
    <p className={styles.cameraState} role="status">{status}{state === "ready" && !calibrated ? " · Calibration recommended" : ""}</p>
    {state === "ready" && <div className={styles.cameraTools}>
      <button type="button" className={styles.tinyButton} onClick={() => { if (latestPoint.current) { center.current = latestPoint.current; setCalibrated(true); } }} disabled={!faceSeen}>Calibrate center</button>
      <label><input type="checkbox" checked={autoPause} onChange={(event) => { setAutoPause(event.target.checked); pauseCalled.current = false; }} /> Pause effects if face is missing for 1.5 seconds</label>
    </div>}
    <details className={styles.cameraDetails}><summary>Camera, model &amp; limits</summary>
      <p>MediaPipe model and WebAssembly are downloaded only when enabled: <a href={WASM_ROOT} target="_blank" rel="noreferrer">WASM package</a> and <a href={MODEL} target="_blank" rel="noreferrer">face landmark model</a>. Analysis runs in this browser at up to 5 checks per second, at camera resolution up to 640px. Direction is approximate and depends on your centered calibration.</p>
      <p>This is not awareness, medical, safety, or liveness monitoring. A photo may fool it. It does not infer EEG, control manifestation, or automatically resume effects. Manual controls always remain available.</p>
    </details>
  </section>;
}
