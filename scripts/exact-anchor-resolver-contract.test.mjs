import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyIdentityResolutionGate } from "../lib/identity-resolution/listing-resolution-gate.mjs";
import {
  normalizePaddleOcrResponse,
  ocrResultToEvidencePatch
} from "../lib/listing/ocr/ocr-contract.mjs";
import {
  confirmedPreingestionRetrievalFields,
  preingestionEvidenceDocumentFromPayload
} from "../lib/listing/pipeline/preingestion-evidence.mjs";
import { bundlePatchesFromOcrResult } from "../lib/listing/preingestion/preingestion-ocr-worker.mjs";
import { extractAnchorDossier, resolvedHintFromAnchorDossier } from "../lib/listing/v4/anchors/anchor-extractor.mjs";
import { anchorRoutes, planAnchorRoute } from "../lib/listing/v4/anchors/anchor-router.mjs";
import { probePreL2Anchors } from "../lib/listing/v4/anchors/pre-l2-anchor-probe.mjs";
import { maybeFinalizeL1FromExactAnchor } from "../lib/listing/v4/fast-scout/exact-anchor-finalize.mjs";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
};

function ocrCardCodePatch({
  value = "OP01-120",
  rawText = value,
  confidence = 0.97
} = {}) {
  return {
    field: "tcg_card_number",
    value,
    raw_text: rawText,
    confidence,
    source_type: "OCR",
    source_image_id: "back",
    provenance: { crop_type: "card_code_crop" }
  };
}

function payloadWithPatch(patch) {
  return { preingestion_evidence_patches: [patch] };
}

function ocrContextPatch({
  field,
  value,
  rawText = value,
  cropType,
  confidence = 0.97,
  sourceType = "OCR"
}) {
  return {
    field,
    value,
    raw_text: rawText,
    confidence,
    source_type: sourceType,
    source_image_id: cropType === "subject_crop" ? "front" : "back",
    provenance: { crop_type: cropType }
  };
}

function flatPatchFromCanonicalOcr({ cropType, rawText, imageId }) {
  const normalized = normalizePaddleOcrResponse({
    raw_text: rawText,
    confidence: 0.97,
    text_candidates: [{ text: rawText, confidence: 0.97 }]
  }, {
    request_id: `ocr-${cropType}`,
    image_url: "https://signed.test/card.jpg",
    crop_type: cropType
  });
  const rich = {
    ...normalized,
    evidence_patch: ocrResultToEvidencePatch(normalized, {
      imageId,
      cropId: cropType
    })
  };
  return bundlePatchesFromOcrResult(rich, {
    job_key: `job-${cropType}`,
    payload: {
      crop: {
        role: cropType,
        source_image_id: imageId,
        crop_metadata: { crop_id: cropType }
      }
    }
  });
}

function officialCatalogRow() {
  return {
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
      rarity: "SEC",
      serial_number: "1/1",
      numerical_rarity: "1/1",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "99999999"
    }
  };
}

function catalogFetch(rows, calls) {
  return async () => {
    calls.count += 1;
    return { ok: true, json: async () => rows };
  };
}

function assertResolverTerminal(result) {
  assert.ok(
    ["CONFIRMED", "RESOLVED", "ABSTAIN"].includes(result.identity_resolution_status),
    `Resolver must return a terminal identity decision, got ${result.identity_resolution_status}`
  );
  assert.ok(result.final_title.length <= 80, "Resolver-owned title must respect the frozen 80-character limit");
  if (result.identity_resolution_status === "ABSTAIN") {
    assert.equal(result.publication_gate?.auto_publish_allowed, false, "abstention must fail closed");
    return;
  }
  assert.ok(result.final_title.length > 0, "a resolved identity must have a non-empty Resolver-owned title");
}

test("normalized direct OCR code becomes the only exact-anchor lookup input", () => {
  const payload = payloadWithPatch(ocrCardCodePatch());
  const evidenceDocument = preingestionEvidenceDocumentFromPayload(payload);
  const retrievalFields = confirmedPreingestionRetrievalFields(payload);

  assert.equal(evidenceDocument?.resolved?.tcg_card_number, "OP01-120");
  assert.deepEqual(retrievalFields, { tcg_card_number: "OP01-120" });

  const dossier = extractAnchorDossier(evidenceDocument);
  const plan = planAnchorRoute(dossier);

  assert.equal(resolvedHintFromAnchorDossier(dossier).tcg_card_number, "OP01-120");
  assert.equal(plan.route, anchorRoutes.TCG_EXACT_LOOKUP);
});

