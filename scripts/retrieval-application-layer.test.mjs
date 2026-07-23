import assert from "node:assert/strict";
import {
  applyIdentityResolutionGate,
  applyIdentityResolutionGateWithConvergence
} from "../lib/identity-resolution/listing-resolution-gate.mjs";
import { buildCandidateSelectionPass } from "../lib/listing/candidates/candidate-selection-pass.mjs";
import {
  buildRetrievalApplicationLayer,
  finalizeRetrievalApplicationOutcome
} from "../lib/listing/candidates/retrieval-application-layer.mjs";
import { __listingCopilotTitleTestHooks } from "../lib/listing/v4/pipeline/native-recognition-core.mjs";

function packet(candidates = [], promptCandidateIds = []) {
  return {
    vector_retrieval: {
      status: "ok",
      candidates,
      assist_filter: {
        raw_candidate_count: candidates.length,
        approved_candidate_count: candidates.length,
        prompt_candidate_count: promptCandidateIds.length,
        prompt_candidate_ids: promptCandidateIds
      }
    }
  };
}

function trustedCatalogCandidate(overrides = {}) {
  return {
    candidate_id: "catalog-exact",
    candidate_identity_id: "identity-exact",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "REVIEWED_INTERNAL",
    match_score: 0.92,
    anchor_agreement: {
      exact_code_match: true,
      prompt_hard_filter_pass: true,
      agreed: ["collector_number", "subjects", "product_hierarchy", "year"],
      contradicted: []
    },
    reference_metadata: {
      corrected_title_is_reviewed_title_ground_truth: true
    },
    fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Chrome",
      players: ["Test Player"],
      card_name: "Autograph",
      collector_number: "CPA-TP",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
    },
    ...overrides
  };
}

function resultWithCandidate(candidate = trustedCatalogCandidate()) {
  return {
    resolved_fields: {
      year: "2024",
      players: ["Test Player"],
      collector_number: "CPA-TP"
    },
    catalog_candidate_packet: packet([candidate], [candidate.candidate_id])
  };
}

function buildLayer(result, enabled = true) {
  const control = buildCandidateSelectionPass({ result });
  const application = buildRetrievalApplicationLayer({ result, candidateControl: control, enabled });
  return { control, application };
}

function testSelectedCandidateBecomesFieldEvidenceWithoutCopyingInstanceFields() {
  const result = resultWithCandidate();
  const { control, application } = buildLayer(result);
  assert.equal(control.selected_candidate_decision.selected_candidate_id, "catalog-exact");
  assert.ok(control.candidate_field_inventory.some((row) => row.field_name === "card_grade"));

  const product = application.decisions.find((row) => row.field === "product");
  const cardName = application.decisions.find((row) => row.field === "card_name");
  const year = application.decisions.find((row) => row.field === "year");
  const grade = application.decisions.find((row) => row.field === "card_grade");
  const cert = application.decisions.find((row) => row.field === "cert_number");
  assert.equal(product.decision, "APPLY");
  assert.equal(cardName.decision, "APPLY");
  assert.equal(year.decision, "SUPPORT");
  assert.equal(grade.decision, "BLOCK");
  assert.equal(cert.decision, "BLOCK");
  assert.ok(application.identity_evidence_items.some((item) => item.field === "product"));
  assert.equal(application.identity_evidence_items.some((item) => item.field === "card_grade"), false);
  assert.equal(application.identity_evidence_items.every((item) => item.metadata.candidate_is_evidence_not_truth === true), true);
}

function testVectorReferenceCanSupportButCannotFillMissingIdentity() {
  const vector = trustedCatalogCandidate({
    candidate_id: "vector-approved",
    source_type: "VISUAL_VECTOR",
    source_trust: "APPROVED_REFERENCE"
  });
  const result = {
    resolved_fields: {
      year: "2024",
      players: ["Test Player"],
      collector_number: "CPA-TP"
    },
    vector_candidate_packet: packet([vector], ["vector-approved"])
  };
  const { application } = buildLayer(result);
  const year = application.decisions.find((row) => row.field === "year");
  const product = application.decisions.find((row) => row.field === "product");
  assert.equal(year.decision, "SUPPORT");
  assert.equal(product.decision, "BLOCK");
  assert.equal(application.identity_evidence_items.some((item) => item.field === "product"), false);
  assert.equal(application.identity_evidence_items.find((item) => item.field === "year")?.source, "VECTOR_APPROVED_REFERENCE");
}

