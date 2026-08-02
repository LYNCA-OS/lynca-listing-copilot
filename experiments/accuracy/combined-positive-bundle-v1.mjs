// Evaluation-only composition of replay-positive accuracy mechanisms.
//
// This module has no provider, persistence, deployment, or production-path
// authority. It receives previously captured typed fields and observations,
// applies each mechanism in a fixed order, and exposes the complete stage
// ledger. Scoring labels and cohort identifiers are deliberately outside this
// boundary.

import { composeFromCanonicalFields } from "../../lib/listing/thin/canonical-composer.mjs";
import { applyAccuracyExpressionOverlayV1 } from "../../lib/listing/thin/accuracy-expression-overlay-v1.mjs";
import { applyAccuracySchema73MechanismV1 } from "../../lib/listing/thin/accuracy-schema73-overlay-v1.mjs";
import {
  buildPhraseAwareCandidatesV1,
  resolvePhraseAwareCandidatesV1
} from "../../lib/listing/thin/accuracy-phrase-aware-resolver-v1.mjs";
import { composeWithGeneralizableDownstreamRecoveryV1 } from "./composer-downstream-generalizable-v1.mjs";
import { composeWithLotContractRecoveryV1 } from "./lot-contract-recovery-v1.mjs";

export const COMBINED_POSITIVE_BUNDLE_V1 = "combined-positive-bundle-v1";

export const COMBINED_POSITIVE_MECHANISMS_V1 = Object.freeze([
  "candidate_identity_v3",
  "attested_insert",
  "finish_family_color_only",
  "product_known_manufacturer_extension",
  "serial_single_digit_v1",
  "exact_season_suffix",
  "front_same_value_serial",
  "typed_exact_admission",
  "phrase_aware_resolver_guard",
  "typed_product_finish_compaction",
  "exact_parallel_color_compaction",
  "compact_lot_quantity"
]);

// `candidate_identity_v3` was selected on the development cohort and is not
// eligible for the independent paid arm. The remaining mechanisms stay in the
// same fixed order so a paid replay cannot silently choose a more favorable
// sequence after seeing labels.
export const COMBINED_POSITIVE_PAID_MECHANISMS_V1 = Object.freeze(
  COMBINED_POSITIVE_MECHANISMS_V1.filter((name) => name !== "candidate_identity_v3")
);

const copy = (value) => structuredClone(value ?? {});
const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .split(/[^a-z0-9/']+/)
  .filter(Boolean));

function titleLosses(before, after) {
  const next = tokens(after);
  return [...tokens(before)].filter((token) => !next.has(token));
}

function changedFields(before, after) {
  const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...names].filter((name) => JSON.stringify(before?.[name]) !== JSON.stringify(after?.[name]));
}

function stage(name, beforeFields, afterFields, beforeTitle, afterTitle, {
  actions = [],
  rejected = [],
  decisions = []
} = {}) {
  return {
    mechanism: name,
    before_title: beforeTitle,
    after_title: afterTitle,
    changed_title: beforeTitle !== afterTitle,
    changed_fields: changedFields(beforeFields, afterFields),
    before_fields: copy(beforeFields),
    after_fields: copy(afterFields),
    actions: copy(actions),
    rejected: copy(rejected),
    decisions: copy(decisions)
  };
}

function guardPhraseDecisions(fields, decisions) {
  let virtual = copy(fields);
  return decisions.map((row) => {
    if (row.decision !== "admit") return row;
    // A generic logo role does not prove whether an identity phrase belongs
    // in Product, Set, or IP. Keep exact-identity registry hits as visible
    // candidates until a fresh cohort or stronger typed role validates the
    // routing; they do not receive automatic title authority in this bundle.
    if (row.candidate_family === "exact_identity_phrase") {
      return {
        ...row,
        decision: "candidate_only",
        admission_reason: "generic_logo_identity_role_hold",
        resolver_admission_reason: row.admission_reason
      };
    }
    const before = composeFromCanonicalFields(virtual);
    const next = copy(virtual);
    next[row.candidate_field] = row.candidate_value;
    const after = composeFromCanonicalFields(next);
    const displaced = titleLosses(before.title, after.title);
    if (displaced.length || after.length > 80) {
      return {
        ...row,
        decision: "candidate_only",
        admission_reason: displaced.length
          ? "composer_displacement_guard"
          : "composer_over_80_guard",
        resolver_admission_reason: row.admission_reason,
        displaced_title_tokens: displaced
      };
    }
    virtual = next;
    return row;
  });
}

function applyAdmittedPhraseDecisions(fields, decisions) {
  const next = copy(fields);
  for (const row of decisions) {
    if (row.decision === "admit") next[row.candidate_field] = row.candidate_value;
  }
  return next;
}

function runExpressionStage(currentFields, context, name, {
  mechanisms = [],
  includeSerial = false,
  includeCandidateIdentity = false
} = {}) {
  const before = copy(currentFields);
  const beforeTitle = composeFromCanonicalFields(before).title;
  const replay = applyAccuracyExpressionOverlayV1(before, {
    ...context,
    candidateFacts: includeCandidateIdentity ? context.candidateFacts : [],
    mechanisms,
    includeSerial
  });
  return {
    fields: replay.fields,
    title: replay.composed.title,
    ledger: stage(name, before, replay.fields, beforeTitle, replay.composed.title, {
      actions: replay.changes,
      rejected: replay.rejected
    })
  };
}

