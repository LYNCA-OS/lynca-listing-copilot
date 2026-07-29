import assert from "node:assert/strict";

import {
  effectiveRendererParity,
  projectReadOnlyProviderSnapshot,
  protectedReadParity,
  replayProviderOutputContract,
  replayRowsPassGate,
  requiredAcceptanceFailureRegression
} from "./replay-provider-output-contract.mjs";

assert.equal(requiredAcceptanceFailureRegression(["print_finish"], ["lot_quantity"]), true);
assert.equal(requiredAcceptanceFailureRegression(["print_finish"], []), false);
assert.equal(requiredAcceptanceFailureRegression([], ["lot_quantity"]), true);

const model = {
  schema_version: "constraint-model-test-v1",
  snapshot_version: "constraint-model-test-v1",
  snapshot_source_sha256: "b".repeat(64),
  source_card_count: 1,
  player_teams: {},
  player_team_years: {},
  set_product_years: {
    "fade to black": ["2025|Panini Phoenix"]
  }
};
const emptyModel = {
  schema_version: "constraint-model-empty-test-v1",
  snapshot_version: "constraint-model-empty-test-v1",
  snapshot_source_sha256: "c".repeat(64),
  source_card_count: 0,
  player_teams: {},
  player_team_years: {},
  set_product_years: {}
};

function normalizationProjection(input = {}, output = {}) {
  return {
    input,
    output,
    decisions: [...new Set([...Object.keys(input), ...Object.keys(output)])].sort().map((field) => ({
      field,
      decision: !(field in output)
        ? "DROP"
        : !(field in input)
          ? "DERIVE"
          : JSON.stringify(input[field]) === JSON.stringify(output[field])
            ? "PRESERVE"
            : "NORMALIZE"
    }))
  };
}

const snapshot = {
  schema_version: "evaluation-replay-snapshot-v4",
  status: "COMPLETE",
  provider_fields: {
    year: "2025",
    manufacturer: "Panini",
    product: "Panini Phoenix",
    set: "Fade To Black",
    players: ["Victor Wembanyama"],
    team: "San Antonio Spurs"
  },
  observed_fields: {
    year: "2025",
    manufacturer: "Panini",
    set: "Fade To Black",
    players: ["Victor Wembanyama"],
    ssp: false,
    grade_type: "UNKNOWN"
  },
  normalized_evidence: {
    card_grade: {
      value: "10",
      status: "CONFIRMED",
      sources: [{ source_type: "OCR_ONLY", observed_text: "10" }]
    },
    print_run_number: {
      value: "03/25",
      normalized_value: "03/25",
      status: "CONFIRMED",
      sources: [{ source_type: "OCR_ONLY", observed_text: "03/25" }]
    }
  },
  provider_field_evidence: [
    { field: "year", value: "2025", source_type: "CARD_BACK_PRINTED_TEXT", visible_text: "2025" },
    { field: "product", value: "Panini Phoenix", source_type: "VISION_ONLY", visible_text: "" }
  ],
  derivation_provenance: [],
  normalization: {
    input: {
      year: "2025",
      manufacturer: "Panini",
      product: "Panini Phoenix",
      set: "Fade To Black",
      players: ["Victor Wembanyama"],
      team: "San Antonio Spurs"
    },
    output: {
      year: "2025",
      manufacturer: "Panini",
      set: "Fade To Black",
      players: ["Victor Wembanyama"],
      ssp: false,
      grade_type: "UNKNOWN"
    },
    decisions: [
      { field: "year", decision: "PRESERVE" },
      { field: "manufacturer", decision: "PRESERVE" },
      { field: "product", decision: "DROP" },
      { field: "set", decision: "PRESERVE" },
      { field: "players", decision: "PRESERVE" },
      { field: "team", decision: "DROP" },
      { field: "ssp", decision: "DERIVE" },
      { field: "grade_type", decision: "DERIVE" }
    ]
  },
  resolved_fields: {
    year: "2025",
    manufacturer: "Panini",
    product: "Panini Phoenix",
    set: "Fade To Black",
    players: ["Victor Wembanyama"],
    card_grade: "10",
    print_run_number: "03/25",
    print_run_numerator: "03",
    print_run_denominator: "25"
  },
  rendered_fields: {
    year: "2025",
    manufacturer: "Panini",
    product: "Panini Phoenix",
    set: "Fade To Black",
    players: ["Victor Wembanyama"],
    card_grade: "10",
    print_run_number: "03/25",
    print_run_numerator: "03",
    print_run_denominator: "25"
  },
  semantic_retrieval_application: { enabled: false, decisions: [] },
  versions: {
    recognition_pipeline_fingerprint: "a".repeat(64),
    constraint_snapshot: "constraint-model-test-v1",
    constraint_snapshot_sha256: "b".repeat(64),
    constraint_enumerator: "constraint-enumerator-v3",
    normalization: "normalization-v1",
    resolver: "resolver-v1",
    renderer: "renderer-v3-scg"
  },
  effective_terminal_renderer_inputs: {
    max_title_length: 80,
    serial_numerator_verified: null,
    trust_resolved_print_run_without_evidence: true,
    source: "test"
  },
  final_title: "2025 Panini Phoenix Fade To Black Victor Wembanyama"
};

