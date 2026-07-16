import { buildVectorCandidatePacket } from "../../retrieval/vector-candidate-packet.mjs";
import { renderListingPresentation } from "../../renderer/listing-renderer.mjs";
import {
  buildCandidateApplicationTrace,
  candidateDirectConflicts,
  candidateFields,
  candidateSourceTrust,
  candidateSourceType,
  participationLevels
} from "../../candidates/candidate-application-policy.mjs";
import { SEM_STANDARD_VERSION, semCatalogTrustVerdict } from "../../csm/sem-definition.mjs";
import { collectAnchors, strongestInstanceAnchor } from "../anchors/anchor-classifier.mjs";
import { lookupCertIdentity } from "../anchors/cert-lookup.mjs";

// L1 exact-anchor finalize: when the fast-scout observation matches exactly
// one catalog identity on the strictest anchor tier (printed exact code
// agreement + subject + year, zero contradicted anchors), the catalog answer
// IS the answer - the writer-visible title renders in the L1 window (~2-3s)
// instead of waiting 30-40s for the full L2 observation. L2 still runs in
// the background as verification.
//
// Fail-closed by construction:
// - the scout must have read a printed exact code off the current card
// - the catalog candidate must pass the anchor hard filter with an exact
//   code match and zero contradictions, and be the ONLY candidate to do so
// - the unified candidate policy decides which candidate fields may apply
// - subject and instance fields come only from the current-image scout
// Anything less falls through to the normal L2 path unchanged.

const referenceInstanceFields = new Set([
  "serial_number",
  "serial_numerator",
  "print_run_number",
  "print_run_numerator",
  "grade",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "cert_number",
  "condition",
  "current_physical_defects",
  "physical_defects",
  "defects"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return cleanText(value) !== "";
}

function exactAnchorWriterMode(env = {}) {
  const configured = cleanText(env.ENABLE_V4_EXACT_ANCHOR_FINALIZE).toLowerCase();
  if (configured === "true") return "WRITER_ENABLED";
  if (configured === "false") return "DISABLED";
  return "SHADOW_ONLY";
}

function currentImageHasSubjectEvidence(scoutResult = {}, scoutResolved = {}) {
  if (exactAnchorQueryFieldsFromScout(scoutResolved).subjects.length === 0) return false;
  const dossier = scoutResult.anchor_dossier;
  if (dossier && typeof dossier === "object") {
    return dossier.context?.subject_direct === true;
  }
  const evidence = scoutResult.evidence || scoutResult.normalized_evidence || {};
  return [evidence.players, evidence.subject, evidence.character].some((entry) => {
    const sources = Array.isArray(entry?.sources) ? entry.sources : [];
    return sources.some((source) => /VISION|OCR|PADDLE|CARD_FRONT|CARD_BACK|SLAB|PRINTED|OPERATOR/.test(
      cleanText(source?.source_type || source?.sourceType).toUpperCase()
    ));
  });
}

function referenceInstanceCopyViolation(candidate = {}, trace = {}) {
  const counterValue = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : value ? 1 : 0;
  };
  const counter = Math.max(
    counterValue(candidate.reference_instance_copy_violation_count),
    counterValue(candidate.reference_print_run_numerator_copy_violation_count),
    counterValue(candidate.external_print_run_numerator_copy_violation_count),
    counterValue(candidate.catalog_full_print_run_copy_violation_count),
    counterValue(candidate.serial_grade_cert_copy_violation_count)
  );
  const fields = new Set((trace.forbidden_fields || []).filter((field) => referenceInstanceFields.has(field)));
  if (counter > 0) {
    fields.add("serial_number");
    fields.add("print_run_numerator");
  }
  return {
    count: Math.max(counter, fields.size > 0 ? 1 : 0),
    fields: [...fields]
  };
}

