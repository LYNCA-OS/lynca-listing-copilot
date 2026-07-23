import { buildFieldGraph } from "../../feedback/field_graph.mjs";
import { normalizePrintedCardCodeForFields } from "../../pipeline/field-normalization.mjs";
import { expandPrintRunFields } from "../../print-run/print-run-fields.mjs";
import { sanitizeGradeFields } from "../../grade/grade-value.mjs";
import { sanitizeIdentityCardNameValue } from "../../pipeline/text.mjs";
import { safeSurfaceColor } from "../../parallel-policy.mjs";

function normalizeText(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || "";
}

function hasFieldValue(value) {
  if (Array.isArray(value)) return value.some(hasFieldValue);
  if (value && typeof value === "object") return Object.values(value).some(hasFieldValue);
  if (typeof value === "boolean") return true;
  return value !== null && value !== undefined && normalizeText(value) !== "";
}

function mergeMeaningfulFieldSources(...sources) {
  const output = {};
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const [field, value] of Object.entries(source)) {
      // A later presentation surface is more authoritative only when it
      // actually carries a value. Sparse/null renderer scaffolding must not
      // erase an observation that the resolver already retained.
      if (hasFieldValue(value)) output[field] = value;
      else if (!Object.hasOwn(output, field)) output[field] = value;
    }
  }
  return output;
}

function sanitizeStructuralFields(fields = {}) {
  const output = sanitizeGradeFields(fields);
  output.card_name = sanitizeIdentityCardNameValue(output.card_name);
  const cardName = normalizeText(output.card_name);
  // PSA-style labels expose a field descriptor such as `SPLTNG.IMG - BLACK
  // SCOPE`. It is evidence about the parallel, never the collectible's card
  // name. Keep the parallel field and prevent this label key from leaking into
  // the CSM title when V4 reconciles authoritative evidence.
  if (/\b(?:SPLT{1,2}NG\.?\s*IMG|PARALLEL(?:\s+NAME)?)\b\s*[-–—:]/i.test(cardName)
      || /^(?:\(?\s*)?(?:no\s+named\s+insert|no\s+insert|not\s+visible|none\s+visible)(?:\s+visible)?(?:\s*\)?)$/i.test(cardName)) {
    output.card_name = null;
  }
  // V4 merges several structured surfaces after the legacy normalization
  // pass. Re-apply the printed-code contract at the canonical boundary so
  // player names and label prose cannot re-enter the title as `#...`.
  for (const field of ["card_number", "collector_number", "checklist_code"]) {
    output[field] = normalizePrintedCardCodeForFields(output[field], output);
  }
  const explicitPrintRun = expandPrintRunFields({
    print_run_number: output.print_run_number,
    print_run_numerator: output.print_run_numerator,
    print_run_denominator: output.print_run_denominator,
    serial_number: output.serial_number,
    serial_denominator: output.serial_denominator,
    numerical_rarity: output.numerical_rarity
  });
  const canonicalPrintRun = normalizeText(explicitPrintRun.print_run_number)
    .replace(/^#/, "")
    .replace(/\s*\/\s*/g, "/");
  if (canonicalPrintRun) {
    for (const field of ["card_number", "collector_number", "checklist_code"]) {
      const code = normalizeText(output[field]).replace(/^#/, "").replace(/\s*\/\s*/g, "/");
      if (code && code === canonicalPrintRun) output[field] = null;
    }
  }
  return output;
}

function resolvedFieldsFrom(result = {}) {
  const renderedFields = result.rendered_fields && typeof result.rendered_fields === "object"
    && !Array.isArray(result.rendered_fields)
    && result.rendered_fields.fields && typeof result.rendered_fields.fields === "object"
    && !Array.isArray(result.rendered_fields.fields)
    ? result.rendered_fields.fields
    : {};
  return mergeMeaningfulFieldSources(
    result.fields,
    result.resolved,
    result.resolved_fields,
    renderedFields
  );
}

function unresolvedSet(result = {}) {
  return new Set((Array.isArray(result.unresolved) ? result.unresolved : [])
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean));
}

function conflictIsResolved(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.resolved === true || value.is_resolved === true) return true;
  return /^(?:RESOLVED|OVERRIDDEN|ACCEPTED)$/i.test(normalizeText(
    value.status || value.resolution_status || value.decision
  ));
}

function explicitConflictFields(result = {}) {
  const fields = new Set();
  const push = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "object") {
      // A resolved override is part of the audit trail, not a reason to erase
      // the canonical value a second time at the V4 boundary.
      if (conflictIsResolved(value)) return;
      push(value.field || value.field_name || value.name);
      return;
    }
    const normalized = normalizeText(value).toLowerCase();
    if (normalized) fields.add(normalized);
  };
  push(result.conflict_map);
  push(result.conflicts);
  push(result.field_conflicts);
  return fields;
}

