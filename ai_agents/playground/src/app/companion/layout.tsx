import type { Metadata } from "next";
import "./companion-tweaks.css";

export const metadata: Metadata = {
  title: "TEN Companion · Private by choice",
  description: "Supportive and technical conversations with memory you review before saving.",
};

export default function CompanionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
