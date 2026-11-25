import type { Metadata } from "next";
import ControlPanel from "@/components/control/control-panel";

export const metadata: Metadata = {
  title: "Пульт — AURELIUS",
  description: "One screen to run AURELIUS: task by voice or text, live totals, campaign progress, sections and a global stop.",
};

export default function ControlPage() {
  return <ControlPanel />;
}
