import assert from "node:assert/strict";
import { __listingCopilotTitleTestHooks } from "../lib/listing/v4/pipeline/native-recognition-core.mjs";

const {
  applyOpenSetAssistShadowPresentationGuard,
  withEvidenceCompatibility,
  boundedPayloadImagesFromImages,
  catalogCandidateHasStrongAnchor,
  catalogStrongCandidateForVectorLazy,
  configuredMaxPayloadImages,
  narrowSurfaceColorFromOpenSetParallel,
  retrievalAnchorSummary,
  retrievalFieldsHavePrePromptVectorAnchor,
  shouldDeferVectorUntilProviderObservation,
  shouldSkipVectorForCatalogContext
} = __listingCopilotTitleTestHooks;

const compatibleVisualHypothesis = withEvidenceCompatibility({
  title: "2025-26 Topps Finest Cooper Flagg Masters Auto Yellow Geometric #/35",
  model_title_suggestion: "2025-26 Topps Finest Cooper Flagg Masters Auto Yellow Geometric #/35",
  confidence: "MEDIUM",
  reason: "visual hypothesis requires writer review",
  fields: {
    year: "2025/26",
    manufacturer: "Topps",
    product: "Topps Finest",
    set: "Masters",
    players: ["Cooper Flagg"],
    surface_color: "Yellow",
    parallel_exact: "Yellow Geometric",
    auto: true
  },
  unresolved: ["parallel_exact"]
}, {
  title: "2025-26 Topps Finest Cooper Flagg Masters Auto Yellow Geometric #/35",
  confidence: "MEDIUM",
  fields: {
    year: "2025/26",
    manufacturer: "Topps",
    product: "Topps Finest",
    set: "Masters",
    players: ["Cooper Flagg"],
    surface_color: "Yellow",
    parallel_exact: "Yellow Geometric",
    auto: true
  },
  field_evidence: [{
    field: "parallel_exact",
    value: "Yellow Geometric",
    source_type: "VISION_ONLY",
    confidence: 0.84,
    review_required: true,
    directly_observed: true
  }],
  unresolved: ["parallel_exact"]
}, {
  images: [{ id: "image-1" }],
  maxTitleLength: 80
});
assert.equal(compatibleVisualHypothesis.raw_provider_fields.parallel_exact, "Yellow Geometric");
assert.equal(compatibleVisualHypothesis.raw_provider_field_evidence.length, 1);
assert.equal(compatibleVisualHypothesis.resolved.parallel_exact, "Yellow Geometric");
assert.equal(compatibleVisualHypothesis.resolved.year, "2025-26");

assert.equal(configuredMaxPayloadImages({}), 14);
assert.equal(configuredMaxPayloadImages({ LISTING_MAX_PAYLOAD_IMAGES: "18" }), 18);
assert.equal(configuredMaxPayloadImages({ LISTING_MAX_PAYLOAD_IMAGES: "1000" }), 24);
assert.equal(configuredMaxPayloadImages({ LISTING_MAX_PAYLOAD_IMAGES: "0" }), 14);
assert.equal(configuredMaxPayloadImages({ LISTING_MAX_PAYLOAD_IMAGES: "not-a-number" }), 14);
assert.equal(configuredMaxPayloadImages({ LISTING_MAX_PAYLOAD_IMAGES: "1" }), 2);

