import { foldLatinDiacritics } from "../pipeline/subject-identity.mjs";
import {
  candidateDirectConflicts,
  candidateFields,
  candidateId,
  candidateIsMarketplace,
  candidateSourceTrust,
  sourceTrustScore
} from "../candidates/candidate-application-policy.mjs";

export const cardDomainRerankerContract = Object.freeze({
  version: "card-identity-fusion-v1-20260722",
  embedding: "sparse-card-domain-identity-v1",
  mode: "shadow_only",
  dimensions: Object.freeze({
    identity_code: 8,
    serial_denominator: 6,
    subjects: 6,
    year: 5,
    product_hierarchy: 5,
    product: 4,
    set: 4,
    card_name: 3,
    parallel: 3,
    manufacturer: 2,
    surface_color: 1,
    ssp: 3,
    rc: 2,
    first_bowman: 2,
    auto: 2,
    relic: 2,
    patch: 2
  })
});

const exactConflictFields = new Set([
  "identity_code",
  "serial_denominator",
  "subjects",
  "year"
]);

const basicColors = Object.freeze({
  gold: "gold",
  golden: "gold",
  white: "white",
  red: "red",
  blue: "blue",
  green: "green",
  black: "black",
  silver: "silver",
  orange: "orange",
  purple: "purple"
});

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return foldLatinDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

function firstValue(...items) {
  return items.flatMap(values)[0] || "";
}

function serialDenominator(...items) {
  for (const item of items.flatMap(values)) {
    const denominator = item.match(/(?:\/|of)\s*0*(\d{1,5})\b/)?.[1]
      || item.match(/^0*(\d{1,5})$/)?.[1];
    if (denominator) return denominator;
  }
  return "";
}

function basicColor(value) {
  const tokens = normalizeText(value).split(" ").filter(Boolean);
  for (const token of tokens) {
    if (basicColors[token]) return basicColors[token];
  }
  return "";
}

function yearFamily(value) {
  const normalized = normalizeText(value);
  return normalized.match(/\b(19|20)\d{2}\b/)?.[0] || normalized;
}

function domainFields(raw = {}) {
  const fields = candidateFields({ fields: raw });
  const product = firstValue(fields.product);
  const set = firstValue(fields.set, fields.insert, fields.subset);
  return {
    identity_code: [...new Set([
      firstValue(fields.checklist_code),
      firstValue(fields.collector_number, fields.card_number, fields.tcg_card_number)
    ].filter(Boolean))],
    checklist_code: firstValue(fields.checklist_code),
    collector_number: firstValue(fields.collector_number, fields.card_number, fields.tcg_card_number),
    serial_denominator: serialDenominator(
      fields.serial_denominator,
      fields.print_run_denominator,
      fields.expected_serial_denominator,
      fields.numbered_to,
      fields.serial_number
    ),
    subjects: [...new Set([
      ...values(fields.players),
      ...values(fields.player),
      ...values(fields.character)
    ])].sort(),
    year: yearFamily(fields.year),
    product_hierarchy: [product, set].filter(Boolean).join(" "),
    product,
    set,
    card_name: firstValue(fields.card_name, fields.insert, fields.variation),
    parallel: firstValue(fields.parallel_exact, fields.parallel_family, fields.parallel),
    manufacturer: firstValue(fields.manufacturer, fields.brand),
    surface_color: basicColor(fields.surface_color),
    ssp: fields.ssp === true ? "ssp" : "",
    rc: fields.rc === true ? "rc" : "",
    first_bowman: fields.first_bowman === true ? "first bowman" : "",
    auto: fields.auto === true ? "auto" : "",
    relic: fields.relic === true ? "relic" : "",
    patch: fields.patch === true ? "patch" : ""
  };
}

function addFeature(embedding, key, weight) {
  if (!key || !Number.isFinite(weight) || weight <= 0) return;
  embedding[key] = Math.max(Number(embedding[key] || 0), weight);
}

export function buildCardDomainEmbedding(rawFields = {}) {
  const fields = domainFields(rawFields);
  const embedding = {};
  for (const [field, configuredWeight] of Object.entries(cardDomainRerankerContract.dimensions)) {
    const fieldValues = values(fields[field]);
    for (const value of fieldValues) {
      addFeature(embedding, `${field}=${value}`, configuredWeight);
      if (!["checklist_code", "collector_number", "serial_denominator", "year"].includes(field)) {
        for (const token of value.split(" ").filter((item) => item.length > 1)) {
          addFeature(embedding, `${field}:token=${token}`, configuredWeight * 0.35);
        }
      }
    }
  }
  return { fields, embedding };
}

export function cardDomainEmbeddingSimilarity(left = {}, right = {}) {
  const leftEmbedding = left.embedding || buildCardDomainEmbedding(left).embedding;
  const rightEmbedding = right.embedding || buildCardDomainEmbedding(right).embedding;
  const leftEntries = Object.entries(leftEmbedding);
  const rightEntries = Object.entries(rightEmbedding);
  if (!leftEntries.length || !rightEntries.length) return 0;
  const rightMap = new Map(rightEntries);
  const dot = leftEntries.reduce((sum, [key, weight]) => sum + weight * Number(rightMap.get(key) || 0), 0);
  const leftNorm = Math.sqrt(leftEntries.reduce((sum, [, weight]) => sum + weight ** 2, 0));
  const rightNorm = Math.sqrt(rightEntries.reduce((sum, [, weight]) => sum + weight ** 2, 0));
  return leftNorm && rightNorm ? Number((dot / (leftNorm * rightNorm)).toFixed(6)) : 0;
}