function exactAnchorCandidatePolicy(candidate = {}, { currentImageSubjectEvidence = false } = {}) {
  const agreement = candidate.anchor_agreement && typeof candidate.anchor_agreement === "object"
    ? candidate.anchor_agreement
    : {};
  const directConflicts = candidateDirectConflicts(candidate);
  const trace = buildCandidateApplicationTrace(candidate, {
    participationLevel: participationLevels.SHADOW,
    matchLevel: "EXACT_CARD_MATCH"
  });
  const trustVerdict = semCatalogTrustVerdict({
    sourceType: candidateSourceType(candidate),
    sourceTrust: candidateSourceTrust(candidate),
    anchorAgreement: agreement,
    directConflicts,
    materialConflicts: candidate.conflicting_fields || []
  });
  const copyViolation = referenceInstanceCopyViolation(candidate, trace);
  const canApplyFields = (trace.can_apply_fields || []).filter(
    (field) => field !== "players" && field !== "character" && !referenceInstanceFields.has(field)
  );
  const passed = trustVerdict.allowed === true
    && directConflicts.length === 0
    && copyViolation.count === 0;
  return {
    schema_version: "v4-exact-anchor-candidate-policy-v1",
    passed,
    reason: copyViolation.count > 0
      ? "reference_instance_copy_violation"
      : trustVerdict.allowed !== true
        ? trustVerdict.reason || "candidate_trust_policy_rejected"
        : directConflicts.length
          ? "candidate_direct_conflict"
          : "unified_candidate_policy_passed",
    current_image_subject_evidence: currentImageSubjectEvidence,
    writer_eligible: passed && currentImageSubjectEvidence,
    reference_instance_copy_violation_count: copyViolation.count,
    reference_instance_copy_violation_fields: copyViolation.fields,
    can_apply_fields: canApplyFields,
    support_only_fields: trace.support_only_fields || [],
    suggest_only_fields: trace.suggest_only_fields || [],
    forbidden_fields: trace.forbidden_fields || [],
    trust_verdict: trustVerdict,
    application_trace: trace
  };
}

function shadowFinalizeResult(result = {}, reason, extra = {}) {
  const {
    title,
    resolved_fields: resolvedFields,
    presentation,
    ...diagnostics
  } = result;
  return {
    ...diagnostics,
    finalized: false,
    reason,
    ...extra,
    shadow: {
      eligible: result.candidate_policy?.writer_eligible === true,
      would_finalize_reason: result.reason || null,
      proposed_title: title || "",
      resolved_fields: resolvedFields || {},
      presentation: presentation || null
    }
  };
}

function applyWriterPublishGate(result = {}, writerMode = "SHADOW_ONLY") {
  const candidatePolicy = result.candidate_policy || {};
  if (candidatePolicy.reference_instance_copy_violation_count > 0) {
    return shadowFinalizeResult(result, "reference_instance_copy_violation");
  }
  if (candidatePolicy.passed !== true) {
    return shadowFinalizeResult(result, "candidate_policy_rejected");
  }
  if (candidatePolicy.current_image_subject_evidence !== true) {
    return shadowFinalizeResult(result, "current_image_subject_evidence_required");
  }
  if (writerMode !== "WRITER_ENABLED") {
    return shadowFinalizeResult(result, "writer_fast_lane_shadow_only");
  }
  return result;
}