function displayConflictFields(result = {}) {
  const fields = explicitConflictFields(result);
  for (const state of Array.isArray(result.field_states) ? result.field_states : Object.values(result.field_states || {})) {
    if (!/CONFLICT/i.test(normalizeText(state?.display_status || state?.status))) continue;
    const field = normalizeText(state?.field || state?.field_name || state?.name).toLowerCase();
    if (field) fields.add(field);
  }
  return fields;
}

const conflictFieldGroups = Object.freeze([
  ["player", "players", "subject", "character"],
  ["parallel", "parallel_exact", "exact_parallel"],
  ["serial", "serial_number", "serial_denominator", "print_run_number", "print_run_numerator", "print_run_denominator", "numbered_to", "numerical_rarity"],
  ["grade", "grade_company", "card_grade", "auto_grade", "grade_type"],
  ["card_number", "collector_number", "checklist_code", "tcg_card_number"]
]);

function conflictGroupMembers(field) {
  return conflictFieldGroups.find((members) => members.includes(field)) || [field];
}

function upstreamDraftIncludedFields(result = {}) {
  const gate = result.draft_gate || result.publication_gate?.draft_gate;
  const policies = gate?.by_field && typeof gate.by_field === "object"
    ? Object.values(gate.by_field)
    : Array.isArray(gate?.fields)
      ? gate.fields
      : [];
  const included = new Set();
  for (const policy of policies) {
    const displayPolicy = normalizeText(policy?.display_policy).toUpperCase();
    const field = normalizeText(policy?.field).toLowerCase();
    if (!field || !["INCLUDE_NORMAL", "INCLUDE_HIGHLIGHTED"].includes(displayPolicy)) continue;
    if (!hasFieldValue(policy?.selected_value)) continue;
    conflictGroupMembers(field).forEach((member) => included.add(member));
  }
  return included;
}

function upstreamPipelineRetainedFields(result = {}) {
  const rows = result.pipeline_node_ledger?.field_flow?.fields;
  if (!Array.isArray(rows)) return new Set();

  const retained = new Set();
  for (const row of rows) {
    const field = normalizeText(row?.field_group || row?.field).toLowerCase();
    if (!field || row?.resolved_present !== true || row?.rendered_present !== true) continue;
    const disposition = normalizeText(row?.pipeline_disposition || row?.disposition).toUpperCase();
    if ([
      "UNEXPLAINED_RESOLUTION_DROP",
      "INTENTIONALLY_ROUTED_TO_REVIEW",
      "INTENTIONALLY_REJECTED_BY_NORMALIZATION_GUARD"
    ].includes(disposition)) continue;
    conflictGroupMembers(field).forEach((member) => retained.add(member));
  }
  return retained;
}

function fieldsWithoutConflicts(fields = {}, result = {}) {
  const conflicts = explicitConflictFields(result);
  if (!conflicts.size) return fields;
  const upstreamIncluded = new Set([
    ...upstreamDraftIncludedFields(result),
    ...upstreamPipelineRetainedFields(result)
  ]);
  const blocked = new Set();
  for (const field of conflicts) {
    conflictGroupMembers(field).forEach((member) => {
      if (!upstreamIncluded.has(member)) blocked.add(member);
    });
  }
  const output = { ...fields };
  for (const field of blocked) {
    if (Object.hasOwn(output, field)) output[field] = null;
  }
  return output;
}

function normalizedObservedPlayerValues(values = []) {
  const output = [];
  const comparablePlayer = (value) => normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  for (const raw of values.flat(Infinity)) {
    const text = normalizeText(raw);
    if (!text) continue;
    const parts = /[|/;]/.test(text)
      ? text.split(/\s*[|/;]\s*/).map(normalizeText).filter(Boolean)
      : [text];
    for (const part of parts) {
      const comparable = comparablePlayer(part);
      if (!part || !comparable || output.some((existing) => comparablePlayer(existing) === comparable)) continue;
      output.push(part);
    }
  }
  return output;
}

function selectedCandidateOwnsTrustedCorrection(result = {}, field = "") {
  const application = result.selected_candidate_safe_field_application;
  const candidateId = normalizeText(application?.candidate_id);
  if (!candidateId || application?.status !== "ready_fill_missing" || application?.renderer_application_allowed !== true) {
    return false;
  }
  if (!(application.eligible_fields || []).map(normalizeText).includes(field)) return false;
  const trace = (Array.isArray(result.candidate_application_trace) ? result.candidate_application_trace : [])
    .find((row) => normalizeText(row?.candidate_id) === candidateId);
  if (trace?.decision_eligible !== true) return false;
  if ((trace.anchor_agreement?.authoritative_overrides || []).includes("reviewed_current_source_identity_match")) {
    return true;
  }
  const agreed = new Set((trace.anchor_agreement?.agreed || []).map(normalizeText));
  const contradicted = (trace.anchor_agreement?.contradicted || []).map(normalizeText).filter(Boolean);
  return trace.source_type === "INTERNAL_APPROVED_HISTORY"
    && trace.source_trust === "APPROVED_REFERENCE"
    && contradicted.length === 0
    && ["year", "subjects", "product_hierarchy", "serial_denominator"].every((anchor) => agreed.has(anchor));
}

