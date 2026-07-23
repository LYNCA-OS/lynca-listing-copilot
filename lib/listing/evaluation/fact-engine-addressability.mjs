export const factAddressabilityCategories = Object.freeze([
  "TEMPORAL_NORMALIZATION",
  "PRODUCT_ALIAS",
  "CODE_SEMANTICS",
  "CATALOG_ROW_ABSENT",
  "OCR_OR_VISION_MISS",
  "NOT_VISIBLE",
  "QUERY_PLANNING_FAILURE",
  "SELECTION_FAILURE",
  "APPLICATION_FAILURE",
  "TRACE_OR_ENGINEERING_FAILURE",
  "UNKNOWN"
]);

const strictFactCategories = new Set([
  "TEMPORAL_NORMALIZATION",
  "PRODUCT_ALIAS",
  "CODE_SEMANTICS"
]);
const broadFactCategories = new Set([...strictFactCategories, "QUERY_PLANNING_FAILURE"]);

function clean(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return Object.values(value).flatMap(values);
  const normalized = clean(value);
  return normalized ? [normalized] : [];
}

function tokens(value) {
  return new Set(values(value).flatMap((entry) => entry.split(" ")).filter(Boolean));
}

function overlap(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return { intersection: 0, containment: false, jaccard: 0 };
  const intersection = [...a].filter((token) => b.has(token)).length;
  return {
    intersection,
    containment: intersection === Math.min(a.size, b.size),
    jaccard: intersection / new Set([...a, ...b]).size
  };
}

function rowId(row = {}) {
  return clean(row.query_card_id || row.source_feedback_id || row.id || row.item_id).replaceAll(" ", "-");
}

function fieldTruth(item = {}, field = "") {
  const fields = item.reviewed_ground_truth?.fields || {};
  const statuses = item.reviewed_ground_truth?.field_statuses || {};
  return clean(statuses[field]).toUpperCase() === "CONFIRMED" ? fields[field] : null;
}

function observation(smoke = {}) {
  return smoke.l2_candidate_debug?.candidate_observation_snapshot || {};
}

function years(value) {
  return values(value).flatMap((entry) => entry.match(/(?:19|20)\d{2}/g) || []);
}

function temporalAliasMismatch(truth, observed) {
  const expected = years(truth);
  const actual = years(observed);
  return expected.length > 0 && actual.length > 0
    && clean(truth) !== clean(observed)
    && expected.some((year) => actual.includes(year));
}

function codeValue(fields = {}) {
  return fields.card_number || fields.collector_number || fields.checklist_code || "";
}

function catalogSourceTrust(card = {}, currentFeedbackId = "") {
  const sourceType = clean(card.source?.source_type).replaceAll(" ", "_").toUpperCase();
  const sourceStatus = clean(card.source?.source_status || card.source_status).replaceAll(" ", "_").toUpperCase();
  const feedbackId = clean(card.source?.source_metadata?.source_feedback_id);
  if (/OFFICIAL/.test(sourceType) || /OFFICIAL/.test(sourceStatus)) return "OFFICIAL_FACT";
  if (sourceType === "INTERNAL_CORRECTED_TITLE" && feedbackId && feedbackId !== clean(currentFeedbackId)) {
    return "REVIEWED_INTERNAL_FACT";
  }
  return "HEURISTIC_FACT";
}

function findSmoke(smokeRows = [], id = "") {
  return smokeRows.find((row) => rowId(row) === id) || {};
}

function classifyEvidenceFailure(failure = {}) {
  if (failure.category === "TRACE_MISSING") return "TRACE_OR_ENGINEERING_FAILURE";
  if (["OCR_MISSED", "VISION_OBSERVATION_MISSED"].includes(failure.category)) return "OCR_OR_VISION_MISS";
  if (failure.category === "NOT_VISIBLE_IN_IMAGE") return "NOT_VISIBLE";
  if (failure.category === "NORMALIZATION_DROPPED" && failure.field === "year") return "TEMPORAL_NORMALIZATION";
  if (failure.category === "NORMALIZATION_DROPPED" && ["product", "set"].includes(failure.field)) return "PRODUCT_ALIAS";
  if (failure.category === "NORMALIZATION_DROPPED" && ["card_number", "card_name"].includes(failure.field)) return "CODE_SEMANTICS";
  if (failure.category === "EVIDENCE_FILTER_BLOCKED") return "UNKNOWN";
  return "UNKNOWN";
}