test("sports card code plus two canonical OCR context fields reaches composite lookup without becoming Resolver hard evidence", () => {
  const payload = {
    preingestion_evidence_patches: [
      ocrContextPatch({
        field: "checklist_code",
        value: "24",
        rawText: "CARD NO. 24",
        cropType: "card_code_crop"
      }),
      ocrContextPatch({
        field: "product",
        value: "Panini Phoenix",
        rawText: "Panini Phoenix",
        cropType: "year_product_crop"
      }),
      ocrContextPatch({
        field: "players",
        value: "Jaxson Dart",
        rawText: "Jaxson Dart",
        cropType: "subject_crop"
      })
    ]
  };

  const document = preingestionEvidenceDocumentFromPayload(payload);
  assert.deepEqual(document?.resolved, { checklist_code: "24" });
  assert.deepEqual(document?.retrieval_context, {
    product: "Panini Phoenix",
    players: "Jaxson Dart"
  });
  assert.deepEqual(
    confirmedPreingestionRetrievalFields(payload),
    { checklist_code: "24" },
    "query context must never be promoted to Resolver hard evidence"
  );

  const dossier = extractAnchorDossier(document);
  const plan = planAnchorRoute(dossier);
  assert.equal(plan.route, anchorRoutes.SPORTS_COMPOSITE_LOOKUP);
  assert.equal(plan.direct_context_dimensions, 2);
  assert.equal(dossier.context.product, "Panini Phoenix");
  assert.deepEqual(dossier.context.subjects, ["Jaxson Dart"]);
});

test("the real OCR normalizer and bundle adapter can reach the sports composite route", async () => {
  const patches = [
    ...flatPatchFromCanonicalOcr({
      cropType: "card_code_crop",
      rawText: "CARD NO. 24",
      imageId: "back"
    }),
    ...flatPatchFromCanonicalOcr({
      cropType: "year_product_crop",
      rawText: "Panini Phoenix",
      imageId: "back"
    }),
    ...flatPatchFromCanonicalOcr({
      cropType: "subject_crop",
      rawText: "Jaxson Dart",
      imageId: "front"
    })
  ];
  assert.deepEqual(
    patches.map((patch) => [patch.field, patch.value, patch.provenance.crop_type]),
    [
      ["collector_number", "24", "collector_number"],
      ["product", "Panini Phoenix", "product_text"],
      ["players", "Jaxson Dart", "player_name"]
    ]
  );
  assert.ok(
    patches.every((patch) => patch.provenance.source_trust_tier === 3),
    "flattening the OCR packet must preserve, not upgrade, its tier-3 trust"
  );

  const document = preingestionEvidenceDocumentFromPayload({
    preingestion_evidence_patches: patches
  });
  assert.deepEqual(document?.resolved, { collector_number: "24" });
  assert.deepEqual(document?.retrieval_context, {
    product: "Panini Phoenix",
    players: "Jaxson Dart"
  });
  assert.equal(document?.evidence?.collector_number?.sources?.[0]?.trust_tier, 3);
  assert.equal(document?.retrieval_context_evidence?.product?.sources?.[0]?.trust_tier, 3);
  assert.equal(document?.retrieval_context_evidence?.players?.sources?.[0]?.trust_tier, 3);
  const plan = planAnchorRoute(extractAnchorDossier(document));
  assert.equal(plan.route, anchorRoutes.SPORTS_COMPOSITE_LOOKUP);
  assert.equal(plan.direct_context_dimensions, 2);

  const probe = await probePreL2Anchors({
    payload: { preingestion_evidence_patches: patches },
    env,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{
        identity_id: "panini-phoenix-24-jaxson-dart",
        canonical_title: "2025 Panini Phoenix Jaxson Dart Rookie #24",
        retrieval_status: "registry",
        source_type: "PANINI_OFFICIAL_CATALOG",
        normalized_score: 1,
        supporting_fields: ["product", "subjects", "collector_number"],
        fields: {
          year: "2025",
          manufacturer: "Panini",
          product: "Panini Phoenix",
          players: ["Jaxson Dart"],
          collector_number: "24",
          card_name: "Rookie"
        }
      }]
    })
  });
  assert.equal(probe.finalized, true, JSON.stringify(probe));
  assert.deepEqual(
    probe.finalize.resolver_input.resolved,
    { collector_number: "24" },
    "retrieval-only context must not enter Resolver as a pre-resolved field"
  );
  assert.deepEqual(probe.finalize.resolver_input.retrieval_context, {
    product: "Panini Phoenix",
    players: "Jaxson Dart"
  });
  assert.equal(
    probe.finalize.resolver_input.candidate_observation_snapshot.product,
    "Panini Phoenix",
    "Candidate Selection still needs the query context snapshot"
  );
  assert.ok(
    probe.finalize.resolver_input.retrieval_application.identity_evidence_items
      .some((item) => item.field === "product"),
    "a selected official identity must send product through Retrieval Application"
  );
  const resolved = applyIdentityResolutionGate(probe.finalize.resolver_input, {
    maxLength: 80,
    providerId: "v4_exact_anchor"
  });
  assertResolverTerminal(resolved);
  assert.ok(
    ["CONFIRMED", "RESOLVED"].includes(resolved.identity_resolution_status),
    `the structurally addressable fixture must become writer-ready: ${JSON.stringify(resolved)}`
  );
});