function selectedCandidateTrustedFieldValue(result = {}, field = "") {
  if (!selectedCandidateOwnsTrustedCorrection(result, field)) return null;
  const candidateId = normalizeText(result.selected_candidate_safe_field_application?.candidate_id);
  const decisions = Array.isArray(result.retrieval_application?.decisions)
    ? result.retrieval_application.decisions
    : [];
  return decisions.find((row) => (
    normalizeText(row?.candidate_id) === candidateId
    && normalizeText(row?.field) === field
    && hasFieldValue(row?.candidate_value)
  ))?.candidate_value ?? null;
}

export function applySafeCurrentImageMultiCardInference(fields = {}) {
  const output = { ...fields };
  // Subject count is not physical-card count. Preserve explicit upstream lot
  // evidence, but never manufacture multi_card/card_count from a name list.
  // A boolean detector/model signal without a physical count is diagnostic,
  // not enough evidence to switch the title grammar to Lot. Independent lot
  // detection and operator input both have a concrete count when admitted.
  const cardCount = Number(output.card_count);
  if (output.multi_card === true && (!Number.isInteger(cardCount) || cardCount < 2)) {
    output.multi_card = false;
    output.card_count = null;
    output.lot_type = null;
    return output;
  }
  if (output.multi_card === true && !hasFieldValue(output.lot_type)) {
    output.lot_type = "CURRENT_IMAGE_MULTI_CARD_REVIEW";
  }
  return output;
}

function currentImageObservationFloor(fields = {}, result = {}) {
  const snapshot = result.candidate_observation_snapshot;
  const output = { ...fields };
  const directObservationSources = [
    result.raw_provider_fields,
    result.raw_observed_fields
  ].filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const observationSources = [
    ...directObservationSources,
    snapshot
  ].filter((value) => value && typeof value === "object" && !Array.isArray(value));
  // Subject identity must come from the current image observation itself.
  // Candidate snapshots and field-flow ledgers can contain both a base name
  // and a catalog-expanded form of that same person; counting those surfaces
  // as separate subjects incorrectly switches a single card into the
  // MULTI_SUBJECT_REVIEW renderer and silently drops high-value modules.
  const observedPlayers = normalizedObservedPlayerValues([
    ...directObservationSources.flatMap((source) => [source.players, source.player])
  ]);

  // A card draft without its observed subject is unusable. Catalog ambiguity
  // may keep the field highlighted for writer review, but it must not erase
  // the immutable current-image observation at the final V4/CSM boundary.
  // This does not authorize auto-publish and never copies candidate identity.
  if (observedPlayers.length) {
    const currentPlayers = normalizedObservedPlayerValues([output.players, output.player]);
    if (currentPlayers.length && currentPlayers.length !== (Array.isArray(output.players) ? output.players.length : 0)) {
      output.players = currentPlayers;
    }
    const currentIsObserved = currentPlayers.every((current) => observedPlayers.some(
      (observed) => observed.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
        === current.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    ));
    if (!currentPlayers.length || currentIsObserved && observedPlayers.length > currentPlayers.length) {
      output.players = observedPlayers;
      if (output.multi_card === true) {
        if (!hasFieldValue(output.lot_type)) output.lot_type = "CURRENT_IMAGE_MULTI_CARD_REVIEW";
      }
    }
  }

  // The adapter can run more than once while a durable job is finalized. Keep
  // explicit upstream lot evidence stable, without inferring quantity from
  // the number of subject names.
  Object.assign(output, applySafeCurrentImageMultiCardInference(output));

  // Safe current-image observations may fill a resolver gap even when catalog
  // ambiguity merely leaves the field unresolved. A declared resolver
  // conflict is different: restoring the raw observation there would bypass
  // conflict resolution and serialize a value the resolver deliberately
  // removed. Exact parallels, serial numerators, grades, and other high-risk
  // fields are intentionally absent from the floor.
  const conflicts = displayConflictFields(result);
  for (const field of ["year", "product", "character"]) {
    const conflictAliases = conflictGroupMembers(field);
    if (conflictAliases.some((alias) => conflicts.has(alias))) continue;
    const observedValue = observationSources.map((source) => source[field]).find(hasFieldValue);
    if (hasFieldValue(output[field]) || !hasFieldValue(observedValue)) continue;
    output[field] = observedValue;
  }

  // Exact optical finishes still require textual/catalog verification, but a
  // single basic color is an intentionally safe visual reduction. Preserve
  // that current-image observation across catalog conflicts without copying
  // Wave/Shimmer/Refractor-style detail into the canonical title.
  const directSurfaceColor = directObservationSources
    .map((source) => safeSurfaceColor(
      source.surface_color
      || source.parallel_exact
      || source.parallel
      || source.variation
      || ""
    ))
    .find(Boolean);
  const authoritativeCatalogColor = safeSurfaceColor(
    selectedCandidateTrustedFieldValue(result, "surface_color") || ""
  );
  const authoritativeCatalogOwnsColor = selectedCandidateOwnsTrustedCorrection(result, "surface_color");
  if (authoritativeCatalogColor) output.surface_color = authoritativeCatalogColor;
  else if (directSurfaceColor && !authoritativeCatalogOwnsColor) output.surface_color = directSurfaceColor;

  return output;
}