function testCandidateResolvedShapeStillProducesFieldEvidence() {
  const base = trustedCatalogCandidate();
  const candidate = {
    ...base,
    fields: undefined,
    resolved: base.fields
  };
  const result = resultWithCandidate(candidate);
  const { control, application } = buildLayer(result);
  assert.ok(control.candidate_field_inventory.some((row) => row.field_name === "product"));
  assert.equal(application.decisions.find((row) => row.field === "product")?.decision, "APPLY");
}

function testCandidateFieldShapesMergeWithoutDroppingEvidence() {
  const candidate = trustedCatalogCandidate({
    identity: {
      manufacturer: "Topps",
      product: "Topps Chrome"
    },
    resolved: {
      card_name: "Autograph",
      collector_number: "CPA-TP"
    },
    fields: {
      year: "2024",
      players: ["Test Player"],
      product: "Topps Chrome Basketball"
    }
  });
  const result = resultWithCandidate(candidate);
  const { control } = buildLayer(result);
  const inventory = control.candidate_field_inventory
    .filter((row) => row.candidate_id === "catalog-exact");
  assert.ok(inventory.some((row) => row.field_name === "manufacturer"));
  assert.ok(inventory.some((row) => row.field_name === "card_name"));
  assert.equal(inventory.find((row) => row.field_name === "product")?.value, "Topps Chrome Basketball");
}

function testEveryCandidateProducesAuditableDecisionRows() {
  const selected = trustedCatalogCandidate();
  const rejected = trustedCatalogCandidate({
    candidate_id: "catalog-other",
    candidate_identity_id: "identity-other",
    fields: {
      year: "2023",
      product: "Panini Prizm",
      players: ["Other Player"],
      card_grade: "9"
    },
    anchor_agreement: {
      prompt_hard_filter_pass: false,
      agreed: [],
      contradicted: ["year", "players", "product_hierarchy"]
    }
  });
  const result = {
    ...resultWithCandidate(selected),
    catalog_candidate_packet: packet([selected, rejected], [selected.candidate_id])
  };
  const { application } = buildLayer(result);
  const rejectedRows = application.decisions.filter((row) => row.candidate_id === "catalog-other");
  assert.ok(rejectedRows.length >= 4);
  assert.ok(rejectedRows.some((row) => row.field === "card_grade" && row.decision === "REJECT"));
  assert.equal(rejectedRows.every((row) => row.decision === "REJECT"), true);
  for (const row of application.decisions) {
    assert.ok(row.candidate_id);
    assert.ok(row.field);
    assert.ok(Object.hasOwn(row, "old_value"));
    assert.ok(Object.hasOwn(row, "candidate_value"));
    assert.ok(Number.isFinite(row.confidence));
    assert.ok(row.source);
    assert.ok(["APPLY", "SUPPORT", "BLOCK", "REJECT"].includes(row.decision));
  }
}

function testDisabledLayerRejectsAllCandidateFieldsAndBlocksRawBypass() {
  const result = resultWithCandidate();
  const { application } = buildLayer(result, false);
  assert.equal(application.identity_evidence_items.length, 0);
  assert.equal(application.decisions.every((row) => row.decision === "REJECT"), true);

  const gated = applyIdentityResolutionGate({
    ...result,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  }, {
    retrievalCandidates: [{
      candidate_id: "raw-bypass",
      source_type: "OFFICIAL_CHECKLIST",
      match_score: 1,
      fields: {
        year: "1999",
        product: "Wrong Product",
        players: ["Wrong Player"]
      }
    }]
  });
  assert.notEqual(gated.identity_resolution?.identity?.product, "Wrong Product");
  assert.notDeepEqual(gated.identity_resolution?.identity?.players, ["Wrong Player"]);
}

