export type SearchBranch = {
  id: string;
  label: string;
  className: string;
  queries: string[];
  priority: number;
};

const SOCIAL_TARGETS = [
  { id: "facebook-groups", label: "Facebook public groups/pages", sites: ["facebook.com/groups", "facebook.com"] },
  { id: "telegram", label: "Telegram public channels/groups", sites: ["t.me", "telegram.me"] },
  { id: "linkedin-groups", label: "LinkedIn public pages/groups", sites: ["linkedin.com/groups", "linkedin.com/company", "linkedin.com/in"] },
  { id: "reddit", label: "Reddit communities", sites: ["reddit.com/r"] },
  { id: "youtube", label: "YouTube channels/videos", sites: ["youtube.com"] },
  { id: "instagram", label: "Instagram public profiles/pages", sites: ["instagram.com"] },
  { id: "x", label: "X public profiles/posts", sites: ["x.com", "twitter.com"] },
  { id: "meetup", label: "Meetup communities/events", sites: ["meetup.com"] },
  { id: "discord", label: "Discord public discovery pages", sites: ["discord.com/invite", "discord.gg"] },
  { id: "quora", label: "Quora public Q&A", sites: ["quora.com"] },
  { id: "forums", label: "Public forums", sites: ["groups.google.com", "forum", "community", "board"] },
];

const REGIONAL_ENGINES: Record<string, string[]> = {
  global: ["google", "brave", "exa", "tavily", "mojeek", "dataforseo"],
  czechia: ["google", "seznam", "brave", "mojeek", "dataforseo"],
  europe: ["google", "brave", "exa", "tavily", "mojeek", "dataforseo"],
  russia_cis: ["yandex", "google", "brave", "mojeek", "dataforseo"],
  turkey: ["yandex", "google", "brave", "dataforseo"],
  china: ["baidu", "google", "brave", "dataforseo"],
  south_korea: ["naver", "google", "brave", "dataforseo"],
};

export function inferRegionKeys(text: string): string[] {
  const q = text.toLowerCase();
  const keys = new Set<string>(["global"]);
  if (/czech|czechia|praha|prague|brno|česko|чех|прага|брно/.test(q)) keys.add("czechia");
  if (/russia|росси|ukraine|украин|belarus|беларус|cis|снгі|снг|turkey|turkiye|турц/.test(q)) keys.add("russia_cis");
  if (/china|китай|shanghai|beijing|baidu|中文/.test(q)) keys.add("china");
  if (/korea|korea|коре|seoul|naver|한국/.test(q)) keys.add("south_korea");
  if (/turkey|turkiye|турц|istanbul|ankara/.test(q)) keys.add("turkey");
  if (/europe|eu |european|europa|европ/.test(q)) keys.add("europe");
  return [...keys];
}

function socialQueries(query: string): SearchBranch[] {
  return SOCIAL_TARGETS.map((target, index) => {
    const sitePart = target.sites.map((s) => `site:${s}`).join(" OR ");
    return {
      id: `social-${target.id}`,
      label: target.label,
      className: "social_public",
      priority: 70 - index,
      queries: [
        `${query} (${sitePart})`,
        `${query} group community forum (${sitePart})`,
      ],
    };
  });
}

export function buildSearchMatrix(query: string, language = "en", geographyHint?: string): SearchBranch[] {
  const q = query.trim();
  const lang = language === "ru" ? "Russian" : language === "uk" ? "Ukrainian" : language === "cs" ? "Czech" : language === "de" ? "German" : "English";
  const regional = inferRegionKeys(`${q} ${geographyHint || ""}`).flatMap((key) => REGIONAL_ENGINES[key] || []);
  const engines = [...new Set(regional)];

  const base: SearchBranch[] = [
    {
      id: "primary-web",
      label: "General web discovery",
      className: "web",
      priority: 100,
      queries: [q, `${q} ${lang}`, `${q} official`],
    },
    {
      id: "official-government",
      label: "Government / official registries",
      className: "official",
      priority: 98,
      queries: [
        `${q} official government registry`,
        `${q} government database`,
        `${q} site:.gov OR site:.gouv OR site:.gov.uk OR site:.gc.ca OR site:.gov.au`,
        `${q} filetype:pdf official register`,
      ],
    },
    {
      id: "specialist-directories",
      label: "Specialized directories and catalogs",
      className: "specialized",
      priority: 94,
      queries: [
        `${q} directory`,
        `${q} professional association`,
        `${q} trade association`,
        `${q} catalog database`,
      ],
    },
    {
      id: "companies",
      label: "Companies / suppliers / manufacturers",
      className: "companies",
      priority: 92,
      queries: [
        `${q} company`,
        `${q} manufacturer`,
        `${q} supplier`,
        `${q} distributor`,
      ],
    },
    {
      id: "documents-open-data",
      label: "Documents / open data / reports",
      className: "documents",
      priority: 90,
      queries: [
        `${q} filetype:pdf`,
        `${q} dataset`,
        `${q} open data`,
        `${q} report statistics`,
      ],
    },
    {
      id: "news",
      label: "News and current activity",
      className: "news",
      priority: 82,
      queries: [`${q} news`, `${q} announcement`, `${q} 2026`],
    },
    {
      id: "maps-local",
      label: "Local / maps / places",
      className: "local",
      priority: 88,
      queries: [`${q} map`, `${q} local`, `${q} address`, `${q} contact`],
    },
    {
      id: "jobs",
      label: "Jobs / roles / specialists",
      className: "jobs",
      priority: 70,
      queries: [`${q} jobs`, `${q} hiring`, `${q} specialist`],
    },
    ...socialQueries(q),
    {
      id: "regional-language",
      label: "Regional-language expansion",
      className: "regional",
      priority: 86,
      queries: [
        q,
        `${q} local language`,
        `${q} local terms`,
        `${q} local directory`,
      ],
    },
  ];

  return base.map((b) => ({
    ...b,
    queries: [...new Set(b.queries.map((x) => x.trim()).filter(Boolean))],
  }));
}
