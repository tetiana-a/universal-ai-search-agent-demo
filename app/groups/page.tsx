import type { Metadata } from "next";
import GroupsDashboard from "@/components/groups/groups-dashboard";

export const metadata: Metadata = {
  title: "Группы и публикации — AURELIUS",
  description: "Find Telegram and Facebook groups, contact admins, post via the bot where admins added it, and publish by hand from your own accounts.",
};

export default function GroupsPage() {
  return <GroupsDashboard />;
}