const projected = projectReadOnlyProviderSnapshot(snapshot);
assert.equal(projected.fields.product, undefined);
assert.equal(projected.fields.team, undefined);
assert.equal(projected.fields.set, "Fade To Black");
assert.equal(projected.fields.card_grade, "10");
assert.equal(projected.fields.print_run_number, "03/25");
assert.equal(projected.fields.ssp, undefined);
assert.equal(projected.fields.grade_type, undefined);
assert.equal(projected.normalized_evidence.card_grade.value, "10");
assert.deepEqual(projected.field_evidence.map((item) => item.field), [
  "year",
  "card_grade",
  "print_run_number"
]);
assert.equal(projected.field_evidence.find((item) => item.field === "card_grade")?.source_type, "OCR_ONLY");
assert.equal(projected.field_evidence.find((item) => item.field === "print_run_number")?.directly_observed, true);

const mismatchedNormalizedValueCannotOverrideObserved = projectReadOnlyProviderSnapshot({
  provider_fields: { year: "2025" },
  observed_fields: { year: "2025" },
  normalized_evidence: {
    year: { value: "2024", normalized_value: "2024", status: "REVIEW" }
  }
});
assert.equal(mismatchedNormalizedValueCannotOverrideObserved.fields.year, "2025");
assert.equal(mismatchedNormalizedValueCannotOverrideObserved.normalized_evidence.year.value, "2025");

const mismatchedRootSourceCannotBypassNormalizationDrop = projectReadOnlyProviderSnapshot({
  provider_fields: { year: "2025" },
  observed_fields: {},
  normalized_evidence: {
    year: {
      value: "2025",
      normalized_value: "2025",
      status: "CONFIRMED",
      sources: [{ source_type: "OCR", observed_text: "2024" }]
    }
  },
  normalization: {
    input: { year: "2025" },
    output: {},
    decisions: [{ field: "year", decision: "DROP", reason: "NORMALIZED_EMPTY_OR_UNSUPPORTED" }]
  }
});
assert.equal(mismatchedRootSourceCannotBypassNormalizationDrop.fields.year, undefined);

const numericSubstringCannotAuthorizeEvidence = projectReadOnlyProviderSnapshot({
  provider_fields: { print_run_denominator: "25" },
  observed_fields: {},
  normalized_evidence: {
    print_run_denominator: {
      value: "25",
      normalized_value: "25",
      status: "CONFIRMED",
      sources: [{ source_type: "OCR", observed_text: "125" }]
    }
  },
  normalization: normalizationProjection({ print_run_denominator: "25" }, {})
});
assert.equal(numericSubstringCannotAuthorizeEvidence.fields.print_run_denominator, undefined);

const boundedPrintRunTokenCanAuthorizeDenominator = projectReadOnlyProviderSnapshot({
  provider_fields: { print_run_denominator: "25" },
  observed_fields: {},
  normalized_evidence: {
    print_run_denominator: {
      value: "25",
      normalized_value: "25",
      status: "CONFIRMED",
      sources: [{ source_type: "OCR", observed_text: "03/25" }]
    }
  },
  normalization: normalizationProjection({ print_run_denominator: "25" }, {})
});
assert.equal(boundedPrintRunTokenCanAuthorizeDenominator.fields.print_run_denominator, "25");

const invalidPrintRun = projectReadOnlyProviderSnapshot({
  normalized_evidence: {
    print_run_number: { value: "GJ1", normalized_value: "GJ1", status: "CONFIRMED" },
    print_run_denominator: { value: "1", normalized_value: "1", status: "CONFIRMED" }
  }
});
assert.equal(invalidPrintRun.fields.print_run_number, undefined);
assert.equal(invalidPrintRun.fields.print_run_denominator, undefined);

