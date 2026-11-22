// Polish alcohol-advertising safety rule.
//
// Art. 13¹ of the Polish sobriety law generally prohibits public advertising
// of alcoholic beverages other than beer. Commercial information exchanged
// between alcohol-industry businesses is treated separately by Art. 2¹.
// This classifier deliberately errs on the side of not scheduling public posts.
// It is not legal clearance for any proposed B2B communication.
export type WineCampaignLike = { region?: string; title?: string; topic?: string; adText?: string; keywords?: string[] };

export const POLISH_WINE_NOTICE =
  "⚠️ В Польше публичная реклама вина, как правило, запрещена (ст. 13¹ закона о трезвости). "
  + "Эта кампания доступна только для изучения B2B-рынка: поиск импортеров, оптовиков, дистрибьюторов и HoReCa. "
  + "Массовая публикация остановлена. Индивидуальные коммерческие предложения профессиональным участникам рынка "
  + "требуют проверки применимых правил и юридического согласования.";

export function isPolishWineCampaign(c: WineCampaignLike): boolean {
  const where = String(c.region || "") + " " + String(c.adText || "");
  const inPoland = /польш(?:а|е|и|у|ой)?|poland|polska|polsce|polski|polskiej/i.test(where);
  const all = [c.title, c.topic, c.adText, ...(c.keywords || [])].filter(Boolean).join(" ");
  const wine = /(?:^|[^\p{L}])(?:вино|вина|вину|вином|вине|вины|винные|винный|винам|wino|wina|wina\b|winem|win|wine|wines|vinho|vini|vins|vin)(?:$|[^\p{L}])/iu.test(all);
  const commercial = /продаж|прода[юёе]|купить|закуп|объявлен|оголошен|реклам|размещ|розміщ|импорт|оптов|дистриб|hurtown|importer|dystrybut|sell|sale|trade|b2b|promotion|advert|ofert/iu.test(all);
  return inPoland && wine && commercial;
}

// These phrases are for locating professional communities and business
// prospects, not for permission to place a public advertisement.
export const POLISH_WINE_B2B_QUERIES = [
  "importerzy wina Polska",
  "hurtownie wina Polska",
  "dystrybutorzy wina Polska",
  "import wina włoskiego Polska",
  "branża winiarska Polska B2B",
  "sklepy winiarskie i hurtownie Polska",
  "dostawcy wina HoReCa Polska",
  "wine importers distributors Poland",
  "dystrybutorzy win włoskich Polska",
];
