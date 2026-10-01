export type Lang = "ru" | "en";
export type Scenario = "realEstate" | "investors" | "companies";

export type NavKey = "research" | "tasks" | "sources" | "results" | "settings";

export type ResultStatus = "Verified" | "Reviewed" | "Manual review";

export type Result = {
  id: number;
  title: string;
  location: string;
  area: string;
  price: string;
  match: number;
  evidence: string;
  status: ResultStatus;
  source: string;
  url: string;
  why: string;
};

export type SourceHealth = "Healthy" | "Warning" | "Review";

export type Source = {
  name: string;
  category: string;
  health: SourceHealth;
  quality: number;
  method: string;
  lastChecked: string;
  status: "Active" | "Review";
  url: string;
  domain: string;
  description: string;
};

export type Task = {
  id: string;
  title: string;
  status: "Running" | "Completed" | "Paused";
  date: string;
  duration: string;
  results: number;
  scenario: Scenario;
};

export const sourceRegistry: Source[] = [
  {
    name: "idealista",
    category: "Real Estate",
    health: "Healthy",
    quality: 94,
    method: "Public web / browser",
    lastChecked: "2 min ago",
    status: "Active",
    url: "https://www.idealista.com/venta-terrenos/madrid-madrid/",
    domain: "idealista.com",
    description: "Madrid land listings and search filters.",
  },
  {
    name: "Comunidad de Madrid — Visor SIT",
    category: "Government / Planning",
    health: "Healthy",
    quality: 97,
    method: "Public web / map",
    lastChecked: "12 min ago",
    status: "Active",
    url: "https://www.comunidad.madrid/medio-ambiente/sistema-informacion-territorial-visor-sit",
    domain: "comunidad.madrid",
    description: "Official planning information and territorial viewer.",
  },
  {
    name: "Sede Electrónica del Catastro",
    category: "Cadastre",
    health: "Healthy",
    quality: 98,
    method: "Public portal",
    lastChecked: "18 min ago",
    status: "Active",
    url: "https://www.sedecatastro.gob.es/",
    domain: "sedecatastro.gob.es",
    description: "Official cadastral references and parcel information.",
  },
  {
    name: "Portal del Suelo 4.0",
    category: "Public Land",
    health: "Healthy",
    quality: 96,
    method: "Web / CSV / JSON",
    lastChecked: "24 min ago",
    status: "Active",
    url: "https://www.comunidad.madrid/inversion-empresa/portal-suelo-40",
    domain: "comunidad.madrid",
    description: "Public land parcels, use and planning parameters.",
  },
  {
    name: "Geoportal Comunidad de Madrid",
    category: "Geospatial",
    health: "Healthy",
    quality: 95,
    method: "Web / geodata",
    lastChecked: "32 min ago",
    status: "Active",
    url: "https://www.comunidad.madrid/geoportal",
    domain: "comunidad.madrid",
    description: "Official geographic data and map layers.",
  },
  {
    name: "Cartografía Comunidad de Madrid",
    category: "Geospatial",
    health: "Healthy",
    quality: 93,
    method: "Web / map",
    lastChecked: "41 min ago",
    status: "Active",
    url: "https://www.comunidad.madrid/medio-ambiente/cartografia-topografica-tematica",
    domain: "comunidad.madrid",
    description: "Topographic and thematic cartography.",
  },
  {
    name: "datos.madrid.es — Urbanismo",
    category: "Open Data",
    health: "Healthy",
    quality: 96,
    method: "CSV / JSON / GEO",
    lastChecked: "52 min ago",
    status: "Active",
    url: "https://datos.madrid.es/group/urbanismo-infraestructuras",
    domain: "datos.madrid.es",
    description: "Open urbanism and infrastructure datasets.",
  },
  {
    name: "Portal de Datos Abiertos de Madrid",
    category: "Open Data",
    health: "Healthy",
    quality: 95,
    method: "Open data portal",
    lastChecked: "1 h ago",
    status: "Active",
    url: "https://datos.madrid.es/",
    domain: "datos.madrid.es",
    description: "Official Madrid public datasets.",
  },
  {
    name: "Amsterdam Invest",
    category: "Investor Discovery",
    health: "Healthy",
    quality: 88,
    method: "Public web",
    lastChecked: "3 h ago",
    status: "Active",
    url: "https://www.iamsterdam.com/en/business/invest",
    domain: "iamsterdam.com",
    description: "Public Amsterdam business and investment ecosystem information.",
  },
  {
    name: "Global Sources",
    category: "Supplier Discovery",
    health: "Healthy",
    quality: 87,
    method: "Public web / directory",
    lastChecked: "4 h ago",
    status: "Active",
    url: "https://www.globalsources.com/",
    domain: "globalsources.com",
    description: "Global B2B supplier and manufacturer directory.",
  },
  {
    name: "Alibaba",
    category: "Supplier Discovery",
    health: "Warning",
    quality: 82,
    method: "Public web / marketplace",
    lastChecked: "4 h ago",
    status: "Review",
    url: "https://www.alibaba.com/",
    domain: "alibaba.com",
    description: "Large public supplier marketplace; access rules require source-specific review.",
  },
];

