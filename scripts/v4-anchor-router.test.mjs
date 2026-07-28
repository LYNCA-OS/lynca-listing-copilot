import assert from "node:assert/strict";
import { extractAnchorDossier, resolvedHintFromAnchorDossier } from "../lib/listing/v4/anchors/anchor-extractor.mjs";
import { anchorRoutes, planAnchorRoute } from "../lib/listing/v4/anchors/anchor-router.mjs";
import { preL2AnchorInputTrace, probePreL2Anchors } from "../lib/listing/v4/anchors/pre-l2-anchor-probe.mjs";
import {
  anchorRouteLateShadowEnabled,
  buildPostRefreshAnchorRouteShadow,
  postRendezvousAnchorExecutionSummary
} from "../lib/listing/v4/anchors/anchor-route-shadow.mjs";

function patch(field, value, confidence = 0.94, cropType = "card_code_crop") {
  return {
    field,
    value,
    confidence,
    source_type: "OCR",
    source_image_id: "image_1",
    provenance: { crop_type: cropType }
  };
}

const tcgDossier = extractAnchorDossier({
  preingestion_evidence_patches: [patch("tcg_card_number", "OP01-120")]
});
assert.equal(tcgDossier.anchors[0].anchor_type, "tcg_card_code");
assert.equal(tcgDossier.anchor_candidates.tcg_code[0].value, "OP01-120");
assert.equal(planAnchorRoute(tcgDossier).route, anchorRoutes.TCG_EXACT_LOOKUP);
assert.equal(resolvedHintFromAnchorDossier(tcgDossier).tcg_card_number, "OP01-120");

const sportsDossier = extractAnchorDossier({
  preingestion_evidence_patches: [
    patch("checklist_code", "CL-LM"),
    patch("product_text", "2024 Topps Chrome", 0.91, "year_product_crop"),
    patch("player_names", ["Lionel Messi"], 0.92, "subject_crop")
  ]
});
assert.equal(planAnchorRoute(sportsDossier).route, anchorRoutes.SPORTS_COMPOSITE_LOOKUP);

const insufficient = extractAnchorDossier({
  preingestion_evidence_patches: [patch("checklist_code", "CL-LM")]
});
assert.equal(planAnchorRoute(insufficient).route, anchorRoutes.NORMAL_L2);

const noPatchDossier = extractAnchorDossier({});
const noPatchInputTrace = preL2AnchorInputTrace({
  preingestion_bundle: {
    crop_plan: [{ role: "card_code_crop" }],
    quality_summary: {
      ocr_stage_execution: {
        evidence_job_observability: [{
          crop_role: "card_code_crop",
          status: "SUCCEEDED",
          patch_count: 0,
          raw_text_present_count: 1,
          normalized_field_count: 0,
          evidence_reason_codes: ["OCR_TEXT_NOT_NORMALIZED_TO_SUPPORTED_FIELD"]
        }]
      }
    }
  }
}, noPatchDossier, planAnchorRoute(noPatchDossier));
assert.equal(noPatchInputTrace.observable_card_code_job_count, 1);
assert.equal(noPatchInputTrace.current_code_patch_count, 0);
assert.ok(noPatchInputTrace.reason_codes.includes("OCR_TEXT_NOT_NORMALIZED_TO_SUPPORTED_FIELD"));
assert.ok(noPatchInputTrace.reason_codes.includes("NO_CURRENT_CODE_PATCH"));

const duplicateContextRoleTrace = preL2AnchorInputTrace({
  preingestion_summary: {
    ocr_stage_execution: {
      evidence_job_observability: [
        { crop_role: "year_product_crop", status: "SUCCEEDED", patch_count: 1, evidence_produced: true },
        { crop_role: "year_product_crop", status: "SUCCEEDED", patch_count: 1, evidence_produced: true }
      ]
    }
  }
}, noPatchDossier, planAnchorRoute(noPatchDossier));
assert.equal(duplicateContextRoleTrace.observable_direct_context_job_count, 2);
assert.equal(duplicateContextRoleTrace.observable_direct_context_role_count, 1);
assert.equal(duplicateContextRoleTrace.sports_pre_provider_reachability, "CONTEXT_JOBS_NOT_OBSERVED");