function cardDomainQueryCoverage(queryEmbedding = {}, candidateEmbedding = {}) {
  const queryEntries = Object.entries(queryEmbedding);
  if (!queryEntries.length) return 0;
  const total = queryEntries.reduce((sum, [, weight]) => sum + weight, 0);
  const covered = queryEntries.reduce((sum, [key, weight]) => (
    Number(candidateEmbedding[key] || 0) > 0 ? sum + weight : sum
  ), 0);
  return total ? Number((covered / total).toFixed(6)) : 0;
}

function fieldConflicts(queryFields = {}, candidateDomainFields = {}) {
  const conflicts = [];
  for (const field of exactConflictFields) {
    const queryValues = values(queryFields[field]);
    const candidateValues = values(candidateDomainFields[field]);
    if (!queryValues.length || !candidateValues.length) continue;
    const compatible = queryValues.some((queryValue) => candidateValues.some((candidateValue) => (
      queryValue === candidateValue
      || (field === "subjects" && (queryValue.includes(candidateValue) || candidateValue.includes(queryValue)))
    )));
    if (!compatible) conflicts.push(field);
  }
  return conflicts;
}

function candidateVisualScore(candidate = {}) {
  return Math.max(0, Math.min(1, ...[
    candidate.visual_similarity,
    candidate.similarity,
    candidate.front_similarity,
    candidate.back_similarity,
    candidate.normalized_score,
    candidate.match_score
  ].map(Number).filter(Number.isFinite), 0));
}

function agreementScore(candidate = {}) {
  const agreement = candidate.anchor_agreement || {};
  const agreed = Array.isArray(agreement.agreed) ? agreement.agreed.length : 0;
  const contradicted = Array.isArray(agreement.contradicted) ? agreement.contradicted.length : 0;
  return Math.max(0, Math.min(1, agreed / 5 - contradicted * 0.3));
}

function exactAnchorScore(query = {}, candidate = {}) {
  const exactFields = ["identity_code", "serial_denominator"];
  const matches = exactFields.filter((field) => {
    const queryValues = values(query[field]);
    const candidateValues = values(candidate[field]);
    return queryValues.length && candidateValues.length && queryValues.some((value) => candidateValues.includes(value));
  });
  return Math.min(1, matches.length / 2);
}

function round(value) {
  return Number(Number(value || 0).toFixed(6));
}

export function rankCardDomainCandidates(candidates = [], observedFields = {}, {
  baselineSelectedCandidateId = "",
  limit = 5
} = {}) {
  const query = buildCardDomainEmbedding(observedFields);
  const ranked = candidates.map((candidate) => {
    const fields = candidateFields(candidate);
    const candidateEmbedding = buildCardDomainEmbedding(fields);
    const embeddingSimilarity = cardDomainEmbeddingSimilarity(query, candidateEmbedding);
    const queryCoverage = cardDomainQueryCoverage(query.embedding, candidateEmbedding.embedding);
    const derivedConflicts = fieldConflicts(query.fields, candidateEmbedding.fields);
    const directConflicts = candidateDirectConflicts(candidate);
    const conflicts = [...new Set([...derivedConflicts, ...directConflicts])];
    const exactAnchor = exactAnchorScore(query.fields, candidateEmbedding.fields);
    const visual = candidateVisualScore(candidate);
    const agreement = agreementScore(candidate);
    const trust = Math.max(0, Math.min(1, sourceTrustScore(candidateSourceTrust(candidate)) / 6));
    const marketplacePenalty = candidateIsMarketplace(candidate) ? 0.35 : 0;
    const conflictPenalty = conflicts.reduce((sum, field) => sum + (exactConflictFields.has(field) ? 0.55 : 0.18), 0);
    const score = Math.max(0, Math.min(1,
      embeddingSimilarity * 0.34
      + queryCoverage * 0.14
      + exactAnchor * 0.2
      + trust * 0.14
      + agreement * 0.12
      + visual * 0.08
      - marketplacePenalty
      - conflictPenalty
    ));
    return {
      candidate_id: candidateId(candidate),
      candidate_identity_id: cleanText(candidate.candidate_identity_id || candidate.identity_id),
      candidate_lane: cleanText(candidate.__candidate_lane),
      source_trust: candidateSourceTrust(candidate),
      decision_eligible: candidate.__decision_eligible === true,
      score: round(score),
      embedding_similarity: round(embeddingSimilarity),
      query_coverage: round(queryCoverage),
      exact_anchor_score: round(exactAnchor),
      visual_score: round(visual),
      source_trust_score: round(trust),
      agreement_score: round(agreement),
      conflicting_fields: conflicts,
      eligible_for_domain_selection: candidate.__decision_eligible === true
        && conflicts.length === 0
        && score >= 0.3
        && queryCoverage >= 0.3
    };
  }).sort((left, right) => right.score - left.score || right.source_trust_score - left.source_trust_score);
  const top = ranked[0] || null;
  const eligibleTop = ranked.find((candidate) => candidate.eligible_for_domain_selection) || null;
  const baseline = cleanText(baselineSelectedCandidateId);
  return {
    schema_version: cardDomainRerankerContract.version,
    mode: cardDomainRerankerContract.mode,
    embedding: cardDomainRerankerContract.embedding,
    candidate_count: ranked.length,
    top_candidate_id: top?.candidate_id || "",
    top_decision_eligible_candidate_id: eligibleTop?.candidate_id || "",
    baseline_selected_candidate_id: baseline,
    would_change_decision: Boolean(eligibleTop?.candidate_id && baseline !== eligibleTop.candidate_id),
    query_feature_count: Object.keys(query.embedding).length,
    selection_threshold: 0.3,
    ranked_candidates: ranked.slice(0, Math.max(1, limit))
  };
}
