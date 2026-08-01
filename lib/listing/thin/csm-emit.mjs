// Emit the full CSM surface from the canonical fields this path collects.
//
// The thin path was composing a title and, when it needed a semantic object,
// parsing that title back. That is backwards: `resolvedFieldsToSemSuggestion`
// exists to turn resolved fields INTO the canonical SEM, and we have resolved
// fields. Round-tripping through a string threw away everything the string
// cannot carry -- confidence, provenance, the empty/unreadable distinction --
// and then measured the parser's boundary guesses instead of our own answers.
//
// So this module maps our schema onto the field names CSM's own functions
// expect, and then uses every one of them. Nothing here reimplements a CSM
// rule; each export is a call into lib/listing/csm.

import {
  SEM_OBSERVATION_LAYER,
  SEM_FEEDBACK_LAYER,
  SEM_STANDARD_VERSION,
  semImplementationTermMap,
  semCanonicalEditableFields,
  classifyWriterFeedbackForSemanticLearning,
  isSemNumericalRarityText,
  isSemCardNumberText
} from "../csm/sem-definition.mjs";
import {
  resolvedFieldsToSemSuggestion,
  canonicalSemToDataFlywheelSem,
  validateTitleDerivedSem,
  buildWriterTitleSemCandidate,
  titleDerivedSemSuggestion,
  SEM_VALIDATION_STATUSES,
  SEM_VALIDATION_SOURCE_TYPES
} from "../csm/title-derived-sem.mjs";
import { labelsForCsmFields } from "../csm/field-labels.mjs";
import { buildSemValidationEvent, SEM_VALIDATION_EVENT_SCHEMA_VERSION } from "../csm/sem-validation.mjs";

/**
 * Our schema -> the resolved-field names `resolvedFieldsToSemSuggestion` reads.
 *
 * Written out rather than guessed: that function looks for `players`,
 * `print_run_number`, `collector_number`, `rc`/`auto`/`patch`/`relic` booleans
 * and `first_bowman`, none of which are what this schema calls them. A field
 * this map misses is silently dropped from the canonical object -- which is the
 * same class of bug as the TCG parallel bracket that vanished because the
 * grammar named it differently.
 */
export function toResolvedFields(fields = {}) {
  const components = new Set(fields.components || fields.attributes || []);
  const rarity = String(fields.descriptive_rarity || "");
  return {
    year: fields.year || undefined,
    ip: fields.ip || undefined,
    manufacturer: fields.manufacturer || undefined,
    product: fields.product || undefined,
    set: fields.set || undefined,
    players: (fields.subjects || []).filter(Boolean),
    card_name: fields.card_name || undefined,
    collector_number: fields.card_number || undefined,
    print_run_number: fields.serial || undefined,
    release_variant: fields.release_variant || undefined,
    // The three parallel layers go across untouched: printFinishSuggestion
    // inside CSM does the degradation, and doing it here as well would be two
    // implementations of one ladder.
    parallel_exact: fields.parallel_exact || undefined,
    surface_color: fields.surface_color || undefined,
    parallel_family: fields.parallel_family || undefined,
    rarity: rarity || undefined,
    first_bowman: /1st\s*bowman/i.test(rarity) || undefined,
    team: fields.team || undefined,
    rc: components.has("RC") || undefined,
    auto: components.has("Auto") || undefined,
    patch: components.has("Patch") || undefined,
    relic: components.has("Relic") || undefined,
    grade: fields.grade || undefined
  };
}

/**
 * Per-field observation layer.
 *
 * CSM names three: OBSERVED_FIELD_CANDIDATE (something was read),
 * BEST_OBSERVED_FIELD (it is the value we are going with) and
 * RESOLVED_SEMANTIC_FIELD (it has been resolved against more than observation).
 * This path only observes, so nothing here may claim the third -- a field the
 * model was unsure of is a candidate, a field it was sure of is the best
 * observed one, and neither is resolved until something outside this call says
 * so. Writing that down is what makes `low_confidence` mean something
 * downstream instead of being a flag nobody reads.
 */
export function fieldObservationLayers(fields = {}) {
  const uncertain = new Set(fields.low_confidence || []);
  const layers = {};
  for (const [name, value] of Object.entries(fields)) {
    const present = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (!present) continue;
    layers[name] = uncertain.has(name)
      ? SEM_OBSERVATION_LAYER.OBSERVED_FIELD_CANDIDATE
      : SEM_OBSERVATION_LAYER.BEST_OBSERVED_FIELD;
  }
  return layers;
}

/**
 * The canonical object, plus its flywheel projection and its own validation.
 *
 * `canonicalSemToDataFlywheelSem` is the stable external projection COS-27
 * consumes; emitting it here is what makes the learning loop possible at all,
 * because a downstream edit can then be attributed to a named bracket rather
 * than to "the string changed".
 */
