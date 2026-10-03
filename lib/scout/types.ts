// Domain model of the "Scout" agent (real estate objects + investors + agencies).
// Every record is plain JSON so it can live in Redis hashes or in memory.

export type Lang = "ru" | "en" | "es" | "uk";

export type PropertyType = "land" | "house" | "villa" | "apartment" | "penthouse" | "commercial" | "hotel" | "other";
export type ObjectStatus = "auction" | "urgent" | "off_market" | "bank" | "regular";

export type ObjectCard = {
  id: string;
  title: string;
  url: string;
  urls: string[]; // every listing of the same object (dedupe merges them)
  photo?: string;
  price?: number;
  currency?: string;
  areaM2?: number;
  pricePerM2?: number;
  country: string;
  city?: string;
  district?: string;
  type: PropertyType;
  status: ObjectStatus;
  yieldPct?: number;
  discountPct?: number; // below the reference market price, positive = cheaper
  sellerContact?: string;
  publishedAt?: string;
  sourceDomain: string;
  score: number;
  scoreReasons: string[];
  checklist: Record<string, ChecklistAnswer>;
  firstSeenAt: string;
  lastSeenAt: string;
  state: "new" | "reviewing" | "qualified" | "rejected";
};

export type InvestorKind = "family_office" | "fund" | "private" | "company";
export type InterestLevel = "explicit" | "general" | "neutral";

export type InvestorCard = {
  id: string;
  name: string;
  company?: string;
  role?: string;
  kind: InvestorKind;
  country?: string;
  channel?: string; // public contact channel (site, email, t.me, linkedin url)
  interest: { segments: PropertyType[]; budgetMin?: number; budgetMax?: number; currency?: string; geography: string[]; goals: Goal[] };
  source: string;
  sourceUrl?: string;
  // Watchlist post comment that revealed the interest (module 5.1).
  comment?: { postUrl: string; text: string; at?: string; level: InterestLevel };
  score: number;
  checklist: Record<string, ChecklistAnswer>;
  firstSeenAt: string;
  lastSeenAt: string;
  state: "new" | "contacted" | "in_dialog" | "qualified" | "refused" | "escalated";
};

export type AgencyCard = {
  id: string;
  name: string;
  city?: string;
  country?: string;
  website?: string;
  domain?: string;
  phone?: string;
  email?: string;
  network?: string; // franchise network (RE/MAX, Engel & Völkers...)
  source: string;
  isNew: boolean;
  firstSeenAt: string;
  state: "new" | "written" | "replied" | "meeting" | "partner" | "declined";
};

export type Goal = "income" | "residency" | "preservation" | "speculation";

export type ChecklistAnswer = { value: string; at: string; source: "dialog" | "manual" | "extracted" };

export type SourceKind = "portal" | "platform" | "group" | "channel" | "agency_site" | "registry" | "feed" | "news";
export type SourceState = "candidate" | "approved" | "rejected" | "dead" | "disabled";

export type ScoutSource = {
  id: string;
  name: string;
  url: string;
  domain: string;
  kind: SourceKind;
  country?: string;
  segment?: string;
  hasApi?: boolean;
  partnerProgram?: boolean;
  members?: number;
  summary?: string;
  recommendation?: "join" | "connect" | "ignore";
  state: SourceState;
  discoveredAt: string;
  approvedAt?: string;
  lastUsefulAt?: string;
  usefulCount: number;
  checkedCount: number;
};

export type WatchKind = "keyword" | "domain" | "person" | "group";
export type WatchItem = { id: string; kind: WatchKind; value: string; note?: string; addedAt: string; lastHitAt?: string; hits: number };

export type DraftChannel = "email" | "telegram" | "whatsapp" | "linkedin" | "public_reply" | "other";
export type Draft = {
  id: string;
  target: { type: "investor" | "agency" | "seller" | "commenter"; id: string; name: string; contact?: string };
  channel: DraftChannel;
  lang: Lang;
  templateId: string;
  text: string;
  state: "pending" | "approved" | "sent" | "rejected";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  kind: "first_contact" | "reminder" | "partnership";
};

export type Lead = {
  id: string;
  type: "investor" | "object";
  refId?: string; // investor or object card
  name: string;
  contact?: string; // e.g. tg:123456 for people talking to the bot
  lang: Lang;
  answers: Record<string, ChecklistAnswer>;
  transcript: Array<{ from: "agent" | "contact" | "human"; text: string; at: string }>;
  state: "in_progress" | "qualified" | "escalated" | "refused" | "handed_over";
  escalation?: string;
  lastContactAt: string;
  remindersSent: number;
  createdAt: string;
};

export type Match = { id: string; objectId: string; investorId: string; score: number; reasons: string[]; createdAt: string; state: "proposed" | "accepted" | "dismissed" };

export type Meeting = { id: string; title: string; startsAt: string; durationMin: number; where: string; with: string; leadId?: string; agencyId?: string; createdAt: string };

export type StopEntry = { key: string; reason: string; at: string };

export type LogEntry = { at: string; actor: "agent" | "human" | "bot" | "cron"; action: string; detail?: string };

export type ScanStats = {
  startedAt: string;
  finishedAt?: string;
  queries: number;
  hits: number;
  objectsNew: number;
  objectsMerged: number;
  investorsNew: number;
  agenciesNew: number;
  sourcesDiscovered: number;
  watchPosts: number;
  watchContacts: number;
  matchesNew: number;
  errors: string[];
  adapters: Record<string, string>;
};

export type ScoutTarget = { country: string; city?: string; types: PropertyType[]; lang: Lang };

export type ScoutSettings = {
  targets: ScoutTarget[];
  priceMin?: number;
  priceMax?: number;
  areaMin?: number;
  minYieldPct?: number;
  minDiscountPct: number;
  // Reference market price per m² by city, editable: drives the "below market" score.
  marketPricePerM2: Record<string, number>;
  dailyLimits: { email: number; telegram: number; whatsapp: number; linkedin: number; public_reply: number; other: number };
  reminderDays: number;
  maxReminders: number;
  reportHourUtc: number;
  companyName: string;
  senderName: string;
  unsubscribeText: Record<Lang, string>;
  templates: Record<string, Record<Lang, string>>;
  monitorKeywords: string[];
};