function testIdentityResolutionConsumesRetrievalFieldEvidence() {
  const result = resultWithCandidate();
  const { control, application } = buildLayer(result);
  const gated = applyIdentityResolutionGate({
    ...result,
    ...control,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  });
  assert.equal(gated.identity_resolution?.identity?.product, "Topps Chrome");
  assert.equal(gated.identity_resolution?.identity?.card_name, "Autograph");
  assert.equal(gated.retrieval_application?.resolver_consumed, true);
  assert.ok(gated.retrieval_application?.actual_applied_fields.includes("product"));
  assert.equal(gated.candidate_decision_stage?.application_owner, "retrieval_application_layer");
  assert.ok(gated.candidate_application_trace
    ?.find((trace) => trace.candidate_id === "catalog-exact")
    ?.applied_fields.includes("product"));
}

function testSingleModelFastPathConsumesAlreadyRetrievedFieldEvidence() {
  const result = resultWithCandidate();
  const gated = __listingCopilotTitleTestHooks.singleModelDraftPath(result, {
    maxTitleLength: 80,
    provider_options: {
      enable_evidence_completion: false,
      enable_retrieval_application: true,
      enable_catalog_assist: true
    }
  }, "openai");

  assert.equal(gated.resolved_fields.product, "Topps Chrome");
  assert.equal(gated.resolved_fields.card_name, "Autograph");
  assert.equal(gated.retrieval_application?.resolver_consumed, true);
  assert.ok(gated.retrieval_application?.actual_applied_fields.includes("product"));
  assert.equal(gated.retrieval_application?.actual_applied_fields.includes("card_grade"), false);
  assert.equal(gated.retrieval_application?.actual_applied_fields.includes("cert_number"), false);
}

async function testAssistShadowPathKeepsRetrievedContextForFieldApplication() {
  const candidate = trustedCatalogCandidate();
  const result = {
    resolved_fields: {
      year: "2024",
      players: ["Test Player"],
      collector_number: "CPA-TP"
    }
  };
  const gated = await __listingCopilotTitleTestHooks.withEvidenceCompletionShadow(result, {
    maxTitleLength: 80,
    provider_options: {
      enable_evidence_completion: false,
      enable_assist_shadow_evidence_completion: false,
      enable_retrieval_application: true,
      enable_catalog_assist: true
    }
  }, {
    catalogContext: {
      packet: packet([candidate], [candidate.candidate_id])
    },
    vectorContext: {},
    providerId: "openai"
  });

  assert.equal(gated.resolved_fields.product, "Topps Chrome");
  assert.equal(gated.resolved_fields.card_name, "Autograph");
  assert.equal(gated.retrieval_application?.resolver_consumed, true);
  assert.ok(gated.retrieval_application?.actual_applied_fields.includes("product"));
  assert.equal(gated.retrieval_application?.actual_applied_fields.includes("card_grade"), false);
  assert.equal(gated.retrieval_application?.actual_applied_fields.includes("cert_number"), false);
  assert.equal(gated.fast_path?.assist_shadow_only, true);
}

function testRawRetrievalEvidenceCannotBypassApplicationOwner() {
  const selected = trustedCatalogCandidate({
    fields: {
      year: "2025",
      manufacturer: "Topps",
      product: "Topps Chrome Sapphire",
      players: ["Shohei Ohtani"]
    }
  });
  const result = resultWithCandidate(selected);
  result.resolved_fields = {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Sapphire",
    players: ["Shohei Ohtani"]
  };
  const { control, application } = buildLayer(result);
  assert.equal(application.decisions.find((row) => row.field === "product")?.decision, "BLOCK");

  const directSource = {
    source_type: "SLAB_LABEL",
    observed_text: "2025 TOPPS SAPPHIRE",
    raw_text: "2025 TOPPS SAPPHIRE",
    evidence_kind: "PRODUCT_TEXT",
    direct_observation: true,
    trust_tier: 1
  };
  const leakedCandidateSource = {
    source_type: "STRUCTURED_DATABASE",
    source_url: "supabase://catalog-cards/unselected-platinum",
    domain: "supabase-catalog",
    title: "2025 Topps Chrome Platinum Shohei Ohtani",
    evidence_kind: "catalog_identity_field_lock",
    trust_tier: 4
  };
  const gated = applyIdentityResolutionGate({
    ...result,
    ...control,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {
      product: {
        value: "Topps Sapphire",
        status: "CONFLICT",
        confidence: 0.5,
        candidates: [
          { value: "Topps Sapphire", confidence: 0.95, sources: [directSource] },
          { value: "Topps Chrome Platinum", confidence: 0.86 },
          { value: "Topps Chrome Platinum", confidence: 0.86 }
        ],
        sources: [directSource, leakedCandidateSource, leakedCandidateSource],
        conflicts: [{
          field: "product",
          existing_value: "Topps Sapphire",
          candidate_value: "Topps Chrome Platinum",
          reason: "independent trusted retrieval candidates disagree"
        }]
      }
    }
  });

  assert.notEqual(gated.identity_resolution?.identity?.product, "Topps Chrome Platinum");
  assert.equal(gated.identity_resolution?.identity?.product, "Topps Sapphire");
  assert.equal(gated.retrieval_evidence_isolation?.enabled, true);
  assert.ok(gated.retrieval_evidence_isolation?.blocked_raw_candidate_evidence_count >= 1);
  assert.equal(gated.retrieval_application?.actual_applied_fields.includes("product"), false);
}

