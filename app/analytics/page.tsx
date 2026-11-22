import type { Metadata } from "next";
import AnalyticsDashboard from "@/components/analytics/analytics-dashboard";

export const metadata: Metadata = {
  title: "Аналитика — AURELIUS",
  description: "Every saved search, result and action, platform metrics, conclusions and downloads.",
};

export default function AnalyticsPage() {
  return <AnalyticsDashboard />;
}