const rejectedEvidence = projectReadOnlyProviderSnapshot({
  provider_fields: { year: "2025", print_run_number: "03/25" },
  observed_fields: { year: "2025", players: ["UNKNOWN", "  "] },
  normalized_evidence: {
    year: { value: "2025", status: "CONFLICT" },
    serial_number: { value: "03/25", status: "CONFLICT" },
    card_grade: { value: "10", status: "MISSING" },
    product: { value: "Panini Phoenix", status: "NOT_APPLICABLE" }
  }
});
assert.deepEqual(rejectedEvidence.fields, {});
assert.deepEqual(rejectedEvidence.normalized_evidence, {});

const conflictedFullSerialCannotReenterThroughRawNumerator = projectReadOnlyProviderSnapshot({
  provider_fields: {
    print_run_number: "03/25",
    print_run_numerator: "03",
    print_run_denominator: "25"
  },
  observed_fields: {
    print_run_numerator: "03",
    print_run_denominator: "25"
  },
  normalized_evidence: {
    print_run_number: { value: "03/25", status: "CONFLICT" },
    print_run_denominator: {
      value: "25",
      normalized_value: "25",
      status: "CONFIRMED",
      sources: [{ source_type: "OCR", observed_text: "25" }]
    }
  }
});
assert.equal(conflictedFullSerialCannotReenterThroughRawNumerator.fields.print_run_number, "#/25");
assert.equal(conflictedFullSerialCannotReenterThroughRawNumerator.fields.print_run_numerator, undefined);
assert.equal(conflictedFullSerialCannotReenterThroughRawNumerator.fields.print_run_denominator, "25");

const mixedUnknownArray = projectReadOnlyProviderSnapshot({
  normalized_evidence: {
    players: {
      value: ["UNKNOWN", "Victor Wembanyama"],
      normalized_value: ["UNKNOWN", "Victor Wembanyama"],
      status: "CONFIRMED",
      sources: [{ source_type: "CARD_FRONT", observed_text: "Victor Wembanyama" }]
    }
  }
});
assert.deepEqual(mixedUnknownArray.fields.players, ["Victor Wembanyama"]);
assert.deepEqual(mixedUnknownArray.normalized_evidence.players.value, ["Victor Wembanyama"]);

const normalizationDropped = projectReadOnlyProviderSnapshot({
  provider_fields: { year: "2025", players: ["Victor Wembanyama"] },
  observed_fields: { players: ["Victor Wembanyama"] },
  normalized_evidence: {},
  normalization: {
    input: { year: "2025", players: ["Victor Wembanyama"] },
    output: { players: ["Victor Wembanyama"] },
    decisions: [
      { field: "year", decision: "DROP", reason: "NORMALIZED_EMPTY_OR_UNSUPPORTED" },
      { field: "players", decision: "PRESERVE" }
    ]
  }
});
assert.equal(normalizationDropped.fields.year, undefined);
assert.deepEqual(normalizationDropped.fields.players, ["Victor Wembanyama"]);

const normalizationDroppedUnprovenEvidence = projectReadOnlyProviderSnapshot({
  provider_fields: { year: "2025" },
  observed_fields: {},
  normalized_evidence: {
    year: { value: "2025", normalized_value: "2025", status: "CONFIRMED" }
  },
  normalization: normalizationProjection({ year: "2025" }, {})
});
assert.equal(normalizationDroppedUnprovenEvidence.fields.year, undefined);

const normalizationDroppedButIndependentOcr = projectReadOnlyProviderSnapshot({
  provider_fields: { year: "2025" },
  observed_fields: {},
  normalized_evidence: {
    year: {
      value: "2025",
      normalized_value: "2025",
      status: "CONFIRMED",
      sources: [{ source_type: "OCR_ONLY", observed_text: "2025" }]
    }
  },
  normalization: normalizationProjection({ year: "2025" }, {})
});
assert.equal(normalizationDroppedButIndependentOcr.fields.year, "2025");

const normalizationDroppedWithMismatchedOcrCandidate = projectReadOnlyProviderSnapshot({
  provider_fields: { year: "2025" },
  observed_fields: {},
  normalized_evidence: {
    year: {
      value: "2025",
      normalized_value: "2025",
      status: "CONFIRMED",
      sources: [{ source_type: "VISION_MODEL", observed_text: "2025" }],
      candidates: [{
        value: "2024",
        sources: [{ source_type: "OCR", observed_text: "2024" }]
      }]
    }
  },
  normalization: normalizationProjection({ year: "2025" }, {})
});
assert.equal(normalizationDroppedWithMismatchedOcrCandidate.fields.year, undefined);