function timeoutRace(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolvePromise) => {
      timer = setTimeout(() => resolvePromise(null), Math.max(1, ms));
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function exactAnchorQueryFieldsFromScout(scoutResolved = {}) {
  const players = Array.isArray(scoutResolved.players) && scoutResolved.players.length
    ? scoutResolved.players
    : scoutResolved.subject
      ? [scoutResolved.subject]
      : [];
  return {
    subjects: players.map(cleanText).filter(Boolean),
    year: cleanText(scoutResolved.year),
    manufacturer: cleanText(scoutResolved.manufacturer),
    product: cleanText(scoutResolved.product_family || scoutResolved.product || scoutResolved.set),
    set: cleanText(scoutResolved.set),
    collector_number: cleanText(
      scoutResolved.collector_number
      || scoutResolved.card_number
      || scoutResolved.tcg_card_number
    ),
    checklist_code: cleanText(scoutResolved.checklist_code),
    tcg_card_number: cleanText(scoutResolved.tcg_card_number),
    serial_number: cleanText(scoutResolved.serial_number),
    expected_serial_denominator: cleanText(scoutResolved.print_run_denominator || scoutResolved.expected_serial_denominator)
  };
}

export function scoutHasFinalizeAnchors(queryFields = {}, {
  allowTcgCodeOnly = false,
  allowSportsProductKey = false
} = {}) {
  if (allowTcgCodeOnly && hasValue(queryFields.tcg_card_number)) return true;
  if (allowSportsProductKey) {
    return hasValue(queryFields.year)
      && (hasValue(queryFields.product) || hasValue(queryFields.set))
      && (hasValue(queryFields.collector_number) || hasValue(queryFields.checklist_code));
  }
  return queryFields.subjects.length > 0
    && hasValue(queryFields.year)
    && (hasValue(queryFields.collector_number) || hasValue(queryFields.checklist_code));
}

async function fetchCatalogCandidates({
  queryFields,
  excludeSourceFeedbackIds = [],
  env,
  fetchImpl,
  timeoutMs,
  attempts = 2
}) {
  const url = cleanText(env.SUPABASE_URL);
  const key = cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  if (!url || !key || typeof fetchImpl !== "function") return null;
  // Transient PostgREST blips ("catalog_lookup_unavailable") were costing
  // fast-lane hits on catalog-covered cards; one bounded retry recovers them.
  // The extra attempt only spends time in the failure case, on a speculative
  // pre-click call where the budget exists.
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${url}/rest/v1/rpc/search_catalog_candidates_with_source`, {
        method: "POST",
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          exact_subject: queryFields.subjects.join(" / "),
          exact_year: queryFields.year,
          exact_product: queryFields.product,
          exact_card_number: queryFields.collector_number,
          exact_checklist_code: queryFields.checklist_code,
          exact_serial_denominator: queryFields.expected_serial_denominator,
          match_count: 8
        }),
        signal: controller.signal
      });
      if (response.ok) {
        const rows = await response.json();
        if (Array.isArray(rows)) {
          const excluded = new Set((Array.isArray(excludeSourceFeedbackIds) ? excludeSourceFeedbackIds : [])
            .map(cleanText)
            .filter(Boolean));
          return rows.filter((row) => {
            const sourceFeedbackId = cleanText(row?.source_feedback_id);
            return !sourceFeedbackId || !excluded.has(sourceFeedbackId);
          });
        }
      }
    } catch {
      // fall through to retry
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function rowSourceTrust(row = {}) {
  const status = cleanText(row.retrieval_status || row.reference_status).toUpperCase();
  return /^(?:APPROVED|REVIEWED|VERIFIED|REGISTRY|OFFICIAL|OFFICIAL_CHECKLIST)$/.test(status)
    ? "APPROVED_REFERENCE"
    : "REFERENCE_CANDIDATE";
}

export function packetCandidatesForExactAnchor(rows = [], queryFields = {}) {
  const sources = rows.map((row) => ({
    candidate_id: row.identity_id || row.candidate_id || null,
    candidate_identity_id: row.identity_id || null,
    provider_id: "catalog",
    source_type: row.source_type || "STRUCTURED_DATABASE",
    source_trust: rowSourceTrust(row),
    reference_metadata: {
      retrieval_status: row.retrieval_status || "candidate",
      source_type: row.source_type || "STRUCTURED_DATABASE"
    },
    title: row.canonical_title || "",
    reference_title: row.canonical_title || "",
    match_score: Number(row.normalized_score || row.raw_score || 0),
    normalized_score: Number(row.normalized_score || row.raw_score || 0),
    supporting_fields: Array.isArray(row.supporting_fields) ? row.supporting_fields : [],
    fields: row.fields && typeof row.fields === "object" ? row.fields : {}
  }));
  const packet = buildVectorCandidatePacket({ sources }, { limit: 8, queryFields });
  return Array.isArray(packet.vector_retrieval?.candidates) ? packet.vector_retrieval.candidates : [];
}

export function finalizeEligibleExactAnchorCandidates(candidates = [], {
  allowTcgCodeOnly = false,
  allowSportsProductKey = false
} = {}) {
  return candidates.filter((candidate) => {
    const agreement = candidate.anchor_agreement || {};
    // This function only identifies strict anchor matches. Writer publication
    // still requires the unified candidate policy and direct current-image
    // subject evidence in applyWriterPublishGate.
    const trusted = candidate.source_trust === "APPROVED_REFERENCE";
    const agreed = agreement.agreed || [];
    const contextSatisfied = allowTcgCodeOnly
      ? true
      : allowSportsProductKey
        ? agreed.includes("year") && agreed.includes("product_hierarchy")
        : agreed.includes("year");
    return trusted
      && agreement.prompt_hard_filter_pass === true
      && agreement.exact_code_match === true
      && (agreement.contradicted || []).length === 0
      && contextSatisfied
      && (candidate.conflicting_fields || []).length === 0;
  });
}

function mergedResolvedForFinalize(scoutResolved = {}, candidate = {}, candidatePolicy = {}) {
  const merged = { ...scoutResolved };
  const fields = candidateFields(candidate);
  for (const field of candidatePolicy.can_apply_fields || []) {
    if (hasValue(fields[field])) merged[field] = fields[field];
  }
  // Subject, support-only identity fields, and physical-copy instance fields
  // remain owned by the current-image observation. Candidate evidence stays
  // available in the policy trace without becoming resolved output.
  return merged;
}

function yearsRoughlyCompatible(a = "", b = "") {
  const startYear = (value) => (cleanText(value).match(/(19|20)\d{2}/) || [""])[0];
  const ya = startYear(a);
  const yb = startYear(b);
  if (!ya || !yb) return true;
  return ya === yb;
}

// Visual verification for a registry lookup candidate: every field present on
// BOTH sides must agree; absent fields never block (verify what is visible).
// Any contradiction means possible label/cert mismatch -> REVIEW_REQUIRED.
export function certVisualVerification(scoutResolved = {}, identity = {}) {
  const scoutPlayers = (Array.isArray(scoutResolved.players) ? scoutResolved.players : [scoutResolved.subject])
    .map(cleanText).filter(Boolean).map((name) => name.toLowerCase());
  const identityPlayers = (Array.isArray(identity.players) ? identity.players : [identity.subject])
    .map(cleanText).filter(Boolean).map((name) => name.toLowerCase());
  const subjectChecked = scoutPlayers.length > 0 && identityPlayers.length > 0;
  const subjectMatch = !subjectChecked || scoutPlayers.some((scoutName) => identityPlayers.some(
    (identityName) => scoutName.includes(identityName) || identityName.includes(scoutName)
  ));

  const yearChecked = hasValue(scoutResolved.year) && hasValue(identity.year);
  const yearMatch = !yearChecked || yearsRoughlyCompatible(scoutResolved.year, identity.year);

  const scoutProduct = cleanText(scoutResolved.product_family || scoutResolved.product || "").toLowerCase();
  const identityProduct = cleanText(identity.product || "").toLowerCase();
  const productChecked = Boolean(scoutProduct && identityProduct);
  const productMatch = !productChecked
    || scoutProduct.includes(identityProduct) || identityProduct.includes(scoutProduct);

  const conflicts = [];
  if (subjectChecked && !subjectMatch) conflicts.push("subject");
  if (yearChecked && !yearMatch) conflicts.push("year");
  if (productChecked && !productMatch) conflicts.push("product");

  return {
    pass: conflicts.length === 0 && (subjectChecked || yearChecked),
    subject_checked: subjectChecked,
    subject_match: subjectMatch,
    year_checked: yearChecked,
    year_match: yearMatch,
    product_checked: productChecked,
    product_match: productMatch,
    conflicts
  };
}

async function tryCertLookupLane({ scoutResult, scoutResolved, env, fetchImpl, timeoutMs, maxLength }) {
  if (String(env.ENABLE_V4_CERT_LOOKUP_LANE || "true").toLowerCase() === "false") return null;
  const anchors = collectAnchors({
    resolved: scoutResolved,
    evidence: scoutResult.evidence || scoutResult.normalized_evidence || {}
  });
  const certAnchor = strongestInstanceAnchor(anchors);
  if (!certAnchor || certAnchor.anchor_type !== "cert_number") return null;

  const lookup = await lookupCertIdentity({
    grader: certAnchor.grader || scoutResolved.grade_company || "",
    certNumber: certAnchor.normalized,
    env,
    fetchImpl,
    timeoutMs: Math.min(timeoutMs, 1200)
  });
  if (!lookup.found) return null;

  const anchorLookupCandidate = {
    source: lookup.source,
    match_level: lookup.match_level,
    grader: lookup.grader,
    cert_number: lookup.cert_number,
    review_status: lookup.review_status || null
  };
  const verification = certVisualVerification(scoutResolved, lookup.identity || {});
  if (!verification.pass) {
    // Cert record disagrees with what the camera sees: possible label or
    // cert misuse. Never finalize (through ANY lane) — flag for review.
    return {
      finalized: false,
      reason: "cert_conflict_review_required",
      review_required: true,
      anchor_lookup_candidate: anchorLookupCandidate,
      visual_verification: verification,
      identity_resolution: { status: "REVIEW_REQUIRED" }
    };
  }

  const agreed = [
    verification.subject_checked && verification.subject_match ? "subjects" : "",
    verification.year_checked && verification.year_match ? "year" : "",
    verification.product_checked && verification.product_match ? "product_hierarchy" : ""
  ].filter(Boolean);
  const policyCandidate = {
    candidate_id: `cert:${cleanText(lookup.grader)}:${cleanText(lookup.cert_number)}`,
    candidate_identity_id: null,
    provider_id: "internal_registry",
    source_type: lookup.source,
    source_trust: cleanText(lookup.review_status).toUpperCase() === "REVIEWED_INTERNAL"
      ? "REVIEWED_INTERNAL"
      : rowSourceTrust({ retrieval_status: lookup.review_status }),
    reference_title: lookup.canonical_title || "",
    reference_metadata: {
      retrieval_status: lookup.review_status || "candidate",
      source_type: lookup.source
    },
    anchor_agreement: {
      agreed,
      contradicted: [],
      exact_code_match: true,
      prompt_hard_filter_applicable: true,
      prompt_hard_filter_pass: true
    },
    conflicting_fields: [],
    fields: lookup.identity || {}
  };
  const candidatePolicy = exactAnchorCandidatePolicy(policyCandidate, {
    currentImageSubjectEvidence: currentImageHasSubjectEvidence(scoutResult, scoutResolved)
  });
  const merged = mergedResolvedForFinalize(scoutResolved, policyCandidate, candidatePolicy);
  const presentation = renderListingPresentation({
    resolved: merged,
    evidence: scoutResult.evidence || scoutResult.normalized_evidence || {},
    maxLength
  });
  const title = cleanText(presentation.final_title);
  if (!title) return null;

  return {
    finalized: true,
    sem_standard_version: SEM_STANDARD_VERSION,
    reason: "cert_registry_finalized",
    title,
    resolved_fields: merged,
    presentation,
    candidate_policy: candidatePolicy,
    anchor_lookup_candidate: anchorLookupCandidate,
    visual_verification: verification,
    identity_resolution: { status: "CONFIRMED" },
    candidate: {
      candidate_id: policyCandidate.candidate_id,
      candidate_identity_id: null,
      reference_title: lookup.canonical_title || "",
      anchor_agreement: policyCandidate.anchor_agreement,
      source_type: lookup.source
    },
    query_fields: { cert_number: certAnchor.normalized, grader: lookup.grader }
  };
}

export async function maybeFinalizeL1FromExactAnchor({
  scoutResult = {},
  excludeSourceFeedbackIds = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 2000,
  maxLength = 80,
  policy = {}
} = {}) {
  const lookupTiming = {
    cert_lookup_ms: null,
    catalog_lookup_ms: null,
    parallel_lookup: true
  };
  const notFinalized = (reason, extra = {}) => ({
    finalized: false,
    reason,
    lookup_timing: { ...lookupTiming },
    ...extra
  });
  const writerMode = exactAnchorWriterMode(env);
  if (writerMode === "DISABLED") {
    return notFinalized("disabled_by_env");
  }
  const scoutResolved = scoutResult.resolved_fields || scoutResult.resolved || scoutResult.fields || {};
  const queryFields = exactAnchorQueryFieldsFromScout(scoutResolved);
  const currentImageSubjectEvidence = currentImageHasSubjectEvidence(scoutResult, scoutResolved);
  const allowTcgCodeOnly = policy.allow_tcg_code_only === true;
  const allowSportsProductKey = policy.allow_sports_product_key === true;
  const allowCatalogFinalize = policy.allow_catalog_finalize !== false;
  const allowCertLane = policy.allow_cert_lane !== false;
  const hasCatalogAnchors = allowCatalogFinalize && scoutHasFinalizeAnchors(queryFields, {
    allowTcgCodeOnly,
    allowSportsProductKey
  });
  const baseDiagnostics = {
    writer_fast_lane_mode: writerMode,
    writer_fast_lane_enabled: writerMode === "WRITER_ENABLED",
    current_image_subject_evidence: currentImageSubjectEvidence,
    query_fields: queryFields,
    catalog_lookup_attempted: hasCatalogAnchors,
    catalog_candidate_count: 0,
    trusted_candidate_count: 0,
    eligible_candidate_count: 0
  };

  // Anchor-first order: a cert-registry hit is trusted instance/grade evidence,
  // not a card-directory identity key. It may supply registry fields only
  // after current-image verification, and a cert CONFLICT blocks fast-lane
  // finalize entirely. The cert and catalog lookups are independent I/O, so
  // run them together and apply cert precedence after both settle. This keeps
  // fail-closed semantics while avoiding serial network latency.
  const certLookup = (async () => {
    if (!allowCertLane) return null;
    const startedAt = Date.now();
    try {
      return await timeoutRace(
        tryCertLookupLane({ scoutResult, scoutResolved, env, fetchImpl, timeoutMs, maxLength }),
        timeoutMs
      );
    } finally {
      lookupTiming.cert_lookup_ms = Date.now() - startedAt;
    }
  })();
  const catalogLookup = (async () => {
    if (!hasCatalogAnchors) return null;
    const startedAt = Date.now();
    try {
      return await timeoutRace(
        fetchCatalogCandidates({
          queryFields,
          excludeSourceFeedbackIds,
          env,
          fetchImpl,
          timeoutMs,
          attempts: 2
        }),
        timeoutMs * 2 + 100
      );
    } finally {
      lookupTiming.catalog_lookup_ms = Date.now() - startedAt;
    }
  })();
  const [certLane, rows] = await Promise.all([certLookup, catalogLookup]);
  if (certLane?.review_required) {
    return { ...baseDiagnostics, ...certLane, lookup_timing: { ...lookupTiming } };
  }
  if (certLane?.finalized) {
    return applyWriterPublishGate(
      { ...baseDiagnostics, ...certLane, lookup_timing: { ...lookupTiming } },
      writerMode
    );
  }
  if (!hasCatalogAnchors) return notFinalized("scout_missing_exact_anchors", baseDiagnostics);
  if (!rows || !rows.length) {
    return notFinalized(rows ? "no_catalog_candidates" : "catalog_lookup_unavailable", baseDiagnostics);
  }

  const candidates = packetCandidatesForExactAnchor(rows, queryFields);
  const eligible = finalizeEligibleExactAnchorCandidates(candidates, {
    allowTcgCodeOnly,
    allowSportsProductKey
  });
  const diagnostics = {
    ...baseDiagnostics,
    catalog_candidate_count: candidates.length,
    trusted_candidate_count: candidates.filter((candidate) => candidate.source_trust === "APPROVED_REFERENCE").length,
    eligible_candidate_count: eligible.length
  };
  if (eligible.length !== 1) {
    return notFinalized(
      eligible.length === 0 ? "no_exact_anchor_agreement" : "ambiguous_exact_anchor_candidates",
      diagnostics
    );
  }

  const winner = eligible[0];
  const candidatePolicy = exactAnchorCandidatePolicy(winner, { currentImageSubjectEvidence });
  const merged = mergedResolvedForFinalize(scoutResolved, winner, candidatePolicy);
  const presentation = renderListingPresentation({
    resolved: merged,
    evidence: scoutResult.evidence || scoutResult.normalized_evidence || {},
    maxLength
  });
  const title = cleanText(presentation.final_title);
  if (!title) return notFinalized("renderer_empty_title");

  return applyWriterPublishGate({
    ...diagnostics,
    finalized: true,
    sem_standard_version: SEM_STANDARD_VERSION,
    reason: "exact_anchor_catalog_finalized",
    title,
    resolved_fields: merged,
    presentation,
    candidate_policy: candidatePolicy,
    candidate: {
      candidate_id: winner.candidate_id || null,
      candidate_identity_id: winner.candidate_identity_id || null,
      reference_title: winner.reference_title || "",
      anchor_agreement: winner.anchor_agreement || null,
      source_type: winner.source_type || null
    },
    lookup_timing: { ...lookupTiming }
  }, writerMode);
}