export const scenarios = {
  realEstate: {
    label: "Real Estate",
    labelRu: "Недвижимость",
    query:
      "Найди земельные участки в Мадриде площадью от 10 000 м², подходящие под мои критерии.",
    queryEn:
      "Find land parcels in Madrid above 10,000 m² suitable for my criteria.",
    sourcesFound: 520,
    sourcesChecked: 347,
    qualified: 86,
    duplicates: 510,
    evidence: 91,
    remaining: "~8 min",
    categories: [
      ["Real Estate Portals", 126, 94, "strong"],
      ["Local Agencies", 84, 88, "strong"],
      ["Municipal / Public", 73, 82, "medium"],
      ["Bank & Auctions", 54, 76, "medium"],
      ["Forums / Communities", 61, 58, "weak"],
      ["Other Sources", 89, 64, "medium"],
    ],
  },
  investors: {
    label: "Investors",
    labelRu: "Инвесторы",
    query:
      "Найди потенциальных инвесторов в Амстердаме для технологического проекта X.",
    queryEn:
      "Find potential investors in Amsterdam for technology project X.",
    sourcesFound: 412,
    sourcesChecked: 286,
    qualified: 58,
    duplicates: 304,
    evidence: 88,
    remaining: "~6 min",
    categories: [
      ["VC Funds", 76, 94, "strong"],
      ["Angel Networks", 63, 89, "strong"],
      ["Family Offices", 51, 81, "medium"],
      ["Accelerators", 44, 79, "medium"],
      ["Conferences", 72, 70, "medium"],
      ["Professional Networks", 106, 55, "weak"],
    ],
  },
  companies: {
    label: "Companies",
    labelRu: "Компании",
    query:
      "Найди производителей промышленной упаковки в Китае с экспортом в ЕС.",
    queryEn:
      "Find industrial packaging manufacturers in China exporting to the EU.",
    sourcesFound: 684,
    sourcesChecked: 455,
    qualified: 112,
    duplicates: 618,
    evidence: 90,
    remaining: "~11 min",
    categories: [
      ["Manufacturer Directories", 168, 93, "strong"],
      ["Company Websites", 142, 92, "strong"],
      ["Trade Portals", 124, 84, "medium"],
      ["Export Registries", 86, 79, "medium"],
      ["Industry Associations", 72, 73, "medium"],
      ["Communities", 92, 57, "weak"],
    ],
  },
} as const;

