import { buildVectorCandidatePacket } from "../../retrieval/vector-candidate-packet.mjs";
import {
  buildCandidatePreApplicationEvidenceSnapshot,
  buildCandidateSelectionPass
} from "../../candidates/candidate-selection-pass.mjs";
import { buildRetrievalApplicationLayer } from "../../candidates/retrieval-application-layer.mjs";
import { SEM_STANDARD_VERSION } from "../../csm/sem-definition.mjs";
import { strongestInstanceAnchor } from "../anchors/anchor-classifier.mjs";
import { lookupCertIdentity } from "../anchors/cert-lookup.mjs";
import { supabaseRestAdminHeaders as supabaseServiceHeaders } from "../../../supabase-service-headers.mjs";

export const exactAnchorPolicyVersion = "v4-exact-anchor-finalize-v5-sports-composite";

// L1 exact-anchor finalize: when the fast-scout observation matches exactly
// one catalog identity on the strictest anchor tier (printed exact code
// agreement + at least two direct sports context dimensions, zero contradicted
// anchors), the catalog answer
// becomes a resolver candidate. This module never owns SEM fields or title
// rendering; `finalized` means resolver-ready, not writer/title-ready.
//
// Fail-closed by construction:
// - the scout must have read a printed exact code off the current card
// - the catalog candidate must pass the anchor hard filter with an exact
//   code match and zero contradictions, and be the ONLY candidate to do so
// - instance fields (print run, grade) come only from the current-image
//   scout reading; catalog contributes identity fields only
// Anything less falls through to the normal L2 path unchanged.

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return cleanText(value) !== "";
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
    const contextDimensions = [
      queryFields.subjects.length > 0,
      hasValue(queryFields.year),
      hasValue(queryFields.product) || hasValue(queryFields.set)
    ].filter(Boolean).length;
    return contextDimensions >= 2
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
        headers: supabaseServiceHeaders(key, {
          "content-type": "application/json"
        }),
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
    // Subject safety is already triple-enforced: the RPC WHERE clause filters
    // by the provided subject, scoutHasFinalizeAnchors requires subjects, and
    // any candidate-side subject mismatch lands in `contradicted`.
    const trusted = candidate.source_trust === "APPROVED_REFERENCE";
    const agreed = agreement.agreed || [];
    const sportsContextAgreementCount = [
      agreed.includes("subjects"),
      agreed.includes("year"),
      agreed.includes("product_hierarchy")
    ].filter(Boolean).length;
    const contextSatisfied = allowTcgCodeOnly
      ? true
      : allowSportsProductKey
        ? sportsContextAgreementCount >= 2
        : agreed.includes("year");
    return trusted
      && agreement.prompt_hard_filter_pass === true
      && agreement.exact_code_match === true
      && (agreement.contradicted || []).length === 0
      && contextSatisfied
      && (candidate.conflicting_fields || []).length === 0;
  });
}

function catalogCandidatePacket(candidate = {}) {
  return {
    vector_retrieval: {
      status: "COMPLETED",
      status_code: "EXACT_ANCHOR_CANDIDATE_READY",
      retrieval_strategy: "catalog_exact_anchor",
      instruction: "Candidate hypothesis only; Candidate Control and Resolver retain decision ownership.",
      candidates: [candidate],
      field_support: [],
      field_support_count: 0,
      field_support_fields: [],
      unavailable: []
    }
  };
}

