import assert from "node:assert/strict";
import {
  dragonBallMastersParserRevision,
  dragonBallMastersSourceIdentity,
  parseDragonBallMastersHtml,
  validateDragonBallMastersResponse
} from "../lib/listing/catalog/dragon-ball-masters-official-adapter.mjs";
import { createOfficialCatalogSourceAdapter } from "../lib/listing/catalog/official-catalog-source-adapter.mjs";

assert.equal(dragonBallMastersParserRevision, "dragon-ball-masters-post-v1");
assert.equal(
  dragonBallMastersSourceIdentity("https://www.dbs-cardgame.com/us-en/cardlist/?search=true&category_exp=428007")?.category_id,
  "428007"
);
for (const invalid of [
  "http://www.dbs-cardgame.com/us-en/cardlist/?search=true&category_exp=428007",
  "https://dbs-cardgame.com/us-en/cardlist/?search=true&category_exp=428007",
  "https://www.dbs-cardgame.com/us-en/cardlist/?search=true",
  "https://www.dbs-cardgame.com/us-en/cardlist/?search=true&category_exp=428007&free=goku",
  "https://www.dbs-cardgame.com/us-en/cardlist/?search=true&category_exp=7"
]) assert.equal(dragonBallMastersSourceIdentity(invalid), null);

const html = `
<select name="category_exp"><option value="428007" selected="selected">Series 7 Booster</option></select>
<li><dl class="cardListCol cardColorYellow csrdTypeBATTLE cardFront">
  <dt class="cardNumber">BT7-079</dt><dd class="cardName">Hit, Pride of Universe 6</dd>
  <dd class="leftCol"><div class="cardimg"><img src="../../images/cardlist/cardimg/BT7-079.png"></div>
  <dl class="seriesCol"><dt>Series</dt><dd>Series7<br>～ASSAULT OF THE SAIYANS～</dd></dl>
  <dl class="rarityCol"><dt>Rarity</dt><dd>Super Rare[SR]</dd></dl></dd>
  <dd class="rightCol"><dl class="typeCol"><dt>Type</dt><dd>BATTLE</dd></dl>
  <dl class="colorCol"><dt>Color</dt><dd>Yellow</dd></dl></dd>
</dl></li>
<li><dl class="cardListCol cardColorYellow csrdTypeBATTLE cardFront">
  <dt class="cardNumber">BT7-079_SPR</dt><dd class="cardName">Hit, Pride of Universe 6</dd>
  <dd class="leftCol"><div class="cardimg"><img src="../../images/cardlist/cardimg/BT7-079_SPR.png"></div>
  <dl class="seriesCol"><dt>Series</dt><dd>Series7<br>～ASSAULT OF THE SAIYANS～</dd></dl>
  <dl class="rarityCol"><dt>Rarity</dt><dd>Special Rare[SPR]</dd></dl></dd>
  <dd class="rightCol"><dl class="typeCol"><dt>Type</dt><dd>BATTLE</dd></dl>
  <dl class="colorCol"><dt>Color</dt><dd>Yellow</dd></dl></dd>
  <dd class="bottomCol"><dl class="notesCol"><dt>Notes</dt><dd>Series 7 special version</dd></dl></dd>
</dl></li>`;

assert.deepEqual(validateDragonBallMastersResponse(html, { categoryId: "428007" }), { card_count: 2 });
assert.throws(() => validateDragonBallMastersResponse(html, { categoryId: "428008" }), /category_contract_mismatch/);

const rows = parseDragonBallMastersHtml(html, {
  sourceUrl: "https://www.dbs-cardgame.com/us-en/cardlist/?search=true&category_exp=428007"
});
assert.equal(rows.length, 2);
assert.deepEqual(rows[0], {
  category: "tcg",
  game: "Dragon Ball Super Masters",
  language: "EN",
  manufacturer: "Bandai",
  product: "Series 7 - ASSAULT OF THE SAIYANS",
  set_or_insert: "Series 7 - ASSAULT OF THE SAIYANS",
  name: "Hit, Pride of Universe 6",
  card_name: "Hit, Pride of Universe 6",
  card_number: "BT7-079",
  checklist_code: "BT7-079",
  rarity: "SR",
  official_card_type: "BATTLE",
  parallel_name: "",
  parallel_exact: "",
  observable_components: ["Color:Yellow"],
  image_url: "https://www.dbs-cardgame.com/images/cardlist/cardimg/BT7-079.png",
  external_id: "BT7-079",
  source_url: "https://www.dbs-cardgame.com/us-en/cardlist/?search=true&category_exp=428007"
});
assert.equal(rows[1].card_number, "BT7-079");
assert.equal(rows[1].checklist_code, "BT7-079_SPR");
assert.equal(rows[1].external_id, "BT7-079_SPR");
assert.equal(rows[1].rarity, "SPR");
assert.equal(rows[1].parallel_exact, "Special Rare Series 7 special version");

const requests = [];
const adapter = createOfficialCatalogSourceAdapter({
  provider: "dragon_ball_masters",
  fetchImpl: async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/html; charset=UTF-8" : "" },
      arrayBuffer: async () => Buffer.from(html)
    };
  }
});
const officialSourceUrl = "https://www.dbs-cardgame.com/us-en/cardlist/?search=true&category_exp=428007";
const sourceFile = await adapter.downloadSource({ href: officialSourceUrl, text: "Series 7" });
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "https://www.dbs-cardgame.com/us-en/cardlist/index.php?search=true");
assert.equal(requests[0].options.method, "POST");
assert.equal(requests[0].options.body, "category_exp=428007");
assert.deepEqual(sourceFile.dragon_ball_masters, { category_id: "428007", card_count: 2 });
const importedRows = adapter.parseRows(await adapter.extractRawText(sourceFile), {
  sourceUrl: officialSourceUrl,
  sourceName: "Series 7",
  category: "tcg"
});
assert.equal(importedRows.length, 2);
assert.equal(importedRows[0].import_status, "OFFICIAL_CHECKLIST_CANDIDATE");
assert.equal(importedRows[0].parse_confidence, 0.99);
await assert.rejects(
  adapter.downloadSource({ href: "https://www.dbs-cardgame.com/us-en/cardlist/", text: "unbounded" }),
  /dragon_ball_masters_bounded_category_url_required/
);

console.log("dragon-ball-masters-official-adapter.test.mjs passed");