const strongCatalogCandidate = {
  candidate_id: "catalog-96",
  candidate_identity_id: "identity-96",
  source_trust: "APPROVED_REFERENCE",
  supporting_fields: ["collector_number", "subject", "product"],
  fields: {
    year: "1997-98",
    product: "Bowman's Best",
    subjects: ["Michael Jordan"],
    collector_number: "96"
  },
  conflicting_fields: []
};
const strongCatalogContext = {
  promptPacket: true,
  catalog_assist_eligibility: {
    prompt_candidate_count: 1
  },
  assistPacket: {
    vector_retrieval: {
      candidates: [strongCatalogCandidate]
    }
  }
};
assert.equal(catalogCandidateHasStrongAnchor(strongCatalogCandidate, {}), true);
assert.equal(catalogStrongCandidateForVectorLazy(strongCatalogContext, {})?.candidate_id, "catalog-96");
assert.equal(shouldSkipVectorForCatalogContext({
  catalogContext: strongCatalogContext,
  resolvedForRetrieval: { player: "Michael Jordan", product: "Bowman's Best" },
  providerOptions: { enable_vector_assist: true },
  env: {}
}).skip, true);
assert.equal(shouldSkipVectorForCatalogContext({
  catalogContext: {
    ...strongCatalogContext,
    catalog_assist_eligibility: { prompt_candidate_count: 2 },
    assistPacket: {
      vector_retrieval: {
        candidates: [strongCatalogCandidate, { ...strongCatalogCandidate, candidate_id: "catalog-97" }]
      }
    }
  },
  providerOptions: { enable_vector_assist: true },
  env: {}
}).skip, false, "multi-candidate catalog matches should still allow vector assist");
assert.equal(catalogCandidateHasStrongAnchor({
  ...strongCatalogCandidate,
  conflicting_fields: ["year"]
}, {}), false, "direct catalog conflicts must fail closed");
assert.equal(catalogCandidateHasStrongAnchor({
  ...strongCatalogCandidate,
  supporting_fields: ["subject"],
  fields: { subjects: ["Michael Jordan"] }
}, {}), false, "weak subject-only catalog candidates should not skip vector");

assert.deepEqual(retrievalAnchorSummary({}).anchors, []);
assert.equal(retrievalFieldsHavePrePromptVectorAnchor({}), false);
assert.equal(shouldDeferVectorUntilProviderObservation({
  providerOptions: {
    enable_vector_assist: true,
    force_vector_assist: true,
    enable_vector_lazy_mode: false
  },
  resolvedForRetrieval: {},
  env: {}
}), true, "forced vector must wait for provider observations when no query anchors exist");
assert.equal(shouldDeferVectorUntilProviderObservation({
  providerOptions: {
    enable_vector_assist: true,
    force_vector_assist: true,
    enable_vector_lazy_mode: false
  },
  resolvedForRetrieval: {
    year: "2018-19",
    product: "Panini Encased",
    players: ["Jaren Jackson Jr."]
  },
  env: {}
}), true, "non-final pre-prompt anchors must be rebound after provider observation");
assert.equal(retrievalFieldsHavePrePromptVectorAnchor({ collector_number: "202" }), true);

assert.equal(shouldDeferVectorUntilProviderObservation({
  catalogContext: {
    promptPacket: true,
    catalog_assist_eligibility: {
      prompt_candidate_count: 0,
      field_support_count: 3
    },
    assistPacket: {
      vector_retrieval: {
        candidates: [],
        field_support: [
          { field: "product", value: "Panini Status" },
          { field: "year", value: "2018-19" },
          { field: "player", value: "Trae Young" }
        ]
      }
    }
  },
  providerOptions: { enable_vector_assist: true, enable_vector_lazy_mode: true },
  env: {}
}), true, "field-support-only catalog packets must not block post-observation vector retrieval");
assert.equal(shouldDeferVectorUntilProviderObservation({
  catalogContext: strongCatalogContext,
  lazyDecision: { skip: true, reason: "strong_catalog_anchor" },
  providerOptions: { enable_vector_assist: true, enable_vector_lazy_mode: true },
  env: {}
}), false, "only a vetted strong catalog anchor may satisfy vector lazy mode");
assert.equal(shouldDeferVectorUntilProviderObservation({
  catalogContext: strongCatalogContext,
  lazyDecision: { skip: false },
  providerOptions: { enable_vector_assist: true, enable_vector_lazy_mode: true },
  env: {}
}), true, "an unvetted prompt candidate must not suppress post-observation convergence");
assert.equal(shouldDeferVectorUntilProviderObservation({
  providerOptions: { enable_catalog_assist: true, enable_vector_assist: false },
  env: {}
}), true, "catalog-only mode still needs a post-observation identity lookup");

const oversizedPayloadBatch = boundedPayloadImagesFromImages([
  { id: "front" },
  { id: "back" },
  ...Array.from({ length: 20 }, (_, index) => ({ id: `crop-${index}`, derived: true }))
], { maxImages: 14 });
assert.equal(oversizedPayloadBatch.ok, true);
assert.equal(oversizedPayloadBatch.images.length, 14);
assert.equal(oversizedPayloadBatch.primary_image_count, 2);
assert.equal(oversizedPayloadBatch.deferred_image_count, 8);
assert.deepEqual(oversizedPayloadBatch.images.slice(0, 2).map((image) => image.id), ["front", "back"]);

