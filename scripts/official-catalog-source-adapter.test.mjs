import assert from "node:assert/strict";
import {
  catalogImportStatuses,
  catalogSourceTypes
} from "../lib/listing/catalog/catalog-contract.mjs";
import {
  createOfficialCatalogSourceAdapter,
  discoverOfficialCatalogSource,
  ExternalCatalogAdapter,
  officialCatalogSourceProfile
} from "../lib/listing/catalog/official-catalog-source-adapter.mjs";

{
  [
    "INTERNAL_CORRECTED_TITLE",
    "TOPPS_OFFICIAL_CHECKLIST",
    "PANINI_OFFICIAL_CHECKLIST",
    "UPPER_DECK_OFFICIAL_CHECKLIST",
    "LEAF_OFFICIAL_RELEASE",
    "FUTERA_OFFICIAL_CHECKLIST",
    "PARKSIDE_OFFICIAL_RELEASE",
    "ONIT_OFFICIAL_RELEASE",
    "SMALL_MANUFACTURER_OFFICIAL_RELEASE",
    "BANDAI_ONE_PIECE_OFFICIAL_CARDLIST",
    "BANDAI_DIGIMON_OFFICIAL_CARDLIST",
    "BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE",
    "BANDAI_DBS_MASTERS_OFFICIAL_CARD_DATABASE",
    "BANDAI_UNION_ARENA_OFFICIAL_CARDLIST",
    "BANDAI_BATTLE_SPIRITS_OFFICIAL_CARDLIST",
    "BANDAI_GENERIC_OFFICIAL_CARDLIST",
    "POKEMON_OFFICIAL_CARD_SEARCH",
    "POKEMON_TCG_COMMUNITY_API",
    "WOTC_GATHERER_OFFICIAL_DATABASE",
    "SCRYFALL_COMMUNITY_API",
    "KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE",
    "YGOPRODECK_COMMUNITY_API",
    "LORCANA_OFFICIAL_CARD_DATABASE",
    "LORCANA_COMMUNITY_API",
    "STAR_WARS_UNLIMITED_OFFICIAL_CARDLIST",
    "FAB_OFFICIAL_CARD_DATABASE",
    "BUSHIROAD_WEISS_SCHWARZ_OFFICIAL_CARDLIST",
    "BUSHIROAD_VANGUARD_OFFICIAL_CARDLIST",
    "BUSHIROAD_SHADOWVERSE_EVOLVE_OFFICIAL_CARDLIST",
    "GRAND_ARCHIVE_OFFICIAL_CARD_DATABASE",
    "ALTERED_OFFICIAL_CARD_DATABASE",
    "LICENSED_EXTERNAL_DIRECTORY",
    "EXTERNAL_DIRECTORY_WEAK",
    "MARKETPLACE_REFERENCE"
  ].forEach((sourceType) => {
    assert.equal(catalogSourceTypes[sourceType], sourceType);
  });
  assert.equal(officialCatalogSourceProfile("topps").source_type, catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST);
  assert.equal(officialCatalogSourceProfile("panini").source_type, catalogSourceTypes.PANINI_OFFICIAL_CHECKLIST);
  assert.equal(officialCatalogSourceProfile("upper_deck").source_type, catalogSourceTypes.UPPER_DECK_OFFICIAL_CHECKLIST);
  assert.equal(officialCatalogSourceProfile("leaf").source_type, catalogSourceTypes.LEAF_OFFICIAL_RELEASE);
  assert.equal(officialCatalogSourceProfile("futera").source_type, catalogSourceTypes.FUTERA_OFFICIAL_CHECKLIST);
  assert.equal(officialCatalogSourceProfile("one_piece").source_type, catalogSourceTypes.BANDAI_ONE_PIECE_OFFICIAL_CARDLIST);
  assert.equal(officialCatalogSourceProfile("digimon").source_type, catalogSourceTypes.BANDAI_DIGIMON_OFFICIAL_CARDLIST);
  assert.equal(officialCatalogSourceProfile("dragon_ball_fusion_world").source_type, catalogSourceTypes.BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE);
  assert.equal(officialCatalogSourceProfile("dragon_ball_masters").source_type, catalogSourceTypes.BANDAI_DBS_MASTERS_OFFICIAL_CARD_DATABASE);
  assert.equal(officialCatalogSourceProfile("union_arena").source_type, catalogSourceTypes.BANDAI_UNION_ARENA_OFFICIAL_CARDLIST);
  assert.equal(officialCatalogSourceProfile("battle_spirits").source_type, catalogSourceTypes.BANDAI_BATTLE_SPIRITS_OFFICIAL_CARDLIST);
  assert.equal(officialCatalogSourceProfile("pokemon_tcg_api").source_type, catalogSourceTypes.POKEMON_TCG_COMMUNITY_API);
  assert.equal(officialCatalogSourceProfile("wotc_gatherer").source_type, catalogSourceTypes.WOTC_GATHERER_OFFICIAL_DATABASE);
  assert.equal(officialCatalogSourceProfile("scryfall").source_type, catalogSourceTypes.SCRYFALL_COMMUNITY_API);
  assert.equal(officialCatalogSourceProfile("ygoprodeck").source_type, catalogSourceTypes.YGOPRODECK_COMMUNITY_API);
  assert.equal(officialCatalogSourceProfile("konami_yugioh").source_type, catalogSourceTypes.KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE);
  assert.equal(officialCatalogSourceProfile("lorcana").source_type, catalogSourceTypes.LORCANA_OFFICIAL_CARD_DATABASE);
  assert.equal(officialCatalogSourceProfile("lorcast").source_type, catalogSourceTypes.LORCANA_COMMUNITY_API);
  assert.equal(officialCatalogSourceProfile("swu").source_type, catalogSourceTypes.STAR_WARS_UNLIMITED_OFFICIAL_CARDLIST);
  assert.equal(officialCatalogSourceProfile("swudb").source_type, catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK);
  assert.equal(officialCatalogSourceProfile("fab").source_type, catalogSourceTypes.FAB_OFFICIAL_CARD_DATABASE);
  assert.equal(officialCatalogSourceProfile("weiss_schwarz").source_type, catalogSourceTypes.BUSHIROAD_WEISS_SCHWARZ_OFFICIAL_CARDLIST);
  assert.equal(officialCatalogSourceProfile("vanguard").source_type, catalogSourceTypes.BUSHIROAD_VANGUARD_OFFICIAL_CARDLIST);
  assert.equal(officialCatalogSourceProfile("shadowverse").source_type, catalogSourceTypes.BUSHIROAD_SHADOWVERSE_EVOLVE_OFFICIAL_CARDLIST);
  assert.equal(officialCatalogSourceProfile("grand_archive").source_type, catalogSourceTypes.GRAND_ARCHIVE_OFFICIAL_CARD_DATABASE);
  assert.equal(officialCatalogSourceProfile("altered").source_type, catalogSourceTypes.ALTERED_OFFICIAL_CARD_DATABASE);
  assert.equal(officialCatalogSourceProfile("pokemon").source_type, catalogSourceTypes.POKEMON_TCG_COMMUNITY_API);
  assert.equal(officialCatalogSourceProfile("dbfw").source_type, catalogSourceTypes.BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE);
  assert.equal(officialCatalogSourceProfile("yugioh").source_type, catalogSourceTypes.YGOPRODECK_COMMUNITY_API);
}

