import { normalizeGoldenSemValue } from "./golden-sem-accuracy.mjs";

export const evidenceFailureCategories = Object.freeze([
  "NOT_VISIBLE_IN_IMAGE",
  "CROP_NOT_SCHEDULED",
  "OCR_MISSED",
  "VISION_OBSERVATION_MISSED",
  "NORMALIZATION_DROPPED",
  "EVIDENCE_FILTER_BLOCKED",
  "TRACE_MISSING"
]);

const relevantCropRoles = Object.freeze({
  year: ["year_product_crop"],
  manufacturer: ["year_product_crop"],
  product: ["year_product_crop"],
  set: ["year_product_crop", "card_code_crop"],
  subject: ["subject_crop"],
  card_name: ["subject_crop"],
  card_number: ["card_code_crop"],
  numerical_rarity: ["serial_crop"],
  grading_info: ["grade_label_crop"]
});

const ocrReadableFields = new Set(Object.keys(relevantCropRoles));

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function textOf(value) {
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => key !== "grade_type")
      .map(([, entry]) => textOf(entry))
      .join(" ");
  }
  return clean(value);
}

function rows(value = {}) {
  if (Array.isArray(value)) return value;
  for (const key of ["cards", "results", "items", "records"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function idOf(row = {}) {
  return clean(row.query_card_id || row.source_feedback_id || row.source_asset_id || row.candidate_id || row.id).toLowerCase();
}

function normalized(field, value) {
  return textOf(normalizeGoldenSemValue(field, value)).toLowerCase();
}

function tokens(field, value) {
  return normalized(field, value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1 || /^\d+$/.test(token));
}

function containsTruth(field, truth, text) {
  const expected = tokens(field, truth);
  if (!expected.length) return false;
  const actual = new Set(tokens(field, text));
  return expected.every((token) => actual.has(token));
}

function fieldValueMatches(field, truth, fields = {}) {
  const aliases = {
    subject: ["subject", "player", "players", "character"],
    grading_info: ["grading_info", "grade", "card_grade", "grade_company"],
    print_finish: ["print_finish", "parallel", "parallel_exact", "parallel_family"],
    card_number: ["card_number", "collector_number", "checklist_code"]
  };
  return (aliases[field] || [field]).some((key) => {
    const value = fields?.[key];
    if (Array.isArray(value)) return value.some((entry) => normalized(field, entry) === normalized(field, truth));
    return normalized(field, value) === normalized(field, truth);
  });
}

function observationSnapshot(smoke = {}) {
  return smoke.l2_candidate_debug?.candidate_observation_snapshot
    || smoke.l2_status?.candidate_debug?.candidate_observation_snapshot
    || {};
}

function bestSmokeForTrace(smokeRows = [], trace = {}) {
  const traceCandidateIds = new Set((trace?.retrieval_candidates || []).map((row) => clean(row.candidate_id)).filter(Boolean));
  const traceSelected = clean(trace?.selected_candidate_id);
  const score = (row) => {
    const debug = row?.l2_candidate_debug || {};
    const candidateIds = (debug.candidate_application_trace || []).map((entry) => clean(entry.candidate_id));
    const overlap = candidateIds.filter((id) => traceCandidateIds.has(id)).length;
    const selectedMatch = traceSelected && clean(debug.selected_candidate_id) === traceSelected;
    const rendezvous = row?.preingestion_ocr_rendezvous || row?.l2_status?.preingestion_ocr_rendezvous || {};
    return (selectedMatch ? 1_000_000 : 0)
      + overlap * 10_000
      + (row?.ok === true ? 1_000 : 0)
      + (Array.isArray(rendezvous.raw_ocr_observations) ? rendezvous.raw_ocr_observations.length : 0)
      + (Array.isArray(rendezvous.job_observability) ? rendezvous.job_observability.length : 0);
  };
  return [...smokeRows].sort((left, right) => score(right) - score(left))[0] || {};
}

function classifyMissing({ field, truth, trace, smoke }) {
  const evidence = Array.isArray(trace?.evidence_observations) ? trace.evidence_observations : [];
  const instrumented = trace && (Object.hasOwn(trace, "evidence_observations") || trace.instrumentation?.sensor_evidence_instrumented === true);
  if (!instrumented || smoke?.ok === false || trace?.recognition_ok === false) {
    const recognitionReason = clean(smoke?.error || trace?.recognition_error);
    return {
      category: "TRACE_MISSING",
      confidence: "HIGH",
      reason: recognitionReason
        ? `recognition or sensor trace failed: ${recognitionReason.slice(0, 160)}`
        : "sensor evidence was not successfully instrumented",
      alternatives: []
    };
  }

  const rawOcr = [
    ...evidence.filter((entry) => /OCR/i.test(clean(entry.source))).map((entry) => clean(entry.raw_text || entry.fields?.ocr_raw_observation)),
    ...(smoke?.preingestion_ocr_rendezvous?.raw_ocr_observations || []).map((entry) => clean(entry.raw_text))
  ].filter(Boolean);
  const gpt = evidence.filter((entry) => /GPT/i.test(clean(entry.source)));
  const rawTokenMatch = rawOcr.some((text) => containsTruth(field, truth, text));
  const gptFieldMatch = gpt.some((entry) => fieldValueMatches(field, truth, entry.fields));
  const snapshotMatch = fieldValueMatches(field, truth, observationSnapshot(smoke));

  if (rawTokenMatch) {
    return {
      category: "NORMALIZATION_DROPPED",
      confidence: "HIGH",
      reason: "all normalized truth tokens occur in raw OCR but the field was not admitted as evidence",
      alternatives: []
    };
  }
  if (snapshotMatch || gptFieldMatch) {
    return {
      category: "EVIDENCE_FILTER_BLOCKED",
      confidence: "HIGH",
      reason: "a matching structured observation exists outside the accepted field evidence",
      alternatives: []
    };
  }

  const jobObservability = smoke?.preingestion_ocr_rendezvous?.job_observability;
  const rawOcrObservations = smoke?.preingestion_ocr_rendezvous?.raw_ocr_observations;
  const scheduledRoles = new Set((jobObservability || [])
    .filter((job) => clean(job.status).toUpperCase() === "SUCCEEDED")
    .map((job) => clean(job.crop_role)));
  for (const observation of rawOcrObservations || []) {
    const region = clean(observation.source_region || observation.crop_type).toLowerCase();
    if (/year_product|product_text/.test(region)) scheduledRoles.add("year_product_crop");
    if (/subject_name|player_name/.test(region)) scheduledRoles.add("subject_crop");
    if (/collector_number|checklist_code|card_code/.test(region)) scheduledRoles.add("card_code_crop");
    if (/serial/.test(region)) scheduledRoles.add("serial_crop");
    if (/grade_label/.test(region)) scheduledRoles.add("grade_label_crop");
  }
  const expectedRoles = relevantCropRoles[field] || [];
  const relevantCropScheduled = expectedRoles.some((role) => scheduledRoles.has(role));

  if (ocrReadableFields.has(field) && !Array.isArray(jobObservability) && !Array.isArray(rawOcrObservations)) {
    const rendezvousReason = clean(smoke?.preingestion_ocr_rendezvous?.reason);
    const rendezvousStatus = clean(smoke?.preingestion_ocr_rendezvous?.status).toUpperCase();
    return {
      category: "TRACE_MISSING",
      confidence: "HIGH",
      reason: rendezvousReason || rendezvousStatus === "ERROR"
        ? `OCR rendezvous failed before crop evidence became observable: ${rendezvousReason || rendezvousStatus}`
        : "crop planner observability is absent, so scheduled versus missed cannot be distinguished",
      alternatives: ["CROP_NOT_SCHEDULED", "OCR_MISSED", "NOT_VISIBLE_IN_IMAGE"]
    };
  }

  if (ocrReadableFields.has(field) && !relevantCropScheduled) {
    return {
      category: "CROP_NOT_SCHEDULED",
      confidence: "HIGH",
      reason: `no successful relevant crop; expected one of: ${expectedRoles.join(", ")}`,
      alternatives: ["NOT_VISIBLE_IN_IMAGE"]
    };
  }
  if (ocrReadableFields.has(field) && relevantCropScheduled) {
    return {
      category: "OCR_MISSED",
      confidence: "MEDIUM",
      reason: "a relevant crop completed but raw OCR did not contain the truth tokens",
      alternatives: ["NOT_VISIBLE_IN_IMAGE", "VISION_OBSERVATION_MISSED"],
      needs_visual_review: true
    };
  }
  if (field === "print_finish") {
    return {
      category: "VISION_OBSERVATION_MISSED",
      confidence: "MEDIUM",
      reason: "print finish is a visual-semantic field and no matching GPT observation was emitted",
      alternatives: ["NOT_VISIBLE_IN_IMAGE", "CROP_NOT_SCHEDULED"],
      needs_visual_review: true
    };
  }
  return {
    category: "TRACE_MISSING",
    confidence: "LOW",
    reason: "the current trace lacks the visibility or gate telemetry required to distinguish the remaining causes",
    alternatives: ["NOT_VISIBLE_IN_IMAGE", "VISION_OBSERVATION_MISSED"],
    needs_visual_review: true
  };
}

export function buildEvidenceFailureTaxonomy({ dataset = {}, audit = {}, trace = {}, smoke = {}, generatedAt = new Date().toISOString() } = {}) {
  const datasetById = new Map(rows(dataset).map((row) => [idOf(row), row]));
  const traceById = new Map(rows(trace).map((row) => [idOf(row), row]));
  const smokeRowsById = new Map();
  for (const row of rows(smoke)) {
    const id = idOf(row);
    smokeRowsById.set(id, [...(smokeRowsById.get(id) || []), row]);
  }
  const failures = [];

  for (const card of rows(audit)) {
    const id = idOf(card);
    for (const [field, result] of Object.entries(card.fields || {})) {
      if (result.evidence_seen !== false) continue;
      const classification = classifyMissing({
        field,
        truth: result.truth,
        trace: traceById.get(id),
        smoke: bestSmokeForTrace(smokeRowsById.get(id) || [], traceById.get(id))
      });
      failures.push({
        query_card_id: id,
        item_category: datasetById.get(id)?.category || null,
        field,
        truth: result.truth,
        ...classification
      });
    }
  }

  const countBy = (key) => Object.fromEntries([...new Set(failures.map((row) => row[key]))]
    .sort()
    .map((value) => [value, failures.filter((row) => row[key] === value).length]));
  const highConfidenceCount = failures.filter((row) => row.confidence === "HIGH").length;
  const visualReviewCount = failures.filter((row) => row.needs_visual_review).length;
  return {
    schema_version: "evidence-failure-taxonomy-v1",
    generated_at: generatedAt,
    policy: {
      holdout_is_read_only: true,
      classifications_are_diagnostic_not_training_labels: true,
      not_visible_requires_visual_review: true
    },
    summary: {
      missing_field_count: failures.length,
      card_count: new Set(failures.map((row) => row.query_card_id)).size,
      high_confidence_count: highConfidenceCount,
      visual_review_required_count: visualReviewCount,
      by_category: countBy("category"),
      by_item_category: countBy("item_category"),
      by_field: countBy("field"),
      by_cause: countBy("category"),
      by_reason: countBy("reason")
    },
    failures
  };
}