function classifyRetrievalMiss({ item = {}, smoke = {}, catalogById = new Map() } = {}) {
  const accepted = item.retrieval_ground_truth?.accepted_candidate_ids || [];
  const catalogRows = accepted.map((id) => catalogById.get(id)).filter(Boolean);
  if (!catalogRows.length) return { category: "CATALOG_ROW_ABSENT", confidence: "HIGH" };
  const sourceTrust = [...new Set(catalogRows.map((card) => catalogSourceTrust(card, item.source_feedback_id)))];
  const sourceBacked = sourceTrust.some((trust) => ["OFFICIAL_FACT", "REVIEWED_INTERNAL_FACT"].includes(trust));
  const observed = observation(smoke);
  const truthYear = fieldTruth(item, "year");
  const truthProduct = fieldTruth(item, "product");
  const truthSubject = fieldTruth(item, "subject");
  const truthCode = fieldTruth(item, "card_number");
  const observedYear = observed.year || observed.season || observed.release_year;
  const observedProduct = observed.product || observed.set || observed.product_hint;
  const observedSubject = observed.players || observed.player || observed.subject;
  const observedCode = codeValue(observed);

  if (temporalAliasMismatch(truthYear, observedYear)) {
    return { category: "TEMPORAL_NORMALIZATION", confidence: "HIGH", fact_source_backed: sourceBacked, source_trust: sourceTrust };
  }
  const productMatch = overlap(truthProduct, observedProduct);
  if (truthProduct && observedProduct && clean(truthProduct) !== clean(observedProduct)
    && (productMatch.containment || productMatch.jaccard >= 0.5)) {
    return { category: "PRODUCT_ALIAS", confidence: "HIGH", fact_source_backed: sourceBacked, source_trust: sourceTrust };
  }
  if (truthCode && observedCode && clean(truthCode) !== clean(observedCode)
    && overlap(truthCode, observedCode).intersection > 0) {
    return { category: "CODE_SEMANTICS", confidence: "MEDIUM", fact_source_backed: sourceBacked, source_trust: sourceTrust };
  }
  const subjectMatch = overlap(truthSubject, observedSubject);
  if ((!observedSubject && truthSubject) || (!observedProduct && truthProduct) || (!observedYear && truthYear)) {
    return { category: "OCR_OR_VISION_MISS", confidence: "MEDIUM" };
  }
  if (subjectMatch.intersection >= 2 || !truthSubject) {
    return { category: "QUERY_PLANNING_FAILURE", confidence: "MEDIUM" };
  }
  return { category: "OCR_OR_VISION_MISS", confidence: "LOW" };
}

function countBy(rows = [], key = "category") {
  return Object.fromEntries([...new Set(rows.map((row) => row[key]))].sort().map((value) => [
    value,
    rows.filter((row) => row[key] === value).length
  ]));
}

function metric(numerator, denominator) {
  return { numerator, denominator, rate: denominator ? Number((numerator / denominator).toFixed(6)) : null };
}