test("sports context stays fail-closed when crop, source, text match, or confidence is invalid", () => {
  const invalidContext = [
    ocrContextPatch({
      field: "product",
      value: "Panini Phoenix",
      rawText: "Panini Phoenix",
      cropType: "subject_crop"
    }),
    ocrContextPatch({
      field: "players",
      value: "Jaxson Dart",
      rawText: "Jaxson Dart",
      cropType: "subject_crop",
      sourceType: "STRUCTURED_DATABASE"
    }),
    ocrContextPatch({
      field: "product",
      value: "Panini Phoenix",
      rawText: "Panini Prizm",
      cropType: "year_product_crop"
    }),
    ocrContextPatch({
      field: "players",
      value: "Jaxson Dart",
      rawText: "Jaxson Dart",
      cropType: "subject_crop",
      confidence: 0.5
    })
  ];

  for (const contextPatch of invalidContext) {
    const document = preingestionEvidenceDocumentFromPayload({
      preingestion_evidence_patches: [
        ocrContextPatch({
          field: "checklist_code",
          value: "24",
          rawText: "CARD NO. 24",
          cropType: "card_code_crop"
        }),
        contextPatch
      ]
    });
    const plan = planAnchorRoute(extractAnchorDossier(document));
    assert.equal(plan.route, anchorRoutes.NORMAL_L2);
    assert.equal(plan.allow_identity_finalize, false);
  }
});

test("semantically wrong product/player OCR cannot finalize even if the catalog transport returns a row", async () => {
  const patches = [
    ...flatPatchFromCanonicalOcr({
      cropType: "card_code_crop",
      rawText: "CARD NO. 24",
      imageId: "back"
    }),
    ...flatPatchFromCanonicalOcr({
      cropType: "year_product_crop",
      rawText: "Rookie Ticket",
      imageId: "front"
    }),
    ...flatPatchFromCanonicalOcr({
      cropType: "subject_crop",
      rawText: "New York Giants",
      imageId: "front"
    })
  ];
  const probe = await probePreL2Anchors({
    payload: { preingestion_evidence_patches: patches },
    env,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{
        identity_id: "panini-phoenix-24-jaxson-dart",
        canonical_title: "2025 Panini Phoenix Jaxson Dart Rookie #24",
        retrieval_status: "registry",
        source_type: "PANINI_OFFICIAL_CATALOG",
        normalized_score: 1,
        supporting_fields: ["product", "subjects", "collector_number"],
        fields: {
          year: "2025",
          manufacturer: "Panini",
          product: "Panini Phoenix",
          players: ["Jaxson Dart"],
          collector_number: "24"
        }
      }]
    })
  });

  assert.equal(probe.plan.route, anchorRoutes.SPORTS_COMPOSITE_LOOKUP);
  assert.equal(probe.metrics.lookup_attempted, true);
  assert.equal(probe.finalized, false);
  assert.equal(probe.finalize.resolver_ready, false);
  assert.equal(probe.metrics.eligible_candidate_count, 0);
  assert.equal(probe.finalize.reason, "no_exact_anchor_agreement");
});

