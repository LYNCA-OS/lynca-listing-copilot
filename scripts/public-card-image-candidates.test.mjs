import assert from "node:assert/strict";
import {
  collectPublicCardImageCandidates,
  formatPublicCardCandidateSummary
} from "./collect-public-card-image-candidates.mjs";

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

console.log("public card image candidate tests passed");