const attributedCandidateSourceMustSupportItsValue = projectReadOnlyProviderSnapshot({
  provider_fields: { set: "Prizm" },
  observed_fields: {},
  normalized_evidence: {
    set: {
      value: "Prizm",
      normalized_value: "Prizm",
      status: "CONFIRMED",
      candidates: [{
        value: "Prizm",
        sources: [{ source_type: "OCR", observed_text: "Chrome" }]
      }]
    }
  },
  normalization: normalizationProjection({ set: "Prizm" }, {})
});
assert.equal(attributedCandidateSourceMustSupportItsValue.fields.set, undefined);

const normalizationDroppedWithMatchingOcrCandidate = projectReadOnlyProviderSnapshot({
  provider_fields: { year: "2025" },
  observed_fields: {},
  normalized_evidence: {
    year: {
      value: "2025",
      normalized_value: "2025",
      status: "CONFIRMED",
      sources: [{ source_type: "VISION_MODEL", observed_text: "2025" }],
      candidates: [{
        value: "2025",
        sources: [{ source_type: "OCR", observed_text: "2025" }]
      }]
    }
  },
  normalization: normalizationProjection({ year: "2025" }, {})
});
assert.equal(normalizationDroppedWithMatchingOcrCandidate.fields.year, "2025");

const normalizedEvidenceOnlyUnsourcedSerial = projectReadOnlyProviderSnapshot({
  provider_fields: { year: "2025" },
  observed_fields: { year: "2025" },
  normalized_evidence: {
    print_run_number: {
      value: "03/25",
      normalized_value: "03/25",
      status: "CONFIRMED",
      sources: []
    }
  },
  normalization: normalizationProjection({ year: "2025" }, { year: "2025" }),
  effective_terminal_renderer_inputs: {
    serial_numerator_verified: true,
    trust_resolved_print_run_without_evidence: true
  }
});
assert.equal(normalizedEvidenceOnlyUnsourcedSerial.fields.print_run_number, undefined);
assert.equal(normalizedEvidenceOnlyUnsourcedSerial.fields.print_run_numerator, undefined);
assert.equal(normalizedEvidenceOnlyUnsourcedSerial.fields.print_run_denominator, undefined);

const serialPrecisionDropKeepsOnlyDenominator = projectReadOnlyProviderSnapshot({
  provider_fields: { print_run_number: "03/25" },
  observed_fields: { print_run_denominator: "25" },
  normalized_evidence: {
    print_run_number: {
      value: "03/25",
      normalized_value: "03/25",
      status: "CONFIRMED",
      sources: [{ source_type: "OCR", observed_text: "03/25" }]
    },
    print_run_denominator: {
      value: "25",
      normalized_value: "25",
      status: "CONFIRMED",
      sources: [{ source_type: "OCR", observed_text: "25" }]
    }
  },
  normalization: {
    input: { print_run_number: "03/25" },
    output: { print_run_denominator: "25" },
    decisions: [
      { field: "print_run_number", decision: "DROP", reason: "NUMERATOR_UNVERIFIED" },
      { field: "print_run_denominator", decision: "DERIVE", reason: "DENOMINATOR_PRESERVED" }
    ]
  }
});
assert.equal(serialPrecisionDropKeepsOnlyDenominator.fields.print_run_number, "#/25");
assert.equal(serialPrecisionDropKeepsOnlyDenominator.fields.print_run_numerator, undefined);
assert.equal(serialPrecisionDropKeepsOnlyDenominator.fields.print_run_denominator, "25");

const unverifiedOneOfOneIsSuppressed = projectReadOnlyProviderSnapshot({
  provider_fields: { print_run_number: "1/1" },
  observed_fields: { print_run_denominator: "1", one_of_one: true },
  normalized_evidence: {},
  normalization: {
    input: { print_run_number: "1/1" },
    output: { print_run_denominator: "1" },
    decisions: [
      { field: "print_run_number", decision: "DROP", reason: "NUMERATOR_UNVERIFIED" },
      { field: "print_run_denominator", decision: "DERIVE", reason: "DENOMINATOR_PRESERVED" }
    ]
  },
  effective_terminal_renderer_inputs: {
    serial_numerator_verified: false,
    trust_resolved_print_run_without_evidence: true
  }
});
assert.equal(unverifiedOneOfOneIsSuppressed.fields.print_run_number, undefined);
assert.equal(unverifiedOneOfOneIsSuppressed.fields.print_run_denominator, undefined);
assert.equal(unverifiedOneOfOneIsSuppressed.fields.one_of_one, undefined);

