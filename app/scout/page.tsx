import type { Metadata } from "next";
import ScoutDashboard from "@/components/scout/scout-dashboard";

export const metadata: Metadata = {
  title: "Разведчик — AURELIUS",
  description: "Daily real estate, investor and agency scout with Telegram control.",
};

export default function ScoutPage() {
  return <ScoutDashboard />;
}
