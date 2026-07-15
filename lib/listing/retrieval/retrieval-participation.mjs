export const retrievalParticipationLevels = Object.freeze({
  NOT_USED: "NOT_USED",
  OBSERVATION_ONLY: "OBSERVATION_ONLY",
  FIELD_EVIDENCE: "FIELD_EVIDENCE",
  CANDIDATE_RANKING: "CANDIDATE_RANKING",
  IDENTITY_DECISION: "IDENTITY_DECISION"
});

const identityDecisionFields = new Set([
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "insert",
  "player",
  "players",
  "subjects",
  "card_name",
  "card_type",
  "official_card_type",
  "release_variant",
  "variation",
  "parallel",
  "parallel_exact",
  "parallel_family",
  "collector_number",
  "card_number",
  "checklist_code",
  "tcg_card_number"
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cleanTextList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => cleanText(item))
    .filter(Boolean))];
}

function traceLane(trace = {}) {
  const sourceType = cleanText(trace.source_type || trace.candidate_source_type).toLowerCase();
  if (sourceType.includes("checklist")) return "official_checklist";
  const lane = cleanText(trace.candidate_lane || trace.lane).toLowerCase();
  if (lane) return lane;
  if (sourceType.includes("vector")) return "vector";
  if (sourceType.includes("catalog") || sourceType.includes("registry") || sourceType.includes("internal")) {
    return "catalog";
  }
  return "";
}

function traceRowsForSource(rows = [], source = "") {
  const normalizedSource = cleanText(source).toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const lane = traceLane(row);
    if (lane === normalizedSource) return true;
    return normalizedSource === "catalog" && lane === "official_checklist";
  });
}

function legacyParticipationLevel(funnel = {}) {
  return cleanText(funnel.participation_level) || null;
}

function selectedCandidateId(funnel = {}, decisionStage = {}) {
  return cleanText(
    funnel.selected_candidate_id
      || decisionStage.selected_candidate_id
      || decisionStage.selected_candidate?.selected_candidate_id
  ) || null;
}

function retrievalApplicationRowsForSource(application = {}, source = "") {
  const decisions = Array.isArray(application?.decisions) ? application.decisions : [];
  const normalizedSource = cleanText(source).toLowerCase();
  return decisions.filter((row) => {
    const lane = traceLane(row);
    if (lane === normalizedSource) return true;
    return normalizedSource === "catalog" && lane === "official_checklist";
  });
}

function hasRetrievalApplicationContract(application = {}) {
  return cleanText(application?.schema_version) === "retrieval-application-v1"
    && Array.isArray(application?.decisions);
}

function appliedFieldsForSource({
  funnel = {},
  traceRows = [],
  decisionStage = {},
  retrievalApplication = {},
  source = ""
} = {}) {
  if (hasRetrievalApplicationContract(retrievalApplication)) {
    return cleanTextList(retrievalApplicationRowsForSource(retrievalApplication, source)
      .filter((row) => row.applied_to_final === true)
      .map((row) => row.resolver_field || row.field));
  }
  const selectedId = selectedCandidateId(funnel, decisionStage);
  const laneFields = traceRows
    .filter((row) => !selectedId || cleanText(row.candidate_id) === selectedId)
    .flatMap((row) => Array.isArray(row.applied_fields) ? row.applied_fields : []);
  const decisionFields = selectedId && cleanText(decisionStage.selected_candidate_id) === selectedId
    ? decisionStage.field_application?.applied_fields || []
    : [];
  return cleanTextList([
    ...(Array.isArray(funnel.applied_fields) ? funnel.applied_fields : []),
    ...laneFields,
    ...(Array.isArray(decisionFields) ? decisionFields : [])
  ]);
}

function supportedFieldsForSource({
  funnel = {},
  traceRows = [],
  retrievalApplication = {},
  source = ""
} = {}) {
  if (hasRetrievalApplicationContract(retrievalApplication)) {
    return cleanTextList(retrievalApplicationRowsForSource(retrievalApplication, source)
      .filter((row) => row.supported_final === true || row.applied_to_final === true)
      .map((row) => row.resolver_field || row.field));
  }
  return cleanTextList([
    ...(Array.isArray(funnel.evidence_support_fields) ? funnel.evidence_support_fields : []),
    ...traceRows.flatMap((row) => [
      ...(Array.isArray(row.can_apply_fields) ? row.can_apply_fields : []),
      ...(Array.isArray(row.support_only_fields) ? row.support_only_fields : [])
    ])
  ]);
}

function roleList({ observed, ranked, fieldEvidence, identityDecision }) {
  const roles = [];
  if (observed) roles.push(retrievalParticipationLevels.OBSERVATION_ONLY);
  if (ranked) roles.push(retrievalParticipationLevels.CANDIDATE_RANKING);
  if (fieldEvidence) roles.push(retrievalParticipationLevels.FIELD_EVIDENCE);
  if (identityDecision) roles.push(retrievalParticipationLevels.IDENTITY_DECISION);
  return roles.length ? roles : [retrievalParticipationLevels.NOT_USED];
}