for (const serialNumeratorVerified of [null, true]) {
  const conflictedOneOfOneCannotReenterFromDenominator = projectReadOnlyProviderSnapshot({
    provider_fields: { print_run_number: "1/1" },
    observed_fields: { print_run_denominator: "1" },
    normalized_evidence: {
      print_run_number: { value: "1/1", status: "CONFLICT" },
      print_run_denominator: {
        value: "1",
        normalized_value: "1",
        status: "CONFIRMED",
        sources: [{ source_type: "OCR", observed_text: "1" }]
      }
    },
    normalization: {
      input: { print_run_number: "1/1" },
      output: { print_run_denominator: "1" },
      decisions: [
        { field: "print_run_number", decision: "DROP", reason: "FULL_SERIAL_CONFLICT" },
        { field: "print_run_denominator", decision: "DERIVE", reason: "DENOMINATOR_PRESERVED" }
      ]
    },
    effective_terminal_renderer_inputs: {
      serial_numerator_verified: serialNumeratorVerified,
      trust_resolved_print_run_without_evidence: true
    }
  });
  assert.equal(conflictedOneOfOneCannotReenterFromDenominator.fields.print_run_number, undefined);
  assert.equal(conflictedOneOfOneCannotReenterFromDenominator.fields.print_run_numerator, undefined);
  assert.equal(conflictedOneOfOneCannotReenterFromDenominator.fields.print_run_denominator, undefined);
  assert.equal(conflictedOneOfOneCannotReenterFromDenominator.fields.one_of_one, undefined);
}

assert.equal(protectedReadParity(
  { print_run_denominator: "25" },
  { numbered_to: "25", numerical_rarity: "#/25", product: "Panini Phoenix", team: "Lakers" }
).matches, true);
assert.equal(protectedReadParity(
  { print_run_denominator: "25" },
  { serial_number: "03/25" }
).matches, false);
assert.equal(protectedReadParity(
  { year: "2025" },
  { year: "2025", product: "Panini Phoenix", team: "Lakers", parallel_exact: "Silver" }
).matches, true);
assert.equal(protectedReadParity(
  { year: "2025", ssp: false },
  { year: "2025" }
).matches, true, "sparse visible-mark booleans intentionally omit false defaults");

for (const serialNumeratorVerified of [true, false, null]) {
  const rendererInputs = {
    renderer_version: "renderer-v3-scg",
    max_title_length: 80,
    serial_numerator_verified: serialNumeratorVerified,
    trust_resolved_print_run_without_evidence: true,
    source: "baseline"
  };
  assert.equal(effectiveRendererParity(rendererInputs, { ...rendererInputs, source: "candidate" }).matches, true);
  for (const changedSerialState of [true, false, null].filter((value) => value !== serialNumeratorVerified)) {
    assert.equal(effectiveRendererParity(rendererInputs, {
      ...rendererInputs,
      serial_numerator_verified: changedSerialState
    }).matches, false);
  }
  assert.equal(effectiveRendererParity(rendererInputs, { ...rendererInputs, max_title_length: 79 }).matches, false);
  assert.equal(effectiveRendererParity(rendererInputs, {
    ...rendererInputs,
    trust_resolved_print_run_without_evidence: false
  }).matches, false);
}

const report = {
  results: [{
    asset_id: "asset-1",
    final_title: snapshot.final_title,
    reference_title: "2025 Panini Phoenix Fade To Black Victor Wembanyama",
    l2_candidate_debug: {
      retrieval_application: {
        enabled: true,
        selected_candidate_id: "official-1",
        decisions: [{
          candidate_id: "official-1",
          candidate_identity_id: "identity-1",
          candidate_lane: "catalog",
          resolver_field: "surface_color",
          resolver_value: "Gold",
          confidence: 0.72,
          source: "OFFICIAL_CHECKLIST",
          source_trust: "OFFICIAL_FACT",
          permission: "can_apply",
          decision: "APPLY",
          reason: "selected_candidate_safe_field_application"
        }]
      }
    },
    evaluation_decision_trace_packet: {
      replay_snapshot: snapshot,
      retrieval: {
        top_k: [{
          candidate_id: "official-1",
          source: "OFFICIAL_CHECKLIST",
          source_trust: "OFFICIAL_FACT",
          selected: true,
          field_actions: [{
            field: "product",
            value: "Panini Phoenix",
            action: "APPLY",
            reason: "SELECTED_CANDIDATE_SAFE_FIELD_APPLICATION"
          }]
        }]
      }
    }
  }]
};
const replay = await replayProviderOutputContract(report, { model });
assert.equal(replay.replayable_count, 1);
assert.equal(replay.forward_value_count, 1);
assert.ok(replay.rows[0].forward_value_fields.includes("product"));
assert.equal(replay.rows[0].forward_unknown_fields.includes("team"), true);
assert.equal(replay.rows[0].replay_snapshot_terminal_title_match, true);