const nonterminalContextTrace = preL2AnchorInputTrace({
  preingestion_summary: {
    ocr_stage_execution: {
      evidence_job_observability: [
        { crop_role: "year_product_crop", status: "SUCCEEDED", patch_count: 1, evidence_produced: true },
        { crop_role: "subject_crop", status: "RUNNING", patch_count: 0, evidence_produced: false }
      ]
    }
  }
}, noPatchDossier, planAnchorRoute(noPatchDossier));
assert.equal(nonterminalContextTrace.terminal_direct_context_role_count, 1);
assert.equal(nonterminalContextTrace.sports_pre_provider_reachability, "CONTEXT_JOBS_NOT_TERMINAL");

const unobservableContextTrace = preL2AnchorInputTrace({
  preingestion_summary: {
    ocr_stage_execution: {
      evidence_job_observability: [
        { crop_role: "year_product_crop", status: "SUCCEEDED" },
        { crop_role: "subject_crop", status: "SUCCEEDED" }
      ]
    }
  }
}, noPatchDossier, planAnchorRoute(noPatchDossier));
assert.equal(unobservableContextTrace.terminal_direct_context_role_count, 2);
assert.equal(unobservableContextTrace.evidence_observable_direct_context_role_count, 0);
assert.equal(unobservableContextTrace.sports_pre_provider_reachability, "CONTEXT_EVIDENCE_UNOBSERVED");

const noContextEvidenceTrace = preL2AnchorInputTrace({
  preingestion_summary: {
    ocr_stage_execution: {
      evidence_job_observability: [
        { crop_role: "year_product_crop", status: "SUCCEEDED", patch_count: 0, evidence_produced: false },
        { crop_role: "subject_crop", status: "SUCCEEDED", patch_count: 0, evidence_produced: false }
      ]
    }
  }
}, noPatchDossier, planAnchorRoute(noPatchDossier));
assert.equal(noContextEvidenceTrace.evidence_observable_direct_context_role_count, 2);
assert.equal(noContextEvidenceTrace.patch_producing_direct_context_role_count, 0);
assert.equal(noContextEvidenceTrace.sports_pre_provider_reachability, "CONTEXT_EVIDENCE_NOT_PRODUCED");

const belowThresholdDossier = extractAnchorDossier({
  preingestion_evidence_patches: [patch("tcg_card_number", "OP01-120", 0.7)]
});
const belowThresholdTrace = preL2AnchorInputTrace(
  { preingestion_evidence_patches: [patch("tcg_card_number", "OP01-120", 0.7)] },
  belowThresholdDossier,
  planAnchorRoute(belowThresholdDossier)
);
assert.ok(belowThresholdTrace.reason_codes.includes("ANCHOR_BELOW_DIRECT_THRESHOLD"));
assert.equal(belowThresholdTrace.threshold_eligible_code_anchor_count, 0);

const routeOnlyShadow = buildPostRefreshAnchorRouteShadow({
  payload: {
    images: [{ image_id: "image_1" }],
    preingestion_evidence_patches: [patch("collector_number", "54")]
  },
  result: {
    normalized_evidence: Object.fromEntries([
      ["year", "2024"],
      ["product", "Panini Contenders"],
      ["players", ["Jaren Jackson"]]
    ].map(([field, value]) => [field, {
      value,
      normalized_value: value,
      status: "CONFIRMED",
      confidence: 0.94,
      sources: [{
        source_type: "CARD_FRONT",
        image_id: "image_1",
        direct_observation: true,
        source_inference_method: "full_card_vision"
      }]
    }]))
  }
});
assert.equal(anchorRouteLateShadowEnabled({ payload: {} , env: {} }), false);
assert.equal(anchorRouteLateShadowEnabled({
  payload: {
    provider_options: {
      recognition_benchmark_profile: "cold_algorithm_benchmark",
      trace_level: "evaluation"
    }
  },
  env: {}
}), true);
assert.equal(anchorRouteLateShadowEnabled({
  payload: {
    enable_anchor_route_late_shadow: false,
    provider_options: {
      recognition_benchmark_profile: "cold_algorithm_benchmark",
      trace_level: "evaluation"
    }
  },
  env: { ENABLE_ANCHOR_ROUTE_LATE_SHADOW: "true" }
}), true, "untrusted top-level payload flags cannot disable a server-owned evaluation shadow");
assert.equal(routeOnlyShadow.mode, "ROUTE_ONLY_SHADOW");
assert.equal(routeOnlyShadow.fast_final_eligible, false);
assert.equal(routeOnlyShadow.effects.catalog_lookup, false);
assert.equal(routeOnlyShadow.strict_post_refresh.plan.route, anchorRoutes.NORMAL_L2);
assert.equal(
  routeOnlyShadow.post_provider_context_counterfactual.plan.route,
  anchorRoutes.SPORTS_COMPOSITE_LOOKUP
);
assert.deepEqual(
  routeOnlyShadow.post_provider_context_counterfactual.provider_context_patch_fields,
  ["year", "product", "players"]
);