/**
 * Run the fixed evaluation bundle. Extra caller properties are ignored.
 */
export function runCombinedPositiveBundleV1(canonicalFields = {}, {
  expressionFields = {},
  expressionTitle = "",
  candidateFacts = [],
  observations = [],
  provenance = {},
  enabledMechanisms = COMBINED_POSITIVE_MECHANISMS_V1
} = {}) {
  let fields = copy(canonicalFields);
  let title = composeFromCanonicalFields(fields).title;
  const baseline = { fields: copy(fields), title };
  const stages = [];
  const enabled = new Set(enabledMechanisms ?? []);
  for (const name of enabled) {
    if (!COMBINED_POSITIVE_MECHANISMS_V1.includes(name)) {
      throw new Error(`unknown_combined_positive_mechanism:${name}`);
    }
  }
  const noChange = (name) => stage(name, fields, fields, title, title);
  const expressionContext = {
    expressionFields,
    expressionTitle,
    candidateFacts,
    observations
  };

  const expressionStages = [
    ["candidate_identity_v3", {
      mechanisms: [],
      includeSerial: false,
      includeCandidateIdentity: true
    }],
    ["attested_insert", { mechanisms: ["attested_insert"], includeSerial: false }],
    ["finish_family_color_only", { mechanisms: ["finish_family_color_only"], includeSerial: false }],
    ["product_known_manufacturer_extension", {
      mechanisms: ["product_known_manufacturer_extension"],
      includeSerial: false
    }],
    ["serial_single_digit_v1", { mechanisms: [], includeSerial: true }]
  ];
  for (const [name, config] of expressionStages) {
    if (!enabled.has(name)) {
      stages.push(noChange(name));
      continue;
    }
    const replay = runExpressionStage(fields, expressionContext, name, config);
    fields = replay.fields;
    title = replay.title;
    stages.push(replay.ledger);
  }

  for (const name of ["exact_season_suffix", "front_same_value_serial", "typed_exact_admission"]) {
    if (!enabled.has(name)) {
      stages.push(noChange(name));
      continue;
    }
    const before = copy(fields);
    const beforeTitle = title;
    const replay = applyAccuracySchema73MechanismV1(name, before, { observations });
    fields = replay.fields;
    title = composeFromCanonicalFields(fields).title;
    stages.push(stage(name, before, fields, beforeTitle, title, { actions: replay.changes }));
  }

  {
    if (!enabled.has("phrase_aware_resolver_guard")) {
      stages.push(noChange("phrase_aware_resolver_guard"));
    } else {
    const before = copy(fields);
    const beforeTitle = title;
    const candidates = buildPhraseAwareCandidatesV1(before, observations, { provenance });
    const resolved = resolvePhraseAwareCandidatesV1(before, candidates);
    const decisions = guardPhraseDecisions(before, resolved);
    fields = applyAdmittedPhraseDecisions(before, decisions);
    title = composeFromCanonicalFields(fields).title;
    stages.push(stage("phrase_aware_resolver_guard", before, fields, beforeTitle, title, {
      actions: decisions.filter((row) => row.decision === "admit"),
      rejected: decisions.filter((row) => row.decision === "candidate_only"),
      decisions
    }));
    }
  }

  for (const name of ["typed_product_finish_compaction", "exact_parallel_color_compaction"]) {
    if (!enabled.has(name)) {
      stages.push(noChange(name));
      continue;
    }
    const before = copy(fields);
    const beforeTitle = title;
    const replay = composeWithGeneralizableDownstreamRecoveryV1(before, {
      enabledMechanisms: [name]
    });
    fields = replay.fields;
    title = replay.candidate.title;
    stages.push(stage(name, before, fields, beforeTitle, title, {
      actions: replay.applied,
      rejected: replay.rejected
    }));
  }

  {
    if (!enabled.has("compact_lot_quantity")) {
      stages.push(noChange("compact_lot_quantity"));
    } else {
    const before = copy(fields);
    const beforeTitle = title;
    const replay = composeWithLotContractRecoveryV1(before, {
      enabledMechanisms: ["compact_lot_quantity"]
    });
    if (replay.baseline.title !== beforeTitle) {
      throw new Error("combined_positive_bundle_composition_mismatch");
    }
    fields = replay.fields;
    title = replay.candidate.title;
    stages.push(stage("compact_lot_quantity", before, fields, beforeTitle, title, {
      actions: replay.applied,
      rejected: replay.rejected
    }));
    }
  }

  if (stages.map((row) => row.mechanism).join("\n") !== COMBINED_POSITIVE_MECHANISMS_V1.join("\n")) {
    throw new Error("combined_positive_bundle_stage_order_mismatch");
  }
  if (title.length > 80) throw new Error(`combined_positive_bundle_over_80:${title.length}`);

  return {
    schema_version: COMBINED_POSITIVE_BUNDLE_V1,
    authority: "evaluation_only",
    production_promoted: false,
    provider_calls: 0,
    baseline,
    candidate: { fields: copy(fields), title },
    stages
  };
}