const mismatchedNormalizedReplay = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-normalized-value-mismatch",
    final_title: "2024 Panini Phoenix Fade To Black Victor Wembanyama",
    reference_title: "2024 Panini Phoenix Fade To Black Victor Wembanyama",
    evaluation_decision_trace_packet: {
      replay_snapshot: {
        ...snapshot,
        normalized_evidence: {
          year: { value: "2024", normalized_value: "2024", status: "REVIEW" }
        },
        resolved_fields: { ...snapshot.resolved_fields, year: "2024" },
        rendered_fields: { ...snapshot.rendered_fields, year: "2024" },
        final_title: "2024 Panini Phoenix Fade To Black Victor Wembanyama"
      }
    }
  }]
}, { model });
assert.equal(mismatchedNormalizedReplay.replayable_count, 1);
assert.equal(mismatchedNormalizedReplay.rows[0].candidate_title.includes("2025"), true);
assert.equal(mismatchedNormalizedReplay.rows[0].candidate_title.includes("2024"), false);
assert.equal(mismatchedNormalizedReplay.gate_passed, false);

const incomplete = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-2",
    evaluation_decision_trace_packet: {
      replay_snapshot: { schema_version: "evaluation-replay-snapshot-v4", status: "PARTIAL" }
    }
  }]
}, { model });
assert.equal(incomplete.gate_passed, false);
assert.equal(incomplete.incomplete_snapshot_count, 1);

const unsupportedSchema = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-v1",
    evaluation_decision_trace_packet: {
      replay_snapshot: { ...snapshot, schema_version: "evaluation-replay-snapshot-v1" }
    }
  }]
}, { model });
assert.equal(unsupportedSchema.replayable_count, 0);
assert.equal(unsupportedSchema.rows[0].reason, "SNAPSHOT_SCHEMA_UNSUPPORTED");

const dishonestNormalizationDecision = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-dishonest-normalization-decision",
    final_title: snapshot.final_title,
    evaluation_decision_trace_packet: {
      replay_snapshot: {
        ...snapshot,
        normalization: {
          ...snapshot.normalization,
          decisions: snapshot.normalization.decisions.map((row) => (
            row.field === "year" ? { ...row, decision: "DROP" } : row
          ))
        }
      }
    }
  }]
}, { model });
assert.equal(dishonestNormalizationDecision.replayable_count, 0);
assert.equal(dishonestNormalizationDecision.rows[0].reason, "TRACE_MISSING_NORMALIZATION_PROJECTION");

const missingEffectiveRendererState = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-missing-effective-renderer",
    final_title: snapshot.final_title,
    evaluation_decision_trace_packet: {
      replay_snapshot: { ...snapshot, effective_terminal_renderer_inputs: undefined }
    }
  }]
}, { model });
assert.equal(missingEffectiveRendererState.replayable_count, 0);
assert.equal(
  missingEffectiveRendererState.rows[0].reason,
  "TRACE_MISSING_EFFECTIVE_SERIAL_PRESENTATION_STATE"
);

const serialRejectedTitle = "2025 Panini Victor Wembanyama Fade To Black #/25";
const serialRejected = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-serial-false",
    final_title: serialRejectedTitle,
    reference_title: serialRejectedTitle,
    evaluation_decision_trace_packet: {
      replay_snapshot: {
        ...snapshot,
        provider_fields: {
          year: "2025",
          manufacturer: "Panini",
          players: ["Victor Wembanyama"],
          card_name: "Fade To Black"
        },
        observed_fields: {
          year: "2025",
          manufacturer: "Panini",
          players: ["Victor Wembanyama"],
          card_name: "Fade To Black"
        },
        normalization: normalizationProjection(
          {
            year: "2025",
            manufacturer: "Panini",
            players: ["Victor Wembanyama"],
            card_name: "Fade To Black"
          },
          {
            year: "2025",
            manufacturer: "Panini",
            players: ["Victor Wembanyama"],
            card_name: "Fade To Black"
          }
        ),
        normalized_evidence: {
          print_run_number: {
            value: "03/25",
            normalized_value: "03/25",
            status: "CONFIRMED",
            sources: [{ source_type: "OCR", observed_text: "03/25" }]
          }
        },
        resolved_fields: {
          year: "2025",
          manufacturer: "Panini",
          players: ["Victor Wembanyama"],
          card_name: "Fade To Black",
          print_run_number: "#/25",
          print_run_denominator: "25"
        },
        rendered_fields: {
          year: "2025",
          manufacturer: "Panini",
          players: ["Victor Wembanyama"],
          card_name: "Fade To Black",
          print_run_number: "#/25",
          print_run_denominator: "25"
        },
        effective_terminal_renderer_inputs: {
          max_title_length: 80,
          serial_numerator_verified: false,
          trust_resolved_print_run_without_evidence: true,
          source: "test"
        },
        final_title: serialRejectedTitle
      }
    }
  }]
}, {
  model: emptyModel,
  allowConstraintModelChange: true
});
assert.equal(serialRejected.gate_passed, true, JSON.stringify(serialRejected.rows[0], null, 2));
assert.equal(serialRejected.rows[0].candidate_title, serialRejectedTitle);
assert.equal(serialRejected.rows[0].constraint_model_changed, true);
assert.equal(serialRejected.rows[0].constraint_model_change_allowed, true);