const newestRendezvousSummary = { evidence_job_observability: [{ job_id: "new" }] };
assert.equal(postRendezvousAnchorExecutionSummary({
  execution_summary: { evidence_job_observability: [{ job_id: "stale" }] },
  sweep: { execution_summary: newestRendezvousSummary }
}), newestRendezvousSummary);
assert.equal(postRendezvousAnchorExecutionSummary({}), null);
const persistedMergedSummary = {
  evidence_job_observability_count: 2,
  evidence_job_observability: [{ job_id: "older" }, { job_id: "newer" }]
};
assert.equal(postRendezvousAnchorExecutionSummary({
  execution_summary: persistedMergedSummary,
  sweep: { execution_summary: { evidence_job_observability: [{ job_id: "last-wave-only" }] } }
}), persistedMergedSummary);

const boundedReasonTrace = preL2AnchorInputTrace({
  preingestion_summary: {
    ocr_stage_execution: {
      evidence_job_observability: [{
        crop_role: "card_code_crop",
        status: "SUCCEEDED",
        patch_count: 0,
        evidence_reason_codes: Array.from({ length: 40 }, (_, index) => `reason ${index}`)
      }]
    }
  }
}, noPatchDossier, planAnchorRoute(noPatchDossier));
assert.equal(boundedReasonTrace.reason_codes.length, 24);
assert.ok(boundedReasonTrace.reason_codes_truncated_count > 0);
assert.match(boundedReasonTrace.reason_codes_sha256, /^[0-9a-f]{64}$/);

const lateShadowWithPostRendezvousSummary = buildPostRefreshAnchorRouteShadow({
  payload: {
    preingestion_summary: {
      // Deliberately stale: two rows, but both describe the same crop role.
      ocr_stage_execution: {
        evidence_job_observability: [
          { crop_role: "year_product_crop", status: "SUCCEEDED", patch_count: 1 },
          { crop_role: "year_product_crop", status: "SUCCEEDED", patch_count: 1 }
        ]
      }
    },
    preingestion_evidence_patches: [
      patch("year", "2024", 0.96, "year_product_crop"),
      patch("product", "Panini Contenders", 0.95, "year_product_crop"),
      patch("player_names", ["Jaren Jackson"], 0.95, "subject_crop")
    ]
  },
  executionSummary: {
    evidence_job_observability: [
      { crop_role: "year_product_crop", status: "SUCCEEDED", patch_count: 2, evidence_produced: true },
      { crop_role: "subject_crop", status: "SUCCEEDED", patch_count: 1, evidence_produced: true }
    ]
  }
});
assert.equal(
  lateShadowWithPostRendezvousSummary.strict_post_refresh.input_trace.execution_summary_source,
  "POST_RENDEZVOUS_OVERRIDE"
);
assert.equal(
  lateShadowWithPostRendezvousSummary.strict_post_refresh.input_trace.sports_pre_provider_reachability,
  "CONTEXT_EVIDENCE_REACHABLE"
);
assert.equal(lateShadowWithPostRendezvousSummary.effects.catalog_lookup, false);
assert.equal(lateShadowWithPostRendezvousSummary.effects.provider_skip, false);

const certOnly = extractAnchorDossier({
  preingestion_evidence_patches: [
    patch("grade_company", "PSA", 0.99, "grade_label_crop"),
    patch("cert_number", "87654321", 0.96, "grade_label_crop")
  ]
});
assert.equal(planAnchorRoute(certOnly).route, anchorRoutes.CERT_VERIFY);
assert.equal(planAnchorRoute(certOnly).allow_identity_finalize, false);
assert.equal(certOnly.anchors.find((anchor) => anchor.anchor_type === "cert_number")?.grader, "PSA");