{
  const swuDb = new ExternalCatalogAdapter({
    provider: "swu_db",
    fetchImpl: async () => new Response(JSON.stringify({
      total_cards: 1,
      data: [{
        Set: "SOR",
        Number: "188",
        Name: "Chopper",
        Subtitle: "Metal Menace",
        Type: "Unit",
        Aspects: ["Aggression"],
        Traits: ["DROID", "SPECTRE"],
        Rarity: "Rare",
        VariantType: "Normal",
        FrontArt: "https://cdn.swu-db.com/images/cards/SOR/161.png"
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  const report = await swuDb.buildImportReport({
    sourceUrls: [{ href: "https://api.swu-db.com/cards/search?q=Chopper&format=json", text: "SWUDB Chopper" }]
  });
  assert.equal(report.source_type, catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK);
  assert.equal(report.source_trust, catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK);
  assert.equal(report.raw.staging[0].staging.identity_fields.game, "Star Wars Unlimited");
  assert.equal(report.raw.staging[0].staging.identity_fields.card_name, "Chopper - Metal Menace");
  assert.equal(report.raw.staging[0].staging.identity_fields.collector_number, "188");
  assert.equal(report.raw.staging[0].staging.physical_instance_fields.serial_number, undefined);
  assert.equal(report.raw.staging[0].staging.physical_instance_fields.card_grade, undefined);
  assert.equal(report.raw.staging[0].staging.physical_instance_fields.cert_number, undefined);
}

{
  const discovery = await discoverOfficialCatalogSource({
    provider: "panini",
    indexUrl: "https://www.paniniamerica.net/checklist.html",
    category: "basketball",
    fetchImpl: async () => new Response(`
      <script>window.endpoint="/api/checklists?Sport=Basketball&Program=Prizm"</script>
      <script>window.image="data:image/svg+xml;base64,PRODUCTCHECKLIST"</script>
      <script>window.script="javascript:openChecklist('/api/products')"</script>
      <script>window.fragment="&lt;div&gt;/api/products&lt;/div&gt;"</script>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Montserrat">
      <script>window.userApi="/api/User/Load"</script>
      <a href="/checklists/2024-panini-prizm-basketball.txt">2024 Panini Prizm Basketball Checklist</a>
      <a href="data:text/plain,checklist">Basketball Checklist Data Asset</a>
      <a href="javascript:openChecklist()">Basketball Checklist Script</a>
    `, { status: 200 })
  });
  assert.equal(discovery.provider, "panini");
  assert.equal(discovery.source_type, catalogSourceTypes.PANINI_OFFICIAL_CHECKLIST);
  assert.equal(discovery.discovered_source_count, 1);
  assert.ok(discovery.network_endpoint_hints.some((hint) => /api\/checklists/i.test(hint)));
  assert.ok(discovery.network_endpoint_hints.every((hint) => /^https?:\/\//i.test(hint)));
  assert.ok(discovery.network_endpoint_hints.every((hint) => !/[<>]/.test(hint)));
  assert.ok(discovery.network_endpoint_hints.every((hint) => !/googleapis|\/api\/User\/Load/i.test(hint)));
  assert.equal(discovery.policy.staging_only, true);
  assert.equal(discovery.policy.reviewed_internal_auto_promotion, false);
  assert.ok(discovery.manual_csv_fallback.columns.includes("players"));
}

{
  const upperDeck = createOfficialCatalogSourceAdapter({
    provider: "upper_deck",
    fetchImpl: async () => new Response("Base Set Checklist\n1\tConnor Bedard\tChicago Blackhawks", {
      status: 200,
      headers: { "content-type": "text/plain" }
    })
  });
  const report = await upperDeck.buildImportReport({
    sourceUrls: [{
      href: "https://www.upperdeckepack.com/Checklists/2024-25-series-one",
      text: "2024-25 Upper Deck Hockey Series One Checklist"
    }]
  });
  assert.equal(report.provider, "upper_deck");
  assert.equal(report.metrics.source_count, 1);
  assert.equal(report.metrics.parsed_row_count, 1);
  assert.equal(report.raw.staging[0].staging.identity_fields.manufacturer, "Upper Deck");
  assert.equal(report.raw.staging[0].staging.physical_instance_fields.card_grade, undefined);
}

{
  const leaf = createOfficialCatalogSourceAdapter({
    provider: "leaf",
    fetchImpl: async () => new Response("2025 Leaf Metal Basketball Autographs Multi-Sport Release", {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });
  const sourceFile = await leaf.downloadSource({
    href: "https://leaftradingcards.com/releases/2025-leaf-metal-basketball"
  });
  const rawText = await leaf.extractRawText(sourceFile);
  const rows = leaf.parseRows(rawText, {
    sourceName: "2025 Leaf Metal Basketball",
    sourceUrl: sourceFile.source_url
  });
  assert.equal(rows[0].import_status, catalogImportStatuses.OFFICIAL_RELEASE_SUPPORT);
  assert.equal(rows[0].field_statuses.product, "OFFICIAL_RELEASE_METADATA");
  assert.deepEqual(rows[0].physical_instance_fields, {});
}

{
  const onePiece = createOfficialCatalogSourceAdapter({
    provider: "one_piece",
    fetchImpl: async () => new Response(`
      <dl class="modalCol" id="OP01-001"><dt><div class="infoCol"><span>OP01-001</span> | <span>L</span> | <span>LEADER</span></div><div class="cardName">Roronoa Zoro</div></dt><dd><img data-src="../images/cardlist/card/OP01-001.png"><div class="getInfo"><h3>Card Set(s)</h3>-ROMANCE DAWN- [OP01]</div></dd></dl>
      <dl class="modalCol" id="OP01-002"><dt><div class="infoCol"><span>OP01-002</span> | <span>L</span> | <span>LEADER</span></div><div class="cardName">Trafalgar Law</div></dt><dd><img data-src="../images/cardlist/card/OP01-002.png"><div class="getInfo"><h3>Card Set(s)</h3>-ROMANCE DAWN- [OP01]</div></dd></dl>
    `, {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });
  const report = await onePiece.buildImportReport({
    sourceUrls: [{
      href: "https://en.onepiece-cardgame.com/cardlist/?series=556101",
      text: "One Piece Romance Dawn"
    }]
  });
  assert.equal(report.provider, "one_piece");
  assert.equal(report.source_type, catalogSourceTypes.BANDAI_ONE_PIECE_OFFICIAL_CARDLIST);
  assert.equal(report.metrics.card_count, 2);
  assert.equal(report.metrics.fetched_count, 1);
  assert.equal(report.metrics.parse_success_count, 2);
  assert.equal(report.metrics.parse_error_count, 0);
  assert.equal(report.metrics.rarity_count >= 1, true);
  assert.equal(Object.hasOwn(report.metrics, "parser_confidence_distribution"), true);
  assert.equal(Object.hasOwn(report.metrics, "image_reference_count"), true);
  assert.equal(report.raw.staging[0].staging.identity_fields.card_name, "Roronoa Zoro");
  assert.equal(report.raw.staging[0].staging.physical_instance_fields.card_grade, undefined);
  assert.equal(report.raw.staging[0].staging.source_trust, "OFFICIAL_CHECKLIST_CANDIDATE");
}

{
  const digimonHtml = `
    <ul class="image_lists">
      <li class="image_lists_item data page-1">
        <a class="card_img" data-src="#ST10-01"><img src="../images/cardlist/card/ST10-01.png" alt="ST10-01Nyaromon"></a>
        <div class="popupCol" id="ST10-01">
          <div class="cardTitleCol"><ul class="cardTitleList">
            <li class="cardNo">ST10-01</li><li class="cardRarity">U</li><li class="cardType">Digi-Egg</li><li class="cardLv">Lv.2</li>
          </ul><div class="cardTitle">Nyaromon</div></div>
          <dl class="cardInfoBox col2"><dt class="cardInfoTit">Color</dt><dd class="cardInfoData cardColor"><span>Purple</span></dd></dl>
          <dl class="cardInfoBox col2"><dt class="cardInfoTit">Form</dt><dd class="cardInfoData">In-Training</dd></dl>
        </div>
      </li>
      <li class="image_lists_item data page-1">
        <a class="card_img" data-src="#BT2-108_P1"><img src="../images/cardlist/card/BT2-108_P1.png" alt="BT2-108WarGreymon"></a>
        <div class="popupCol" id="BT2-108_P1">
          <div class="cardTitleCol"><ul class="cardTitleList">
            <li class="cardNo">BT2-108</li><li class="cardRarity">SR</li><li class="cardType">Digimon</li><li class="cardLv">Lv.6</li>
          </ul><div class="cardTitle">WarGreymon</div></div>
          <div class="cardParallel">Alternative Art</div>
        </div>
      </li>
    </ul>`;
  const digimon = createOfficialCatalogSourceAdapter({
    provider: "digimon",
    fetchImpl: async () => new Response(digimonHtml, {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });
  const report = await digimon.report({
    sourceUrls: [{
      href: "https://world.digimoncard.com/cardlist/?search=true",
      text: "Digimon Card List"
    }]
  });
  assert.equal(report.source_type, catalogSourceTypes.BANDAI_DIGIMON_OFFICIAL_CARDLIST);
  assert.equal(report.metrics.card_count, 2);
  assert.equal(report.raw.staging[0].staging.identity_fields.game, "Digimon");
  assert.equal(report.raw.staging[0].staging.identity_fields.card_name, "Nyaromon");
  assert.equal(report.raw.staging[0].staging.identity_fields.card_number, "ST10-01");
  assert.equal(report.raw.staging[0].staging.identity_fields.rarity, "U");
  assert.equal(report.raw.staging[0].staging.identity_fields.official_card_type, "Digi-Egg");
  assert.equal(report.raw.staging[0].staging.identity_fields.image_url, "https://world.digimoncard.com/images/cardlist/card/ST10-01.png");
  assert.deepEqual(report.raw.staging[0].staging.identity_fields.observable_components, ["Color:Purple", "Form:In-Training"]);
  assert.equal(report.raw.staging[1].staging.identity_fields.parallel_exact, "Alternative Art");
  assert.equal(report.raw.staging[1].staging.identity_fields.external_id, "BT2-108_P1");
}

{
  const dragonBallListHtml = `
    <ul>
      <li class="cardItem"><a data-src="detail.php?card_no=FS01-01"><img data-src="../../images/cards/card/en/FS01-01_f.webp" alt="FS01-01 Son Goku"></a></li>
      <li class="cardItem"><a data-src="detail.php?card_no=FS01-16&p=_p1"><img data-src="../../images/cards/card/en/FS01-16_p1.webp" alt="FS01-16 God Kamehameha"></a></li>
    </ul>`;
  const dragonBallDetail = ({ number, name, rarity, type, product, image, traits = "Saiyan", token = "detail-token" }) => `
    <meta name="token" content="${token}">
    <div class="cardNo">${number}</div><div class="rarity">${rarity}</div>
    <h1 class="cardName">${name}</h1>
    <div class="cardImage"><img src="../../images/cards/card/en/${image}" alt="${number} ${name}"></div>
    <div class="cardDataCell"><h6>Card type</h6><div class="data">${type}</div></div>
    <div class="cardDataCell"><h6>Color</h6><div class="data"><div class="colValue">Red</div></div></div>
    <div class="cardDataCell"><h6>Special Traits</h6><div class="data">${traits}</div></div>
    <div class="productName">${product}</div>`;
  let dragonBallFetchCount = 0;
  let dragonBallTransientFailureInjected = false;
  const dragonBall = createOfficialCatalogSourceAdapter({
    provider: "dragon_ball_fusion_world",
    fetchImpl: async (url) => {
      dragonBallFetchCount += 1;
      const href = String(url);
      if (href.includes("card_no=FS01-01") && !dragonBallTransientFailureInjected) {
        dragonBallTransientFailureInjected = true;
        return new Response("temporary", { status: 503, headers: { "content-type": "text/html" } });
      }
      if (href.includes("card_no=FS01-01")) return new Response(dragonBallDetail({
        number: "FS01-01", name: "Son Goku", rarity: "L", type: "LEADER",
        product: "STARTER DECK -SON GOKU- [FS01]", image: "FS01-01_f.webp", token: `detail-${dragonBallFetchCount}`
      }), { status: 200, headers: { "content-type": "text/html" } });
      if (href.includes("card_no=FS01-16")) return new Response(dragonBallDetail({
        number: "FS01-16", name: "God Kamehameha", rarity: "PR", type: "EXTRA",
        product: "STARTER DECK -SON GOKU- Bonus pack", image: "FS01-16_p1.webp", token: `detail-${dragonBallFetchCount}`
      }), { status: 200, headers: { "content-type": "text/html" } });
      return new Response(`<meta name="token" content="list-${dragonBallFetchCount}">${dragonBallListHtml}`, { status: 200, headers: { "content-type": "text/html" } });
    }
  });
  const report = await dragonBall.buildImportReport({
    sourceUrls: [{
      href: "https://www.dbs-cardgame.com/fw/en/cardlist/?search=true&category%5B%5D=583101",
      text: "Dragon Ball Fusion World Starter Deck Son Goku FS01"
    }]
  });
  assert.equal(report.source_type, catalogSourceTypes.BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE);
  assert.equal(dragonBallFetchCount, 4);
  assert.equal(dragonBallTransientFailureInjected, true);
  assert.equal(report.metrics.card_count, 2);
  assert.equal(report.metrics.review_required_count, 0);
  assert.equal(report.raw.staging[0].staging.identity_fields.game, "Dragon Ball Super Fusion World");
  assert.equal(report.raw.staging[0].staging.identity_fields.card_name, "Son Goku");
  assert.equal(report.raw.staging[0].staging.identity_fields.rarity, "L");
  assert.equal(report.raw.staging[0].staging.identity_fields.official_card_type, "LEADER");
  assert.deepEqual(report.raw.staging[0].staging.identity_fields.observable_components, ["Color:Red", "Special Traits:Saiyan"]);
  assert.equal(report.raw.staging[1].staging.identity_fields.external_id, "FS01-16_p1");
  assert.equal(report.raw.staging[1].staging.identity_fields.product, "STARTER DECK -SON GOKU- Bonus pack");
  assert.equal(report.raw.staging[1].staging.identity_fields.parallel_exact, undefined);
  const repeatedReport = await dragonBall.buildImportReport({
    sourceUrls: [{
      href: "https://www.dbs-cardgame.com/fw/en/cardlist/?search=true&category%5B%5D=583101",
      text: "Dragon Ball Fusion World Starter Deck Son Goku FS01"
    }]
  });
  assert.equal(dragonBallFetchCount, 7);
  assert.equal(repeatedReport.raw.sources[0].raw_checksum, report.raw.sources[0].raw_checksum);
}

{
  let unboundedFetchCount = 0;
  const dragonBallUnbounded = createOfficialCatalogSourceAdapter({
    provider: "dragon_ball_fusion_world",
    fetchImpl: async () => {
      unboundedFetchCount += 1;
      return new Response('<li class="cardItem"><a data-src="detail.php?card_no=FS01-01">card</a></li>', {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }
  });
  const report = await dragonBallUnbounded.buildImportReport({
    sourceUrls: [{ href: "https://www.dbs-cardgame.com/fw/en/cardlist/", text: "Unbounded source" }]
  });
  assert.equal(unboundedFetchCount, 1);
  assert.equal(report.metrics.card_count, 0);
  assert.equal(report.metrics.parse_error_count, 1);
}

{
  const unionArena = createOfficialCatalogSourceAdapter({
    provider: "union_arena",
    fetchImpl: async () => new Response("UA01BT-001 Gon Freecss Character Super Rare Green", {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });
  const report = await unionArena.buildImportReport({
    sourceUrls: [{
      href: "https://www.unionarena-tcg.com/na/cardlist/",
      text: "Union Arena Hunter x Hunter"
    }]
  });
  assert.equal(report.source_type, catalogSourceTypes.BANDAI_UNION_ARENA_OFFICIAL_CARDLIST);
  assert.equal(report.raw.staging[0].staging.identity_fields.game, "Union Arena");
  assert.equal(report.raw.staging[0].staging.physical_instance_fields.cert_number, undefined);
}

{
  const pokemon = new ExternalCatalogAdapter({
    provider: "pokemon_tcg_api",
    fetchImpl: async () => new Response(JSON.stringify({
      data: [{
        id: "swsh1-1",
        name: "Celebi V",
        number: "001",
        rarity: "Rare Holo V",
        supertype: "Pokemon",
        subtypes: ["Basic", "V"],
        set: { name: "Sword & Shield", series: "Sword & Shield" },
        images: { small: "https://images.example/pokemon-small.png", large: "https://images.example/pokemon-large.png" }
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  const report = await pokemon.buildImportReport({
    sourceUrls: [{
      href: "https://api.pokemontcg.io/v2/cards?q=set.id:swsh1",
      text: "Pokemon TCG API"
    }]
  });
  assert.equal(report.source_type, catalogSourceTypes.POKEMON_TCG_COMMUNITY_API);
  assert.equal(report.source_trust, catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK);
  assert.equal(report.raw.staging[0].staging.import_status, catalogImportStatuses.COMMUNITY_API_CANDIDATE);
  assert.equal(report.raw.staging[0].staging.identity_fields.card_name, "Celebi V");
  assert.equal(report.raw.staging[0].staging.physical_instance_fields.cert_number, undefined);
}

{
  const scryfall = new ExternalCatalogAdapter({
    provider: "scryfall",
    fetchImpl: async () => new Response(JSON.stringify({
      data: [{
        id: "card-1",
        oracle_id: "oracle-1",
        name: "Black Lotus",
        lang: "en",
        collector_number: "233",
        rarity: "rare",
        set_name: "Limited Edition Alpha",
        type_line: "Artifact",
        image_uris: { normal: "https://img.example/lotus.jpg" }
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  const report = await scryfall.buildImportReport({
    sourceUrls: [{ href: "https://api.scryfall.com/cards/search?q=e:lea", text: "Scryfall Alpha" }]
  });
  assert.equal(report.source_type, catalogSourceTypes.SCRYFALL_COMMUNITY_API);
  assert.equal(report.raw.staging[0].staging.identity_fields.game, "Magic: The Gathering");
  assert.equal(report.raw.staging[0].staging.identity_fields.card_number, "233");
}

{
  const ygoprodeck = new ExternalCatalogAdapter({
    provider: "ygoprodeck",
    fetchImpl: async () => new Response(JSON.stringify({
      data: [{
        id: 46986414,
        name: "Dark Magician",
        type: "Normal Monster",
        archetype: "Dark Magician",
        card_images: [{ image_url: "https://img.example/dark-magician.jpg" }],
        card_sets: [{
          set_name: "Legend of Blue Eyes White Dragon",
          set_code: "LOB-005",
          set_rarity: "Ultra Rare"
        }]
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  const report = await ygoprodeck.buildImportReport({
    sourceUrls: [{ href: "https://db.ygoprodeck.com/api/v7/cardinfo.php?name=Dark%20Magician", text: "YGOPRODeck" }]
  });
  assert.equal(report.source_type, catalogSourceTypes.YGOPRODECK_COMMUNITY_API);
  assert.equal(report.raw.staging[0].staging.identity_fields.manufacturer, "Konami");
  assert.equal(report.raw.staging[0].staging.identity_fields.card_number, "LOB-005");
}

{
  const lorcana = new ExternalCatalogAdapter({
    provider: "lorcast",
    fetchImpl: async () => new Response(JSON.stringify({
      results: [{
        id: "crd_elsa",
        name: "Elsa",
        version: "Spirit of Winter",
        lang: "en",
        collector_number: "207",
        rarity: "Enchanted",
        type: ["Character"],
        classifications: ["Floodborn", "Hero"],
        ink: "Amethyst",
        set: { code: "1", name: "The First Chapter" },
        image_uris: { digital: { large: "https://cards.example/elsa.avif" } }
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  const report = await lorcana.buildImportReport({
    sourceUrls: [{ href: "https://api.lorcast.com/v0/cards/search?q=elsa&unique=prints", text: "Lorcast Elsa" }]
  });
  assert.equal(report.source_type, catalogSourceTypes.LORCANA_COMMUNITY_API);
  assert.equal(report.source_trust, catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK);
  assert.equal(report.raw.staging[0].staging.identity_fields.game, "Lorcana");
  assert.equal(report.raw.staging[0].staging.identity_fields.card_number, "207");
  assert.equal(report.raw.staging[0].staging.identity_fields.checklist_code, "1-207");
}

{
  const discovery = await discoverOfficialCatalogSource({
    provider: "konami_yugioh",
    indexUrl: "https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=1&request_locale=en",
    fetchImpl: async () => new Response(`
      <form action="/yugiohdb/card_search.action"></form>
      <script>fetch("/yugiohdb/card_search.action?ope=2&cid=4007")</script>
    `, { status: 200 })
  });
  assert.equal(discovery.source_type, catalogSourceTypes.KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE);
  assert.ok(discovery.network_endpoint_hints.some((hint) => /card_search\.action/i.test(hint)));
  assert.equal(discovery.policy.marketplace_titles_allowed, false);
}

{
  const discovery = await discoverOfficialCatalogSource({
    provider: "star_wars_unlimited",
    indexUrl: "https://starwarsunlimited.com/cards",
    fetchImpl: async () => new Response(`
      <script>fetch("/api/cards?game=swu")</script>
      <a href="/cards?set=JTL">Jump to Lightspeed Card List</a>
    `, { status: 200 })
  });
  assert.equal(discovery.source_type, catalogSourceTypes.STAR_WARS_UNLIMITED_OFFICIAL_CARDLIST);
  assert.equal(discovery.policy.curated_source_policy.staging_only, true);
  assert.equal(discovery.policy.curated_source_policy.reviewed_internal_auto_promotion, false);
  assert.ok(discovery.network_endpoint_hints.some((hint) => /api\/cards/i.test(hint)));
}

{
  const futera = createOfficialCatalogSourceAdapter({
    provider: "futera",
    fetchImpl: async () => new Response("Base Set Checklist\n7 Lionel Messi, Argentina", {
      status: 200,
      headers: { "content-type": "text/plain" }
    })
  });
  const report = await futera.buildImportReport({
    sourceUrls: [{
      href: "https://www.futera.com/checklists/football-club",
      text: "2025 Futera Football Club Checklist"
    }]
  });
  assert.equal(report.source_type, catalogSourceTypes.FUTERA_OFFICIAL_CHECKLIST);
  assert.equal(report.raw.staging[0].staging.identity_fields.manufacturer, "Futera");
  assert.deepEqual(report.raw.staging[0].staging.identity_fields.players, ["Lionel Messi"]);
}

console.log("official catalog source adapter tests passed");