const tooManyPrimaryPayloadBatch = boundedPayloadImagesFromImages([
  { id: "front" },
  { id: "back" },
  { id: "third-primary" }
], { maxImages: 14 });
assert.equal(tooManyPrimaryPayloadBatch.ok, true);
assert.deepEqual(tooManyPrimaryPayloadBatch.images.map((image) => image.id), ["front", "back", "third-primary"]);
assert.equal(tooManyPrimaryPayloadBatch.deferred_image_count, 0);

const mislabeledDerivedPayloadBatch = boundedPayloadImagesFromImages([
  { id: "image-1", role: "image_1_original" },
  { id: "image-2", role: "image_2_original" },
  { id: "serial-crop", role: "serial_crop" },
  { id: "grade-crop", capture_angle: "grade_label_crop" }
], { maxImages: 3 });
assert.equal(mislabeledDerivedPayloadBatch.ok, true);
assert.deepEqual(mislabeledDerivedPayloadBatch.images.map((image) => image.id), ["image-1", "image-2", "serial-crop"]);
assert.equal(mislabeledDerivedPayloadBatch.deferred_image_count, 1);

function shadowResult({
  title,
  fields,
  evidence = {},
  fieldStates = []
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
    evidence,
    field_states: fieldStates,
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

const visualHypothesisGuarded = applyOpenSetAssistShadowPresentationGuard({
  ...shadowResult({
    title: "2025-26 Topps Finest Cooper Flagg Masters Auto Gold #/35",
    fields: {
      year: "2025-26",
      manufacturer: "Topps",
      brand: "Topps",
      product: "Topps Finest",
      set: "Masters",
      player: "Cooper Flagg",
      players: ["Cooper Flagg"],
      surface_color: "Yellow",
      auto: true
    }
  }),
  raw_provider_fields: {
    year: "2025-26",
    product: "Topps Finest",
    set: "Masters",
    players: ["Cooper Flagg"],
    surface_color: "Yellow",
    parallel_exact: "Yellow Geometric"
  },
  raw_provider_field_evidence: [{
    field: "parallel_exact",
    value: "Yellow Geometric",
    source_type: "VISION_ONLY",
    source_image_id: "image-1",
    source_region: "parallel_surface",
    visible_text: "Yellow geometric surface pattern",
    confidence: 0.84,
    review_required: true,
    directly_observed: true,
    direct_observation: true
  }]
}, { maxTitleLength: 80 });

assert.equal(visualHypothesisGuarded.open_set_presentation_guard.used, true);
assert.equal(visualHypothesisGuarded.open_set_presentation_guard.action, "kept_visual_parallel_in_writer_presentation_only");
assert.equal(visualHypothesisGuarded.fields.parallel_exact, null, "visual hypotheses must not enter identity fields");
assert.equal(visualHypothesisGuarded.resolved.parallel_exact, null, "visual hypotheses must not enter resolved identity");
assert.equal(visualHypothesisGuarded.rendered_fields.parallel_exact, "Yellow Geometric");
assert.equal(visualHypothesisGuarded.writer_review_suggestions.parallel_exact.value, "Yellow Geometric");
assert.match(visualHypothesisGuarded.final_title, /\bYellow Geometric\b/i);
assert.equal(visualHypothesisGuarded.modules.print_finish.status, "REVIEW");
assert.equal(visualHypothesisGuarded.modules.print_finish.requires_review, true);

const oracleVisualHypothesisGuarded = applyOpenSetAssistShadowPresentationGuard({
  ...visualHypothesisGuarded,
  evaluation_profile: "v4_accuracy_ceiling_oracle_v1",
  title: "2025-26 Topps Finest Cooper Flagg Yellow Geometric",
  final_title: "2025-26 Topps Finest Cooper Flagg Yellow Geometric",
  rendered_title: "2025-26 Topps Finest Cooper Flagg Yellow Geometric"
}, { maxTitleLength: 80, evaluation_profile: "v4_accuracy_ceiling_oracle_v1" });
assert.equal(oracleVisualHypothesisGuarded.open_set_presentation_guard.action, "kept_visual_parallel_as_review_metadata_only");
assert.equal(oracleVisualHypothesisGuarded.writer_review_suggestions.parallel_exact.value, "Yellow Geometric");
assert.doesNotMatch(oracleVisualHypothesisGuarded.final_title, /Geometric/i, "Oracle title must not consume writer review suggestions");
assert.equal(oracleVisualHypothesisGuarded.rendered_fields.parallel_exact, null);

const finalizerDoesNotResurrectRejectedFacsimileAuto = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation({
  title: "2025 Topps Chrome Shohei Ohtani",
  confidence: "HIGH",
  raw_provider_fields: {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    auto: true,
    observable_components: ["auto"]
  },
  resolved_fields: {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    auto: false,
    observable_components: []
  },
  provider_field_rejections: [{
    field: "auto",
    value: true,
    reason: "auto_not_directly_supported_by_current_image"
  }]
}, { maxTitleLength: 80 });
assert.equal(finalizerDoesNotResurrectRejectedFacsimileAuto.resolved_fields.auto, false);
assert.doesNotMatch(finalizerDoesNotResurrectRejectedFacsimileAuto.title, /\bAuto\b/i);

const weakVisualHypothesisGuarded = applyOpenSetAssistShadowPresentationGuard({
  ...shadowResult({
    title: "2025-26 Topps Finest Cooper Flagg Yellow Geometric",
    fields: {
      year: "2025-26",
      product: "Topps Finest",
      player: "Cooper Flagg",
      players: ["Cooper Flagg"]
    }
  }),
  raw_provider_fields: {
    year: "2025-26",
    product: "Topps Finest",
    players: ["Cooper Flagg"],
    parallel_exact: "Yellow Geometric"
  },
  raw_provider_field_evidence: [{
    field: "parallel_exact",
    value: "Yellow Geometric",
    source_type: "VISION_ONLY",
    confidence: 0.79,
    review_required: true,
    directly_observed: true
  }]
}, { maxTitleLength: 80 });
assert.equal(weakVisualHypothesisGuarded.writer_review_suggestions?.parallel_exact, undefined);
assert.doesNotMatch(weakVisualHypothesisGuarded.final_title, /\bGeometric\b/i);

const referenceOnlyHypothesisGuarded = applyOpenSetAssistShadowPresentationGuard({
  ...shadowResult({
    title: "2025-26 Topps Finest Cooper Flagg Yellow Geometric",
    fields: {
      year: "2025-26",
      product: "Topps Finest",
      player: "Cooper Flagg",
      players: ["Cooper Flagg"]
    }
  }),
  raw_provider_fields: {
    product: "Topps Finest",
    parallel_exact: "Yellow Geometric"
  },
  raw_provider_field_evidence: [{
    field: "parallel_exact",
    value: "Yellow Geometric",
    source_type: "STRUCTURED_DATABASE",
    confidence: 0.99,
    review_required: true,
    directly_observed: true
  }]
}, { maxTitleLength: 80 });
assert.equal(referenceOnlyHypothesisGuarded.writer_review_suggestions?.parallel_exact, undefined);
assert.doesNotMatch(referenceOnlyHypothesisGuarded.final_title, /\bGeometric\b/i, "catalog/reference evidence must not masquerade as a current-image visual suggestion");

const directSupportedParallel = applyOpenSetAssistShadowPresentationGuard(shadowResult({
  title: "2024 Pokemon Darkrai Holo PSA 10",
  fields: {
    year: "2024",
    brand: "Pokemon",
    product: "Pokemon",
    character: "Darkrai",
    parallel: "Holo",
    grade_company: "PSA",
    card_grade: "10"
  },
  fieldStates: [
    {
      field: "parallel",
      resolved_value: "Holo",
      supporting_sources: [
        { source: "SLAB_LABEL", value: "Holo", direct_observation: true }
      ]
    }
  ]
}), { maxTitleLength: 80 });
assert.equal(directSupportedParallel.open_set_presentation_guard.used, false);
assert.equal(directSupportedParallel.open_set_presentation_guard.action, "direct_parallel_evidence_preserved");
assert.equal(directSupportedParallel.fields.parallel, "Holo");
assert.match(directSupportedParallel.final_title, /\bHolo\b/i);

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