function testResolvedRetrievalOutcomeOwnsRenderedFieldContainer() {
  const result = {
    ...resultWithCandidate(),
    rendered_fields: {
      title: "2024 Test Player",
      fields: {
        year: "2024",
        players: ["Test Player"],
        collector_number: "CPA-TP"
      }
    }
  };
  const { control, application } = buildLayer(result);
  const gated = applyIdentityResolutionGate({
    ...result,
    ...control,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  });

  assert.equal(gated.resolved_fields.product, "Topps Chrome");
  assert.equal(gated.rendered_fields.fields.product, "Topps Chrome");
  assert.equal(gated.rendered_fields.fields.card_name, "Autograph");
  assert.match(gated.rendered_fields.rendered_title, /Topps Chrome/);
}

function testSelectedTrustedVariantRequiresExactCardIdentity() {
  const candidate = trustedCatalogCandidate({
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    anchor_agreement: {
      exact_code_match: false,
      prompt_hard_filter_pass: true,
      agreed: ["year", "subjects", "manufacturer", "product_hierarchy", "serial_denominator"],
      contradicted: []
    },
    fields: {
      year: "2025",
      manufacturer: "Topps",
      product: "Topps Chrome Tennis",
      players: ["Test Player"],
      card_name: "Lucky Hyper",
      surface_color: "Gold",
      parallel_family: "Geometric",
      numbered_to: "50",
      serial_denominator: "50"
    }
  });
  const result = resultWithCandidate(candidate);
  result.resolved_fields = {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Chrome Tennis",
    players: ["Test Player"],
    surface_color: "Green",
    collector_number: "CPA-TP",
    serial_number: "16/50",
    serial_denominator: "50"
  };
  const { control, application } = buildLayer(result);
  assert.notEqual(application.decisions.find((row) => row.field === "surface_color")?.decision, "APPLY");
  assert.notEqual(application.decisions.find((row) => row.field === "parallel_family")?.decision, "APPLY");

  const gated = applyIdentityResolutionGate({
    ...result,
    ...control,
    provider: "openai_legacy",
    candidate_observation_snapshot: {
      player: "Test Player"
    },
    raw_provider_fields: {
      ...result.resolved_fields,
      surface_color: "Green"
    },
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  });

  assert.equal(gated.resolved_fields.surface_color, "Green");
  assert.equal(gated.resolved_fields.parallel_family ?? null, null);
  assert.deepEqual(gated.resolved_fields.players, ["Test Player"]);
  assert.equal(gated.resolved_fields.card_name ?? null, null);
  assert.match(gated.final_title, /Test Player/);
  assert.doesNotMatch(gated.final_title, /Lucky Hyper|Gold|Geometric/);
  assert.match(gated.final_title, /Green/);
  assert.equal(gated.draft_gate.by_field.surface_color.draft_source_override, "PRIMARY_FAST_VISION_CONFLICT_REVIEW");
}