function resolverInputForCatalogCandidate({
  scoutResult = {},
  scoutResolved = {},
  candidate = {},
  reason = "unique_trusted_exact_anchor_candidate",
  observationContext = scoutResult.current_image_context || {}
} = {}) {
  const candidateId = cleanText(candidate.candidate_id);
  if (!candidateId) {
    return {
      accepted: false,
      reason: "exact_anchor_candidate_missing_id",
      resolver_input: null
    };
  }

  const catalogPacket = catalogCandidatePacket(candidate);
  const canonicalDocument = scoutResult.canonical_evidence_document
    && typeof scoutResult.canonical_evidence_document === "object"
    && !Array.isArray(scoutResult.canonical_evidence_document)
    ? scoutResult.canonical_evidence_document
    : null;
  // Query context may select/narrow an identity, but it is not Resolver hard
  // evidence. On the pre-L2 route, seed the Resolver only with the canonical
  // hard-evidence snapshot; the selected candidate must carry any safe
  // product/subject fill through Retrieval Application. Provider-backed scout
  // calls have no canonical preingestion document and retain their existing
  // normalized observation snapshot.
  const resolverResolved = canonicalDocument
    ? { ...(canonicalDocument.resolved || {}) }
    : { ...scoutResolved };
  const resolverEvidence = canonicalDocument
    ? { ...(canonicalDocument.evidence || {}) }
    : { ...(scoutResult.evidence || scoutResult.normalized_evidence || {}) };
  const candidateObservationEvidence = canonicalDocument
    ? {
        ...(canonicalDocument.evidence || {}),
        ...(canonicalDocument.retrieval_context_evidence || {})
      }
    : resolverEvidence;
  const candidateBaseResult = {
    provider: "v4_exact_anchor",
    confidence: "LOW",
    reason,
    resolved: { ...scoutResolved },
    resolved_fields: { ...scoutResolved },
    evidence: scoutResult.evidence || scoutResult.normalized_evidence || {},
    normalized_evidence: candidateObservationEvidence,
    raw_observed_fields: canonicalDocument
      ? {
          ...(canonicalDocument.resolved || {}),
          ...(canonicalDocument.retrieval_context || {})
        }
      : { ...scoutResolved },
    raw_provider_fields: canonicalDocument
      ? {}
      : { ...(scoutResult.raw_provider_fields || scoutResolved) },
    raw_provider_field_evidence: Array.isArray(scoutResult.raw_provider_field_evidence)
      ? scoutResult.raw_provider_field_evidence
      : [],
    evidence_schema_version: canonicalDocument?.schema_version
      || scoutResult.evidence_schema_version
      || "exact-anchor-current-image-evidence-v1",
    unresolved: Array.isArray(scoutResult.unresolved) ? scoutResult.unresolved : [],
    catalog_candidate_packet: catalogPacket
  };
  candidateBaseResult.candidate_pre_application_evidence_snapshot =
    buildCandidatePreApplicationEvidenceSnapshot(candidateBaseResult, observationContext);
  candidateBaseResult.current_image_context =
    candidateBaseResult.candidate_pre_application_evidence_snapshot.current_image_context || null;
  const candidateControl = buildCandidateSelectionPass({
    result: candidateBaseResult,
    catalogContext: { packet: catalogPacket }
  });
  const selectedCandidateId = cleanText(candidateControl.selected_candidate_decision?.selected_candidate_id);
  if (selectedCandidateId !== candidateId) {
    return {
      accepted: false,
      reason: "exact_anchor_candidate_not_selected_by_candidate_control",
      resolver_input: null,
      candidate_control: candidateControl
    };
  }

  const retrievalApplication = buildRetrievalApplicationLayer({
    result: { ...candidateBaseResult, ...candidateControl },
    candidateControl,
    enabled: true,
    maxLength: 80
  });
  const identityEvidenceItems = Array.isArray(retrievalApplication.identity_evidence_items)
    ? retrievalApplication.identity_evidence_items
    : [];
  const canonicalOwner = retrievalApplication.owner === "retrieval_application_layer"
    && retrievalApplication.owns_candidate_application === true;
  const applicationSelectedWinner = cleanText(retrievalApplication.selected_candidate_id) === candidateId;
  if (!canonicalOwner || !applicationSelectedWinner || !identityEvidenceItems.length) {
    return {
      accepted: false,
      reason: !canonicalOwner
        ? "exact_anchor_candidate_application_owner_invalid"
        : !applicationSelectedWinner
          ? "exact_anchor_candidate_application_selection_mismatch"
          : "exact_anchor_candidate_application_no_safe_evidence",
      resolver_input: null,
      candidate_control: candidateControl,
      retrieval_application: retrievalApplication
    };
  }

  return {
    accepted: true,
    reason: "exact_anchor_candidate_control_accepted",
    resolver_input: {
      ...candidateBaseResult,
      ...candidateControl,
      resolved: resolverResolved,
      resolved_fields: resolverResolved,
      evidence: resolverEvidence,
      retrieval_context: canonicalDocument?.retrieval_context || null,
      retrieval_application: retrievalApplication,
      resolution_trace: [{
        phase: "exact_anchor",
        step: "candidate_to_resolver_input",
        decision: "resolver_required",
        output: {
          candidate_id: candidateId,
          candidate_identity_id: cleanText(candidate.candidate_identity_id) || null,
          candidate_lane: "catalog",
          candidate_selection_owner: "candidate_selection_pass",
          candidate_application_owner: retrievalApplication.owner,
          exact_anchor_policy_version: exactAnchorPolicyVersion,
          identity_evidence_fields: identityEvidenceItems.map((item) => item.field),
          identity_evidence_decisions: identityEvidenceItems.map((item) => (
            item.metadata?.retrieval_application_decision || null
          ))
        }
      }]
    },
    candidate_control: candidateControl,
    retrieval_application: retrievalApplication
  };
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

async function tryCertLookupLane({ scoutResult, scoutResolved, env, fetchImpl, timeoutMs }) {
  if (String(env.ENABLE_V4_CERT_LOOKUP_LANE || "true").toLowerCase() === "false") return null;
  const anchors = Array.isArray(scoutResult.anchor_dossier?.anchors)
    ? scoutResult.anchor_dossier.anchors
    : [];
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
      finalized_semantics: "RESOLVER_READY",
      resolver_ready: false,
      reason: "cert_conflict_review_required",
      review_required: true,
      anchor_lookup_candidate: anchorLookupCandidate,
      visual_verification: verification,
      identity_resolution: { status: "REVIEW_REQUIRED" }
    };
  }

  // The canonical Candidate Control Plane currently rebinds catalog card-code
  // anchors, but it has no versioned contract for a cert-registry current-copy
  // match. Do not create a second application owner here merely to keep the
  // fast lane. A visually compatible cert lookup remains a review/fall-through
  // signal until the Candidate owner explicitly models that source.
  return {
    finalized: false,
    finalized_semantics: "RESOLVER_READY",
    sem_standard_version: SEM_STANDARD_VERSION,
    reason: "cert_registry_candidate_application_owner_not_integrated",
    resolver_ready: false,
    resolver_input: null,
    review_required: true,
    anchor_lookup_candidate: anchorLookupCandidate,
    visual_verification: verification,
    identity_resolution: { status: "REVIEW_REQUIRED" },
    candidate: {
      candidate_id: `cert:${cleanText(lookup.grader)}:${cleanText(lookup.cert_number)}`,
      reference_title: lookup.canonical_title || "",
      source_type: lookup.source || "INTERNAL_CERT_REGISTRY",
      application_owner_status: "UNMODELED"
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
  policy = {}
} = {}) {
  const lookupTiming = {
    cert_lookup_ms: null,
    catalog_lookup_ms: null,
    parallel_lookup: true
  };
  const notFinalized = (reason, extra = {}) => ({
    finalized: false,
    finalized_semantics: "RESOLVER_READY",
    resolver_ready: false,
    reason,
    lookup_timing: { ...lookupTiming },
    ...extra
  });
  if (String(env.ENABLE_V4_EXACT_ANCHOR_FINALIZE || "true").toLowerCase() === "false") {
    return notFinalized("disabled_by_env");
  }
  const scoutResolved = scoutResult.resolved_fields || scoutResult.resolved || scoutResult.fields || {};
  const queryFields = exactAnchorQueryFieldsFromScout(scoutResolved);
  const allowTcgCodeOnly = policy.allow_tcg_code_only === true;
  const allowSportsProductKey = policy.allow_sports_product_key === true;
  const allowCatalogFinalize = policy.allow_catalog_finalize !== false;
  const allowCertLane = policy.allow_cert_lane !== false;
  const hasCatalogAnchors = allowCatalogFinalize && scoutHasFinalizeAnchors(queryFields, {
    allowTcgCodeOnly,
    allowSportsProductKey
  });
  const baseDiagnostics = {
    query_fields: queryFields,
    catalog_lookup_attempted: hasCatalogAnchors,
    catalog_candidate_count: 0,
    trusted_candidate_count: 0,
    eligible_candidate_count: 0
  };

  // Anchor-first order: a cert-registry hit is a current-copy review signal,
  // not a card-directory identity key. Until Candidate Control owns that
  // source contract it supplies no fields; a compatible lookup falls through
  // and a conflict blocks fast-lane finalize. The cert and catalog lookups are
  // independent I/O, so run them together and apply cert precedence after
  // both settle without adding serial latency.
  const certLookup = (async () => {
    if (!allowCertLane) return null;
    const startedAt = Date.now();
    try {
      return await timeoutRace(
        tryCertLookupLane({ scoutResult, scoutResolved, env, fetchImpl, timeoutMs }),
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
  if (certLane?.finalized || certLane?.review_required) {
    return { ...baseDiagnostics, ...certLane, lookup_timing: { ...lookupTiming } };
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
  const candidateApplication = resolverInputForCatalogCandidate({
    scoutResult,
    scoutResolved,
    candidate: winner,
    reason: "unique_trusted_exact_anchor_candidate",
    observationContext: scoutResult.current_image_context || {}
  });
  if (candidateApplication.accepted !== true || !candidateApplication.resolver_input) {
    return notFinalized(candidateApplication.reason || "exact_anchor_candidate_control_rejected", {
      ...diagnostics,
      candidate: {
        candidate_id: winner.candidate_id || null,
        candidate_identity_id: winner.candidate_identity_id || null,
        source_type: winner.source_type || null
      },
      candidate_control_decision: candidateApplication.candidate_control?.selected_candidate_decision || null,
      retrieval_application_owner: candidateApplication.retrieval_application?.owner || null
    });
  }

  return {
    ...diagnostics,
    finalized: true,
    finalized_semantics: "RESOLVER_READY",
    sem_standard_version: SEM_STANDARD_VERSION,
    reason: "exact_anchor_catalog_resolver_ready",
    resolver_ready: true,
    resolver_input: candidateApplication.resolver_input,
    candidate: {
      candidate_id: winner.candidate_id || null,
      candidate_identity_id: winner.candidate_identity_id || null,
      reference_title: winner.reference_title || "",
      anchor_agreement: winner.anchor_agreement || null,
      source_type: winner.source_type || null
    },
    lookup_timing: { ...lookupTiming }
  };
}