export const resultsByScenario: Record<Scenario, Result[]> = {
  realEstate: [
    {
      id: 1,
      title: "Finca Madrid Norte",
      location: "Madrid, ES",
      area: "12,800 m²",
      price: "€1.84M",
      match: 96,
      evidence: "Listing / planning evidence",
      status: "Verified",
      source: "idealista",
      url: "https://www.idealista.com/venta-terrenos/madrid-madrid/",
      why: "Illustrative demo result: the target area threshold and Madrid geography are represented in the mock result.",
    },
    {
      id: 2,
      title: "Parcela Industrial Sur",
      location: "Getafe, ES",
      area: "18,420 m²",
      price: "€2.12M",
      match: 93,
      evidence: "Listing + location evidence",
      status: "Verified",
      source: "idealista",
      url: "https://www.idealista.com/venta-terrenos/madrid-madrid/",
      why: "Illustrative demo result: large parcel within the Madrid metro area.",
    },
    {
      id: 3,
      title: "Urban Expansion Plot",
      location: "Alcalá de Henares, ES",
      area: "10,250 m²",
      price: "€1.31M",
      match: 91,
      evidence: "Planning map evidence",
      status: "Reviewed",
      source: "Comunidad de Madrid — Visor SIT",
      url: "https://www.comunidad.madrid/medio-ambiente/sistema-informacion-territorial-visor-sit",
      why: "Illustrative demo result: planning context is represented as a second-stage verification source.",
    },
    {
      id: 4,
      title: "Development Opportunity",
      location: "Móstoles, ES",
      area: "24,000 m²",
      price: "€3.42M",
      match: 88,
      evidence: "Listing evidence",
      status: "Reviewed",
      source: "Portal del Suelo 4.0",
      url: "https://www.comunidad.madrid/inversion-empresa/portal-suelo-40",
      why: "Illustrative demo result: public-land source is shown as a verification/discovery layer.",
    },
  ],
  investors: [
    {
      id: 11,
      title: "Amsterdam Growth Ecosystem",
      location: "Amsterdam, NL",
      area: "B2B / SaaS",
      price: "Series A–B",
      match: 94,
      evidence: "Public ecosystem source",
      status: "Verified",
      source: "Amsterdam Invest",
      url: "https://www.iamsterdam.com/en/business/invest",
      why: "Illustrative demo result linked to a real public Amsterdam investment ecosystem source.",
    },
    {
      id: 12,
      title: "Dutch Climate-Tech Network",
      location: "Amsterdam, NL",
      area: "Climate / Deeptech",
      price: "€250k–€1M",
      match: 91,
      evidence: "Public ecosystem source",
      status: "Reviewed",
      source: "Amsterdam Invest",
      url: "https://www.iamsterdam.com/en/business/invest",
      why: "Illustrative demo result for demonstrating an adaptive investor schema.",
    },
    {
      id: 13,
      title: "Technology Investment Lead",
      location: "Amsterdam, NL",
      area: "Technology",
      price: "Private",
      match: 84,
      evidence: "Public reference required",
      status: "Manual review",
      source: "Amsterdam Invest",
      url: "https://www.iamsterdam.com/en/business/invest",
      why: "Illustrative demo result intentionally flagged for human verification.",
    },
  ],
  companies: [
    {
      id: 21,
      title: "Ningbo Industrial Packaging",
      location: "Zhejiang, CN",
      area: "Industrial packaging",
      price: "EU export",
      match: 95,
      evidence: "Directory source",
      status: "Verified",
      source: "Global Sources",
      url: "https://www.globalsources.com/",
      why: "Illustrative demo result linked to a real B2B supplier discovery source.",
    },
    {
      id: 22,
      title: "Guangdong Flexible Pack Co.",
      location: "Guangdong, CN",
      area: "Flexible packaging",
      price: "EU / UK",
      match: 90,
      evidence: "Supplier directory",
      status: "Reviewed",
      source: "Global Sources",
      url: "https://www.globalsources.com/",
      why: "Illustrative demo result; export verification remains a second-stage step.",
    },
    {
      id: 23,
      title: "Industrial Packaging Supplier",
      location: "Foshan, CN",
      area: "B2B packaging",
      price: "OEM / private label",
      match: 86,
      evidence: "Marketplace source",
      status: "Manual review",
      source: "Alibaba",
      url: "https://www.alibaba.com/",
      why: "Illustrative demo result showing a marketplace source with manual validation state.",
    },
  ],
};

export const tasks: Task[] = [
  {
    id: "AURE-0427",
    title: "Madrid land discovery",
    status: "Running",
    date: "Today, 15:42",
    duration: "6m 24s",
    results: 86,
    scenario: "realEstate",
  },
  {
    id: "AURE-0424",
    title: "Amsterdam investor discovery",
    status: "Completed",
    date: "Today, 13:18",
    duration: "11m 08s",
    results: 58,
    scenario: "investors",
  },
  {
    id: "AURE-0419",
    title: "China packaging suppliers",
    status: "Paused",
    date: "Yesterday, 18:33",
    duration: "8m 42s",
    results: 112,
    scenario: "companies",
  },
];