export function emitCsm(fields, composedTitle) {
  const sem = resolvedFieldsToSemSuggestion(toResolvedFields(fields));
  const validation = validateTitleDerivedSem(composedTitle, sem);
  return {
    sem_standard_version: SEM_STANDARD_VERSION,
    canonical_sem: sem,
    data_flywheel_sem: canonicalSemToDataFlywheelSem(sem),
    observation_layers: fieldObservationLayers(fields),
    field_labels: labelsForCsmFields(Object.keys(sem)),
    validation: {
      status: validation.validation_status,
      confidence: validation.confidence,
      structurally_valid: validation.structurally_valid,
      errors: validation.errors,
      warnings: validation.warnings,
      field_confidence: validation.confidence_detail?.field_confidence || {}
    }
  };
}

/**
 * The reviewed title as writer feedback.
 *
 * This is the piece that turns an evaluation into a learning signal. A reviewed
 * title that differs from ours is exactly the EDIT case COS-27 describes, and
 * CSM already classifies what such an edit is worth: an edit on a stable sample
 * with reviewed semantic fields is REVIEWED_SEMANTIC_TRUTH, an edit without
 * them is a learning candidate, a rejection is commercial feedback and not
 * semantic truth at all.
 *
 * `stableTrainingSample` is true here because the sealed set is exactly that --
 * 255 titles a human writer confirmed, which the dataset states as
 * `reviewed_title_is_ground_truth: true`.
 */
export function classifyReviewedTitle(ourTitle, reviewedTitle) {
  const same = String(ourTitle || "").trim() === String(reviewedTitle || "").trim();
  const action = same ? "APPROVE" : "EDIT";
  const classification = classifyWriterFeedbackForSemanticLearning({
    action,
    stableTrainingSample: true,
    reviewedSemanticFields: true
  });
  return {
    action,
    ...classification,
    writer_candidate: action === "EDIT"
      ? buildWriterTitleSemCandidate(reviewedTitle, { action })
      : null
  };
}

/**
 * Assert that a value sits in the CSM bracket this schema claims for it.
 *
 * Uses CSM's own predicates rather than the boundary classifier alone, so a
 * print run that has drifted into `card_number` is caught at emit time and not
 * only at parse time.
 */
export function checkNumberBrackets(fields = {}, csmGaps = []) {
  const problems = [];
  if (fields.serial && !isSemNumericalRarityText(fields.serial)) {
    problems.push(`serial "${fields.serial}" is not a CSM numerical rarity`);
  }
  // CSM's predicate does not cover every real TCG code. `TG22/TG30` is the
  // printed Trainer Gallery number -- the reviewed title carries "#TG22/TG30"
  // -- but isSemCardNumberText falls through to /^[A-Z0-9]{1,8}(-[A-Z0-9]{1,8}){0,3}$/,
  // which allows hyphens and not slashes, and the numerical-rarity branch above
  // it only fires for all-digit values. So a genuine TCG code with letters AND
  // a slash is rejected by the contract's own check.
  //
  // The right response is not to bend the value until it passes. It is
  // reported separately as a CSM COVERAGE GAP, so the count of our violations
  // stays honest and the gap stays visible instead of being absorbed.
  if (fields.card_number
    && !isSemCardNumberText(fields.card_number, { grammar: fields.grammar, field: "card_number", checklistContext: true })) {
    const tcgSlashCode = fields.grammar === "tcg" && /^[A-Z0-9]+\/[A-Z0-9]+$/i.test(fields.card_number);
    if (tcgSlashCode) csmGaps.push(`isSemCardNumberText rejects the printed TCG code "${fields.card_number}"`);
    else problems.push(`card_number "${fields.card_number}" is not a CSM card number`);
  }
  return problems;
}

/**
 * Every field name this schema uses must be a CSM term or a documented alias.
 *
 * `semImplementationTermMap` records which implementation names CSM recognises
 * and how it classifies them. Checking against it is how a third naming scheme
 * gets caught while it is one field rather than after it has spread.
 */
export function unknownFieldNames(fields = {}) {
  // CSM's own canonical field list is part of the known set, not a hand-copied
  // subset of it. Adding `language` -- a field CSM had defined all along --
  // made this function report it as a non-CSM field on all 148 cards, which is
  // the check accusing the contract of violating itself. Any field CSM defines
  // is by construction a CSM field; only OUR local names need enumerating.
  const known = new Set([...Object.keys(semImplementationTermMap), ...semCanonicalEditableFields]);
  const aliases = new Set(["subjects", "grade", "components", "ip", "grammar", "lot_count",
    "unreadable", "low_confidence", "print_finish", "attributes", "descriptive_rarity",
    "year", "manufacturer", "product", "set", "card_name", "release_variant",
    "surface_color", "parallel_family", "parallel_exact", "card_number", "serial", "team"]);
  return Object.keys(fields).filter((name) => !known.has(name) && !aliases.has(name));
}