export function classifyRetrievalParticipation({
  source = "catalog",
  funnel = {},
  candidateApplicationTrace = [],
  candidateDecisionStage = {},
  retrievalApplication = {},
  exactAnchorIdentityDecision = false
} = {}) {
  const rows = traceRowsForSource(candidateApplicationTrace, source);
  const applicationContractPresent = hasRetrievalApplicationContract(retrievalApplication);
  const applicationRows = retrievalApplicationRowsForSource(retrievalApplication, source);
  const rawCandidateCount = finiteCount(funnel.raw_candidate_count);
  const approvedCandidateCount = finiteCount(funnel.approved_candidate_count);
  const postObservationPromptCandidateCount = finiteCount(funnel.prompt_candidate_count);
  const providerPromptCandidateCount = finiteCount(funnel.provider_prompt_candidate_count);
  const promptCandidateCount = Math.max(
    postObservationPromptCandidateCount,
    providerPromptCandidateCount
  );
  const evidenceSupportFieldCount = applicationContractPresent
    ? applicationRows.filter((row) => ["APPLY", "SUPPORT"].includes(cleanText(row.decision).toUpperCase())).length
    : finiteCount(funnel.evidence_support_field_count);
  const appliedFields = appliedFieldsForSource({
    funnel,
    traceRows: rows,
    decisionStage: candidateDecisionStage,
    retrievalApplication,
    source
  });
  const supportedFields = supportedFieldsForSource({
    funnel,
    traceRows: rows,
    retrievalApplication,
    source
  });
  const selectedId = cleanText(retrievalApplication?.selected_candidate_id)
    || selectedCandidateId(funnel, candidateDecisionStage);
  const appliedFieldCount = applicationContractPresent
    ? appliedFields.length
    : Math.max(finiteCount(funnel.applied_field_count), appliedFields.length);
  const observed = rawCandidateCount > 0;
  // prompt_assist_used is a mode flag, not proof that a candidate entered the prompt.
  // Historical reports set it even when every candidate was blocked fail-closed.
  const ranked = promptCandidateCount > 0 || Boolean(selectedId);
  const fieldEvidence = evidenceSupportFieldCount > 0
    || supportedFields.length > 0
    || appliedFieldCount > 0;
  const identityFieldApplied = appliedFields.some((field) => identityDecisionFields.has(field));
  const identityDecision = exactAnchorIdentityDecision === true
    || identityFieldApplied
    || Boolean(selectedId && appliedFieldCount > 0 && funnel.title_changed === true);
  const finalFieldEffect = appliedFieldCount > 0 || funnel.title_changed === true || identityDecision;
  const roles = roleList({ observed, ranked, fieldEvidence, identityDecision });
  const participationLevel = identityDecision
    ? retrievalParticipationLevels.IDENTITY_DECISION
    : ranked
      ? retrievalParticipationLevels.CANDIDATE_RANKING
      : fieldEvidence
        ? retrievalParticipationLevels.FIELD_EVIDENCE
        : observed
          ? retrievalParticipationLevels.OBSERVATION_ONLY
          : retrievalParticipationLevels.NOT_USED;
  const reasonCodes = [];
  if (funnel.query_attempted === true) reasonCodes.push("QUERY_ATTEMPTED");
  if (!observed) reasonCodes.push("NO_CANDIDATE_RETURNED");
  if (observed) reasonCodes.push("CANDIDATE_OBSERVED");
  if (ranked) reasonCodes.push("CANDIDATE_ENTERED_RANKING");
  if (funnel.prompt_assist_used === true && !ranked) {
    reasonCodes.push("PROMPT_ASSIST_MODE_WITHOUT_PROMPT_CANDIDATE");
  }
  if (fieldEvidence) reasonCodes.push("FIELD_EVIDENCE_AVAILABLE");
  if (appliedFieldCount > 0) reasonCodes.push("FIELD_APPLIED_TO_FINAL_STATE");
  if (funnel.title_changed === true) reasonCodes.push("FINAL_TITLE_CHANGED");
  if (identityDecision) reasonCodes.push(exactAnchorIdentityDecision ? "EXACT_ANCHOR_IDENTITY_DECISION" : "IDENTITY_FIELD_DECISION");
  if (observed && !ranked && !fieldEvidence) reasonCodes.push("AVAILABLE_BUT_UNUSED");
  if (observed && !finalFieldEffect) reasonCodes.push("AVAILABLE_BUT_NOT_APPLIED");

  return {
    schema_version: "retrieval-participation-source-v1",
    source: cleanText(source).toLowerCase() || "unknown",
    participation_level: participationLevel,
    participation_roles: roles,
    legacy_participation_level: legacyParticipationLevel(funnel),
    query_attempted: funnel.query_attempted === true,
    retrieval_available: observed,
    retrieval_used: ranked || fieldEvidence || identityDecision,
    retrieval_applied: finalFieldEffect,
    retrieval_unused: observed && !ranked && !fieldEvidence && !identityDecision,
    retrieval_available_but_not_applied: observed && !finalFieldEffect,
    raw_candidate_count: rawCandidateCount,
    approved_candidate_count: approvedCandidateCount,
    prompt_candidate_count: promptCandidateCount,
    post_observation_prompt_candidate_count: postObservationPromptCandidateCount,
    provider_prompt_candidate_count: providerPromptCandidateCount,
    prompt_assist_mode_enabled: funnel.prompt_assist_used === true,
    evidence_support_field_count: evidenceSupportFieldCount,
    selected_candidate_id: selectedId,
    applied_field_count: appliedFieldCount,
    applied_fields: appliedFields,
    supported_fields: supportedFields,
    title_changed: funnel.title_changed === true,
    final_field_effect: finalFieldEffect,
    identity_decision: identityDecision,
    blocked_fields: cleanTextList(funnel.blocked_fields),
    blocked_reasons: cleanTextList(funnel.blocked_reasons),
    reason_codes: [...new Set(reasonCodes)]
  };
}

