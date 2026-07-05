import assert from "node:assert/strict";
import {
  cardsightAllowedUsage,
  cardsightForbiddenUsage,
  cardsightSourceTrust,
  createCardsightAdapter,
  normalizeCardsightCatalogSearchResponse,
  normalizeCardsightIdentifyResponse
} from "../lib/listing/external/cardsight-adapter.mjs";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

{
  const adapter = createCardsightAdapter({
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch should not run without a key");
    }
  });
  const result = await adapter.searchCatalog({ observedFields: { year: "2023", product: "Topps Chrome" } });
  assert.equal(result.unavailable, true);
  assert.equal(result.code, "cardsight_missing_api_key");
  assert.doesNotMatch(JSON.stringify(result), /cs_test_secret|cs_identify_secret/);
}

{
  const normalized = normalizeCardsightIdentifyResponse({
    requestId: "req_1",
    detections: [{
      confidence: "High",
      card: {
        id: "card_1",
        setId: "set_1",
        releaseId: "rel_1",
        year: "1997-98",
        manufacturer: "Topps",
        releaseName: "Bowman's Best Basketball",
        setName: "Best Performance",
        name: "Michael Jordan",
        number: "96",
        parallel: {
          id: "par_1",
          name: "Atomic Refractor",
          numberedTo: 100
        }
      },
      grading: {
        company: "PSA",
        grade: "10",
        certNumber: "12345678",
        confidence: "Medium"
      }
    }, {
      confidence: "Medium",
      card: { setId: "set_2", releaseId: "rel_2", name: "Set level only" }
    }, {
      confidence: "Low",
      card: {}
    }]
  }, { segment: "basketball" });
  assert.equal(normalized.raw_match_counts.exact_card, 1);
  assert.equal(normalized.raw_match_counts.set_level, 1);
  assert.equal(normalized.raw_match_counts.no_match, 1);
  assert.equal(normalized.candidates[0].source_trust, cardsightSourceTrust);
  assert.equal(normalized.candidates[0].used_as_truth, false);
  assert.equal(normalized.candidates[0].match_level, "exact_card");
  assert.equal(normalized.candidates[0].external_card_id, "card_1");
  assert.equal(normalized.candidates[0].parallel_candidate.name, "Atomic Refractor");
  assert.equal(normalized.candidates[0].grading_candidate.company, "PSA");
  assert.equal(normalized.candidates[0].grading_candidate.cert_number_present, true);
  assert.equal(normalized.candidates[0].fields.card_grade, undefined);
  assert.equal(normalized.candidates[0].fields.grade_company, undefined);
  assert.equal(normalized.candidates[0].fields.cert_number, undefined);
  assert.equal(normalized.candidates[0].fields.serial_number, undefined);
  assert.deepEqual(normalized.candidates[0].allowed_usage, cardsightAllowedUsage);
  assert.deepEqual(normalized.candidates[0].forbidden_usage, cardsightForbiddenUsage);
}

{
  const key = "cs_test_secret";
  let captured = null;
  const adapter = createCardsightAdapter({
    env: { CARDSIGHTAI_API_KEY: key, CARDSIGHTAI_BASE_URL: "https://example.cardsight.test" },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return response({
        results: [{
          score: "0.91",
          card: {
            id: "card_2",
            setId: "set_2",
            releaseId: "rel_2",
            year: "2023",
            manufacturer: "Panini",
            releaseName: "Prizm Basketball",
            name: "Test Player",
            number: "12"
          }
        }]
      });
    }
  });
  const result = await adapter.searchCatalog({
    observedFields: {
      year: "2023",
      manufacturer: "Panini",
      product: "Prizm",
      players: ["Test Player"],
      collector_number: "12"
    },
    segment: "basketball",
    take: 3
  });
  assert.ok(captured.url.startsWith("https://example.cardsight.test/v1/catalog/search?"));
  assert.equal(captured.init.headers["X-API-Key"], key);
  assert.match(captured.url, /q=2023\+Panini\+Prizm\+Test\+Player\+12/);
  assert.match(captured.url, /take=3/);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source_trust, cardsightSourceTrust);
  assert.equal(result.candidates[0].used_as_truth, false);

  const observedResult = await adapter.searchByObservedFields({
    observedFields: {
      year: "2023",
      manufacturer: "Panini",
      product: "Prizm",
      players: ["Test Player"],
      collector_number: "12"
    },
    segment: "basketball",
    take: 3
  });
  assert.equal(observedResult.candidates.length, 1);
}

{
  let captured = null;
  const adapter = createCardsightAdapter({
    env: { CARDSIGHTAI_API_KEY: "cs_identify_secret", CARDSIGHTAI_BASE_URL: "https://example.cardsight.test" },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return response({ detections: [{ confidence: "High", card: { id: "card_3", setId: "set_3" } }] });
    }
  });
  const result = await adapter.identifyImage({ image: new Uint8Array([1, 2, 3]), segment: "basketball" });
  assert.equal(captured.url, "https://example.cardsight.test/v1/identify/card/basketball");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["X-API-Key"], "cs_identify_secret");
  assert.equal(typeof captured.init.body.get, "function");
  assert.equal(result.candidates[0].match_level, "exact_card");
}

{
  const calls = [];
  const adapter = createCardsightAdapter({
    env: { CARDSIGHTAI_API_KEY: "cs_catalog_secret", CARDSIGHTAI_BASE_URL: "https://example.cardsight.test" },
    fetchImpl: async (url) => {
      calls.push(url);
      return response({
        id: "card_5",
        setId: "set_5",
        releaseId: "rel_5",
        year: "2020",
        manufacturer: "Topps",
        releaseName: "Topps Chrome Basketball",
        name: "Test Player",
        number: "22",
        parallel: {
          id: "gold",
          name: "Gold Refractor",
          numberedTo: 50
        },
        parallels: [{
          id: "purple",
          name: "Purple Refractor",
          numberedTo: 99
        }]
      });
    }
  });
  const card = await adapter.getCard("card_5");
  assert.equal(calls[0], "https://example.cardsight.test/v1/catalog/cards/card_5");
  assert.equal(card.candidate.external_card_id, "card_5");
  assert.equal(card.candidate.fields.product, "Topps Chrome Basketball");
  const parallels = await adapter.getParallels("card_5");
  assert.equal(parallels.parallels.length, 2);
  assert.deepEqual(parallels.parallels.map((parallel) => parallel.name), ["Gold Refractor", "Purple Refractor"]);
}

{
  const result = normalizeCardsightCatalogSearchResponse({
    data: {
      results: [{
        name: "1997-98 Bowman's Best Michael Jordan #96",
        id: "card_4",
        setId: "set_4",
        releaseId: "rel_4"
      }]
    }
  }, { query: "Michael Jordan", segment: "basketball" });
  assert.equal(result.candidates[0].external_card_id, "card_4");
  assert.equal(result.candidates[0].source_trace.query, "Michael Jordan");
}

console.log("CardSight adapter tests passed");