function testSelectedTrustedProductSpecificitySurvivesRawVisionDraftFallback() {
  for (const [observedProduct, catalogProduct, observedManufacturer, catalogManufacturer, sameSource] of [
    ["Topps Signature", "Topps Signature Class", "Topps", "Topps", false],
    ["Topps Chrome", "Topps Chrome UFC", "Topps", "Topps", false],
    ["Topps Chrome", "Bowman University Chrome", "Topps", "Topps", true],
    ["Topps", "Bowman University Chrome", "Topps", "Topps", true],
    ["Metal", "Leaf Metal Draft", "Leaf Trading Cards", "Leaf", true]
  ]) {
    const candidate = trustedCatalogCandidate({
      source_type: "INTERNAL_APPROVED_HISTORY",
      source_trust: "APPROVED_REFERENCE",
      source_feedback_id: sameSource ? "reviewed-source-1" : null,
      reference_metadata: {
        corrected_title_is_reviewed_title_ground_truth: true,
        prompt_safe_internal_writer_title: true,
        source_feedback_id: sameSource ? "reviewed-source-1" : null
      },
      anchor_agreement: {
        exact_code_match: false,
        prompt_hard_filter_pass: true,
        agreed: ["year", "subjects", "manufacturer", "product_hierarchy"],
        contradicted: []
      },
      fields: {
        year: "2025",
        manufacturer: catalogManufacturer,
        product: catalogProduct,
        players: ["Test Player"]
      }
    });
    const result = resultWithCandidate(candidate);
    if (sameSource) result.source_feedback_id = "reviewed-source-1";
    result.resolved_fields = {
      year: "2025",
      manufacturer: observedManufacturer,
      product: observedProduct,
      players: ["Test Player"]
    };
    const { control, application } = buildLayer(result);
    const expectedProduct = sameSource ? catalogProduct : observedProduct;
    assert.equal(
      application.decisions.find((row) => row.field === "product")?.decision,
      sameSource ? "APPLY" : "BLOCK",
      `${observedProduct} may only upgrade to ${catalogProduct} for the exact reviewed source`
    );

    const gated = applyIdentityResolutionGate({
      ...result,
      ...control,
      provider: "openai_legacy",
      candidate_observation_snapshot: {
        year: "2025",
        manufacturer: observedManufacturer,
        product: observedProduct,
        players: ["Test Player"]
      },
      raw_provider_fields: {
        year: "2025",
        manufacturer: observedManufacturer,
        product: observedProduct,
        players: ["Test Player"]
      },
      retrieval_application: application,
      resolved: result.resolved_fields,
      evidence: {}
    });

    assert.equal(gated.resolved_fields.product, expectedProduct);
    assert.equal(gated.retrieval_application?.actual_applied_fields.includes("product"), sameSource);
    const renderedProduct = expectedProduct === "Leaf Metal Draft" ? "Metal Draft" : expectedProduct;
    assert.match(gated.final_title, new RegExp(renderedProduct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}

function testSelectedApplySurvivesShortPrintedIdentityConflict() {
  const candidate = trustedCatalogCandidate({
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    source_feedback_id: "reviewed-source-vision-conflict",
    reference_metadata: {
      corrected_title_is_reviewed_title_ground_truth: true,
      prompt_safe_internal_writer_title: true,
      source_feedback_id: "reviewed-source-vision-conflict"
    },
    anchor_agreement: {
      exact_code_match: false,
      prompt_hard_filter_pass: true,
      agreed: ["year", "subjects", "manufacturer", "product_hierarchy"],
      contradicted: []
    },
    fields: {
      year: "2025-26",
      manufacturer: "Topps",
      product: "Bowman University Chrome",
      players: ["Sienna Betts"],
      card_name: "Anime"
    }
  });
  const result = {
    ...resultWithCandidate(candidate),
    source_feedback_id: "reviewed-source-vision-conflict",
    resolved_fields: {
      year: "2025",
      manufacturer: "Topps",
      product: "Topps",
      players: ["Sienna Betts"],
      card_name: "BETTS"
    }
  };
  const { control, application } = buildLayer(result);
  assert.equal(application.decisions.find((row) => row.field === "year")?.decision, "APPLY");
  assert.equal(application.decisions.find((row) => row.field === "product")?.decision, "APPLY");
  assert.equal(application.decisions.find((row) => row.field === "card_name")?.decision, "APPLY");
  const printedIdentitySource = {
    source_type: "CARD_FRONT_PRINTED_TEXT",
    provider_id: "openai_legacy",
    evidence_kind: "PRINTED_IDENTITY_FRAGMENT",
    direct_observation: true,
    trust_tier: 3
  };
  const evidenceField = (value) => ({
    value,
    status: "CONFIRMED",
    confidence: 0.9,
    candidates: [{ value, confidence: 0.9, sources: [printedIdentitySource] }],
    sources: [printedIdentitySource],
    conflicts: []
  });
  const gated = applyIdentityResolutionGate({
    ...result,
    ...control,
    provider: "openai_legacy",
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {
      year: evidenceField("2025"),
      manufacturer: evidenceField("Topps"),
      product: evidenceField("Topps"),
      players: evidenceField(["Sienna Betts"]),
      card_name: evidenceField("BETTS")
    }
  });
  assert.equal(gated.resolved_fields.year, "2025-26");
  assert.equal(gated.resolved_fields.product, "Bowman University Chrome");
  assert.equal(gated.resolved_fields.card_name, "Anime");
  assert.ok(gated.retrieval_application.actual_applied_fields.includes("year"));
  assert.ok(gated.retrieval_application.actual_applied_fields.includes("product"));
  assert.ok(gated.retrieval_application.actual_applied_fields.includes("card_name"));
}

function testTrustedHierarchyCannotCrossPublisherFamily() {
  const candidate = trustedCatalogCandidate({
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    anchor_agreement: {
      exact_code_match: false,
      prompt_hard_filter_pass: true,
      agreed: ["year", "subjects", "product_hierarchy"],
      contradicted: []
    },
    fields: {
      year: "2025",
      manufacturer: "Panini",
      product: "Panini Cosmic Chrome",
      players: ["Test Player"]
    }
  });
  const result = resultWithCandidate(candidate);
  result.resolved_fields = {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Test Player"]
  };
  const { application } = buildLayer(result);
  const decision = application.decisions.find((row) => row.field === "product");
  assert.ok(["BLOCK", "REJECT"].includes(decision.decision));
}

function testReviewedSeasonYearCanUpgradeTruncatedObservedYear() {
  const candidate = trustedCatalogCandidate({
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    source_feedback_id: "reviewed-season-source",
    reference_metadata: {
      corrected_title_is_reviewed_title_ground_truth: true,
      prompt_safe_internal_writer_title: true,
      source_feedback_id: "reviewed-season-source"
    },
    fields: {
      year: "2025-26",
      manufacturer: "Topps",
      product: "Bowman University Chrome",
      players: ["Sienna Betts"],
      official_card_type: "Anime",
      ssp: true
    }
  });
  const result = resultWithCandidate(candidate);
  result.source_feedback_id = "reviewed-season-source";
  result.resolved_fields = {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Sienna Betts"]
  };
  const { control, application } = buildLayer(result);
  assert.equal(application.decisions.find((row) => row.field === "year")?.decision, "APPLY");
  const gated = applyIdentityResolutionGate({
    ...result,
    ...control,
    provider: "openai_legacy",
    raw_provider_fields: result.resolved_fields,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  });
  assert.equal(gated.resolved_fields.year, "2025-26");
  assert.equal(gated.resolved_fields.product, "Bowman University Chrome");
  assert.equal(gated.resolved_fields.official_card_type, "Anime");
  assert.equal(gated.resolved_fields.ssp, true);
}

function testReviewedCurrentSourceOverridesProviderSemanticConflictsOnly() {
  const candidate = trustedCatalogCandidate({
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    source_feedback_id: "reviewed-current-source-conflict",
    reference_metadata: {
      corrected_title_is_reviewed_title_ground_truth: true,
      prompt_safe_internal_writer_title: true,
      source_feedback_id: "reviewed-current-source-conflict"
    },
    conflicting_fields: ["players", "surface_color", "product", "serial_number"],
    fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Heritage High Number",
      players: ["Jackson Chourio"],
      surface_color: "Blue",
      parallel_exact: "Dark Blue Bordered",
      serial_number: "09/50",
      print_run_numerator: "09"
    }
  });
  const result = resultWithCandidate(candidate);
  result.source_feedback_id = "reviewed-current-source-conflict";
  result.resolved_fields = {
    year: "2024",
    manufacturer: "Topps",
    product: "Topps Heritage",
    players: ["Jackson Chourio", "Jackson Bryan Chourio"],
    surface_color: "Gold",
    serial_number: "11/50",
    print_run_numerator: "11"
  };
  const { control, application } = buildLayer(result);
  assert.equal(control.selected_candidate_decision.selected_candidate_id, candidate.candidate_id);
  assert.equal(application.decisions.find((row) => row.field === "product")?.decision, "APPLY");
  assert.equal(application.decisions.find((row) => row.field === "players")?.decision, "APPLY");
  assert.equal(application.decisions.find((row) => row.field === "surface_color")?.decision, "APPLY");
  assert.notEqual(application.decisions.find((row) => row.field === "serial_number")?.decision, "APPLY");

  const gated = applyIdentityResolutionGate({
    ...result,
    ...control,
    provider: "openai_legacy",
    raw_provider_fields: result.resolved_fields,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  });
  assert.equal(gated.resolved_fields.product, "Topps Heritage High Number");
  assert.deepEqual(gated.resolved_fields.players, ["Jackson Chourio"]);
  assert.equal(gated.resolved_fields.surface_color, "Blue");
  assert.notEqual(gated.resolved_fields.serial_number, "09/50");
  assert.notEqual(gated.resolved_fields.print_run_numerator, "09");
}

function testCandidateCannotOverrideContradictingCurrentImageIdentity() {
  const result = resultWithCandidate();
  result.resolved_fields = {
    ...result.resolved_fields,
    product: "Panini Prizm"
  };
  const { application } = buildLayer(result);
  const productDecision = application.decisions.find((row) => row.field === "product");
  assert.ok(["BLOCK", "REJECT"].includes(productDecision.decision));
  assert.equal(application.identity_evidence_items.some((item) => item.field === "product"), false);

  const gated = applyIdentityResolutionGate({
    ...result,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  });
  assert.equal(gated.identity_resolution?.identity?.product, "Panini Prizm");
}

function testOutcomeRecordsResolverBlockInsteadOfPretendingApplication() {
  const result = resultWithCandidate();
  const { application } = buildLayer(result);
  const outcome = finalizeRetrievalApplicationOutcome({
    result: { ...result, retrieval_application: application },
    resolvedAfter: result.resolved_fields,
    titleAfter: "2024 Test Player"
  });
  const product = outcome.retrieval_application.decisions.find((row) => row.field === "product");
  assert.equal(product.outcome, "BLOCKED_BY_IDENTITY_RESOLUTION");
  assert.equal(outcome.retrieval_application.actual_application_count, 0);
}

async function testConvergenceCannotReinjectRawCandidates() {
  const result = resultWithCandidate();
  const { application } = buildLayer(result, false);
  let retrieverCalled = false;
  const gated = await applyIdentityResolutionGateWithConvergence({
    ...result,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  }, {
    retrieveEvidence: async () => {
      retrieverCalled = true;
      return {
        retrievalCandidates: [{
          candidate_id: "convergence-bypass",
          source_type: "OFFICIAL_CHECKLIST",
          fields: { product: "Wrong Product" }
        }]
      };
    }
  });
  assert.equal(retrieverCalled, false);
  assert.notEqual(gated.identity_resolution?.identity?.product, "Wrong Product");
}

testSelectedCandidateBecomesFieldEvidenceWithoutCopyingInstanceFields();
testVectorReferenceCanSupportButCannotFillMissingIdentity();
testCandidateResolvedShapeStillProducesFieldEvidence();
testCandidateFieldShapesMergeWithoutDroppingEvidence();
testEveryCandidateProducesAuditableDecisionRows();
testDisabledLayerRejectsAllCandidateFieldsAndBlocksRawBypass();
testIdentityResolutionConsumesRetrievalFieldEvidence();
testSingleModelFastPathConsumesAlreadyRetrievedFieldEvidence();
await testAssistShadowPathKeepsRetrievedContextForFieldApplication();
testRawRetrievalEvidenceCannotBypassApplicationOwner();
testResolvedRetrievalOutcomeOwnsRenderedFieldContainer();
testSelectedTrustedVariantRequiresExactCardIdentity();
testSelectedTrustedProductSpecificitySurvivesRawVisionDraftFallback();
testSelectedApplySurvivesShortPrintedIdentityConflict();
testTrustedHierarchyCannotCrossPublisherFamily();
testReviewedSeasonYearCanUpgradeTruncatedObservedYear();
testReviewedCurrentSourceOverridesProviderSemanticConflictsOnly();
testCandidateCannotOverrideContradictingCurrentImageIdentity();
testOutcomeRecordsResolverBlockInsteadOfPretendingApplication();
await testConvergenceCannotReinjectRawCandidates();

console.log("retrieval application layer tests passed");
