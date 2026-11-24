// Topics where advertising is restricted by law and by Facebook/Telegram rules (age gates, licences, bans).
// Such communities stay in the base but are marked ⚠️, so nobody posts there without checking the rules.
// Matching is by whole words: a word equal to one of `exact`, or starting with one of `prefix`.
const RESTRICTED: Array<{ label: string; exact: string[]; prefix: string[] }> = [
  { label: "алкоголь",
    exact: ["вино", "вина", "вину", "вином", "вине", "пиво", "пива", "ром", "джин", "wine", "wines", "beer", "beers", "rum", "gin", "vino", "vini", "vinos", "wino", "wina", "piwo", "piwa", "pivo", "piva", "víno", "vína", "bier", "biere", "wein", "weine", "birra", "birre", "cerveza", "cervezas"],
    prefix: ["алкогол", "винн", "виноде", "винотек", "виноторг", "пивн", "пивовар", "водк", "коньяк", "виски", "самогон", "бренди", "текил", "ликер", "ликёр", "сомелье", "alcohol", "alkohol", "alcool", "liquor", "vodka", "wódk", "whisk", "brewer", "winer", "winiar", "winnic", "vinar", "vinař", "sommel", "spirits", "cervecer", "brauerei", "tequil", "cognac"] },
  { label: "табак, вейпы",
    exact: ["snus", "iqos"],
    prefix: ["табак", "табач", "сигар", "кальян", "вейп", "вэйп", "tobacc", "cigar", "vape", "vaping", "hookah", "shisha", "tytoń", "tyton", "papieros", "tabac", "tabak", "zigarett"] },
  { label: "азартные игры",
    exact: ["poker", "покер", "slots"],
    prefix: ["казино", "букмекер", "тотализ", "лотере", "casino", "kasyn", "bookmak", "betting", "gambl", "lotter", "apuesta", "sázk", "sazk", "glücksspiel"] },
  { label: "оружие",
    exact: ["gun", "guns", "broń", "zbraně"],
    prefix: ["оруж", "пистолет", "карабин", "weapon", "firearm", "rifle", "pistol", "waffen"] },
  { label: "наркотики, CBD",
    exact: ["cbd", "weed", "thc", "травка"],
    prefix: ["наркот", "марихуан", "канабис", "каннабис", "cannabis", "marijuan", "kratom", "закладк"] },
];

/** The restricted-advertising category the text belongs to ("алкоголь", …), or "" when none. */
export function restrictedTopic(text: string): string {
  const words = text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const r of RESTRICTED) if (words.some((w) => r.exact.includes(w) || r.prefix.some((p) => w.startsWith(p)))) return r.label;
  return "";
}
