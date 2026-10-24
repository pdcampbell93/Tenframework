/** Owner-reviewed Python runs only; no credential or chat fields cross this API. */
export const SANDBOX_LIMITS = { codeBytes: 16000, outputChars: 12000, executionSeconds: 30, lifetimeSeconds: 60, reviewSeconds: 600 } as const;
export type SandboxJob = { id: string; state: string; expiresAt: number };
export type SandboxStatus = {
  configured: boolean; available: boolean; paused: boolean; disengaged: boolean;
  limits: typeof SANDBOX_LIMITS; active: SandboxJob | null;
};
export type SandboxReview = { id: string; codeHash: string; expiresAt: number };
export type SandboxResult = {
  id: string; state: string; stdout: string; stderr: string; exitCode: number | null;
  truncated: boolean; cleanupConfirmed: boolean; message: string;
};
