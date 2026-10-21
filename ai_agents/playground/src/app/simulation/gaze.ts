export type GazePoint = { x: number; y: number };
export type GazeDirection = "center" | "left" | "right" | "up" | "down" | "uncertain";

export function estimateGaze(landmarks: { x: number; y: number }[]): GazePoint | null {
  if (landmarks.length < 478) return null;
  const eye = (outer: number, inner: number, iris: number, upper: number, lower: number) => {
    const a = landmarks[outer], b = landmarks[inner], pupil = landmarks[iris];
    const top = landmarks[upper], bottom = landmarks[lower];
    const width = Math.abs(b.x - a.x), height = Math.abs(bottom.y - top.y);
    if (width < .005 || height < .003) return null;
    return { x: (pupil.x - Math.min(a.x, b.x)) / width, y: (pupil.y - top.y) / height };
  };
  const left = eye(33, 133, 468, 159, 145);
  const right = eye(362, 263, 473, 386, 374);
  if (!left || !right) return null;
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

export function directionFromGaze(point: GazePoint | null, center: GazePoint | null): GazeDirection {
  if (!point || !center) return "uncertain";
  const dx = point.x - center.x, dy = point.y - center.y;
  if (Math.abs(dx) < .16 && Math.abs(dy) < .2) return "center";
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}
