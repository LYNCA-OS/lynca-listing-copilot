import { gradeAtomicCompleteness } from "../grade/grade-value.mjs";

const serialFieldNames = new Set([
  "print_run_number",
  "print_run_numerator",
  "print_run_denominator",
  "numbered_to",
  "serial_number",
  "serial_denominator",
  "numerical_rarity"
]);

const gradeFieldNames = new Set([
  "grade",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveDimension(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function imageDimensions(image = {}) {
  const width = positiveDimension(image.width ?? image.image_width ?? image.original_width ?? image.originalWidth);
  const height = positiveDimension(image.height ?? image.image_height ?? image.original_height ?? image.originalHeight);
  return width && height ? { width, height } : null;
}

export function captureQualityLooksLikeSlab(captureQuality = {}, images = []) {
  const explicitSurfaceTypes = [
    captureQuality.capture_surface_type,
    ...(Array.isArray(captureQuality.images)
      ? captureQuality.images.map((image) => image?.capture_surface_type)
      : [])
  ];
  if (explicitSurfaceTypes.some((value) => cleanText(value).toUpperCase() === "SLAB")) return true;

  const dimensionCandidates = [
    ...(Array.isArray(images) ? images : []),
    ...(Array.isArray(captureQuality.images) ? captureQuality.images : [])
  ];
  return dimensionCandidates.some((image) => {
    const dimensions = imageDimensions(image);
    if (!dimensions) return false;
    const shortSide = Math.min(dimensions.width, dimensions.height);
    const longSide = Math.max(dimensions.width, dimensions.height);
    // Standard raw cards are about 0.714. A ratio at or below 0.64 is a
    // conservative slab/enclosure signal and only enables a short OCR wait.
    return shortSide / longSide <= 0.64;
  });
}

function positiveDuration(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

function unresolvedFieldNames(values = []) {
  return new Set((Array.isArray(values) ? values : [])
    .flatMap((value) => cleanText(value).toLowerCase().split(/[^a-z0-9_]+/))
    .filter(Boolean));
}

function unresolvedIncludesAny(unresolved, fieldNames) {
  return [...fieldNames].some((field) => unresolved.has(field));
}

function currentPrintRunValue(fields = {}) {
  return cleanText(
    fields.print_run_number
    || fields.numerical_rarity
    || fields.serial_number
  );
}

function printRunMentioned(fields = {}, unresolved = new Set()) {
  return Boolean(currentPrintRunValue(fields)) || unresolvedIncludesAny(unresolved, serialFieldNames);
}

function gradeMentioned(fields = {}, unresolved = new Set()) {
  const atomic = gradeAtomicCompleteness(fields);
  return atomic.has_company || atomic.has_score || unresolvedIncludesAny(unresolved, gradeFieldNames);
}

function patchValue(patch = {}) {
  return cleanText(
    patch.value
    ?? patch.normalized_value
    ?? patch.normalizedValue
  );
}

export const workerUnavailableReasons = Object.freeze([
  "ocr_worker_unavailable",
  "field_ocr_worker_unavailable",
  "worker_unavailable"
]);

function unavailableReason(value) {
  const text = String(value ?? "").toLowerCase();
  return workerUnavailableReasons.some((needle) => text.includes(needle));
}

function jobRelevantToTargets(job = {}, targetFields = []) {
  if (!targetFields.length) return true;
  const role = cleanText(job.crop_role).toLowerCase();
  return (targetFields.includes("serial_number") && role === "serial_crop")
    || (targetFields.includes("grade") && role === "grade_label_crop");
}

export function ocrWorkersUnavailable(latestOcrState = null, {
  targetFields = []
} = {}) {
  if (!latestOcrState || typeof latestOcrState !== "object") return false;
  const activeCount = Number(latestOcrState.active_count);
  if (latestOcrState.active_count === null
    || latestOcrState.active_count === undefined
    || !Number.isFinite(activeCount)
    || activeCount !== 0) return false;
  const allJobs = Array.isArray(latestOcrState.job_observability)
    ? latestOcrState.job_observability
    : [];
  const jobCount = Number(latestOcrState.job_count);
  if (!Number.isInteger(jobCount) || jobCount < 1 || allJobs.length !== jobCount) return false;
  const jobs = allJobs.filter((job) => jobRelevantToTargets(job, targetFields));
  if (!jobs.length) return false;
  return jobs.every((job) => (
    cleanText(job.status).toUpperCase() === "FAILED"
    && unavailableReason(job.error_code || job.last_error || job.reason)
  ));
}

export function criticalOcrSignalFields(latestOcrState = null) {
  const patches = Array.isArray(latestOcrState?.evidence_patches)
    ? latestOcrState.evidence_patches
    : [];
  const aliases = new Map([
    ["grade", "card_grade"],
    ["grade_label", "card_grade"],
    ["print_run_numerator", "print_run_number"],
    ["print_run_denominator", "print_run_number"],
    ["serial_denominator", "serial_number"],
    ["numerical_rarity", "print_run_number"]
  ]);
  const acceptedFields = new Set([
    "print_run_number",
    "serial_number",
    "grade_company",
    "card_grade",
    "auto_grade",
    "grade_type"
  ]);
  const fields = {};
  const observedValues = new Map();

  for (const patch of patches) {
    const rawField = cleanText(patch?.field || patch?.evidence_field).toLowerCase();
    const field = aliases.get(rawField) || rawField;
    const value = patchValue(patch);
    if (!acceptedFields.has(field) || !value) continue;
    const comparable = value.toUpperCase();
    const seen = observedValues.get(field) || new Set();
    seen.add(comparable);
    observedValues.set(field, seen);
    if (!fields[field]) fields[field] = value;
  }

  const conflictingFields = [...observedValues.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([field]) => field);
  return {
    fields,
    patch_fields: Object.keys(fields),
    conflicting_fields: conflictingFields
  };
}

export function criticalOcrRendezvousDecision({
  currentFields = {},
  unresolved = [],
  latestOcrState = null,
  slabLikely = false,
  configuredWaitMs = 0,
  criticalWaitMs = 2_500,
  // A foil/holo serial crop OCR job routinely needs longer than the shared
  // 2.5s critical budget to settle on a Cloud Run PaddleOCR worker. The serial
  // numerator is the single highest-value physical-instance field, so when it
  // is the field we are waiting on it gets its own, longer budget instead of
  // the provider's low-confidence read winning by default.
  serialWaitMs = 8_000,
  // The ceiling applied to whatever the budgets above ask for. See the comment
  // at waitBudgetMs: 4.6% of sessions get a patch, so this caps rather than
  // disables.
  maxWaitMs = Number(process.env.PREINGESTION_OCR_MAX_WAIT_MS) || 2_000
} = {}) {
  const unresolvedSet = unresolvedFieldNames(unresolved);
  const ocrSignals = criticalOcrSignalFields(latestOcrState);
  const decisionFields = {
    ...ocrSignals.fields,
    ...currentFields
  };
  const stateKnown = Boolean(latestOcrState && typeof latestOcrState === "object");
  const stateConfigured = latestOcrState?.configured !== false;
  const serialActiveCount = Number(latestOcrState?.serial_active_count || 0);
  const gradeActiveCount = Number(latestOcrState?.grade_label_active_count || 0);
  const serialWorkPending = stateConfigured && (!stateKnown || serialActiveCount > 0);
  const gradeWorkPending = stateConfigured && (!stateKnown || gradeActiveCount > 0);
  const atomicGrade = gradeAtomicCompleteness(decisionFields);
  const gradeIncomplete = atomicGrade.incomplete_score_without_company
    || atomicGrade.incomplete_company_without_score;
  const gradeCompletelyMissing = !atomicGrade.has_company && !atomicGrade.has_score;
  const gradeUnresolved = unresolvedIncludesAny(unresolvedSet, gradeFieldNames);
  const gradeSignalConflict = ocrSignals.conflicting_fields.some((field) => gradeFieldNames.has(field));
  const serialSignalConflict = ocrSignals.conflicting_fields.some((field) => serialFieldNames.has(field));
  const serialNeedsRendezvous = printRunMentioned(decisionFields, unresolvedSet) || serialSignalConflict;
  const gradeNeedsRendezvous = (gradeMentioned(decisionFields, unresolvedSet) || (slabLikely && gradeCompletelyMissing))
    && (gradeIncomplete || gradeUnresolved || gradeSignalConflict || (slabLikely && gradeCompletelyMissing));
  const unavailableTargetFields = [
    ...(serialNeedsRendezvous ? ["serial_number"] : []),
    ...(gradeNeedsRendezvous ? ["grade"] : [])
  ];

  const targetFields = [];
  const reasons = [];

  if (serialWorkPending && serialNeedsRendezvous) {
    targetFields.push("serial_number");
    reasons.push(serialSignalConflict
      ? "ocr_print_run_candidates_conflict"
      : currentPrintRunValue(decisionFields)
      ? "current_print_run_requires_hard_text_verification"
      : "provider_left_print_run_unresolved");
  }

  if (gradeWorkPending && gradeNeedsRendezvous) {
    targetFields.push("grade");
    reasons.push(
      gradeSignalConflict
        ? "ocr_grade_candidates_conflict"
        : atomicGrade.incomplete_score_without_company
        ? "grade_score_missing_company"
        : atomicGrade.incomplete_company_without_score
          ? "grade_company_missing_score"
          : slabLikely && gradeCompletelyMissing
            ? "slab_capture_grade_completely_missing"
          : "provider_left_grade_unresolved"
    );
  }

  const baseBudget = positiveDuration(configuredWaitMs, 0);
  const wantsSerial = targetFields.includes("serial_number");
  const targetedBudget = targetFields.length
    ? Math.max(
      positiveDuration(criticalWaitMs, 2_500),
      wantsSerial ? positiveDuration(serialWaitMs, 8_000) : 0
    )
    : 0;
  // Cap what the listener can be made to wait for.
  //
  // Measured over 1,451 production sessions that reached this rendezvous: the
  // wait averaged 657ms, p90 was 1,741ms, and the worst case was 24,539ms --
  // and the whole rendezvous changed a field on 4.6% of them, applying 0.14
  // patches per session.
  //
  // 4.6% is not nothing, so this is a ceiling rather than a switch. But a
  // ceiling of 2,000ms keeps everything up to the observed p90 and removes a
  // tail that reached twenty-four seconds for the same 4.6% chance. The
  // background jobs are unaffected; they keep running and their results still
  // land on the next read. Only the listener stops being held.
  //
  // Raise PREINGESTION_OCR_MAX_WAIT_MS if the OCR workers are healthy and the
  // patch rate is measured to be materially higher than 4.6%.
  // A listener cannot recover evidence from a worker that every observed job
  // says is unreachable. Keep the durable OCR jobs intact, but do not put this
  // request on a timer whose only possible outcome is another timeout.
  const workersUnavailable = ocrWorkersUnavailable(latestOcrState, {
    targetFields: unavailableTargetFields
  });
  const ceilingMs = workersUnavailable ? 0 : positiveDuration(maxWaitMs, 2_000);
  const waitBudgetMs = Math.min(Math.max(baseBudget, targetedBudget), ceilingMs);

  return {
    should_wait: waitBudgetMs > 0,
    wait_budget_ms: waitBudgetMs,
    wait_budget_ceiling_ms: ceilingMs,
    wait_budget_uncapped_ms: Math.max(baseBudget, targetedBudget),
    target_fields: targetFields,
    unavailable_target_fields: unavailableTargetFields,
    reasons,
    state_known: stateKnown,
    state_configured: stateConfigured,
    serial_active_count: serialActiveCount,
    grade_label_active_count: gradeActiveCount,
    grade_incomplete: gradeIncomplete,
    grade_completely_missing: gradeCompletelyMissing,
    grade_unresolved: gradeUnresolved,
    slab_likely: slabLikely === true,
    ocr_signal_fields: ocrSignals.patch_fields,
    ocr_signal_conflicting_fields: ocrSignals.conflicting_fields,
    base_wait_budget_ms: baseBudget,
    targeted_wait_budget_ms: targetedBudget,
    workers_unavailable: workersUnavailable
  };
}
