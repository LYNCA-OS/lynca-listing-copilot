import assert from "node:assert/strict";
import { evaluateAgnesRealPhotoPilot } from "./evaluate-agnes-real-photo-pilot.mjs";

const dataset = {
  schema_version: "marketplace-real-photo-card-pilot-v1",
  source_policy: "real_marketplace_photos_reference_only",
  items: [
    {
      candidate_id: "ok-wemby",
      source_provider: "test",
      source_type: "MARKETPLACE_REFERENCE",
      trust_tier: "MARKET_REFERENCE",
      source_page_url: "https://example.test/wemby",
      card_image_url: "https://example.test/wemby.jpg",
      reference_title: "2023-24 Panini Prizm Victor Wembanyama #136 Silver Prizm RC",
      reference_fields: {
        year: "2023-24",
        brand: "Panini",
        product: "Prizm",
        players: ["Victor Wembanyama"],
        parallel: "Silver Prizm",
        collector_number: "136",
        rc: true
      },
      critical_fields: ["year", "brand", "product", "players", "parallel", "collector_number", "rc"]
    },
    {
      candidate_id: "bad-color",
      source_provider: "test",
      source_type: "MARKETPLACE_REFERENCE",
      trust_tier: "MARKET_REFERENCE",
      source_page_url: "https://example.test/wemby-gold",
      card_image_url: "https://example.test/wemby-gold.jpg",
      reference_title: "2023-24 Panini Prizm Victor Wembanyama #136 Silver Prizm RC",
      reference_fields: {
        year: "2023-24",
        brand: "Panini",
        product: "Prizm",
        players: ["Victor Wembanyama"],
        parallel: "Silver Prizm",
        collector_number: "136",
        rc: true
      },
      critical_fields: ["year", "brand", "product", "players", "parallel", "collector_number", "rc"]
    },
    {
      candidate_id: "bad-name",
      source_provider: "test",
      source_type: "MARKETPLACE_REFERENCE",
      trust_tier: "MARKET_REFERENCE",
      source_page_url: "https://example.test/ohtani",
      card_image_url: "https://example.test/ohtani.jpg",
      reference_title: "2025 Topps Chrome Shohei Ohtani #1 Refractor",
      reference_fields: {
        year: "2025",
        brand: "Topps",
        product: "Topps Chrome",
        players: ["Shohei Ohtani"],
        parallel: "Refractor",
        collector_number: "1"
      },
      critical_fields: ["year", "brand", "product", "players", "parallel", "collector_number"]
    },
    {
      candidate_id: "storage-ok",
      source_provider: "test",
      source_type: "INTERNAL_APPROVED_HISTORY",
      trust_tier: "INTERNAL",
      source_page_url: "https://example.test/storage",
      storage_object_path: "listing-assets/2026-06-23/storage-ok/front.jpg",
      reference_title: "2025 Topps Chrome Shohei Ohtani #1 Refractor",
      reference_fields: {
        year: "2025",
        brand: "Topps",
        product: "Topps Chrome",
        players: ["Shohei Ohtani"],
        parallel: "Refractor",
        collector_number: "1"
      },
      critical_fields: ["year", "brand", "product", "players", "parallel", "collector_number"]
    }
  ]
};

const seenImages = [];
const report = await evaluateAgnesRealPhotoPilot({
  dataset,
  env: { AGNES_API_KEY: "test-key" },
  analyzeImpl: async ({ images }) => {
    seenImages.push(images[0]);
    const id = images[0].name;
    if (id === "ok-wemby") {
      return {
        parsed: {
          title: "23-24 Prizm Wembanyama #136 Silver RC",
          fields: {
            year: "2023-24",
            brand: "Panini",
            product: "Prizm",
            players: ["Victor Wembanyama"],
            parallel: "Silver Prizm",
            collector_number: "136",
            rc: true
          }
        },
        parse_source: "json",
        model_id: "test-model",
        finish_reason: "stop"
      };
    }
    if (id === "bad-color") {
      return {
        parsed: {
          title: "2023-24 Panini Prizm Victor Wembanyama #136 Gold Wave RC",
          fields: {
            year: "2023-24",
            brand: "Panini",
            product: "Prizm",
            players: ["Victor Wembanyama"],
            parallel: "Gold Wave",
            collector_number: "136",
            rc: true
          }
        },
        parse_source: "json",
        model_id: "test-model",
        finish_reason: "stop"
      };
    }
    if (id === "storage-ok") {
      assert.equal(images[0].url, "https://storage.example.test/signed/front.jpg");
      return {
        parsed: {
          title: "2025 Topps Chrome Shohei Ohtani #1 Refractor",
          fields: {
            year: "2025",
            brand: "Topps",
            product: "Topps Chrome",
            players: ["Shohei Ohtani"],
            parallel: "Refractor",
            collector_number: "1"
          }
        },
        parse_source: "json",
        model_id: "test-model",
        finish_reason: "stop"
      };
    }
    return {
      parsed: {
        title: "2025 Topps Chrome Shohei Otani #1 Refractor",
        fields: {
          year: "2025",
          brand: "Topps",
          product: "Topps Chrome",
          players: ["Shohei Otani"],
          parallel: "Refractor",
          collector_number: "1"
        }
      },
      parse_source: "json",
      model_id: "test-model",
      finish_reason: "stop"
    };
  },
  createSignedReadUrlImpl: async ({ objectPath }) => {
    assert.equal(objectPath, "listing-assets/2026-06-23/storage-ok/front.jpg");
    return "https://storage.example.test/signed/front.jpg";
  },
  now: () => new Date("2026-06-23T00:00:00.000Z")
});

assert.equal(report.status, "completed");
assert.equal(report.commercial_accuracy_claim_allowed, false);
assert.equal(report.marketplace_reference_only, true);
assert.equal(report.controlled_storage_required_for_commercial, true);
assert.equal(report.commercial_input_stability_ready, false);
assert.equal(report.controlled_storage_input_count, 1);
assert.equal(report.external_url_input_count, 3);
assert.equal(report.attempted_count, 4);
assert.equal(report.evaluated_count, 4);
assert.equal(report.title_accepted_count, 2);
assert.equal(report.title_acceptance_evaluated_rate, 0.5);
assert.equal(report.results[0].title_acceptance.accepted, true);
assert.equal(report.results[1].title_acceptance.accepted, false);
assert.ok(report.results[1].title_acceptance.critical_errors.some((error) => error.type === "unexpected_color"));
assert.equal(report.results[2].title_acceptance.accepted, false);
assert.ok(report.results[2].title_acceptance.critical_errors.some((error) => error.field === "players"));
assert.equal(report.results[3].image_input.mode, "controlled_storage_signed_url");
assert.equal(seenImages.length, 4);

console.log("real photo pilot tests passed");
