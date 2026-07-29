export const cardJoinAddressabilityContractVersion = "cardjoin-addressability-v1";

export const cardJoinDefaultGate = Object.freeze({
  target_joint_success: 0.85,
  target_precision: 0.99,
  target_deadline_success: 0.95,
  deadline_ms: 3000,
  minimum_development: 100,
  minimum_validation: 30
});

const allowedSplits = new Set(["development", "validation"]);
const trustedSources = new Set([
  "OFFICIAL",
  "OFFICIAL_CHECKLIST",
  "REVIEWED_INTERNAL",
  "INTERNAL_VERIFIED_TITLE",
  "WRITER_REVIEWED"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanComparable(value) {
  return cleanText(Array.isArray(value) ? value.join(" ") : value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\((?:19|20)?\d{2}\s*[-/]\s*\d{2}\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function leadingYear(value) {
  return cleanText(value).match(/(?:19|20)\d{2}/)?.[0] || "";
}

function present(value) {
  if (Array.isArray(value)) return value.some(present);
  return cleanText(value) !== "";
}

function number(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function normalizeIdentity(raw = {}) {
  return {
    canonical_identity_id: cleanText(raw.canonical_identity_id || raw.identity_id),
    year: leadingYear(raw.year || raw.season_year || raw.season || raw.product_year),
    manufacturer: cleanComparable(raw.manufacturer || raw.brand),
    product: cleanComparable(raw.product || raw.product_name),
    set: cleanComparable(raw.set_or_insert || raw.set || raw.insert || raw.subset),
    subject: cleanComparable(raw.subject || raw.player || raw.players || raw.character),
    card_number: cleanComparable(
      raw.card_number || raw.collector_number || raw.checklist_code || raw.tcg_card_number
    )
  };
}

function identityMatches(groundTruth = {}, candidate = {}) {
  const truth = normalizeIdentity(groundTruth);
  const row = normalizeIdentity(candidate);
  if (truth.canonical_identity_id && row.canonical_identity_id) {
    return truth.canonical_identity_id === row.canonical_identity_id;
  }
  const decisiveFields = ["year", "product", "set", "subject", "card_number"];
  const comparableFields = decisiveFields.filter((field) => present(truth[field]));
  if (comparableFields.length < 4 || !truth.card_number || !truth.subject) return false;
  return comparableFields.every((field) => present(row[field]) && row[field] === truth[field]);
}

function sourceTrust(candidate = {}) {
  return cleanText(candidate.source_trust || candidate.trust || candidate.source_type).toUpperCase();
}

const sha256Pattern = /^(?:sha256:)?[a-f0-9]{64}$/i;

function sha256Value(value) {
  const text = cleanText(value).toLowerCase();
  return sha256Pattern.test(text) ? text.replace(/^sha256:/, "") : "";
}

function stringSet(value) {
  return new Set((Array.isArray(value) ? value : []).map(cleanText).filter(Boolean));
}

function hashSet(value) {
  return new Set((Array.isArray(value) ? value : []).map(sha256Value).filter(Boolean));
}

function candidateIsIndependent(candidate = {}, sample = {}) {
  const sourceId = cleanText(candidate.source_id || candidate.catalog_source_id);
  const truthSourceId = cleanText(sample.ground_truth_source_id);
  const sourceManifestSha256 = sha256Value(candidate.source_manifest_sha256);
  const contentSha256 = sha256Value(candidate.content_sha256);
  const truthContentSha256 = sha256Value(
    sample.ground_truth_source_sha256 || sample.ground_truth_source_version
  );
  const truthManifestSha256 = sha256Value(sample.ground_truth_manifest_sha256);
  const derivedFromSourceIds = stringSet(candidate.derived_from_source_ids);
  const derivedFromContentHashes = hashSet(candidate.derived_from_content_sha256);
  const sealedCandidateIds = stringSet(sample.sealed_source_candidate_ids);
  const candidateId = cleanText(candidate.candidate_id || candidate.identity_id);
  return sourceId !== ""
    && sourceManifestSha256 !== ""
    && contentSha256 !== ""
    && Array.isArray(candidate.derived_from_source_ids)
    && Array.isArray(candidate.derived_from_content_sha256)
    && (!truthSourceId || sourceId !== truthSourceId)
    && (!truthManifestSha256 || sourceManifestSha256 !== truthManifestSha256)
    && (!truthContentSha256 || contentSha256 !== truthContentSha256)
    && (!truthSourceId || !derivedFromSourceIds.has(truthSourceId))
    && (!truthContentSha256 || !derivedFromContentHashes.has(truthContentSha256))
    && (!candidateId || !sealedCandidateIds.has(candidateId));
}

function candidateIsTrusted(candidate = {}) {
  return trustedSources.has(sourceTrust(candidate));
}

function candidateRank(candidate = {}, index = 0) {
  return Math.max(1, Math.floor(number(candidate.rank, index + 1)));
}

function sensorJoinReady(sample = {}) {
  const sensor = sample.sensor_evidence || {};
  if (sensor.exact_tcg_code === true) return true;
  return sensor.exact_card_code === true
    && Number(sensor.direct_context_dimensions || 0) >= 2;
}

function sampleAdmissibility(sample = {}) {
  const reasons = [];
  const split = cleanText(sample.split).toLowerCase();
  if (!allowedSplits.has(split)) reasons.push(split === "holdout" ? "HOLDOUT_FORBIDDEN" : "INVALID_SPLIT");
  if (sample.ground_truth_independent !== true) reasons.push("GROUND_TRUTH_NOT_INDEPENDENT");
  if (!cleanText(sample.canonical_identity_id)) reasons.push("CANONICAL_IDENTITY_ID_MISSING");
  if (!cleanText(sample.ground_truth_source_id)) reasons.push("GROUND_TRUTH_SOURCE_MISSING");
  if (!sha256Value(sample.ground_truth_source_sha256 || sample.ground_truth_source_version)) {
    reasons.push("GROUND_TRUTH_SOURCE_HASH_MISSING");
  }
  if (!Array.isArray(sample.sealed_source_candidate_ids)) reasons.push("SEALED_CANDIDATE_IDS_MISSING");
  if (!sample.ground_truth || typeof sample.ground_truth !== "object") reasons.push("GROUND_TRUTH_MISSING");
  return { admissible: reasons.length === 0, reasons };
}

function deduplicateIdentitySamples(samples = []) {
  const ordered = [...samples].sort((left, right) => cleanText(left.id).localeCompare(cleanText(right.id)));
  const byIdentity = new Map();
  let duplicateCount = 0;
  for (const sample of ordered) {
    const identityId = cleanText(sample.canonical_identity_id);
    const split = cleanText(sample.split).toLowerCase();
    if (!identityId || !allowedSplits.has(split)) {
      byIdentity.set(`missing:${cleanText(sample.id)}:${byIdentity.size}`, sample);
      continue;
    }
    const existing = byIdentity.get(identityId);
    if (!existing) {
      byIdentity.set(identityId, sample);
      continue;
    }
    if (cleanText(existing.split).toLowerCase() !== split) {
      throw new Error(`CANONICAL_IDENTITY_CROSSES_SPLITS:${identityId}`);
    }
    duplicateCount += 1;
  }
  return { samples: [...byIdentity.values()], duplicateCount };
}

export function requiredCardJoinCoverage(gate = cardJoinDefaultGate) {
  const target = number(gate.target_joint_success, cardJoinDefaultGate.target_joint_success);
  const precision = number(gate.target_precision, cardJoinDefaultGate.target_precision);
  const deadline = number(gate.target_deadline_success, cardJoinDefaultGate.target_deadline_success);
  if (!(target > 0 && precision > 0 && deadline > 0)) return null;
  return Number((target / (precision * deadline)).toFixed(6));
}

export function analyzeCardJoinAddressability(samples = [], {
  gate = cardJoinDefaultGate
} = {}) {
  const deduplicated = deduplicateIdentitySamples(Array.isArray(samples) ? samples : []);
  const deadlineMs = number(gate.deadline_ms, cardJoinDefaultGate.deadline_ms);
  const rows = deduplicated.samples.map((sample) => {
    const admissibility = sampleAdmissibility(sample);
    const candidates = Array.isArray(sample.release_pack_candidates) ? sample.release_pack_candidates : [];
    const eligibleCandidates = candidates
      .map((candidate, index) => ({ ...candidate, rank: candidateRank(candidate, index) }))
      .filter((candidate) => candidateIsTrusted(candidate) && candidateIsIndependent(candidate, sample));
    const correct = eligibleCandidates.filter((candidate) => identityMatches(sample.ground_truth, candidate));
    const bestCorrectRank = correct.length ? Math.min(...correct.map((candidate) => candidate.rank)) : null;
    const topCandidate = [...eligibleCandidates].sort((left, right) => left.rank - right.rank)[0] || null;
    const candidatesAtBestCorrectRank = bestCorrectRank === null
      ? []
      : eligibleCandidates.filter((candidate) => candidate.rank === bestCorrectRank);
    const sourcePackReachable = correct.length > 0;
    const joinReady = sensorJoinReady(sample);
    const uniqueCorrectTop = sourcePackReachable
      && bestCorrectRank === 1
      && candidatesAtBestCorrectRank.length === 1
      && topCandidate != null
      && identityMatches(sample.ground_truth, topCandidate);
    const joinAddressable = joinReady && uniqueCorrectTop;
    const latencyMs = number(sample.no_provider_latency_ms, null);
    const deadlineObserved = latencyMs !== null;
    const deadlineMet = deadlineObserved && latencyMs <= deadlineMs;
    const predicted = sample.predicted_identity && typeof sample.predicted_identity === "object"
      ? sample.predicted_identity
      : null;
    const predictionObserved = predicted != null;
    const predictionCorrect = predictionObserved && identityMatches(sample.ground_truth, predicted);
    return {
      id: cleanText(sample.id || sample.key),
      split: cleanText(sample.split).toLowerCase(),
      admissible: admissibility.admissible,
      inadmissible_reasons: admissibility.reasons,
      trusted_independent_candidate_count: eligibleCandidates.length,
      correct_candidate_count: correct.length,
      source_pack_reachable: sourcePackReachable,
      retrieval_rank: bestCorrectRank,
      retrieval_recall_at_1: bestCorrectRank === 1,
      retrieval_recall_at_5: bestCorrectRank !== null && bestCorrectRank <= 5,
      retrieval_recall_at_20: bestCorrectRank !== null && bestCorrectRank <= 20,
      sensor_join_ready: joinReady,
      unique_correct_top: uniqueCorrectTop,
      join_addressable: joinAddressable,
      deadline_observed: deadlineObserved,
      deadline_met: deadlineMet,
      no_provider_latency_ms: latencyMs,
      prediction_observed: predictionObserved,
      prediction_correct: predictionCorrect,
      joint_success_observed: joinAddressable && deadlineMet && predictionCorrect
    };
  });

  const admissible = rows.filter((row) => row.admissible);
  const bySplit = Object.fromEntries(["development", "validation"].map((split) => {
    const subset = admissible.filter((row) => row.split === split);
    return [split, {
      denominator: subset.length,
      source_pack_reachability: rate(subset.filter((row) => row.source_pack_reachable).length, subset.length),
      retrieval_recall_at_1: rate(subset.filter((row) => row.retrieval_recall_at_1).length, subset.length),
      retrieval_recall_at_5: rate(subset.filter((row) => row.retrieval_recall_at_5).length, subset.length),
      retrieval_recall_at_20: rate(subset.filter((row) => row.retrieval_recall_at_20).length, subset.length),
      sensor_join_readiness: rate(subset.filter((row) => row.sensor_join_ready).length, subset.length),
      join_addressability: rate(subset.filter((row) => row.join_addressable).length, subset.length)
    }];
  }));
  // These are a conditional chain, not unrelated marginal rates:
  // P(addressable) * P(correct | addressable) *
  // P(deadline | addressable and correct) = P(joint success).
  const predictionRows = admissible.filter((row) => row.join_addressable && row.prediction_observed);
  const correctPredictionRows = predictionRows.filter((row) => row.prediction_correct);
  const deadlineRows = correctPredictionRows.filter((row) => row.deadline_observed);
  const coverage = rate(admissible.filter((row) => row.join_addressable).length, admissible.length);
  const observedPrecision = rate(predictionRows.filter((row) => row.prediction_correct).length, predictionRows.length);
  const observedDeadline = rate(deadlineRows.filter((row) => row.deadline_met).length, deadlineRows.length);
  const requiredCoverage = requiredCardJoinCoverage(gate);
  const denominatorReady = bySplit.development.denominator >= Number(gate.minimum_development)
    && bySplit.validation.denominator >= Number(gate.minimum_validation);
  const traceComplete = admissible.every((row) => row.deadline_observed && row.prediction_observed);
  const modelledJointCeiling = coverage === null
    ? null
    : Number((coverage * Number(gate.target_precision) * Number(gate.target_deadline_success)).toFixed(6));
  const observedJointSuccess = traceComplete
    ? rate(admissible.filter((row) => row.joint_success_observed).length, admissible.length)
    : null;

  let status = "NO_GO";
  const blockers = [];
  if (!denominatorReady) blockers.push("INSUFFICIENT_DENOMINATOR");
  if (!traceComplete) blockers.push("TRACE_INCOMPLETE");
  if (coverage === null || coverage < requiredCoverage) blockers.push("ADDRESSABILITY_BELOW_REQUIRED_COVERAGE");
  if (observedPrecision !== null && observedPrecision < Number(gate.target_precision)) blockers.push("PRECISION_BELOW_GATE");
  if (observedDeadline !== null && observedDeadline < Number(gate.target_deadline_success)) blockers.push("DEADLINE_BELOW_GATE");
  if (observedJointSuccess !== null && observedJointSuccess < Number(gate.target_joint_success)) {
    blockers.push("JOINT_SUCCESS_BELOW_GATE");
  }
  if (!denominatorReady) status = "INSUFFICIENT_DENOMINATOR";
  else if (!traceComplete) status = "TRACE_INCOMPLETE";
  else if (blockers.length === 0) status = "GO";

  return {
    contract_version: cardJoinAddressabilityContractVersion,
    route: "NO_FULL_PROVIDER",
    status,
    blockers,
    gate: {
      ...gate,
      required_addressable_coverage: requiredCoverage
    },
    denominator: admissible.length,
    excluded_count: rows.length - admissible.length,
    duplicate_identity_sample_count: deduplicated.duplicateCount,
    split: bySplit,
    metrics: {
      source_pack_reachability: rate(admissible.filter((row) => row.source_pack_reachable).length, admissible.length),
      retrieval_recall_at_1: rate(admissible.filter((row) => row.retrieval_recall_at_1).length, admissible.length),
      retrieval_recall_at_5: rate(admissible.filter((row) => row.retrieval_recall_at_5).length, admissible.length),
      retrieval_recall_at_20: rate(admissible.filter((row) => row.retrieval_recall_at_20).length, admissible.length),
      sensor_join_readiness: rate(admissible.filter((row) => row.sensor_join_ready).length, admissible.length),
      join_addressability: coverage,
      observed_precision_given_addressable: observedPrecision,
      observed_deadline_success_given_correct: observedDeadline,
      modelled_joint_ceiling: modelledJointCeiling,
      observed_joint_success: observedJointSuccess
    },
    rows
  };
}