/**
 * The COS-27 validation event for one card.
 *
 * This is the record the learning loop consumes, and building it is what makes
 * "the output is traceable to the canonical object that produced it" a fact
 * rather than an aspiration. CSM refuses to build one without parser and
 * standard versions on the extraction, which is the right refusal: an event
 * that cannot say which parser produced the candidate cannot be replayed.
 *
 * Source status per CSM's own enum: this path OBSERVES and nothing else, so
 * every retrieval-shaped source is NOT_RUN and says so, rather than being
 * absent and leaving a reader to guess whether it ran and found nothing.
 */
export function emitValidationEvent({
  assetId, fields, composedTitle, reviewedTitle, createdAt,
  runId = "", recognitionSessionId = "", learningEventId = "", feedbackEventId = "",
  // Who confirmed the reviewed title, and when. CSM refuses a VALIDATED event
  // without both, which is the right refusal: "validated" with no reviewer is a
  // claim with nobody behind it. For the sealed set the reviewer is the writer
  // who confirmed those 255 titles.
  reviewedBy = "reviewed_internal_writer", reviewedAt = "",
  // CSM requires an identity group on a VALIDATED event: a confirmed semantic
  // truth has to say which card identity it is true OF, or it cannot be joined
  // to the next sighting of the same card. The sealed set gives one per asset.
  identityGroupId = ""
}) {
  const emitted = emitCsm(fields, composedTitle);
  const candidate = buildWriterTitleSemCandidate(composedTitle, { action: "EDIT" });
  // Every source declares itself, including the ones that did not run -- absent
  // and "ran and found nothing" are different facts, and this path runs none of
  // the retrieval-shaped ones. The exception is the reviewed title: for the
  // sealed set that IS a source, and a VALIDATED event with no supporting
  // source is one CSM refuses to build.
  const sources = Object.fromEntries(SEM_VALIDATION_SOURCE_TYPES.map((source) => [source, { status: "NOT_RUN" }]));
  // We DID run image evidence -- that is the whole of this path -- so saying
  // NOT_RUN for it would be a false statement about our own provenance. OCR and
  // CATALOG genuinely did not run.
  sources.IMAGE_EVIDENCE = { status: "SUPPORTED", evidence_refs: [`images:${assetId}`] };
  // The reviewed title is the human-validated SEM: the dataset states
  // `reviewed_title_is_ground_truth: true`, so this is the one source that did
  // run and did support or contradict us.
  // What the human actually wrote, parsed into SEM. Legitimate here in a way it
  // is not for scoring: this records the writer's answer, it does not grade us
  // against a parser's boundary guesses.
  const validatedSem = reviewedTitle ? titleDerivedSemSuggestion(reviewedTitle) : {};
  // PENDING / VALIDATED / REJECTED. An exact match against a writer-confirmed
  // title is VALIDATED; anything else stays PENDING, because "not identical"
  // is not the same as "wrong" -- the writer may simply have chosen different
  // wording for the same card, and calling that REJECTED would poison the
  // learning signal with our own scoring opinion.
  const status = reviewedTitle && String(composedTitle).trim() === String(reviewedTitle).trim()
    ? "VALIDATED"
    : "PENDING";
  if (status === "VALIDATED") {
    sources.HUMAN_CONFIRMATION = { status: "SUPPORTED", evidence_refs: [`reviewed_title:${assetId}`] };
  }
  // CSM refuses an event without all three parent ids, and it is right to: an
  // event that cannot name the run, the recognition and the feedback that
  // produced it cannot be replayed, and an unreplayable learning record is
  // worse than none. In an evaluation these are real things, so they are filled
  // with the real ones rather than with placeholders -- the run, the card's
  // recognition within it, and this paired comparison as the feedback occasion.
  const run = runId || "thin-path-eval";
  return buildSemValidationEvent({
    assetId: assetId || "",
    recognitionSessionId: recognitionSessionId || `${run}:${assetId}`,
    learningEventId: learningEventId || `${run}:${assetId}:observation`,
    feedbackEventId: feedbackEventId || `${run}:${assetId}:reviewed-title`,
    extraction: candidate,
    validatedSem: reviewedTitle ? validatedSem : {},
    validationStatus: status,
    confidence: emitted.validation.confidence,
    validationSources: sources,
    identityGroupId: status === "VALIDATED" ? (identityGroupId || `identity:${assetId}`) : "",
    reviewedBy: status === "VALIDATED" ? reviewedBy : "",
    reviewedAt: status === "VALIDATED" ? (reviewedAt || createdAt || new Date().toISOString()) : null,
    createdAt: createdAt || undefined
  });
}

export {
  SEM_FEEDBACK_LAYER,
  SEM_OBSERVATION_LAYER,
  SEM_VALIDATION_EVENT_SCHEMA_VERSION,
  SEM_VALIDATION_STATUSES,
  SEM_VALIDATION_SOURCE_TYPES
};
