import { normalizeResolvedFields } from "../listing/evidence/evidence-schema.mjs";
import {
  canonicalValueKey,
  normalizeSource,
  normalizeText,
  parseSerial,
  sourceIsMarketplace
} from "./normalizer.mjs";
import {
  allowedDenominators,
  identityContextFromAggregation,
  serialDenominatorsFromAggregation,
  splitParallelDescriptor
} from "./parallel-taxonomy.mjs";
import { sourceRank } from "./types.mjs";

const candidateRetrievalOrder = Object.freeze([
  "checklist_code_exact",
  "collector_number_and_player",
  "year_product_player",
  "card_type",
  "serial_denominator",
  "visual_parallel_candidate"
]);

function listFromMaybe(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function comparable(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compatibleText(left, right) {
  const a = comparable(left);
  const b = comparable(right);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

function aggregationValues(aggregation = {}, field) {
  return Object.values(aggregation.fields?.[field] || {}).map((group) => group.value).filter(Boolean);
}

function evidenceSnapshot(aggregation = {}) {
  return {
    year: aggregationValues(aggregation, "year"),
    product: aggregationValues(aggregation, "product"),
    players: aggregationValues(aggregation, "players").flatMap((value) => Array.isArray(value) ? value : [value]),
    character: aggregationValues(aggregation, "character"),
    collector_number: aggregationValues(aggregation, "collector_number"),
    checklist_code: aggregationValues(aggregation, "checklist_code"),
    card_type: aggregationValues(aggregation, "card_type"),
    serial_denominators: serialDenominatorsFromAggregation(aggregation),
    surface_color: aggregationValues(aggregation, "surface_color"),
    parallel_family: aggregationValues(aggregation, "parallel_family"),
    parallel_exact: aggregationValues(aggregation, "parallel_exact"),
    parallel: aggregationValues(aggregation, "parallel")
  };
}

function candidateFields(candidate = {}) {
  const raw = candidate.fields && typeof candidate.fields === "object"
    ? candidate.fields
    : candidate.resolved && typeof candidate.resolved === "object"
      ? candidate.resolved
      : candidate;
  return normalizeResolvedFields(raw);
}

function nestedCardRecords(schema = {}) {
  return [
    schema.cards,
    schema.card_identities,
    schema.cardIdentities,
    schema.identity_candidates,
    schema.identityCandidates,
    schema.checklist,
    schema.records,
    schema.items
  ].flatMap(listFromMaybe).filter((record) => record && typeof record === "object");
}

function inheritedCandidate(parent = {}, child = {}) {
  const parentFields = candidateFields(parent);
  const childFields = candidateFields(child);
  return {
    ...parent,
    ...child,
    fields: {
      ...parentFields,
      ...childFields
    },
    parent_schema: parent
  };
}

function sourceCandidate(candidate = {}, index, fallbackSourceType) {
  const fields = candidateFields(candidate);
  const sourceType = normalizeSource(candidate.source || candidate.source_type || fallbackSourceType);
  return {
    candidate_id: candidate.candidate_id || candidate.id || candidate.registry_id || candidate.source_url || `card_identity_${index + 1}`,
    title: candidate.title || candidate.name || "",
    source_type: sourceType,
    source_url: candidate.source_url || "",
    provider_id: candidate.provider_id || candidate.provider || "",
    trust_tier: Number(candidate.trust_tier || (sourceIsMarketplace(sourceType) ? 8 : 4)),
    fields,
    raw: candidate
  };
}

function collectSourceCandidates({
  retrievalCandidates = [],
  registryRecords = [],
  productSchemas = []
} = {}) {
  const retrieval = listFromMaybe(retrievalCandidates).map((candidate, index) => sourceCandidate(candidate, index, "MARKETPLACE"));
  const registry = listFromMaybe(registryRecords).map((candidate, index) => sourceCandidate(candidate, index, "STRUCTURED_DATABASE"));
  const schemas = listFromMaybe(productSchemas).flatMap((schema) => {
    const nested = nestedCardRecords(schema);
    const topLooksLikeCard = Boolean(schema.fields || schema.resolved || schema.collector_number || schema.checklist_code || schema.players || schema.player);
    return [
      ...(topLooksLikeCard ? [schema] : []),
      ...nested.map((record) => inheritedCandidate(schema, record))
    ];
  }).map((candidate, index) => sourceCandidate(candidate, index, "STRUCTURED_DATABASE"));

  const seen = new Set();
  return [...retrieval, ...registry, ...schemas].filter((candidate) => {
    const key = [
      candidate.candidate_id,
      candidate.source_type,
      canonicalValueKey("checklist_code", candidate.fields.checklist_code),
      canonicalValueKey("collector_number", candidate.fields.collector_number),
      canonicalValueKey("players", candidate.fields.players),
      canonicalValueKey("product", candidate.fields.product),
      canonicalValueKey("parallel_exact", candidate.fields.parallel_exact || candidate.fields.parallel)
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function subjectValues(fields = {}) {
  return [
    ...(Array.isArray(fields.players) ? fields.players : []),
    fields.character
  ].filter(Boolean);
}

function allEvidenceSubjectsPresent(evidenceSubjects = [], candidateSubjects = []) {
  if (!evidenceSubjects.length || !candidateSubjects.length) return false;
  return evidenceSubjects.every((subject) => candidateSubjects.some((candidate) => compatibleText(candidate, subject)));
}

function addSignal(score, signals, signal, amount) {
  signals.push({ signal, score_delta: Number(amount.toFixed(4)) });
  return score + amount;
}

function addConflict(conflicts, field, reason, severity = "MEDIUM") {
  conflicts.push({ field, reason, severity });
}

function serialDenominatorFromFields(fields = {}) {
  return parseSerial(fields.serial_number).denominator || null;
}

function parallelCandidateValue(fields = {}) {
  return fields.parallel_exact || fields.parallel || fields.variation || "";
}

function visualParallelMatches(evidence = {}, fields = {}) {
  const candidate = splitParallelDescriptor(parallelCandidateValue(fields));
  const colors = evidence.surface_color.map(comparable).filter(Boolean);
  const families = evidence.parallel_family.map(comparable).filter(Boolean);
  const colorMatch = !colors.length || (candidate.surface_color && colors.includes(comparable(candidate.surface_color)));
  const familyMatch = !families.length || (candidate.parallel_family && families.includes(comparable(candidate.parallel_family)));
  return Boolean((colors.length || families.length) && colorMatch && familyMatch);
}

function scoreWholeCardCandidate(candidate = {}, {
  aggregation = {},
  productSchemas = [],
  registryRecords = []
} = {}) {
  const fields = candidate.fields || {};
  const evidence = evidenceSnapshot(aggregation);
  const conflicts = [];
  const signals = [];
  let score = 0;

  if (evidence.checklist_code.length && fields.checklist_code) {
    if (evidence.checklist_code.some((value) => compatibleText(value, fields.checklist_code))) {
      score = addSignal(score, signals, "checklist_code_exact", 0.28);
    } else {
      addConflict(conflicts, "checklist_code", "candidate checklist_code conflicts with card evidence", "HIGH");
    }
  }

  if (evidence.collector_number.length && fields.collector_number) {
    if (evidence.collector_number.some((value) => compatibleText(value, fields.collector_number))) {
      score = addSignal(score, signals, "collector_number", 0.14);
    } else {
      addConflict(conflicts, "collector_number", "candidate collector_number conflicts with card evidence", "HIGH");
    }
  }

  const evidenceSubjects = unique([...evidence.players, ...evidence.character].map(normalizeText));
  const candidateSubjects = subjectValues(fields);
  if (evidenceSubjects.length && candidateSubjects.length) {
    if (allEvidenceSubjectsPresent(evidenceSubjects, candidateSubjects)) {
      score = addSignal(score, signals, "player_subject", 0.18);
    } else {
      addConflict(conflicts, "players", "candidate subject conflicts with card evidence", "HIGH");
    }
  }

  if (evidence.year.length && fields.year) {
    if (evidence.year.some((value) => compatibleText(value, fields.year))) {
      score = addSignal(score, signals, "year", 0.1);
    } else {
      addConflict(conflicts, "year", "candidate year conflicts with card evidence", "MEDIUM");
    }
  }

  if (evidence.product.length && fields.product) {
    if (evidence.product.some((value) => compatibleText(value, fields.product))) {
      score = addSignal(score, signals, "product", 0.12);
    } else {
      addConflict(conflicts, "product", "candidate product conflicts with card evidence", "HIGH");
    }
  }

  if (evidence.card_type.length && fields.card_type) {
    if (evidence.card_type.some((value) => compatibleText(value, fields.card_type))) {
      score = addSignal(score, signals, "card_type", 0.06);
    } else {
      addConflict(conflicts, "card_type", "candidate card_type conflicts with card evidence", "MEDIUM");
    }
  }

  const evidenceDenominator = evidence.serial_denominators[0] || null;
  const candidateDenominator = serialDenominatorFromFields(fields);
  if (evidenceDenominator) {
    if (candidateDenominator) {
      if (candidateDenominator === evidenceDenominator) {
        score = addSignal(score, signals, "serial_denominator", 0.12);
      } else {
        addConflict(conflicts, "serial_number", "candidate serial denominator conflicts with card evidence", "HIGH");
      }
    } else if (parallelCandidateValue(fields)) {
      const context = identityContextFromAggregation(aggregation);
      const allowed = allowedDenominators({
        ...context,
        parallel_candidate: parallelCandidateValue(fields),
        productSchemas,
        registryRecords
      });
      if (allowed.allowed_denominators.includes(evidenceDenominator)) {
        score = addSignal(score, signals, "serial_denominator_taxonomy_possible", 0.08);
      } else if (allowed.allowed_denominators.length) {
        addConflict(conflicts, "parallel_exact", "candidate parallel is incompatible with serial denominator taxonomy", "HIGH");
      }
    }
  }

  if (visualParallelMatches(evidence, fields)) {
    score = addSignal(score, signals, "visual_parallel_candidate", 0.06);
  }

  const reliability = Math.max(0, (10 - Math.min(10, Number(candidate.trust_tier || 9))) * 0.012);
  if (reliability) score = addSignal(score, signals, "source_reliability", reliability);
  if (sourceIsMarketplace(candidate.source_type)) {
    score -= 0.1;
    signals.push({ signal: "marketplace_reference_penalty", score_delta: -0.1 });
  }

  const conflictPenalty = conflicts.reduce((sum, conflict) => {
    return sum + (conflict.severity === "HIGH" ? 0.22 : 0.1);
  }, 0);
  score = Math.max(0, Math.min(1, score - conflictPenalty));

  return {
    ...candidate,
    score: Number(score.toFixed(4)),
    matched_signals: signals,
    conflicts,
    conflict_count: conflicts.length
  };
}

function candidateMatchesGroundTruth(candidate = {}, groundTruth = {}) {
  const truth = normalizeResolvedFields(groundTruth);
  const fields = candidate.fields || {};
  const checks = ["year", "product", "collector_number", "checklist_code", "serial_number"];
  const scalarMatches = checks.every((field) => {
    if (!truth[field]) return true;
    return fields[field] && compatibleText(fields[field], truth[field]);
  });
  const truthSubjects = subjectValues(truth);
  const candidateSubjects = subjectValues(fields);
  return scalarMatches && (!truthSubjects.length || allEvidenceSubjectsPresent(truthSubjects, candidateSubjects));
}

function metricsForCandidates(candidates = [], groundTruthIdentity = null) {
  if (!groundTruthIdentity) {
    return {
      candidate_recall_at_k: null,
      solver_accuracy_when_candidate_present: null,
      ground_truth_available: false
    };
  }

  const present = candidates.some((candidate) => candidateMatchesGroundTruth(candidate, groundTruthIdentity));
  return {
    candidate_recall_at_k: present ? 1 : 0,
    solver_accuracy_when_candidate_present: null,
    ground_truth_available: true
  };
}

export function generateCardIdentityCandidates({
  aggregation = {},
  retrievalCandidates = [],
  registryRecords = [],
  productSchemas = [],
  options = {}
} = {}) {
  const topK = Math.max(1, Number(options.topK || 3));
  const candidates = collectSourceCandidates({ retrievalCandidates, registryRecords, productSchemas })
    .map((candidate) => scoreWholeCardCandidate(candidate, {
      aggregation,
      productSchemas,
      registryRecords
    }))
    .sort((left, right) => {
      return right.score - left.score
        || sourceRank(left.source_type) - sourceRank(right.source_type)
        || String(left.candidate_id).localeCompare(String(right.candidate_id));
    })
    .slice(0, topK);
  const selected = candidates.find((candidate) => candidate.score >= 0.62 && !candidate.conflicts.some((conflict) => conflict.severity === "HIGH")) || null;

  return {
    top_k: topK,
    retrieval_order: candidateRetrievalOrder,
    scoring_model: "whole_card_identity_candidate_v1",
    candidates: candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      title: candidate.title,
      source_type: candidate.source_type,
      source_url: candidate.source_url,
      provider_id: candidate.provider_id,
      trust_tier: candidate.trust_tier,
      score: candidate.score,
      selected: selected?.candidate_id === candidate.candidate_id,
      fields: candidate.fields,
      matched_signals: candidate.matched_signals,
      conflicts: candidate.conflicts,
      conflict_count: candidate.conflict_count
    })),
    selected_candidate_id: selected?.candidate_id || null,
    metrics: metricsForCandidates(candidates, options.groundTruthIdentity || null)
  };
}

export function evidenceItemsFromSelectedCardIdentity(report = {}) {
  const selected = (report.candidates || []).find((candidate) => candidate.selected);
  if (!selected) return [];
  const source = normalizeSource(selected.source_type || "STRUCTURED_DATABASE");
  const confidence = Math.max(0.45, Math.min(0.82, Number(selected.score || 0)));
  const fields = normalizeResolvedFields(selected.fields || {});
  const fieldNames = [
    "year",
    "manufacturer",
    "brand",
    "product",
    "set",
    "subset",
    "players",
    "character",
    "card_type",
    "insert",
    "surface_color",
    "parallel_family",
    "parallel_exact",
    "parallel",
    "variation",
    "serial_number",
    "collector_number",
    "checklist_code"
  ];

  return fieldNames
    .filter((field) => {
      const value = fields[field];
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== undefined && value !== "" && value !== false;
    })
    .map((field) => ({
      field,
      value: fields[field],
      source,
      confidence,
      metadata: {
        retrieval_source: "whole_card_identity_candidate",
        candidate_id: selected.candidate_id,
        candidate_score: selected.score,
        marketplace_reference_only: sourceIsMarketplace(source)
      }
    }));
}