assert.equal(replayRowsPassGate([{
  replayable: true,
  baseline_policy_fair_token_recall: 1,
  replay_snapshot_terminal_title_match: true,
  protected_read_parity: false,
  effective_renderer_parity: true,
  title_changed: false,
  contract_regression: false
}], 1), false);

const unscored = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-unscored",
    final_title: snapshot.final_title,
    evaluation_decision_trace_packet: { replay_snapshot: snapshot }
  }]
}, { model });
assert.equal(unscored.replayable_count, 1);
assert.equal(unscored.scored_count, 0);
assert.equal(unscored.gate_passed, false);

const missingTerminalTitle = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-missing-terminal-title",
    final_title: "",
    reference_title: snapshot.final_title,
    evaluation_decision_trace_packet: { replay_snapshot: snapshot }
  }]
}, { model });
assert.equal(missingTerminalTitle.replayable_count, 0);
assert.equal(missingTerminalTitle.rows[0].reason, "TRACE_MISSING_TERMINAL_TITLE");

const reorderedBaselineTitle = "Victor Wembanyama 2025 Panini Fade To Black";
const reordered = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-reordered-title",
    final_title: reorderedBaselineTitle,
    reference_title: reorderedBaselineTitle,
    evaluation_decision_trace_packet: {
      replay_snapshot: {
        ...snapshot,
        provider_fields: {
          year: "2025",
          manufacturer: "Panini",
          players: ["Victor Wembanyama"],
          card_name: "Fade To Black"
        },
        observed_fields: {
          year: "2025",
          manufacturer: "Panini",
          players: ["Victor Wembanyama"],
          card_name: "Fade To Black"
        },
        normalization: normalizationProjection(
          {
            year: "2025",
            manufacturer: "Panini",
            players: ["Victor Wembanyama"],
            card_name: "Fade To Black"
          },
          {
            year: "2025",
            manufacturer: "Panini",
            players: ["Victor Wembanyama"],
            card_name: "Fade To Black"
          }
        ),
        normalized_evidence: {
          year: { value: "2025", normalized_value: "2025", status: "REVIEW" }
        },
        final_title: reorderedBaselineTitle
      }
    }
  }]
}, {
  model: emptyModel,
  allowConstraintModelChange: true
});
assert.equal(reordered.rows[0].title_changed, true);
assert.equal(reordered.rows[0].baseline_policy_fair_token_recall, 1);
assert.equal(reordered.rows[0].candidate_policy_fair_token_recall, 1);
assert.equal(reordered.gate_passed, false);

const normalizationDropTitle = "2025 Panini Test Player";
const normalizationDropReplay = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-normalization-drop",
    final_title: normalizationDropTitle,
    reference_title: normalizationDropTitle,
    evaluation_decision_trace_packet: {
      replay_snapshot: {
        ...snapshot,
        provider_fields: {
          year: "2025",
          manufacturer: "Panini",
          players: ["Test Player"]
        },
        observed_fields: {
          manufacturer: "Panini",
          players: ["Test Player"]
        },
        normalized_evidence: {
          manufacturer: { value: "Panini", normalized_value: "Panini", status: "REVIEW" }
        },
        normalization: {
          input: {
            year: "2025",
            manufacturer: "Panini",
            players: ["Test Player"]
          },
          output: {
            manufacturer: "Panini",
            players: ["Test Player"]
          },
          decisions: [
            { field: "year", decision: "DROP", reason: "NORMALIZED_EMPTY_OR_UNSUPPORTED" },
            { field: "manufacturer", decision: "PRESERVE" },
            { field: "players", decision: "PRESERVE" }
          ]
        },
        final_title: normalizationDropTitle
      }
    }
  }]
}, {
  model: emptyModel,
  allowConstraintModelChange: true
});
assert.equal(normalizationDropReplay.rows[0].candidate_title.includes("2025"), false);
assert.equal(normalizationDropReplay.gate_passed, false);