test("low-confidence OCR code cannot trigger a catalog lookup", async () => {
  const calls = { count: 0 };
  const probe = await probePreL2Anchors({
    payload: payloadWithPatch(ocrCardCodePatch({ confidence: 0.5 })),
    env,
    fetchImpl: catalogFetch([officialCatalogRow()], calls)
  });

  assert.deepEqual(confirmedPreingestionRetrievalFields(
    payloadWithPatch(ocrCardCodePatch({ confidence: 0.5 }))
  ), {});
  assert.equal(calls.count, 0, "review-confidence OCR must not reach the catalog transport");
  assert.equal(probe.metrics.lookup_attempted, false);
  assert.equal(probe.finalized, false);
});

test("website and footer noise cannot bypass normalization and trigger lookup", async () => {
  const calls = { count: 0 };
  const payload = payloadWithPatch(ocrCardCodePatch({
    rawText: "Visit https://www.example.com/cards/OP01-120 for product details"
  }));

  assert.deepEqual(
    confirmedPreingestionRetrievalFields(payload),
    {},
    "the canonical evidence boundary must reject a code copied from website/footer text"
  );

  const probe = await probePreL2Anchors({
    payload,
    env,
    fetchImpl: catalogFetch([officialCatalogRow()], calls)
  });

  assert.equal(calls.count, 0, "rejected web noise must never reach an exact catalog lookup");
  assert.equal(probe.metrics.lookup_attempted, false);
  assert.equal(probe.finalized, false);
});

test("bare code retrieval falls through when Candidate Selection lacks independent context", async () => {
  const calls = { count: 0 };
  const probe = await probePreL2Anchors({
    payload: payloadWithPatch(ocrCardCodePatch()),
    env,
    fetchImpl: catalogFetch([officialCatalogRow()], calls)
  });

  assert.equal(calls.count, 1);
  assert.equal(probe.metrics.trusted_candidate_count, 1);
  assert.equal(probe.metrics.eligible_candidate_count, 1);
  assert.equal(probe.finalized, false);
  assert.equal(probe.finalize?.reason, "exact_anchor_candidate_not_selected_by_candidate_control");
  assert.equal(probe.finalize?.resolver_ready, false);
  assert.equal(probe.finalize?.resolver_input, undefined);
  assert.equal(probe.finalize?.finalized_semantics, "RESOLVER_READY");
  assert.equal(probe.finalize?.title, undefined, "Exact Anchor must not publish a Renderer-owned title");
  assert.equal(probe.finalize?.presentation, undefined, "Exact Anchor must not expose a Renderer presentation");
});

test("one trusted context-bound exact candidate enters through the shared Candidate owner", async () => {
  const calls = { count: 0 };
  const finalized = await maybeFinalizeL1FromExactAnchor({
    scoutResult: {
      resolved_fields: {
        year: "2022",
        product: "Romance Dawn",
        players: ["Shanks"],
        tcg_card_number: "OP01-120"
      },
      evidence: {}
    },
    env,
    fetchImpl: catalogFetch([officialCatalogRow()], calls),
    policy: { allow_tcg_code_only: true, allow_catalog_finalize: true, allow_cert_lane: false }
  });

  assert.equal(calls.count, 1);
  assert.equal(finalized.finalized, true, JSON.stringify(finalized));
  assert.equal(finalized.finalized_semantics, "RESOLVER_READY");
  assert.equal(finalized.title, undefined, "Exact Anchor must not publish a Renderer-owned title");
  assert.equal(finalized.presentation, undefined, "Exact Anchor must not expose a Renderer presentation");

  const resolverInput = finalized.resolver_input;
  assert.ok(resolverInput, "a unique trusted candidate must be emitted as resolver_input");
  assert.equal(
    resolverInput.retrieval_application?.owner,
    "retrieval_application_layer",
    "the shared Candidate Application layer must remain the only application owner"
  );
  assert.equal(resolverInput.retrieval_application?.owns_candidate_application, true);
  assert.equal(
    resolverInput.retrieval_application?.selected_candidate_id,
    finalized.candidate?.candidate_id,
    "Candidate Selection must select the same exact-anchor winner"
  );
  const candidateEvidence = resolverInput.retrieval_application.identity_evidence_items;
  const candidateFields = new Set(candidateEvidence.map((item) => item.field));
  for (const forbidden of ["serial_number", "numerical_rarity", "grade_company", "card_grade", "cert_number"]) {
    assert.equal(candidateFields.has(forbidden), false, `catalog candidate must not copy instance field ${forbidden}`);
  }
  assert.ok(candidateEvidence.length > 0);
  assert.ok(candidateEvidence.every((item) => item.metadata?.candidate_is_evidence_not_truth === true));
  assert.ok(candidateEvidence.every((item) => ["APPLY", "SUPPORT"].includes(
    item.metadata?.retrieval_application_decision
  )));
  assert.ok(candidateEvidence.every((item) => item.metadata?.field_permission));
  assert.ok(resolverInput.resolution_trace.some((entry) => (
    entry.output?.candidate_application_owner === "retrieval_application_layer"
    && entry.output?.exact_anchor_policy_version
  )));

  const resolved = applyIdentityResolutionGate(resolverInput, {
    maxLength: 80,
    providerId: "v4_exact_anchor"
  });
  assertResolverTerminal(resolved);
});

