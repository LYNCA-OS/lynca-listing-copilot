import assert from "node:assert/strict";
import { __listingCopilotTitleTestHooks } from "../api/listing-copilot-title.js";

const {
  applyOpenSetAssistShadowPresentationGuard,
  configuredMaxPayloadImages,
  narrowSurfaceColorFromOpenSetParallel
} = __listingCopilotTitleTestHooks;

assert.equal(configuredMaxPayloadImages({}), 14);
assert.equal(configuredMaxPayloadImages({ LISTING_MAX_PAYLOAD_IMAGES: "18" }), 18);
assert.equal(configuredMaxPayloadImages({ LISTING_MAX_PAYLOAD_IMAGES: "0" }), 14);
assert.equal(configuredMaxPayloadImages({ LISTING_MAX_PAYLOAD_IMAGES: "not-a-number" }), 14);

function shadowResult({
  title,
  fields
}) {
  return {
    title,
    final_title: title,
    rendered_title: title,
    title_render_source: "deterministic_renderer",
    confidence: "MEDIUM",
    reason: "No prompt-safe candidates were available.",
    fields,
    resolved: {
      manufacturer: fields.manufacturer || fields.brand || null,
      brand: fields.brand || fields.manufacturer || null,
      product: fields.product || null,
      year: fields.year || null,
      players: fields.players || (fields.player ? [fields.player] : []),
      card_type: fields.card_type || null,
      insert: fields.insert || null,
      surface_color: fields.surface_color || null,
      parallel_family: fields.parallel_family || null,
      parallel_exact: fields.parallel_exact || null,
      parallel: fields.parallel || null,
      variation: fields.variation || null,
      serial_number: fields.serial_number || null,
      collector_number: fields.collector_number || null,
      grade_company: fields.grade_company || null,
      card_grade: fields.card_grade || fields.grade || null,
      rc: fields.rc === true,
      auto: fields.auto === true
    },
    evidence: {},
    unresolved: [],
    fast_path: {
      assist_shadow_only: true,
      reason: "assist_shadow_no_prompt_safe_candidates"
    }
  };
}

assert.equal(narrowSurfaceColorFromOpenSetParallel({
  parallel_exact: "Gold Refractor"
}), "Gold");
assert.equal(narrowSurfaceColorFromOpenSetParallel({
  parallel_exact: "Tiger Stripe"
}), "");

const goldGuarded = applyOpenSetAssistShadowPresentationGuard(shadowResult({
  title: "2025-26 Topps Chrome Dylan Harper Gold Refractor RC 48/50 Auto",
  fields: {
    year: "2025-26",
    manufacturer: "Topps",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Dylan Harper",
    players: ["Dylan Harper"],
    parallel_exact: "Gold Refractor",
    serial_number: "48/50",
    rc: true,
    auto: true
  }
}), { maxTitleLength: 80 });

assert.equal(goldGuarded.open_set_presentation_guard.used, true);
assert.equal(goldGuarded.fields.parallel_exact, null);
assert.equal(goldGuarded.fields.parallel_family, null);
assert.equal(goldGuarded.fields.parallel, null);
assert.equal(goldGuarded.fields.variation, null);
assert.equal(goldGuarded.fields.surface_color, "Gold");
assert.match(goldGuarded.final_title, /\bGold\b/);
assert.doesNotMatch(goldGuarded.final_title, /\bRefractor\b/i);
assert.ok(goldGuarded.unresolved.includes("open-set exact parallel requires catalog or writer review"));

const tigerGuarded = applyOpenSetAssistShadowPresentationGuard(shadowResult({
  title: "2018-19 Panini Prizm Jalen Brunson Tiger Orange RC #250 PSA 9",
  fields: {
    year: "2018-19",
    manufacturer: "Panini",
    brand: "Panini",
    product: "Panini Prizm",
    player: "Jalen Brunson",
    players: ["Jalen Brunson"],
    insert: "Tiger Orange",
    surface_color: "Orange",
    parallel_exact: "Tiger Stripe",
    collector_number: "250",
    grade_company: "PSA",
    card_grade: "9",
    rc: true
  }
}), { maxTitleLength: 80 });

