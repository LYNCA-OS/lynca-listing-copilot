import assert from "node:assert/strict";
import {
  collectPublicCardImageCandidates,
  formatPublicCardCandidateSummary
} from "./collect-public-card-image-candidates.mjs";
import {
  evaluateAgnesPublicCardImages,
  formatAgnesPublicCardEvalSummary
} from "./evaluate-agnes-public-card-images.mjs";

function jsonResponse(payload, {
  ok = true,
  status = 200
} = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload)
  };
}

const fetchedUrls = [];
const collection = await collectPublicCardImageCandidates({
  targetCount: 2,
  pageSize: 5,
  maxPages: 1,
  fetchImpl: async (url, options = {}) => {
    fetchedUrls.push(String(url));
    assert.equal(options.headers["x-api-key"], "test-key");
    return jsonResponse({
      data: [
        {
          id: "sv1-1",
          name: "Sprigatito",
          supertype: "Pokémon",
          number: "1",
          set: {
            id: "sv1",
            name: "Scarlet & Violet",
            series: "Scarlet & Violet",
            releaseDate: "2023/03/31"
          },
          images: {
            large: "https://images.pokemontcg.io/sv1/1_hires.png",
            small: "https://images.pokemontcg.io/sv1/1.png"
          }
        },
        {
          id: "sv1-1",
          name: "Duplicate",
          supertype: "Pokémon",
          images: {
            large: "https://images.pokemontcg.io/sv1/1_hires.png"
          }
        },
        {
          id: "sv1-2",
          name: "Non card image",
          supertype: "Trainer",
          images: {
            large: "https://images.example/not-used.png"
          }
        },
        {
          id: "sv1-3",
          name: "Floragato",
          supertype: "Pokémon",
          number: "13",
          set: {
            id: "sv1",
            name: "Scarlet & Violet"
          },
          images: {
            large: "https://images.pokemontcg.io/sv1/13_hires.png"
          }
        }
      ],
      page: 1,
      pageSize: 5,
      count: 4,
      totalCount: 4
    });
  },
  env: {
    POKEMON_TCG_API_KEY: "test-key"
  },
  now: () => new Date("2026-06-22T14:00:00.000Z")
});

assert.equal(collection.status, "collected");
assert.equal(collection.collected_count, 2);
assert.equal(collection.items.length, 2);
assert.equal(collection.items[0].category, "pokemon_card");
assert.equal(collection.items[0].reference.card_name, "Sprigatito");
assert.equal(collection.items[0].reference.collector_number, "1");
assert.equal(collection.items[0].commercial_accuracy_eval_eligible, false);
assert.equal(collection.items[0].name_reference_eval_eligible, true);
assert.equal(collection.items[0].source_type, "PUBLIC_STRUCTURED_CARD_DATABASE");
assert.match(fetchedUrls[0], /q=supertype/);

const collectionSummary = formatPublicCardCandidateSummary(collection);
assert.match(collectionSummary, /card_images_only: true/);
assert.match(collectionSummary, /collected_count: 2/);

const evalReport = await evaluateAgnesPublicCardImages({
  dataset: collection,
  limit: 2,
  threshold: 0.95,
  concurrency: 2,
  env: {
    AGNES_API_KEY: "test-key"
  },
  analyzeImpl: async ({ images }) => {
    if (images[0].url.includes("13_hires")) {
      throw Object.assign(new Error("mock provider failure"), {
        code: "mock_failure"
      });
    }
    return {
      model_id: "agnes-2.0-flash",
      parse_source: "content",
      finish_reason: "stop",
      parsed: {
        title: "Sprigatito",
        confidence: "HIGH",
        reason: "visible card name",
        fields: {
          card_name: "Sprigatito",
          set_name: "Scarlet & Violet",
          collector_number: "#1"
        },
        unresolved: []
      },
      usage: {
        provider_calls: 1,
        image_count: 1
      }
    };
  },
  now: () => new Date("2026-06-22T14:01:00.000Z")
});

assert.equal(evalReport.status, "completed");
assert.equal(evalReport.attempted_count, 2);
assert.equal(evalReport.evaluated_count, 1);
assert.equal(evalReport.provider_error_count, 1);
assert.equal(evalReport.card_name_exact_count, 1);
assert.equal(evalReport.card_name_exact_rate, 0.5);
assert.equal(evalReport.structured_reference_name_exact_or_corrected_count, 1);
assert.equal(evalReport.structured_reference_name_exact_or_corrected_rate, 0.5);
assert.equal(evalReport.structured_reference_name_threshold_met, false);
assert.equal(evalReport.name_threshold_met, false);
assert.equal(evalReport.commercial_accuracy_claim_allowed, false);
assert.equal(evalReport.results[0].checks.card_name_exact, true);
assert.equal(evalReport.results[0].structured_reference_name_resolution.status, "EXACT");
assert.equal(evalReport.results[1].checks.card_name_exact, false);

const evalSummary = formatAgnesPublicCardEvalSummary(evalReport);
assert.match(evalSummary, /card_name_exact: 1\/2 \(0.5\)/);
assert.match(evalSummary, /structured_reference_name_exact_or_corrected: 1\/2 \(0.5\)/);
assert.match(evalSummary, /commercial_accuracy_claim_allowed: false/);

const skipped = await evaluateAgnesPublicCardImages({
  dataset: collection,
  env: {},
  analyzeImpl: async () => {
    throw new Error("should not call provider without key");
  },
  now: () => new Date("2026-06-22T14:02:00.000Z")
});

assert.equal(skipped.status, "skipped");
assert.match(skipped.blocked_reason, /AGNES_API_KEY/);

console.log("public card image candidate and Agnes eval tests passed");