export function buildRetrievalParticipationSummary({
  catalogFunnel = {},
  vectorFunnel = {},
  officialChecklistFunnel = {},
  candidateApplicationTrace = [],
  candidateDecisionStage = {},
  retrievalApplication = {},
  exactAnchorIdentityDecision = false
} = {}) {
  const sources = {
    catalog: classifyRetrievalParticipation({
      source: "catalog",
      funnel: catalogFunnel,
      candidateApplicationTrace,
      candidateDecisionStage,
      retrievalApplication,
      exactAnchorIdentityDecision
    }),
    vector: classifyRetrievalParticipation({
      source: "vector",
      funnel: vectorFunnel,
      candidateApplicationTrace,
      candidateDecisionStage,
      retrievalApplication
    })
  };
  const officialChecklistRows = traceRowsForSource(candidateApplicationTrace, "official_checklist");
  const derivedOfficialChecklistFunnel = officialChecklistRows.length
    ? {
      query_attempted: true,
      raw_candidate_count: officialChecklistRows.length,
      approved_candidate_count: officialChecklistRows.filter((row) => row.prompt_eligible === true || row.provider_prompt_eligible === true).length,
      prompt_candidate_count: officialChecklistRows.filter((row) => row.prompt_eligible === true).length,
      evidence_support_field_count: officialChecklistRows.reduce((sum, row) => (
        sum
          + (Array.isArray(row.can_apply_fields) ? row.can_apply_fields.length : 0)
          + (Array.isArray(row.support_only_fields) ? row.support_only_fields.length : 0)
      ), 0),
      selected_candidate_id: officialChecklistRows.find((row) => (
        cleanText(row.candidate_id) === cleanText(candidateDecisionStage.selected_candidate_id)
      ))?.candidate_id || "",
      applied_fields: officialChecklistRows.flatMap((row) => row.applied_fields || []),
      applied_field_count: officialChecklistRows.reduce((sum, row) => sum + finiteCount(row.applied_fields?.length), 0),
      title_changed: candidateDecisionStage.title_changed === true
    }
    : {};
  const checklistFunnel = officialChecklistFunnel && Object.keys(officialChecklistFunnel).length
    ? officialChecklistFunnel
    : derivedOfficialChecklistFunnel;
  if (Object.keys(checklistFunnel).length) {
    sources.official_checklist = classifyRetrievalParticipation({
      source: "official_checklist",
      funnel: checklistFunnel,
      candidateApplicationTrace,
      candidateDecisionStage,
      retrievalApplication,
      exactAnchorIdentityDecision
    });
  }
  const rows = Object.values(sources);
  const retrievalAvailable = rows.some((row) => row.retrieval_available);
  const retrievalUsed = rows.some((row) => row.retrieval_used);
  const retrievalApplied = rows.some((row) => row.retrieval_applied);
  const candidateAvailable = rows.some((row) => row.prompt_candidate_count > 0 || Boolean(row.selected_candidate_id));
  return {
    schema_version: "retrieval-participation-v1",
    sources,
    retrieval_available: retrievalAvailable,
    retrieval_used: retrievalUsed,
    retrieval_applied: retrievalApplied,
    retrieval_unused: retrievalAvailable && !retrievalUsed,
    retrieval_available_but_not_applied: retrievalAvailable && !retrievalApplied,
    candidate_available: candidateAvailable,
    candidate_to_final: candidateAvailable && retrievalApplied,
    identity_decision_sources: rows.filter((row) => row.identity_decision).map((row) => row.source),
    applied_fields: cleanTextList(rows.flatMap((row) => row.applied_fields)),
    supported_fields: cleanTextList(rows.flatMap((row) => row.supported_fields))
  };
}
