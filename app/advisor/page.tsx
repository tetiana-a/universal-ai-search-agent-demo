import type { Metadata } from "next";
import AdvisorChat from "@/components/advisor/advisor-chat";

export const metadata: Metadata = {
  title: "Советник — AURELIUS",
  description: "Personal AI advisor: real estate, spiritual business, marketing and community promotion. Text or live voice.",
};

export default function AdvisorPage() {
  return <AdvisorChat />;
}