const payloadHintCannotFinalizeSports = extractAnchorDossier({
  resolvedHint: { year: "2024", product: "Topps Chrome", players: ["Lionel Messi"] },
  preingestion_evidence_patches: [patch("checklist_code", "CL-LM")]
});
assert.equal(
  planAnchorRoute(payloadHintCannotFinalizeSports).route,
  anchorRoutes.NORMAL_L2,
  "a direct code plus non-direct payload hints must not bypass full visual recognition"
);

const bareBarcode = extractAnchorDossier({
  preingestion_evidence_patches: [patch("unknown_number", "012345678905", 0.96, "unknown_crop")]
});
assert.equal(bareBarcode.anchors[0]?.anchor_type, "barcode_candidate");
assert.equal(bareBarcode.anchor_candidates.barcode[0].value, "012345678905");
assert.equal(planAnchorRoute(bareBarcode).route, anchorRoutes.NORMAL_L2);

const rarityOnly = extractAnchorDossier({
  preingestion_evidence_patches: [patch("serial_number", "2/3", 0.98, "serial_crop")]
});
assert.equal(planAnchorRoute(rarityOnly).route, anchorRoutes.NORMAL_L2);

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-key"
};
const probe = await probePreL2Anchors({
  payload: {
    preingestion_evidence_patches: [patch("tcg_card_number", "OP01-120")]
  },
  env,
  fetchImpl: async () => ({
    ok: true,
    json: async () => [{
      identity_id: "tcg-identity-1",
      canonical_title: "2022 One Piece Romance Dawn Shanks OP01-120 SEC",
      retrieval_status: "registry",
      source_type: "BANDAI_ONE_PIECE_OFFICIAL_CARDLIST",
      normalized_score: 1,
      supporting_fields: ["collector_number"],
      fields: {
        year: "2022",
        ip: "One Piece",
        product: "Romance Dawn",
        players: ["Shanks"],
        collector_number: "OP01-120",
        rarity: "SEC"
      }
    }]
  })
});
assert.equal(probe.finalized, true, JSON.stringify(probe));
assert.equal(probe.plan.route, anchorRoutes.TCG_EXACT_LOOKUP);
assert.equal(probe.finalize.resolved_fields.players[0], "Shanks");
assert.equal(probe.metrics.anchor_count, 1);
assert.equal(probe.metrics.direct_anchor_count, 1);
assert.deepEqual(probe.metrics.anchor_type_breakdown, { tcg_card_code: 1 });
assert.equal(probe.metrics.lookup_attempted, true);
assert.equal(probe.metrics.catalog_candidate_count, 1);
assert.equal(probe.metrics.trusted_candidate_count, 1);
assert.equal(probe.metrics.eligible_candidate_count, 1);

const sportsProbe = await probePreL2Anchors({
  payload: {
    preingestion_evidence_patches: [
      patch("collector_number", "54"),
      patch("year", "2024", 0.96, "year_product_crop"),
      patch("product", "Panini Contenders", 0.95, "year_product_crop")
    ]
  },
  env,
  fetchImpl: async () => ({
    ok: true,
    json: async () => [{
      identity_id: "sports-identity-54",
      canonical_title: "2024 Panini Contenders Jaren Jackson Rookie Ticket Auto #54",
      retrieval_status: "reviewed",
      source_type: "REVIEWED_INTERNAL",
      normalized_score: 1,
      supporting_fields: ["year", "product", "collector_number"],
      fields: {
        year: "2024",
        manufacturer: "Panini",
        product: "Panini Contenders",
        players: ["Jaren Jackson"],
        card_name: "Rookie Ticket Autograph",
        collector_number: "54"
      }
    }]
  })
});
assert.equal(sportsProbe.plan.route, anchorRoutes.SPORTS_COMPOSITE_LOOKUP);
assert.equal(sportsProbe.finalized, true, JSON.stringify(sportsProbe));
assert.equal(sportsProbe.metrics.lookup_attempted, true);
assert.equal(sportsProbe.finalize.resolved_fields.players[0], "Jaren Jackson");

console.log("v4-anchor-router.test.mjs OK");
