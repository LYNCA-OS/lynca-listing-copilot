import { buildVectorCandidatePacket } from "../../retrieval/vector-candidate-packet.mjs";
import { renderListingPresentation } from "../../renderer/listing-renderer.mjs";
import { SEM_STANDARD_VERSION } from "../../csm/sem-definition.mjs";
import { collectAnchors, strongestIdentityAnchor } from "../anchors/anchor-classifier.mjs";
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
    collector_number: cleanText(scoutResolved.collector_number || scoutResolved.card_number),
    checklist_code: cleanText(scoutResolved.checklist_code),
    serial_number: cleanText(scoutResolved.serial_number),
    expected_serial_denominator: cleanText(scoutResolved.print_run_denominator || scoutResolved.expected_serial_denominator)
  };
}

export function scoutHasFinalizeAnchors(queryFields = {}) {
  return queryFields.subjects.length > 0
    && hasValue(queryFields.year)
    && (hasValue(queryFields.collector_number) || hasValue(queryFields.checklist_code));
}

async function fetchCatalogCandidates({ queryFields, env, fetchImpl, timeoutMs, attempts = 2 }) {
  const url = cleanText(env.SUPABASE_URL);
  const key = cleanText(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key || typeof fetchImpl !== "function") return null;
  // Transient PostgREST blips ("catalog_lookup_unavailable") were costing
  // fast-lane hits on catalog-covered cards; one bounded retry recovers them.
  // The extra attempt only spends time in the failure case, on a speculative
  // pre-click call where the budget exists.
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${url}/rest/v1/rpc/search_catalog_candidates`, {
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
        if (Array.isArray(rows)) return rows;
      }
    } catch {
      // fall through to retry
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function packetCandidatesFor(rows = [], queryFields = {}) {
  const sources = rows.map((row) => ({
    candidate_id: row.identity_id || row.candidate_id || null,
    candidate_identity_id: row.identity_id || null,
    provider_id: "catalog",
    source_type: row.source_type || "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
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

function finalizeEligibleCandidates(candidates = []) {
  return candidates.filter((candidate) => {
    const agreement = candidate.anchor_agreement || {};
    // Subject safety is already triple-enforced: the RPC WHERE clause filters
    // by the provided subject, scoutHasFinalizeAnchors requires subjects, and
    // any candidate-side subject mismatch lands in `contradicted`.
    return agreement.prompt_hard_filter_pass === true
      && agreement.exact_code_match === true
      && (agreement.contradicted || []).length === 0
      && (agreement.agreed || []).includes("year")
      && (candidate.conflicting_fields || []).length === 0;
  });
}

const catalogIdentityFields = Object.freeze([
  "category",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "card_name",
  "collector_number",
  "checklist_code",
  "official_card_type",
  "team"
]);

function mergedResolvedForFinalize(scoutResolved = {}, candidateFields = {}) {
  const merged = { ...scoutResolved };
  for (const field of catalogIdentityFields) {
    if (hasValue(candidateFields[field])) merged[field] = candidateFields[field];
  }
  // Identity fields come from the catalog; the physical-copy instance fields
  // (print run, grade, observed color/components) stay strictly from the
  // current-image scout reading and are never copied from the reference.
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
  const certAnchor = strongestIdentityAnchor(anchors);
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

  const merged = mergedResolvedForFinalize(scoutResolved, lookup.identity || {});
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
    anchor_lookup_candidate: anchorLookupCandidate,
    visual_verification: verification,
    identity_resolution: { status: "CONFIRMED" },
    candidate: {
      candidate_id: null,
      candidate_identity_id: null,
      reference_title: lookup.canonical_title || "",
      anchor_agreement: null,
      source_type: lookup.source
    },
    query_fields: { cert_number: certAnchor.normalized, grader: lookup.grader }
  };
}

export async function maybeFinalizeL1FromExactAnchor({
  scoutResult = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 2000,
  maxLength = 80
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
  if (String(env.ENABLE_V4_EXACT_ANCHOR_FINALIZE || "true").toLowerCase() === "false") {
    return notFinalized("disabled_by_env");
  }
  const scoutResolved = scoutResult.resolved_fields || scoutResult.resolved || scoutResult.fields || {};
  const queryFields = exactAnchorQueryFieldsFromScout(scoutResolved);
  const hasCatalogAnchors = scoutHasFinalizeAnchors(queryFields);

  // Anchor-first order: a cert-registry hit (verified against the image) is
  // the strongest identity source and a cert CONFLICT blocks fast-lane
  // finalize entirely. The cert and catalog lookups are independent I/O, so
  // run them together and apply cert precedence after both settle. This keeps
  // fail-closed semantics while avoiding serial network latency.
  const certLookup = (async () => {
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
        fetchCatalogCandidates({ queryFields, env, fetchImpl, timeoutMs, attempts: 2 }),
        timeoutMs * 2 + 100
      );
    } finally {
      lookupTiming.catalog_lookup_ms = Date.now() - startedAt;
    }
  })();
  const [certLane, rows] = await Promise.all([certLookup, catalogLookup]);
  if (certLane?.finalized || certLane?.review_required) {
    return { ...certLane, lookup_timing: { ...lookupTiming } };
  }
  if (!hasCatalogAnchors) return notFinalized("scout_missing_exact_anchors");
  if (!rows || !rows.length) return notFinalized(rows ? "no_catalog_candidates" : "catalog_lookup_unavailable");

  const candidates = packetCandidatesFor(rows, queryFields);
  const eligible = finalizeEligibleCandidates(candidates);
  if (eligible.length !== 1) {
    return notFinalized(eligible.length === 0 ? "no_exact_anchor_agreement" : "ambiguous_exact_anchor_candidates");
  }

  const winner = eligible[0];
  const merged = mergedResolvedForFinalize(scoutResolved, winner.fields || {});
  const presentation = renderListingPresentation({
    resolved: merged,
    evidence: scoutResult.evidence || scoutResult.normalized_evidence || {},
    maxLength
  });
  const title = cleanText(presentation.final_title);
  if (!title) return notFinalized("renderer_empty_title");

  return {
    finalized: true,
    sem_standard_version: SEM_STANDARD_VERSION,
    reason: "exact_anchor_catalog_finalized",
    title,
    resolved_fields: merged,
    presentation,
    candidate: {
      candidate_id: winner.candidate_id || null,
      candidate_identity_id: winner.candidate_identity_id || null,
      reference_title: winner.reference_title || "",
      anchor_agreement: winner.anchor_agreement || null,
      source_type: winner.source_type || null
    },
    query_fields: queryFields,
    lookup_timing: { ...lookupTiming }
  };
}