test("cert registry lane falls through until the shared Candidate owner models cert identity", async () => {
  const payload = {
    preingestion_evidence_patches: [
      {
        field: "grade_company",
        value: "PSA",
        raw_text: "PSA 10 87654321",
        confidence: 0.98,
        source_type: "SLAB_LABEL",
        source_image_id: "front",
        provenance: { crop_type: "grade_label_crop" }
      },
      {
        field: "cert_number",
        value: "87654321",
        raw_text: "PSA 10 87654321",
        confidence: 0.98,
        source_type: "SLAB_LABEL",
        source_image_id: "front",
        provenance: { crop_type: "grade_label_crop" }
      },
      {
        field: "year",
        value: "2022-23",
        raw_text: "2022-23 ONE PIECE",
        confidence: 0.96,
        source_type: "OCR",
        source_image_id: "back",
        provenance: { crop_type: "year_product_crop" }
      }
    ]
  };
  const probe = await probePreL2Anchors({
    payload,
    env,
    fetchImpl: async (url) => {
      assert.match(String(url), /\/cert_registry\?/);
      return {
        ok: true,
        json: async () => [{
          grader: "PSA",
          cert_number: "87654321",
          identity: {
            year: "2022-23",
            product: "One Piece Romance Dawn",
            players: ["Shanks"],
            collector_number: "OP01-120",
            serial_number: "1/1",
            grade_company: "PSA",
            card_grade: "10"
          },
          grade: "10",
          canonical_title: "2022-23 One Piece Romance Dawn Shanks OP01-120 PSA 10",
          source: "INTERNAL_CERT_REGISTRY",
          review_status: "APPROVED"
        }]
      };
    }
  });

  assert.equal(probe.plan.route, anchorRoutes.CERT_VERIFY);
  assert.equal(probe.finalized, false, JSON.stringify(probe));
  assert.equal(probe.finalize?.finalized_semantics, "RESOLVER_READY");
  assert.equal(probe.finalize?.resolver_ready, false);
  assert.equal(probe.finalize?.resolver_input, null);
  assert.equal(probe.finalize?.review_required, true);
  assert.equal(
    probe.finalize?.reason,
    "cert_registry_candidate_application_owner_not_integrated"
  );
  assert.equal(probe.finalize?.candidate?.application_owner_status, "UNMODELED");
  assert.equal(probe.finalize?.title, undefined);
  assert.equal(probe.finalize?.presentation, undefined);
  assert.equal(probe.finalize?.candidate?.fields, undefined, "cert lookup fields must not bypass Candidate Control");
});

test("Exact Anchor implementation cannot import or call Renderer", async () => {
  const source = await readFile(
    new URL("../lib/listing/v4/fast-scout/exact-anchor-finalize.mjs", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(source, /listing-renderer\.mjs/);
  assert.doesNotMatch(source, /\brenderListingPresentation\s*\(/);
});