export function buildFactEngineAddressabilityAudit({
  dataset = {},
  evidenceTaxonomy = {},
  retrievalDiagnostic = {},
  smoke = {},
  catalog = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const items = dataset.items || [];
  const itemById = new Map(items.map((item) => [rowId(item), item]));
  const smokeRows = smoke.results || [];
  const catalogById = new Map((catalog.cards || []).map((card) => [card.id, card]));
  const evidence = (evidenceTaxonomy.failures || []).map((failure) => ({
    layer: "EVIDENCE",
    query_card_id: rowId(failure),
    field: failure.field,
    category: classifyEvidenceFailure(failure),
    source_category: failure.category,
    confidence: failure.confidence || "LOW",
    fact_source_backed: failure.category === "NORMALIZATION_DROPPED"
  }));
  const retrievedIds = new Set((retrievalDiagnostic.selection?.opportunities || [])
    .map((row) => row.query_card_id));
  const retrieval = items.filter((item) => !retrievedIds.has(rowId(item))).map((item) => ({
    layer: "RETRIEVAL",
    query_card_id: rowId(item),
    ...classifyRetrievalMiss({
      item,
      smoke: findSmoke(smokeRows, rowId(item)),
      catalogById
    })
  }));
  const selection = (retrievalDiagnostic.selection?.opportunities || [])
    .filter((row) => row.selected_correct !== true).map((row) => ({
      layer: "SELECTION",
      query_card_id: row.query_card_id,
      category: "SELECTION_FAILURE",
      confidence: "HIGH",
      reason: row.selection_failure || "UNKNOWN_SELECTION_FAILURE"
    }));
  const application = (retrievalDiagnostic.safe_application?.opportunities || [])
    .filter((row) => row.applied !== true).map((row) => ({
      layer: "APPLICATION",
      query_card_id: row.query_card_id,
      field: row.field,
      category: "APPLICATION_FAILURE",
      confidence: "HIGH",
      reason: row.reasons?.join(",") || "UNKNOWN_APPLICATION_FAILURE"
    }));
  const failures = [...evidence, ...retrieval, ...selection, ...application];
  const strict = failures.filter((row) => strictFactCategories.has(row.category));
  const broad = failures.filter((row) => broadFactCategories.has(row.category));
  const evidenceStrict = evidence.filter((row) => strictFactCategories.has(row.category));
  const retrievalStrict = retrieval.filter((row) => strictFactCategories.has(row.category));
  const retrievalBroad = retrieval.filter((row) => broadFactCategories.has(row.category));
  const sourceBackedStrict = failures.filter((row) => strictFactCategories.has(row.category) && row.fact_source_backed === true);
  const retrievalSourceBackedStrict = retrieval.filter((row) => strictFactCategories.has(row.category) && row.fact_source_backed === true);
  const currentRecall5 = retrievalDiagnostic.retrieval?.hybrid?.[5]?.numerator || 0;
  const selectionRate = retrievalDiagnostic.selection?.rate || 0;
  const applicationRate = retrievalDiagnostic.safe_application?.rate || 0;
  return {
    schema_version: "fact-engine-addressability-audit-v1",
    generated_at: generatedAt,
    policy: {
      holdout_diagnostic_only: true,
      holdout_rule_tuning_forbidden: true,
      facts_cannot_generate_titles: true,
      strict_fact_categories: [...strictFactCategories],
      broad_fact_categories: [...broadFactCategories]
    },
    summary: {
      diagnostic_unit_count: failures.length,
      by_layer: countBy(failures, "layer"),
      by_category: countBy(failures),
      strict_fact_addressable_rate: metric(strict.length, failures.length),
      broad_fact_addressable_rate: metric(broad.length, failures.length),
      source_backed_strict_fact_addressable_rate: metric(sourceBackedStrict.length, failures.length),
      evidence_strict_addressable_rate: metric(evidenceStrict.length, evidence.length),
      retrieval_strict_addressable_rate: metric(retrievalStrict.length, retrieval.length),
      retrieval_broad_addressable_rate: metric(retrievalBroad.length, retrieval.length),
      retrieval_source_backed_strict_addressable_rate: metric(retrievalSourceBackedStrict.length, retrieval.length)
    },
    theoretical_ceiling: {
      evidence_oracle_recall_if_strict_facts_fixed: metric(159 + evidenceStrict.length, 261),
      retrieval_recall_at_5_if_strict_facts_fixed: metric(currentRecall5 + retrievalStrict.length, items.length),
      retrieval_recall_at_5_if_broad_facts_fixed: metric(currentRecall5 + retrievalBroad.length, items.length),
      retrieval_recall_at_5_if_source_backed_strict_facts_fixed: metric(currentRecall5 + retrievalSourceBackedStrict.length, items.length),
      expected_additional_selected_cards_strict: Number((retrievalStrict.length * selectionRate).toFixed(3)),
      expected_additional_selected_cards_broad: Number((retrievalBroad.length * selectionRate).toFixed(3)),
      expected_additional_selected_cards_source_backed_strict: Number((retrievalSourceBackedStrict.length * selectionRate).toFixed(3)),
      expected_additional_applied_cards_strict: Number((retrievalStrict.length * selectionRate * applicationRate).toFixed(3)),
      expected_additional_applied_cards_broad: Number((retrievalBroad.length * selectionRate * applicationRate).toFixed(3)),
      expected_additional_applied_cards_source_backed_strict: Number((retrievalSourceBackedStrict.length * selectionRate * applicationRate).toFixed(3))
    },
    failures
  };
}