function displayStatusFor(field, result = {}) {
  const unresolved = unresolvedSet(result);
  const conflicts = displayConflictFields(result);
  const key = normalizeText(field).toLowerCase();
  const aliases = conflictGroupMembers(key);
  if (aliases.some((alias) => conflicts.has(alias))) return "CONFLICT";
  if (aliases.some((alias) => unresolved.has(alias))) return "REVIEW";
  return "NORMAL";
}

function valueHasExplicitUncertainty(value) {
  if (Array.isArray(value)) return value.some(valueHasExplicitUncertainty);
  const text = normalizeText(value);
  return Boolean(text && (
    /\?/u.test(text)
    || /\b(?:visible\s+partial|partial\s+wording|uncertain|unclear|illegible|possibly|likely)\b/i.test(text)
    || /\b(?:Edition|Ed\.?)[\s]*[-:][\s]*(?=(?:Aqua|Gold|Green|Red|Blue|Purple|Orange|Black|Silver)\b)/i.test(text)
  ));
}

function fieldState(field, value, result = {}) {
  const explicitStatus = displayStatusFor(field, result);
  const status = explicitStatus === "NORMAL" && valueHasExplicitUncertainty(value)
    ? "REVIEW"
    : explicitStatus;
  return {
    field,
    value: value === undefined ? null : value,
    display_status: status,
    writer_visible: false,
    confidence_band: status === "NORMAL" ? "usable" : "needs_review"
  };
}

export function buildV4FieldGraph(result = {}, payload = {}) {
  return buildFieldGraph({
    // Field states and persisted canonical fields must share one sanitizer.
    // Otherwise invalid OCR/model codes can appear NORMAL in the graph after
    // the canonical identity boundary has correctly removed them.
    resolved: buildV4ResolvedFields(result),
    evidence: result.provider_evidence || result.evidence || {},
    retrievalTrace: result.retrieval_trace || {},
    openSetReadiness: result.open_set_readiness || {},
    workflowSidecars: result.workflow_sidecars || payload.workflow_sidecars || {}
  });
}

export function buildV4ResolvedFields(result = {}) {
  const fields = currentImageObservationFloor(
    fieldsWithoutConflicts(
      sanitizeStructuralFields(resolvedFieldsFrom(result)),
      result
    ),
    result
  );
  return {
    ...fields,
    ...expandPrintRunFields(fields)
  };
}

export function buildV4FieldStates(result = {}, payload = {}) {
  const fieldGraph = buildV4FieldGraph(result, payload);
  const compact = {
    player: fieldGraph.player,
    year: fieldGraph.year,
    product: fieldGraph.product,
    card_type: fieldGraph.card_type,
    parallel: fieldGraph.parallel,
    serial: fieldGraph.serial,
    card_number: fieldGraph.card_number,
    grade: fieldGraph.grade
  };
  return Object.fromEntries(
    Object.entries(compact).map(([field, value]) => [field, fieldState(field, value, result)])
  );
}

export function buildV4FieldEvidenceRows({ sessionId, result = {}, payload = {} } = {}) {
  const fieldStates = buildV4FieldStates(result, payload);
  const fieldGraph = buildV4FieldGraph(result, payload);
  return Object.values(fieldStates).map((state) => ({
    id: `${sessionId}_${state.field}`,
    field_name: state.field,
    field_value: state.value,
    display_status: state.display_status,
    confidence: state.confidence_band === "usable" ? 0.8 : 0.45,
    source_type: "V4_FIELD_GRAPH",
    provenance: {
      source_fields: fieldGraph.field_nodes?.[state.field]?.source_fields || [],
      evidence_sources: fieldGraph.field_nodes?.[state.field]?.evidence_sources || [],
      structured_only: true
    }
  }));
}