const implicitConstraintModelDriftIsRejected = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-constraint-drift",
    final_title: snapshot.final_title,
    reference_title: snapshot.final_title,
    evaluation_decision_trace_packet: { replay_snapshot: snapshot }
  }]
}, { model: emptyModel });
assert.equal(implicitConstraintModelDriftIsRejected.replayable_count, 0);
assert.equal(
  implicitConstraintModelDriftIsRejected.rows[0].reason,
  "CONSTRAINT_REPLAY_VERSION_MISMATCH"
);
assert.deepEqual(
  implicitConstraintModelDriftIsRejected.rows[0].mismatch_fields.sort(),
  ["constraint_snapshot", "constraint_snapshot_sha256"]
);

const unversionedConstraintCandidateIsRejected = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-unversioned-constraint-model",
    final_title: snapshot.final_title,
    reference_title: snapshot.final_title,
    evaluation_decision_trace_packet: { replay_snapshot: snapshot }
  }]
}, {
  model: {
    schema_version: "constraint-model-unversioned-test-v1",
    source_card_count: 0,
    player_teams: {},
    player_team_years: {},
    set_product_years: {}
  },
  allowConstraintModelChange: true
});
assert.equal(unversionedConstraintCandidateIsRejected.replayable_count, 0);
assert.equal(
  unversionedConstraintCandidateIsRejected.rows[0].reason,
  "CONSTRAINT_CANDIDATE_VERSION_MISSING"
);
assert.deepEqual(
  unversionedConstraintCandidateIsRejected.rows[0].missing_components,
  ["constraint_snapshot_sha256"]
);

const partialResolverVersionIsNotRepairable = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-3",
    final_title: snapshot.final_title,
    reference_title: "2025 Panini Phoenix Fade To Black Victor Wembanyama",
    evaluation_decision_trace_packet: {
      replay_snapshot: {
        ...snapshot,
        status: "PARTIAL",
        missing_components: ["resolver_version"]
      }
    }
  }]
}, { model });
assert.equal(partialResolverVersionIsNotRepairable.replayable_count, 0);
assert.equal(partialResolverVersionIsNotRepairable.rows[0].reason, "SNAPSHOT_PARTIAL");

const selfReportedCompleteButMissingRequiredComponents = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-incomplete-v4",
    final_title: snapshot.final_title,
    reference_title: snapshot.final_title,
    evaluation_decision_trace_packet: {
      replay_snapshot: {
        ...snapshot,
        status: "COMPLETE",
        normalized_evidence: {},
        provider_field_evidence: undefined,
        derivation_provenance: undefined,
        semantic_retrieval_application: undefined,
        versions: { renderer: "renderer-v3-scg" }
      }
    }
  }]
}, { model });
assert.equal(selfReportedCompleteButMissingRequiredComponents.replayable_count, 0);
assert.equal(selfReportedCompleteButMissingRequiredComponents.rows[0].reason, "SNAPSHOT_REQUIRED_COMPONENTS_MISSING");
assert.ok(selfReportedCompleteButMissingRequiredComponents.rows[0].missing_components.includes("normalized_evidence"));
assert.ok(selfReportedCompleteButMissingRequiredComponents.rows[0].missing_components.includes("pipeline_fingerprint"));
assert.ok(selfReportedCompleteButMissingRequiredComponents.rows[0].missing_components.includes("semantic_retrieval_application"));
assert.ok(selfReportedCompleteButMissingRequiredComponents.rows[0].missing_components.includes("provider_field_evidence"));
assert.ok(selfReportedCompleteButMissingRequiredComponents.rows[0].missing_components.includes("derivation_provenance"));
assert.ok(selfReportedCompleteButMissingRequiredComponents.rows[0].missing_components.includes("constraint_snapshot_version"));
assert.ok(selfReportedCompleteButMissingRequiredComponents.rows[0].missing_components.includes("constraint_snapshot_source_sha256"));
assert.ok(selfReportedCompleteButMissingRequiredComponents.rows[0].missing_components.includes("constraint_enumerator_version"));

console.log("provider output contract replay tests passed");
