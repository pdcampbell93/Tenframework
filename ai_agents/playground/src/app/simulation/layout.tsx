import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "TEN Lightcraft | Simulated light and waves",
  description: "A fictional, interactive light-and-wave playground with user-controlled signals. No brainwave sensing, radio hardware, or real virtual machine.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function SimulationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