assert.equal(tigerGuarded.open_set_presentation_guard.used, true);
assert.equal(tigerGuarded.fields.surface_color, null);
assert.equal(tigerGuarded.fields.parallel_exact, null);
assert.equal(tigerGuarded.fields.insert, null);
assert.doesNotMatch(tigerGuarded.final_title, /\bTiger\b|\bOrange\b/i);
assert.match(tigerGuarded.final_title, /\bJalen Brunson\b/);
assert.match(tigerGuarded.final_title, /\bPSA 9\b/);

const sapphireGuarded = applyOpenSetAssistShadowPresentationGuard(shadowResult({
  title: "2018-19 Panini Court Kings Heir Apparent Autographs Sapphire Trae Young BGS 10",
  fields: {
    year: "2018-19",
    manufacturer: "Panini",
    brand: "Panini",
    product: "Court Kings",
    player: "Trae Young",
    players: ["Trae Young"],
    insert: "Heir Apparent Autographs Sapphire",
    card_type: "Auto",
    grade_company: "BGS",
    card_grade: "10",
    auto: true
  }
}), { maxTitleLength: 80 });

assert.equal(sapphireGuarded.open_set_presentation_guard.used, true);
assert.equal(sapphireGuarded.fields.insert, "Heir Apparent Autographs");
assert.doesNotMatch(sapphireGuarded.final_title, /\bSapphire\b/i);
assert.match(sapphireGuarded.final_title, /\bHeir Apparent\b/);

const titleOnlySapphireGuarded = applyOpenSetAssistShadowPresentationGuard(shadowResult({
  title: "2018-19 Panini Court Kings Heir Apparent Autographs Sapphire Trae Young BGS 10",
  fields: {
    year: "2018-19",
    manufacturer: "Panini",
    brand: "Panini",
    product: "Court Kings",
    player: "Trae Young",
    players: ["Trae Young"],
    insert: "Heir Apparent Autographs",
    grade_company: "BGS",
    card_grade: "10",
    auto: true
  }
}), { maxTitleLength: 80 });
assert.equal(titleOnlySapphireGuarded.open_set_presentation_guard.used, true);
assert.doesNotMatch(titleOnlySapphireGuarded.final_title, /\bSapphire\b/i);

const chromeSapphireProductGuarded = applyOpenSetAssistShadowPresentationGuard(shadowResult({
  title: "2025-26 Topps Chrome Sapphire Dylan Harper Gold RC 48/50 Auto",
  fields: {
    year: "2025-26",
    manufacturer: "Topps",
    brand: "Topps",
    product: "Topps Chrome Sapphire",
    player: "Dylan Harper",
    players: ["Dylan Harper"],
    surface_color: "Gold",
    serial_number: "48/50",
    rc: true,
    auto: true
  }
}), { maxTitleLength: 80 });
assert.equal(chromeSapphireProductGuarded.open_set_presentation_guard.used, true);
assert.match(chromeSapphireProductGuarded.final_title, /\bTopps Chrome Sapphire\b/);
assert.match(chromeSapphireProductGuarded.final_title, /\bGold\b/);

const noParallel = shadowResult({
  title: "2024 Topps Chrome Caitlin Clark RC #22",
  fields: {
    year: "2024",
    manufacturer: "Topps",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Caitlin Clark",
    players: ["Caitlin Clark"],
    collector_number: "22",
    rc: true
  }
});
const noParallelGuarded = applyOpenSetAssistShadowPresentationGuard(noParallel, { maxTitleLength: 80 });
assert.equal(noParallelGuarded.open_set_presentation_guard.used, false);
assert.equal(noParallelGuarded.final_title, noParallel.final_title);

console.log("open-set presentation guard tests passed");
