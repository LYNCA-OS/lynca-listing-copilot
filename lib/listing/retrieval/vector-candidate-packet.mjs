import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { expandPrintRunFields, stripReferencePrintRunNumerator } from "../print-run/print-run-fields.mjs";

const vectorStatus = Object.freeze({
  COMPLETED: "COMPLETED",
  NO_CONFIDENT_MATCH: "NO_CONFIDENT_MATCH",
  UNAVAILABLE: "UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  ERROR: "ERROR"
});

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundScore(value) {
  const number = finiteNumber(value, null);
  return number === null ? null : Number(number.toFixed(4));
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function serialDenominator(value) {
  return cleanText(value).match(/\/\s*0*(\d{1,4})\b/)?.[1] || null;
}

function cleanUpper(value) {
  return cleanText(value).toUpperCase();
}

function cleanCompare(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareTokens(value) {
  return cleanCompare(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function referenceStatus(candidate = {}) {
  return cleanUpper(candidate.reference_metadata?.reference_status
    || candidate.reference_metadata?.retrieval_status
    || candidate.retrieval_status
    || candidate.status);
}

function candidateSourceType(candidate = {}) {
  return cleanUpper(candidate.source_type
    || candidate.reference_metadata?.source_type
    || candidate.provider_id
    || candidate.source_provider);
}

function candidateOriginalSourceType(candidate = {}) {
  return cleanUpper(candidate.reference_metadata?.source_type
    || candidate.source_type
    || candidate.provider_id
    || candidate.source_provider);
}

function candidateSourceTypeSet(candidate = {}) {
  return new Set([
    candidate.source_type,
    candidate.reference_metadata?.source_type,
    candidate.provider_id,
    candidate.retrieval_provider_id,
    candidate.source_provider,
    candidate.reference_metadata?.provider_id,
    candidate.reference_metadata?.source_provider
  ].map(cleanUpper).filter(Boolean));
}

const trustedReferenceStatuses = new Set([
  "APPROVED",
  "REVIEWED",
  "VERIFIED",
  "REGISTRY",
  "OFFICIAL",
  "OFFICIAL_CHECKLIST"
]);

const trustedReferenceSources = new Set([
  "INTERNAL_APPROVED_HISTORY",
  "APPROVED_MEMORY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_REGISTRY",
  "REGISTRY",
  "STRUCTURED_REGISTRY"
]);

const neverApprovedPromptSources = new Set([
  "MARKETPLACE_REFERENCE",
  "EXTERNAL_DIRECTORY_WEAK"
]);

const catalogProviderIds = new Set([
  "catalog",
  "postgres_hybrid",
  "internal_memory",
  "internal_registry"
]);

const catalogSourceTypes = new Set([
  "INTERNAL_APPROVED_HISTORY",
  "INTERNAL_REGISTRY",
  "OFFICIAL_CHECKLIST",
  "TOPPS_OFFICIAL_CHECKLIST",
  "PANINI_OFFICIAL_CHECKLIST",
  "UPPER_DECK_OFFICIAL_CHECKLIST",
  "LEAF_OFFICIAL_CHECKLIST",
  "LEAF_OFFICIAL_RELEASE",
  "FUTERA_OFFICIAL_CHECKLIST",
  "PARKSIDE_OFFICIAL_RELEASE",
  "ONIT_OFFICIAL_RELEASE",
  "SMALL_MANUFACTURER_OFFICIAL_RELEASE",
  "BANDAI_ONE_PIECE_OFFICIAL_CARDLIST",
  "BANDAI_DIGIMON_OFFICIAL_CARDLIST",
  "BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE",
  "BANDAI_DBS_MASTERS_OFFICIAL_CARD_DATABASE",
  "BANDAI_UNION_ARENA_OFFICIAL_CARDLIST",
  "BANDAI_BATTLE_SPIRITS_OFFICIAL_CARDLIST",
  "BANDAI_GENERIC_OFFICIAL_CARDLIST",
  "POKEMON_OFFICIAL_CARD_SEARCH",
  "POKEMON_TCG_COMMUNITY_API",
  "WOTC_GATHERER_OFFICIAL_DATABASE",
  "SCRYFALL_COMMUNITY_API",
  "KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE",
  "YGOPRODECK_COMMUNITY_API",
  "LORCANA_OFFICIAL_CARD_DATABASE",
  "LORCANA_COMMUNITY_API",
  "STAR_WARS_UNLIMITED_OFFICIAL_CARDLIST",
  "FAB_OFFICIAL_CARD_DATABASE",
  "BUSHIROAD_WEISS_SCHWARZ_OFFICIAL_CARDLIST",
  "BUSHIROAD_VANGUARD_OFFICIAL_CARDLIST",
  "BUSHIROAD_SHADOWVERSE_EVOLVE_OFFICIAL_CARDLIST",
  "GRAND_ARCHIVE_OFFICIAL_CARD_DATABASE",
  "ALTERED_OFFICIAL_CARD_DATABASE",
  "OFFICIAL_RELEASE_PAGE",
  "OFFICIAL_DIGITAL_LIBRARY",
  "LICENSED_EXTERNAL_DIRECTORY",
  "EXTERNAL_DIRECTORY_WEAK",
  "OFFICIAL_PRODUCT_PAGE",
  "OFFICIAL_GRADING_DATA",
  "STRUCTURED_DATABASE",
  "STRUCTURED_REGISTRY"
]);

const fieldSupportTrustedCatalogSourceTypes = new Set(
  [...catalogSourceTypes].filter((sourceType) => ![
    "STRUCTURED_DATABASE",
    "LICENSED_EXTERNAL_DIRECTORY",
    "EXTERNAL_DIRECTORY_WEAK",
    "MARKETPLACE_REFERENCE"
  ].includes(sourceType))
);

function subjectList(fields = {}) {
  const normalized = normalizeResolvedFields(fields);
  return Array.isArray(normalized.players) && normalized.players.length
    ? normalized.players
    : normalized.character
      ? [normalized.character]
      : [];
}

function sanitizedCandidateFields(fields = {}) {
  const normalized = normalizeResolvedFields(stripReferencePrintRunNumerator(fields || {}));
  const output = {
    year: normalized.year,
    manufacturer: normalized.manufacturer || normalized.brand,
    brand: normalized.brand || normalized.manufacturer,
    product: normalized.product || normalized.set,
    set: normalized.set,
    subset: normalized.subset,
    language: normalized.language,
    rarity: normalized.rarity,
    lot_type: normalized.lot_type,
    card_count: normalized.card_count,
    subjects: subjectList(normalized),
    card_name: normalized.card_name,
    card_type: normalized.card_type,
    insert: normalized.insert,
    surface_color: normalized.surface_color,
    parallel_family: normalized.parallel_family,
    parallel_exact: normalized.parallel_exact || normalized.parallel,
    collector_number: normalized.collector_number,
    checklist_code: normalized.checklist_code,
    print_run_denominator: normalized.print_run_denominator,
    numbered_to: normalized.numbered_to,
    serial_denominator: normalized.serial_denominator,
    expected_serial_denominator: normalized.expected_serial_denominator || normalized.print_run_denominator || normalized.numbered_to || serialDenominator(normalized.serial_number)
  };

  return Object.fromEntries(
    Object.entries(output).filter(([, value]) => hasValue(value))
  );
}

function sanitizedReferenceTitle(candidate = {}) {
  const title = cleanText(candidate.reference_title || candidate.title);
  if (!title) return "";
  return cleanText(title
    .replace(/\b(?:PSA|BGS|SGC|CGC|Beckett)\s+(?:Gem\s+Mint\s+)?(?:Auto\s+)?\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\bCert(?:ificate)?\s*#?\s*[A-Z0-9-]+\b/gi, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/\s+#\s+/g, " #")
  );
}

function referencePrintRunCopyViolation(candidate = {}) {
  const expanded = expandPrintRunFields(candidate.fields || {});
  const titleExpanded = expandPrintRunFields(candidate.reference_title || candidate.title || "");
  return Boolean(expanded.print_run_numerator || titleExpanded.print_run_numerator);
}

function sourceTrust(candidate = {}) {
  const existingTrust = cleanUpper(candidate.source_trust);
  const sourceType = candidateSourceType(candidate);
  const sourceTypes = candidateSourceTypeSet(candidate);
  if ([...sourceTypes].some((entry) => neverApprovedPromptSources.has(entry)) || candidateLooksMarketplaceWeak(candidate)) {
    return "REFERENCE_CANDIDATE";
  }
  if (existingTrust === "APPROVED_REFERENCE") return "APPROVED_REFERENCE";
  if (candidate.field_derivation?.corrected_title_as_temporary_gt === true
    || candidate.field_derivation?.title_derived_fields_are_ground_truth === true
    || candidate.reference_metadata?.corrected_title_as_temporary_gt === true) {
    return "APPROVED_REFERENCE";
  }
  const status = referenceStatus(candidate);
  if (trustedReferenceStatuses.has(status)) return "APPROVED_REFERENCE";
  if ([...sourceTypes].some((entry) => trustedReferenceSources.has(entry))) return "APPROVED_REFERENCE";
  if (trustedReferenceSources.has(sourceType)) return "APPROVED_REFERENCE";
  return "REFERENCE_CANDIDATE";
}

function candidateLooksMarketplaceWeak(candidate = {}) {
  const sourceTypes = candidateSourceTypeSet(candidate);
  if (sourceTypes.has("MARKETPLACE_REFERENCE")) return true;
  const text = [
    candidate.provider_id,
    candidate.retrieval_provider_id,
    candidate.source_provider,
    candidate.reference_metadata?.provider_id,
    candidate.reference_metadata?.source_provider,
    candidate.source_url,
    candidate.reference_metadata?.source_url
  ].map(cleanUpper).join(" ");
  return /\b(?:EBAY|MARKETPLACE|SELLER|DCSports87|DCSPORTS87)\b/i.test(text)
    || /EBAY\./i.test(text);
}

function candidateIdentityKey(candidate = {}) {
  return cleanText(candidate.candidate_identity_id)
    || cleanText(candidate.identity_id)
    || cleanText(candidate.candidate_id)
    || cleanText(candidate.source_url)
    || JSON.stringify(sanitizedCandidateFields(candidate.fields || {}));
}

export function candidateConflictFields(candidate = {}) {
  const explicit = [
    candidate.conflicting_fields,
    candidate.direct_evidence_conflicts,
    candidate.conflicts
  ].flatMap((value) => Array.isArray(value) ? value : []);
  return [...new Set(explicit.map((field) => cleanText(
    typeof field === "string" ? field : field?.field || field?.field_name || field?.name || field?.conflicting_field
  )).filter(Boolean))];
}

function candidateHasDirectConflict(candidate = {}) {
  if (candidateConflictFields(candidate).length) return true;
  const conflictCount = finiteNumber(candidate.field_conflict_count ?? candidate.direct_evidence_conflict_count, 0) || 0;
  return conflictCount > 0;
}

function candidateSoftConflictFields(candidate = {}) {
  const explicit = [
    candidate.soft_conflicting_fields,
    candidate.soft_conflicts
  ].flatMap((value) => Array.isArray(value) ? value : []);
  return [...new Set(explicit.map((field) => cleanText(
    typeof field === "string" ? field : field?.field || field?.field_name || field?.name || field?.conflicting_field
  )).filter(Boolean))];
}

function candidateAnchorContradictions(candidate = {}) {
  return Array.isArray(candidate.anchor_agreement?.contradicted)
    ? candidate.anchor_agreement.contradicted.map(cleanText).filter(Boolean)
    : [];
}

function candidateHasAnyPromptConflict(candidate = {}) {
  return candidateHasDirectConflict(candidate)
    || candidateAnchorContradictions(candidate).length > 0;
}

function promptCandidateId(candidate = {}) {
  return cleanText(candidate.candidate_identity_id)
    || cleanText(candidate.identity_id)
    || cleanText(candidate.candidate_id)
    || cleanText(candidate.source_url);
}

function uniquePromptCandidates(candidates = []) {
  const seen = new Set();
  return candidates.filter((candidate, index) => {
    const fields = sanitizedCandidateFields(candidate.fields || {});
    const referenceTitle = sanitizedReferenceTitle(candidate);
    const key = referenceTitle || Object.keys(fields).length
      ? `${cleanCompare(referenceTitle)}:${JSON.stringify(fields).toLowerCase()}`
      : promptCandidateId(candidate) || `prompt_candidate_${index + 1}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isAssistApprovedCandidate(candidate = {}) {
  return sourceTrust(candidate) === "APPROVED_REFERENCE";
}

function normalizedCandidateFieldNames(candidate = {}) {
  return [...new Set([
    ...(Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : []),
    ...(Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [])
  ].map((field) => cleanText(field).toLowerCase()).filter(Boolean))];
}

function candidateFieldSet(candidate = {}) {
  return new Set(normalizedCandidateFieldNames(candidate));
}

function candidateIsCatalogLike(candidate = {}) {
  const provider = cleanUpper(candidate.provider_id || candidate.retrieval_provider_id || candidate.source_provider);
  const sourceType = candidateSourceType(candidate);
  return provider === "CATALOG"
    || provider === "POSTGRES_HYBRID"
    || sourceType === "STRUCTURED_DATABASE"
    || sourceType === "INTERNAL_CORRECTED_TITLE";
}

function candidateHasPromptIdentityAnchor(candidate = {}) {
  if (!candidateIsCatalogLike(candidate)) return true;
  const candidateFields = sanitizedCandidateFields(candidate.fields || {});
  if (candidateFields.lot_type === "LOT" || Number(candidateFields.card_count || 0) > 1) return false;
  // Hard filter: when the row carries an anchor-agreement verdict computed
  // against an actual observation, only agreement-verified candidates may
  // enter the prompt. Similar cards with contradicted anchors stay shadow.
  const agreement = candidate.anchor_agreement;
  if (agreement && typeof agreement === "object" && agreement.prompt_hard_filter_applicable === true) {
    return agreement.prompt_hard_filter_pass === true;
  }
  const fields = candidateFieldSet(candidate);
  const hasAny = (names) => names.some((name) => fields.has(name));
  const hasSubject = hasAny(["subject", "subjects", "player", "players"]);
  const hasPrintedCode = hasAny(["collector_number", "checklist_code", "card_number"]);
  const hasProduct = hasAny(["product", "set", "product_or_set"]);
  const hasSerialDenominator = hasAny(["serial_denominator", "expected_serial_denominator"]);
  const hasObservableComponent = hasAny(["card_name", "insert", "release_variant"]);
  return hasPrintedCode
    || (hasSubject && hasProduct)
    || (hasSubject && hasObservableComponent)
    || (hasProduct && hasObservableComponent && hasSerialDenominator);
}

function isPromptAssistCandidate(candidate = {}) {
  return isAssistApprovedCandidate(candidate)
    && !candidateHasAnyPromptConflict(candidate)
    && candidateHasPromptIdentityAnchor(candidate);
}

function candidateHasHardConstraintAnchor(candidate = {}) {
  if (!candidate || typeof candidate !== "object") return false;
  return candidate.hard_constraint_eligible === true
    && isAssistApprovedCandidate(candidate)
    && !candidateHasAnyPromptConflict(candidate);
}

const promptUnsafeOpenSetDecisions = new Set([
  "NONE_OF_THE_ABOVE",
  "LOW_MARGIN_MATCH",
  "NO_EXACT_MATCH",
  "FAMILY_ONLY_MATCH"
]);

function candidateHasLowMarginComparisonAnchor(candidate = {}) {
  if (candidateHasHardConstraintAnchor(candidate)) return true;
  const agreement = candidate.anchor_agreement && typeof candidate.anchor_agreement === "object"
    ? candidate.anchor_agreement
    : {};
  if (agreement.exact_code_match === true) return true;
  const agreed = new Set(Array.isArray(agreement.agreed) ? agreement.agreed : []);
  if (!agreed.has("product_hierarchy")) return false;
  return agreed.has("subjects")
    || agreed.has("year")
    || agreed.has("serial_denominator")
    || agreed.has("collector_number")
    || agreed.has("checklist_code");
}

function promptCandidatesForOpenSetDecision(retrieval = {}, candidates = []) {
  if (cleanUpper(retrieval.open_set_decision) !== "LOW_MARGIN_MATCH") return candidates;
  // Low margin means "do not select or field-lock automatically", not
  // "hide every candidate from the model". Only candidates with a concrete
  // identity-comparison anchor are admitted for prompt-side comparison.
  return candidates.filter(candidateHasLowMarginComparisonAnchor);
}

function openSetPromptBlockReason(retrieval = {}, promptCandidates = []) {
  const decision = cleanUpper(retrieval.open_set_decision);
  if (!promptUnsafeOpenSetDecisions.has(decision)) return "";
  if (decision === "LOW_MARGIN_MATCH" && promptCandidates.length) return "";
  return `open_set_${decision.toLowerCase()}_not_prompt_safe`;
}

function candidateRole(candidate = {}) {
  const role = cleanText(candidate.embedding_role || candidate.image_role || "");
  if (role.includes("back")) return "back";
  if (role.includes("front")) return "front";
  return "unknown";
}

function expandYearParts(value) {
  const text = cleanCompare(value);
  const years = new Set();
  const fullYears = text.match(/\b(?:19|20)\d{2}\b/g) || [];
  fullYears.forEach((year) => years.add(Number(year)));
  for (const match of text.matchAll(/\b((?:19|20)\d{2})\s*[-/]\s*(\d{2})\b/g)) {
    const start = Number(match[1]);
    const endCentury = Math.floor(start / 100) * 100;
    let end = endCentury + Number(match[2]);
    if (end < start) end += 100;
    for (let year = start; year <= Math.min(end, start + 2); year += 1) years.add(year);
  }
  return [...years];
}

function yearsCompatible(left, right) {
  const leftYears = expandYearParts(left);
  const rightYears = expandYearParts(right);
  if (!leftYears.length || !rightYears.length) return cleanCompare(left) === cleanCompare(right);
  return leftYears.some((year) => rightYears.includes(year));
}

const productNoiseTokens = new Set([
  "card",
  "cards",
  "the",
  "edition"
]);

const productFamilyOnlyTokens = new Set([
  "bandai",
  "ball",
  "bowman",
  "dragon",
  "futera",
  "gi",
  "konami",
  "leaf",
  "mon",
  "oh",
  "onit",
  "panini",
  "parkside",
  "piece",
  "pok",
  "pokemon",
  "score",
  "skybox",
  "super",
  "topps",
  "upper",
  "wizards",
  "wotc",
  "yu"
]);

function productSignificantTokens(value) {
  return compareTokens(value)
    .filter((token) => !productNoiseTokens.has(token));
}

function productSpecificTokens(value) {
  return productSignificantTokens(value)
    .filter((token) => !productFamilyOnlyTokens.has(token));
}

function tokenSetCompatible(leftTokens, rightTokens, { allowNumericExtra = false } = {}) {
  if (!leftTokens.length || !rightTokens.length) return true;
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const leftOnly = [...left].filter((token) => !right.has(token));
  const rightOnly = [...right].filter((token) => !left.has(token));
  if (!leftOnly.length && !rightOnly.length) return true;
  // Numeric release years may be present on only one side (for example,
  // "2000 Bowman" vs "Bowman"). If both sides have unique tokens, they are
  // different product branches ("2000 Bowman" vs "Bowman Chrome"), even
  // when the query-only token happens to be numeric.
  if (leftOnly.length && rightOnly.length) return false;
  const extra = leftOnly.length ? leftOnly : rightOnly;
  return allowNumericExtra && extra.length > 0 && extra.every((token) => /^\d+$/.test(token));
}

function tokenSubsetCompatible(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) return false;
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const leftInRight = [...left].every((token) => right.has(token));
  const rightInLeft = [...right].every((token) => left.has(token));
  return leftInRight || rightInLeft;
}

function productCompatible(left, right) {
  const leftTokens = productSignificantTokens(left);
  const rightTokens = productSignificantTokens(right);
  if (!leftTokens.length || !rightTokens.length) return true;
  return tokenSetCompatible(leftTokens, rightTokens, { allowNumericExtra: true });
}

function productHierarchyCompatible(left, right) {
  const leftTokens = productSignificantTokens(left);
  const rightTokens = productSignificantTokens(right);
  if (productCompatible(left, right)) return true;
  const leftSpecific = productSpecificTokens(left);
  const rightSpecific = productSpecificTokens(right);
  if (leftSpecific.length || rightSpecific.length) {
    if (!leftSpecific.length || !rightSpecific.length) return false;
    return tokenSubsetCompatible(leftSpecific, rightSpecific);
  }
  return tokenSubsetCompatible(leftTokens, rightTokens);
}

function valueCompatible(left, right) {
  const leftValue = cleanCompare(left);
  const rightValue = cleanCompare(right);
  return !leftValue || !rightValue || leftValue === rightValue || leftValue.includes(rightValue) || rightValue.includes(leftValue);
}

function normalizedPrintedCode(value) {
  return cleanUpper(value).replace(/[^A-Z0-9]+/g, "");
}

function printedCodeCompatible(left, right) {
  const leftValue = normalizedPrintedCode(left);
  const rightValue = normalizedPrintedCode(right);
  return Boolean(leftValue && rightValue && leftValue === rightValue);
}

function printedCodeEntries(fields = {}) {
  return ["collector_number", "checklist_code"].flatMap((field) => (
    hasValue(fields[field]) ? [{ field, value: fields[field] }] : []
  ));
}

function printedCodeAgreement(queryFields = {}, candidateFields = {}) {
  const queryCodes = printedCodeEntries(queryFields);
  const candidateCodes = printedCodeEntries(candidateFields);
  if (!queryCodes.length || !candidateCodes.length) {
    return { compared: false, matched: false, matched_fields: [], contradicted_fields: [] };
  }

  const matchedFields = new Set();
  for (const queryCode of queryCodes) {
    for (const candidateCode of candidateCodes) {
      if (printedCodeCompatible(queryCode.value, candidateCode.value)) {
        matchedFields.add(queryCode.field);
        matchedFields.add(candidateCode.field);
      }
    }
  }

  if (matchedFields.size) {
    return {
      compared: true,
      matched: true,
      matched_fields: [...matchedFields],
      contradicted_fields: []
    };
  }

  return {
    compared: true,
    matched: false,
    matched_fields: [],
    contradicted_fields: [...new Set([...queryCodes, ...candidateCodes].map((entry) => entry.field))]
  };
}

function subjectCompatible(leftSubjects = [], rightSubjects = []) {
  const left = leftSubjects.map(cleanCompare).filter(Boolean);
  const right = rightSubjects.map(cleanCompare).filter(Boolean);
  if (!left.length || !right.length) return true;
  return left.some((leftName) => right.some((rightName) => (
    leftName === rightName
    || leftName.includes(rightName)
    || rightName.includes(leftName)
    || tokenSetCompatible(compareTokens(leftName), compareTokens(rightName), { allowNumericExtra: false })
  )));
}

function addQueryConflict(conflicts, field) {
  if (!conflicts.includes(field)) conflicts.push(field);
}

function queryCandidateConflictFields(queryFields = {}, candidateFields = {}) {
  const conflicts = [];
  if (queryFields.year && candidateFields.year && !yearsCompatible(queryFields.year, candidateFields.year)) {
    addQueryConflict(conflicts, "year");
  }

  const queryBrand = queryFields.manufacturer || queryFields.brand;
  const candidateBrand = candidateFields.manufacturer || candidateFields.brand;
  if (queryBrand && candidateBrand && !valueCompatible(queryBrand, candidateBrand)) {
    addQueryConflict(conflicts, "manufacturer");
  }

  if (queryFields.product && candidateFields.product && !productCompatible(queryFields.product, candidateFields.product)) {
    addQueryConflict(conflicts, "product");
  }

  if (queryFields.set && candidateFields.set && !productCompatible(queryFields.set, candidateFields.set)) {
    addQueryConflict(conflicts, "set");
  }

  if (!subjectCompatible(queryFields.subjects || [], candidateFields.subjects || [])) {
    addQueryConflict(conflicts, "players");
  }

  const codeAgreement = printedCodeAgreement(queryFields, candidateFields);
  if (codeAgreement.compared && !codeAgreement.matched) {
    codeAgreement.contradicted_fields.forEach((field) => addQueryConflict(conflicts, field));
  }

  if (queryFields.expected_serial_denominator && candidateFields.expected_serial_denominator
    && cleanCompare(queryFields.expected_serial_denominator) !== cleanCompare(candidateFields.expected_serial_denominator)) {
    addQueryConflict(conflicts, "serial_number");
  }

  if (queryFields.surface_color && candidateFields.surface_color && !valueCompatible(queryFields.surface_color, candidateFields.surface_color)) {
    addQueryConflict(conflicts, "surface_color");
  }

  if (queryFields.language && candidateFields.language && !valueCompatible(queryFields.language, candidateFields.language)) {
    addQueryConflict(conflicts, "language");
  }

  if (queryFields.rarity && candidateFields.rarity && !valueCompatible(queryFields.rarity, candidateFields.rarity)) {
    addQueryConflict(conflicts, "rarity");
  }

  if (queryFields.lot_type && candidateFields.lot_type && !valueCompatible(queryFields.lot_type, candidateFields.lot_type)) {
    addQueryConflict(conflicts, "lot_type");
  }

  return conflicts;
}

function groupCandidates(candidates = []) {
  const groups = new Map();
  candidates.forEach((candidate, index) => {
    const fields = sanitizedCandidateFields(candidate.fields || {});
    if (!Object.keys(fields).length) return;
    const key = candidateIdentityKey(candidate);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        candidate,
        candidates: [],
        fields,
        referenceIds: new Set(),
        embeddingIds: new Set(),
        conflictingFields: new Set(),
        similarities: [],
        ranks: []
      });
    }
    const group = groups.get(key);
    group.candidates.push(candidate);
    group.referenceIds.add(cleanText(candidate.reference_image_id || candidate.source_url || candidate.candidate_id));
    group.embeddingIds.add(cleanText(candidate.embedding_id || candidate.candidate_id));
    candidateConflictFields(candidate).forEach((field) => group.conflictingFields.add(field));
    group.similarities.push(finiteNumber(candidate.visual_similarity ?? candidate.match_score, 0) || 0);
    group.ranks.push(index + 1);
    const role = candidateRole(candidate);
    const similarity = finiteNumber(candidate.visual_similarity ?? candidate.match_score, null);
    if (role === "front") {
      group.front_similarity = Math.max(finiteNumber(group.front_similarity, 0) || 0, similarity || 0);
      group.front_rank = Math.min(finiteNumber(group.front_rank, Number.POSITIVE_INFINITY), index + 1);
    } else if (role === "back") {
      group.back_similarity = Math.max(finiteNumber(group.back_similarity, 0) || 0, similarity || 0);
      group.back_rank = Math.min(finiteNumber(group.back_rank, Number.POSITIVE_INFINITY), index + 1);
    }
    group.fields = {
      ...fields,
      ...group.fields
    };
  });

  return [...groups.values()];
}

function combinedScore(group = {}) {
  const bestSimilarity = Math.max(...group.similarities, 0);
  const avgSimilarity = group.similarities.length
    ? group.similarities.reduce((sum, value) => sum + value, 0) / group.similarities.length
    : 0;
  const multiViewBoost = group.front_similarity && group.back_similarity ? 0.035 : 0;
  const referenceBoost = Math.min(0.04, Math.max(0, (group.referenceIds.size - 1) * 0.015));
  return Math.min(1, bestSimilarity * 0.72 + avgSimilarity * 0.24 + multiViewBoost + referenceBoost);
}

function top1Top2Margin(scores = [], index = 0) {
  const current = scores[index] || 0;
  const next = index === 0 ? scores[1] || 0 : scores[0] || 0;
  return Math.max(0, current - next);
}

function unavailableStatus(retrieval = {}) {
  const reasons = Array.isArray(retrieval.unavailable) ? retrieval.unavailable : [];
  const text = reasons.map((item) => item.reason || "").join(" ");
  if (/timeout/i.test(text)) return vectorStatus.TIMEOUT;
  if (reasons.length) return vectorStatus.UNAVAILABLE;
  return vectorStatus.UNAVAILABLE;
}

function hybridCandidates(retrieval = {}) {
  if (!retrieval.hybrid_ranker) return [];
  return Array.isArray(retrieval.sources) ? retrieval.sources : [];
}

function channelSupport(candidate = {}) {
  const support = candidate.channel_support && typeof candidate.channel_support === "object"
    ? candidate.channel_support
    : {};
  return Object.fromEntries(
    Object.entries(support).map(([channelId, row]) => [channelId, {
      provider: row.provider || channelId,
      rank: finiteNumber(row.rank, null),
      raw_score: finiteNumber(row.raw_score, null),
      normalized_score: roundScore(row.normalized_score),
      supporting_fields: Array.isArray(row.supporting_fields) ? row.supporting_fields : []
    }])
  );
}

function candidateSupportSet(candidate = {}) {
  return new Set([
    ...(Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : []),
    ...(Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [])
  ].map((field) => cleanText(field).toLowerCase()).filter(Boolean));
}

function collectCandidateFieldNames(candidates = [], key = "") {
  return [...new Set(candidates.flatMap((candidate) => (
    Array.isArray(candidate[key]) ? candidate[key] : []
  )).map((field) => cleanText(field)).filter(Boolean))];
}

function candidateOriginalSerial(candidate = {}) {
  const expanded = expandPrintRunFields(candidate.fields || {});
  return cleanText(expanded.print_run_denominator ? `#/${expanded.print_run_denominator}` : candidate.serial_number || candidate.reference_metadata?.serial_number);
}

function serialConflictIsOnlyReferenceDenominator(candidate = {}, queryFields = {}, candidateFields = {}) {
  const queryDenominator = cleanText(queryFields.expected_serial_denominator || serialDenominator(queryFields.serial_number));
  const candidateDenominator = cleanText(candidateFields.expected_serial_denominator || serialDenominator(candidateOriginalSerial(candidate)));
  if (!queryDenominator || !candidateDenominator || queryDenominator !== candidateDenominator) return false;
  return true;
}

function productConflictIsOnlyHierarchySplit(queryFields = {}, candidateFields = {}) {
  const queryHierarchy = [
    queryFields.manufacturer || queryFields.brand,
    queryFields.product,
    queryFields.set,
    queryFields.insert
  ].filter(Boolean).join(" ");
  const candidateHierarchy = [
    candidateFields.manufacturer || candidateFields.brand,
    candidateFields.product,
    candidateFields.set,
    candidateFields.insert
  ].filter(Boolean).join(" ");
  if (!queryHierarchy || !candidateHierarchy) return false;
  return productHierarchyCompatible(queryHierarchy, candidateHierarchy);
}

function candidateHasExactAnchor(candidate = {}, queryFields = {}, candidateFields = {}) {
  const denominator = cleanText(queryFields.expected_serial_denominator || serialDenominator(queryFields.serial_number));
  const candidateDenominator = cleanText(candidateFields.expected_serial_denominator || serialDenominator(candidateOriginalSerial(candidate)));
  return printedCodeAgreement(queryFields, candidateFields).matched === true
    || Boolean(denominator && candidateDenominator && denominator === candidateDenominator);
}

function candidateHasIdentityAnchor(candidate = {}, queryFields = {}, candidateFields = {}) {
  const support = candidateSupportSet(candidate);
  const subjectSupport = support.has("subjects")
    || support.has("players")
    || support.has("subject")
    || subjectCompatible(queryFields.subjects || [], candidateFields.subjects || []);
  const queryProductHierarchy = [
    queryFields.manufacturer || queryFields.brand,
    queryFields.product,
    queryFields.set,
    queryFields.insert
  ].filter(Boolean).join(" ");
  const candidateProductHierarchy = [
    candidateFields.manufacturer || candidateFields.brand,
    candidateFields.product,
    candidateFields.set,
    candidateFields.insert
  ].filter(Boolean).join(" ");
  const hierarchySupport = Boolean(queryProductHierarchy && candidateProductHierarchy)
    && productHierarchyCompatible(queryProductHierarchy, candidateProductHierarchy);
  const productSupport = support.has("product")
    || support.has("product_partial")
    || support.has("set")
    || hierarchySupport;
  return subjectSupport && productSupport;
}

function yearConflictIsSoftCatalogAnchor(candidate = {}, queryFields = {}, candidateFields = {}) {
  if (!queryFields.year || !candidateFields.year) return false;
  return sourceTrust(candidate) === "APPROVED_REFERENCE"
    && printedCodeAgreement(queryFields, candidateFields).matched === true
    && candidateHasIdentityAnchor(candidate, queryFields, candidateFields);
}

function conflictSoftenedByIdentityGranularity(field, candidate = {}, queryFields = {}, candidateFields = {}) {
  const normalizedField = cleanText(field);
  if (normalizedField === "year") {
    return yearConflictIsSoftCatalogAnchor(candidate, queryFields, candidateFields);
  }
  if (normalizedField === "manufacturer" || normalizedField === "brand") {
    // Brand naming is fuzzy across sources (Bowman vs Topps Bowman). A brand
    // conflict softens only when the candidate passes the anchor-agreement
    // hard filter against the current observation - naming noise on top of a
    // verified identity, never a similar card.
    if (sourceTrust(candidate) !== "APPROVED_REFERENCE") return false;
    const agreement = candidateAnchorAgreement(candidate, queryFields, candidateFields);
    return agreement.prompt_hard_filter_pass === true;
  }
  if (normalizedField === "serial_number") {
    return serialConflictIsOnlyReferenceDenominator(candidate, queryFields, candidateFields);
  }
  // collector_number / checklist_code / card_number conflicts are NEVER
  // soft: an exact printed code mismatch is proof of a different card.
  if (normalizedField === "surface_color"
    || normalizedField === "parallel"
    || normalizedField === "parallel_exact"
    || normalizedField === "parallel_family") {
    // A different color/parallel is a different card in the same rainbow.
    // Only naming-style differences behind an exact code agreement soften.
    return sourceTrust(candidate) === "APPROVED_REFERENCE"
      && candidateHasExactAnchor(candidate, queryFields, candidateFields);
  }
  if (normalizedField === "product" || normalizedField === "set") {
    return productConflictIsOnlyHierarchySplit(queryFields, candidateFields);
  }
  return false;
}

function conflictIsIdentityEquivalent(field, candidate = {}, queryFields = {}, candidateFields = {}) {
  const normalizedField = cleanText(field);
  if (normalizedField === "product" || normalizedField === "set") {
    return sourceTrust(candidate) === "APPROVED_REFERENCE"
      && productConflictIsOnlyHierarchySplit(queryFields, candidateFields)
      && candidateHasExactAnchor(candidate, queryFields, candidateFields)
      && candidateHasIdentityAnchor(candidate, queryFields, candidateFields);
  }
  return false;
}

// Anchor agreement between the current observation (query fields) and a
// candidate: agreement is counted only when BOTH sides carry the value.
// Prompt admission for catalog-like candidates requires zero contradicted
// anchors and either an exact printed-code agreement or at least two agreed
// anchors — "similar card" candidates stay shadow-only.
function candidateAnchorAgreement(candidate = {}, queryFields = {}, candidateFields = {}) {
  const agreed = new Set();
  const contradicted = new Set();

  if (hasValue(queryFields.year) && hasValue(candidateFields.year)) {
    (seasonStrictYearsCompatible(queryFields.year, candidateFields.year) ? agreed : contradicted).add("year");
  }

  const querySubjects = Array.isArray(queryFields.subjects) ? queryFields.subjects : [];
  const candidateSubjects = Array.isArray(candidateFields.subjects) ? candidateFields.subjects : [];
  if (querySubjects.length && candidateSubjects.length) {
    (subjectCompatible(querySubjects, candidateSubjects) ? agreed : contradicted).add("subjects");
  }

  const queryManufacturer = queryFields.manufacturer || queryFields.brand;
  const candidateManufacturer = candidateFields.manufacturer || candidateFields.brand;
  if (hasValue(queryManufacturer) && hasValue(candidateManufacturer)) {
    if (valueCompatible(queryManufacturer, candidateManufacturer)) agreed.add("manufacturer");
  }

  const queryProductHierarchy = [
    queryFields.product,
    queryFields.set
  ].filter(Boolean).join(" ");
  const candidateProductHierarchy = [
    candidateFields.product,
    candidateFields.set
  ].filter(Boolean).join(" ");
  if (queryProductHierarchy && candidateProductHierarchy) {
    (productHierarchyCompatible(queryProductHierarchy, candidateProductHierarchy) ? agreed : contradicted).add("product_hierarchy");
  }

  const codeAgreement = printedCodeAgreement(queryFields, candidateFields);
  let exactCodeMatch = codeAgreement.matched === true;
  if (codeAgreement.compared) {
    if (codeAgreement.matched) {
      codeAgreement.matched_fields.forEach((field) => agreed.add(field));
    } else {
      codeAgreement.contradicted_fields.forEach((field) => contradicted.add(field));
    }
  }

  const queryDenominator = cleanText(queryFields.expected_serial_denominator || serialDenominator(queryFields.serial_number));
  const candidateDenominator = cleanText(candidateFields.expected_serial_denominator || serialDenominator(candidateOriginalSerial(candidate)));
  if (queryDenominator && candidateDenominator) {
    (queryDenominator === candidateDenominator ? agreed : contradicted).add("serial_denominator");
  }

  // A reviewed/official identity can correct a vision-only year when the
  // current image supplies the stronger natural key: exact printed code plus
  // compatible subject and product. A matching denominator is deliberately
  // insufficient because many unrelated cards share the same print run.
  const authoritativeYearOverride = contradicted.has("year")
    && sourceTrust(candidate) === "APPROVED_REFERENCE"
    && codeAgreement.matched === true
    && candidateHasIdentityAnchor(candidate, queryFields, candidateFields);
  if (authoritativeYearOverride) contradicted.delete("year");

  const queryAnchorDimensions = [
    hasValue(queryFields.year),
    hasValue(queryManufacturer),
    querySubjects.length > 0,
    Boolean(queryProductHierarchy),
    hasValue(queryFields.collector_number) || hasValue(queryFields.checklist_code),
    Boolean(queryDenominator)
  ].filter(Boolean).length;
  const promptAgreedCount = [...agreed].filter((field) => field !== "manufacturer").length;

  return {
    agreed: [...agreed],
    contradicted: [...contradicted],
    exact_code_match: exactCodeMatch,
    authoritative_overrides: authoritativeYearOverride ? ["year"] : [],
    observed_conflicts: authoritativeYearOverride ? ["year"] : [],
    query_anchor_dimensions: queryAnchorDimensions,
    // With no observed anchors there is nothing to verify against (packets
    // built before provider observation); the legacy existence check applies.
    prompt_hard_filter_applicable: queryAnchorDimensions > 0,
    prompt_hard_filter_pass: queryAnchorDimensions > 0
      && contradicted.size === 0
      && (exactCodeMatch || promptAgreedCount >= 2)
  };
}

// Upstream conflict annotations were computed against an earlier or
// different-lane query state. When the CURRENT observation and the candidate
// both carry the field and the live recompute finds them compatible, the
// stale annotation is dropped in favor of the recompute (eBay C10: same-
// identity candidates stayed blocked by annotated "year" conflicts even
// though 2018 vs 2018-19 is season-compatible).
// Both sides in full season format (YYYY-YY) must share the same starting
// year: 2024-25 and 2025-26 are different annual products even though the
// expanded year sets overlap on 2025. Single-year vs season keeps the
// overlap semantics (2018 matches 2018-19).
function seasonStrictYearsCompatible(left, right) {
  const seasonPattern = /(?:19|20)\d{2}\s*[-/]\s*\d{2}/;
  const leftText = String(left || "");
  const rightText = String(right || "");
  if (seasonPattern.test(leftText) && seasonPattern.test(rightText)) {
    const leftStart = leftText.match(/(?:19|20)\d{2}/)?.[0];
    const rightStart = rightText.match(/(?:19|20)\d{2}/)?.[0];
    return Boolean(leftStart && rightStart && leftStart === rightStart);
  }
  return yearsCompatible(left, right);
}

function staleUpstreamConflict(field, queryFields = {}, candidateFields = {}) {
  const normalizedField = cleanText(field);
  switch (normalizedField) {
    case "year":
      return hasValue(queryFields.year) && hasValue(candidateFields.year)
        && seasonStrictYearsCompatible(queryFields.year, candidateFields.year);
    case "players":
    case "subjects":
      return (Array.isArray(queryFields.subjects) ? queryFields.subjects : []).length > 0
        && (Array.isArray(candidateFields.subjects) ? candidateFields.subjects : []).length > 0
        && subjectCompatible(queryFields.subjects, candidateFields.subjects);
    case "manufacturer":
    case "brand": {
      const queryBrand = queryFields.manufacturer || queryFields.brand;
      const candidateBrand = candidateFields.manufacturer || candidateFields.brand;
      return hasValue(queryBrand) && hasValue(candidateBrand) && valueCompatible(queryBrand, candidateBrand);
    }
    case "product":
    case "set":
      return hasValue(queryFields[normalizedField]) && hasValue(candidateFields[normalizedField])
        && productCompatible(queryFields[normalizedField], candidateFields[normalizedField]);
    case "collector_number":
    case "checklist_code":
      return hasValue(queryFields[normalizedField]) && hasValue(candidateFields[normalizedField])
        && valueCompatible(queryFields[normalizedField], candidateFields[normalizedField]);
    case "surface_color":
      return hasValue(queryFields.surface_color) && hasValue(candidateFields.surface_color)
        && valueCompatible(queryFields.surface_color, candidateFields.surface_color);
    default:
      return false;
  }
}

function mergedConflictFieldsForPrompt(candidate = {}, queryFields = {}, candidateFields = {}) {
  return [
    ...candidateConflictFields(candidate).filter((field) => !staleUpstreamConflict(field, queryFields, candidateFields)),
    ...queryCandidateConflictFields(queryFields, candidateFields)
  ];
}

function candidateConflictsForPrompt(candidate = {}, queryFields = {}, candidateFields = {}) {
  return mergedConflictFieldsForPrompt(candidate, queryFields, candidateFields)
    .filter((field) => !conflictIsIdentityEquivalent(field, candidate, queryFields, candidateFields))
    .filter((field) => !conflictSoftenedByIdentityGranularity(field, candidate, queryFields, candidateFields));
}

function candidateSoftConflictsForPrompt(candidate = {}, queryFields = {}, candidateFields = {}) {
  return [...new Set(mergedConflictFieldsForPrompt(candidate, queryFields, candidateFields)
    .filter((field) => !conflictIsIdentityEquivalent(field, candidate, queryFields, candidateFields))
    .filter((field) => conflictSoftenedByIdentityGranularity(field, candidate, queryFields, candidateFields)))];
}

export function rebindCandidateToObservedFields(candidate = {}, observedFields = {}) {
  const queryFields = sanitizedCandidateFields(observedFields || {});
  const fields = sanitizedCandidateFields(candidate.fields || {});
  const anchorAgreement = candidateAnchorAgreement(candidate, queryFields, fields);
  if (anchorAgreement.prompt_hard_filter_applicable !== true) {
    return {
      ...candidate,
      observation_rebound: false
    };
  }
  return {
    ...candidate,
    anchor_agreement: anchorAgreement,
    conflicting_fields: [...new Set(candidateConflictsForPrompt(candidate, queryFields, fields))],
    soft_conflicting_fields: candidateSoftConflictsForPrompt(candidate, queryFields, fields),
    observation_rebound: true
  };
}

const fieldSupportFields = Object.freeze([
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "language",
  "rarity",
  "insert",
  "card_name",
  "card_type",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "collector_number",
  "checklist_code",
  "expected_serial_denominator"
]);

function fieldSupportAliases(field) {
  switch (field) {
    case "manufacturer":
    case "brand":
      return ["manufacturer", "brand"];
    case "expected_serial_denominator":
      return ["expected_serial_denominator", "serial_denominator", "serial_number"];
    case "collector_number":
      return ["collector_number", "card_number"];
    case "parallel_exact":
      return ["parallel_exact", "parallel"];
    case "card_name":
      return ["card_name", "segment", "named_segment"];
    default:
      return [field];
  }
}

function fieldSupportValue(fields = {}, field = "") {
  for (const alias of fieldSupportAliases(field)) {
    if (hasValue(fields[alias])) return fields[alias];
  }
  if (field === "expected_serial_denominator") {
    return serialDenominator(fields.serial_number);
  }
  return null;
}

function queryFieldValue(fields = {}, field = "") {
  for (const alias of fieldSupportAliases(field)) {
    if (hasValue(fields[alias])) return fields[alias];
  }
  return null;
}

function supportSetHasField(support = new Set(), field = "") {
  return fieldSupportAliases(field).some((alias) => support.has(alias));
}

function candidateFieldCanSupport(candidate = {}, field = "", queryFields = {}, candidateFields = {}) {
  const support = candidateSupportSet(candidate);
  if (supportSetHasField(support, field)) return true;
  return candidateFieldMatchesQuery(field, queryFields, candidateFields);
}

function candidateFieldMatchesQuery(field = "", queryFields = {}, candidateFields = {}) {
  const queryValue = queryFieldValue(queryFields, field);
  const candidateValue = fieldSupportValue(candidateFields, field);
  if (!hasValue(queryValue) || !hasValue(candidateValue)) return false;
  if (field === "year") return yearsCompatible(queryValue, candidateValue);
  if (field === "product") {
    return productHierarchyCompatible(queryValue, candidateValue);
  }
  if (field === "set" || field === "subset" || field === "insert") {
    return productHierarchyCompatible(queryValue, candidateValue);
  }
  if (field === "expected_serial_denominator") {
    return cleanCompare(queryValue) === cleanCompare(candidateValue);
  }
  if (field === "collector_number" || field === "checklist_code") {
    return printedCodeCompatible(queryValue, candidateValue);
  }
  return valueCompatible(queryValue, candidateValue);
}

function fieldSupportConflictBlocked(field = "", hardConflicts = new Set()) {
  if (hardConflicts.has(field)) return true;
  if (field === "expected_serial_denominator" && hardConflicts.has("serial_number")) return true;
  if ((field === "collector_number" || field === "checklist_code") && hardConflicts.has("card_number")) return true;
  if ((field === "product" || field === "set" || field === "subset") && (hardConflicts.has("product") || hardConflicts.has("set"))) return true;
  if ((field === "manufacturer" || field === "brand") && hardConflicts.has("manufacturer")) return true;
  if ((field === "parallel_exact" || field === "parallel_family" || field === "surface_color") && (hardConflicts.has("parallel") || hardConflicts.has("parallel_exact") || hardConflicts.has("surface_color"))) return true;
  return false;
}

function safeFieldSupportValue(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return cleanText(value);
}

function fieldSupportOpenSetBlocked(retrieval = {}) {
  const decision = cleanUpper(retrieval.open_set_decision);
  return decision === "NONE_OF_THE_ABOVE";
}

function isFieldSupportAssistCandidate(candidate = {}, queryFields = {}) {
  if (!isFieldSupportTrustedCatalogCandidate(candidate)) return false;
  if (candidateLooksMarketplaceWeak(candidate)) return false;
  if (!isCatalogLikeCandidate(candidate) && !isApprovedVisualVectorCandidate(candidate)) return false;
  const fields = sanitizedCandidateFields(candidate.fields || {});
  const agreement = candidate.anchor_agreement && typeof candidate.anchor_agreement === "object"
    ? candidate.anchor_agreement
    : candidateAnchorAgreement(candidate, queryFields, fields);
  if (agreement.prompt_hard_filter_applicable !== true) return false;
  const agreedCount = Array.isArray(agreement.agreed) ? agreement.agreed.length : 0;
  return agreement.exact_code_match === true || agreedCount >= 1;
}

function isFieldSupportTrustedCatalogCandidate(candidate = {}) {
  if (candidateLooksMarketplaceWeak(candidate)) return false;
  const sourceTypes = candidateSourceTypeSet(candidate);
  if ([...sourceTypes].some((entry) => neverApprovedPromptSources.has(entry))) return false;
  if (sourceTrust(candidate) === "APPROVED_REFERENCE") return true;
  return [...sourceTypes].some((entry) => fieldSupportTrustedCatalogSourceTypes.has(entry));
}

function isApprovedVisualVectorCandidate(candidate = {}) {
  const sourceTypes = candidateSourceTypeSet(candidate);
  const provider = cleanText(candidate.provider_id || candidate.retrieval_provider_id || candidate.source_provider).toLowerCase();
  return sourceTrust(candidate) === "APPROVED_REFERENCE"
    && (sourceTypes.has("VISUAL_VECTOR") || provider === "visual_vector");
}

function fieldSupportAnchorBlocked(field = "", anchorContradictions = new Set()) {
  if (anchorContradictions.has(field)) return true;
  if (field === "year" && anchorContradictions.has("year")) return true;
  if ((field === "manufacturer" || field === "brand") && anchorContradictions.has("manufacturer")) return true;
  if ((field === "product" || field === "set" || field === "subset" || field === "insert") && anchorContradictions.has("product_hierarchy")) return true;
  if ((field === "collector_number" || field === "checklist_code") && (anchorContradictions.has("collector_number") || anchorContradictions.has("checklist_code"))) return true;
  if (field === "expected_serial_denominator" && anchorContradictions.has("serial_denominator")) return true;
  return false;
}

function buildFieldSupportRows(candidates = [], queryFields = {}, { limit = 24 } = {}) {
  const rows = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!isFieldSupportAssistCandidate(candidate, queryFields)) continue;
    const fields = sanitizedCandidateFields(candidate.fields || {});
    const hardConflicts = new Set(candidateConflictsForPrompt(candidate, queryFields, fields));
    const softConflicts = candidateSoftConflictsForPrompt(candidate, queryFields, fields);
    const anchorContradictions = new Set(candidateAnchorContradictions(candidate));
    const candidateHasConflicts = hardConflicts.size || softConflicts.length || anchorContradictions.size;
    for (const field of fieldSupportFields) {
      if (fieldSupportConflictBlocked(field, hardConflicts)) continue;
      if (fieldSupportAnchorBlocked(field, anchorContradictions)) continue;
      const queryCompatible = candidateFieldMatchesQuery(field, queryFields, fields);
      if (candidateHasConflicts && !queryCompatible) continue;
      if (!candidateHasConflicts && !candidateFieldCanSupport(candidate, field, queryFields, fields)) continue;
      const value = fieldSupportValue(fields, field);
      if (!hasValue(value)) continue;
      const key = `${field}:${JSON.stringify(value).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        field,
        value: safeFieldSupportValue(value),
        source_trust: sourceTrust(candidate) === "APPROVED_REFERENCE" ? "APPROVED_REFERENCE" : "CATALOG_FIELD_SUPPORT",
        support_type: "catalog_vocabulary",
        usage_policy: "use_only_when_current_image_supports_this_field",
        candidate_id: candidate.candidate_id || null,
        candidate_identity_id: candidate.candidate_identity_id || candidate.identity_id || null,
        provider_id: candidate.provider_id || candidate.retrieval_provider_id || candidate.source_provider || null,
        source_type: candidateOriginalSourceType(candidate) || candidate.source_type || candidate.reference_metadata?.source_type || null,
        supporting_fields: Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : [],
        matched_fields: Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [],
        soft_conflicting_fields: softConflicts
      });
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}

function isCatalogLikeCandidate(candidate = {}) {
  const sourceType = cleanUpper(candidate.source_type || candidate.reference_metadata?.source_type);
  if (catalogSourceTypes.has(sourceType)) return true;
  const providerId = cleanText(candidate.provider_id || candidate.retrieval_provider_id || candidate.source_provider).toLowerCase();
  return catalogProviderIds.has(providerId);
}

function exactFieldMatch(queryFields = {}, candidateFields = {}, field = "") {
  if (field === "collector_number" || field === "checklist_code") {
    return printedCodeCompatible(queryFields[field], candidateFields[field]);
  }
  return queryFields[field] && candidateFields[field] && valueCompatible(queryFields[field], candidateFields[field]);
}

function catalogPromptScore(candidate = {}, queryFields = {}) {
  const fields = sanitizedCandidateFields(candidate.fields || {});
  const support = candidateSupportSet(candidate);
  const conflicts = candidateConflictsForPrompt(candidate, queryFields, fields);
  const softConflicts = candidateSoftConflictsForPrompt(candidate, queryFields, fields);
  const agreement = candidateAnchorAgreement(candidate, queryFields, fields);
  let score = finiteNumber(candidate.match_score ?? candidate.normalized_score ?? candidate.raw_score, 0) || 0;
  score += Math.min(0.3, agreement.agreed.length * 0.1);
  score -= agreement.contradicted.length * 0.35;
  score -= softConflicts.length * 0.08;
  score += Math.min(0.12, support.size * 0.02);
  if (support.has("collector_number") || exactFieldMatch(queryFields, fields, "collector_number")) score += 0.12;
  if (support.has("checklist_code") || exactFieldMatch(queryFields, fields, "checklist_code")) score += 0.12;
  if (subjectCompatible(queryFields.subjects || [], fields.subjects || [])) score += 0.08;
  if (productHierarchyCompatible(queryFields.product || queryFields.set, fields.product || fields.set)) score += 0.06;
  if (exactFieldMatch(queryFields, fields, "language")) score += 0.16;
  if (queryFields.language && fields.language && !valueCompatible(queryFields.language, fields.language)) score -= 0.45;
  if (exactFieldMatch(queryFields, fields, "rarity")) score += 0.08;
  if (queryFields.rarity && fields.rarity && !valueCompatible(queryFields.rarity, fields.rarity)) score -= 0.18;
  if (!queryFields.lot_type && fields.lot_type === "LOT") score -= 0.16;
  if (queryFields.lot_type && fields.lot_type && !valueCompatible(queryFields.lot_type, fields.lot_type)) score -= 0.24;
  score -= conflicts.length * 0.5;
  return score;
}

function candidateScore(candidate = {}, ...keys) {
  for (const key of keys) {
    const value = finiteNumber(candidate[key], null);
    if (value !== null) return value;
  }
  return null;
}

function buildCatalogCandidateRows(retrieval = {}, { limit = 5, queryFields = {} } = {}) {
  const sources = Array.isArray(retrieval.sources) ? retrieval.sources : [];
  return sources.filter(isCatalogLikeCandidate)
    .map((candidate, originalIndex) => ({
      candidate,
      originalIndex,
      prompt_score: catalogPromptScore(candidate, queryFields)
    }))
    .sort((left, right) => right.prompt_score - left.prompt_score || left.originalIndex - right.originalIndex)
    .slice(0, Math.max(1, Number(limit) || 5))
    .map(({ candidate }, index) => {
      const fields = sanitizedCandidateFields(candidate.fields || {});
      const conflicts = candidateConflictsForPrompt(candidate, queryFields, fields);
      const softConflicts = candidateSoftConflictsForPrompt(candidate, queryFields, fields);
      const anchorAgreement = candidateAnchorAgreement(candidate, queryFields, fields);
      const printRunCopyViolation = referencePrintRunCopyViolation(candidate);
      return {
        rank: index + 1,
        anchor_agreement: anchorAgreement,
        candidate_id: candidate.candidate_id || `catalog_candidate_${index + 1}`,
        candidate_identity_id: candidate.candidate_identity_id || candidate.identity_id || null,
        provider_id: candidate.provider_id || candidate.retrieval_provider_id || candidate.source_provider || null,
        source_type: candidate.source_type || candidate.reference_metadata?.source_type || null,
        source_url: candidate.source_url || null,
        raw_score: candidateScore(candidate, "raw_score"),
        normalized_score: roundScore(candidateScore(candidate, "normalized_score", "match_score")),
        match_score: roundScore(candidateScore(candidate, "match_score", "normalized_score")),
        source_trust: sourceTrust(candidate),
        reference_count: finiteNumber(candidate.reference_count, 1),
        hard_constraint_eligible: candidate.hard_constraint_eligible === true,
        reference_title: sanitizedReferenceTitle(candidate),
        supporting_fields: Array.isArray(candidate.supporting_fields)
          ? candidate.supporting_fields
          : Array.isArray(candidate.matched_fields)
            ? candidate.matched_fields
            : [],
        matched_fields: Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [],
        conflicting_fields: [...new Set(conflicts)],
        soft_conflicting_fields: softConflicts,
        reference_print_run_numerator_copy_violation_count: printRunCopyViolation ? 1 : 0,
        catalog_full_print_run_copy_violation_count: printRunCopyViolation ? 1 : 0,
        channel_support: channelSupport(candidate),
        reference_metadata: candidate.reference_metadata && typeof candidate.reference_metadata === "object"
          ? candidate.reference_metadata
          : {},
        field_derivation: candidate.field_derivation && typeof candidate.field_derivation === "object"
          ? candidate.field_derivation
          : null,
        fields
      };
    });
}

function buildHybridCandidateRows(retrieval = {}, { limit = 5, queryFields = {} } = {}) {
  const sources = hybridCandidates(retrieval);
  return sources.slice(0, Math.max(1, Number(limit) || 5)).map((candidate, index) => {
    const fields = sanitizedCandidateFields(candidate.fields || {});
    const conflicts = candidateConflictsForPrompt(candidate, queryFields, fields);
    const softConflicts = candidateSoftConflictsForPrompt(candidate, queryFields, fields);
    const anchorAgreement = candidateAnchorAgreement(candidate, queryFields, fields);
    const printRunCopyViolation = referencePrintRunCopyViolation(candidate);
    return {
    rank: index + 1,
    anchor_agreement: anchorAgreement,
    candidate_id: candidate.candidate_id || `hybrid_candidate_${index + 1}`,
    candidate_identity_id: candidate.candidate_identity_id || null,
    rerank_score: roundScore(candidate.rerank_score ?? candidate.match_score),
    rank_fusion_score: roundScore(candidate.rank_fusion_score),
    top1_top2_margin: index === 0 ? roundScore(retrieval.candidate_margin) : null,
    reference_count: finiteNumber(candidate.reference_count, 1),
    source_trust: sourceTrust(candidate),
    front_similarity: roundScore(candidate.front_similarity),
    back_similarity: roundScore(candidate.back_similarity),
    front_back_identity_agreement: Boolean(candidate.front_back_identity_agreement),
    supporting_fields: Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : [],
    conflicting_fields: [...new Set(conflicts)],
    soft_conflicting_fields: softConflicts,
    reference_print_run_numerator_copy_violation_count: printRunCopyViolation ? 1 : 0,
    catalog_full_print_run_copy_violation_count: printRunCopyViolation ? 1 : 0,
    hard_constraint_eligible: candidate.hard_constraint_eligible === true,
    reference_title: sanitizedReferenceTitle(candidate),
    channel_support: channelSupport(candidate),
    fields
  };
  });
}

export function buildVectorCandidatePacket(retrieval = {}, {
  limit = 5,
  queryFields = {}
} = {}) {
  const queryCandidateFields = sanitizedCandidateFields(queryFields || {});
  const hybridRows = buildHybridCandidateRows(retrieval, { limit, queryFields: queryCandidateFields });
  const catalogRows = hybridRows.length ? [] : buildCatalogCandidateRows(retrieval, { limit, queryFields: queryCandidateFields });
  const sources = Array.isArray(retrieval.sources) ? retrieval.sources : [];
  const catalogLikeSources = sources.filter(isCatalogLikeCandidate);
  const vectorSources = sources.filter((candidate) => cleanText(candidate.source_type).toUpperCase() === "VISUAL_VECTOR");
  const status = hybridRows.length || catalogRows.length || vectorSources.length
    ? vectorStatus.COMPLETED
    : Array.isArray(retrieval.unavailable) && retrieval.unavailable.length
      ? unavailableStatus(retrieval)
      : vectorStatus.NO_CONFIDENT_MATCH;
  const groups = groupCandidates(vectorSources)
    .map((group) => ({
      ...group,
      combined_score: combinedScore(group)
    }))
    .sort((left, right) => right.combined_score - left.combined_score);
  const scores = groups.map((group) => group.combined_score);
  const candidates = groups.slice(0, Math.max(1, Number(limit) || 5)).map((group, index) => {
    const candidate = group.candidate || {};
    const candidateForConflict = {
      ...candidate,
      conflicting_fields: [...group.conflictingFields]
    };
    const conflicts = candidateConflictsForPrompt(candidateForConflict, queryCandidateFields, group.fields);
    const softConflicts = candidateSoftConflictsForPrompt(candidateForConflict, queryCandidateFields, group.fields);
    const anchorAgreement = candidateAnchorAgreement(candidateForConflict, queryCandidateFields, group.fields);
    const printRunCopyViolation = group.candidates.some(referencePrintRunCopyViolation);
    return {
      rank: index + 1,
      anchor_agreement: anchorAgreement,
      candidate_id: candidate.candidate_id || `vector_candidate_${index + 1}`,
      candidate_identity_id: candidate.candidate_identity_id || null,
      provider_id: candidate.provider_id || candidate.retrieval_provider_id || candidate.source_provider || "visual_vector",
      source_type: candidate.source_type || candidate.reference_metadata?.source_type || "VISUAL_VECTOR",
      source_url: candidate.source_url || candidate.reference_metadata?.source_url || null,
      similarity: roundScore(Math.max(...group.similarities, 0)),
      combined_score: roundScore(group.combined_score),
      top1_top2_margin: roundScore(top1Top2Margin(scores, index)),
      reference_count: Math.max(1, group.referenceIds.size || group.embeddingIds.size || group.candidates.length),
      source_trust: sourceTrust(candidate),
      hard_constraint_eligible: candidate.hard_constraint_eligible === true,
      reference_title: sanitizedReferenceTitle(candidate),
      front_similarity: roundScore(group.front_similarity),
      back_similarity: roundScore(group.back_similarity),
      front_rank: Number.isFinite(group.front_rank) ? group.front_rank : null,
      back_rank: Number.isFinite(group.back_rank) ? group.back_rank : null,
      supporting_fields: collectCandidateFieldNames(group.candidates, "supporting_fields"),
      matched_fields: collectCandidateFieldNames(group.candidates, "matched_fields"),
      conflicting_fields: [...new Set(conflicts)],
      soft_conflicting_fields: softConflicts,
      reference_print_run_numerator_copy_violation_count: printRunCopyViolation ? 1 : 0,
      catalog_full_print_run_copy_violation_count: printRunCopyViolation ? 1 : 0,
      reference_metadata: candidate.reference_metadata && typeof candidate.reference_metadata === "object"
        ? candidate.reference_metadata
        : {},
      fields: group.fields
    };
  });
  const packetCandidates = hybridRows.length ? hybridRows : catalogRows.length ? catalogRows : candidates;
  const promptSafeCandidates = uniquePromptCandidates(packetCandidates.filter(isPromptAssistCandidate));
  const fieldSupportSourceCandidates = fieldSupportOpenSetBlocked(retrieval)
    ? []
    : packetCandidates;
  const fieldSupport = buildFieldSupportRows(fieldSupportSourceCandidates, queryCandidateFields);

  return {
    vector_retrieval: {
      status,
      status_code: status === vectorStatus.COMPLETED
        ? "VECTOR_RETRIEVAL_COMPLETED"
        : status === vectorStatus.NO_CONFIDENT_MATCH
          ? "VECTOR_NO_CONFIDENT_MATCH"
          : status === vectorStatus.TIMEOUT
            ? "VECTOR_RETRIEVAL_TIMEOUT"
            : status === vectorStatus.ERROR
              ? "VECTOR_RETRIEVAL_ERROR"
              : "VECTOR_RETRIEVAL_UNAVAILABLE",
      retrieval_strategy: hybridRows.length
        ? "hybrid_rrf_structured_rerank"
        : catalogRows.length
          ? "catalog_exact_anchor"
          : "visual_vector_late_fusion",
      open_set_decision: retrieval.open_set_decision || null,
      open_set_reason: retrieval.open_set_reason || null,
      metrics: retrieval.retrieval_metrics || null,
      instruction: "These are hypotheses, not ground truth. Verify every field against the current card images.",
      candidates: packetCandidates,
      field_support: fieldSupport,
      field_support_count: fieldSupport.length,
      field_support_fields: [...new Set(fieldSupport.map((row) => row.field))],
      unavailable: Array.isArray(retrieval.unavailable) ? retrieval.unavailable.map((item) => ({
        provider_id: item.provider_id || "",
        reason: item.reason || ""
      })) : []
    }
  };
}

export function vectorCandidatePacketHasCandidates(packet = {}) {
  return Array.isArray(packet.vector_retrieval?.candidates) && packet.vector_retrieval.candidates.length > 0;
}

export function vectorCandidatePacketAssistEligibility(packet = {}) {
  const retrieval = packet.vector_retrieval || {};
  const candidates = Array.isArray(retrieval.candidates) ? retrieval.candidates : [];
  const fieldSupport = Array.isArray(retrieval.field_support) ? retrieval.field_support : [];
  const rawCandidateCount = candidates.length;
  const printRunViolationCount = candidates.reduce((total, candidate) => {
    return total + Number(candidate.reference_print_run_numerator_copy_violation_count || 0);
  }, 0);
  const approved = candidates.filter(isAssistApprovedCandidate);
  const trustBlockedCount = Math.max(0, rawCandidateCount - approved.length);
  const promptCandidates = promptCandidatesForOpenSetDecision(
    retrieval,
    uniquePromptCandidates(approved.filter(isPromptAssistCandidate))
  );
  const blocked = approved.filter(candidateHasAnyPromptConflict);
  const promptCandidateIds = promptCandidates.map(promptCandidateId).filter(Boolean);
  const openSetBlockedReason = openSetPromptBlockReason(retrieval, promptCandidates);
  if (!candidates.length) {
    return {
      eligible: false,
      reason: fieldSupport.length ? "catalog_field_support_only" : "no_identity_candidates",
      raw_candidate_count: 0,
      approved_candidate_count: 0,
      trust_blocked_count: 0,
      conflict_blocked_count: 0,
      prompt_candidate_count: 0,
      prompt_candidate_ids: [],
      field_support_count: fieldSupport.length,
      field_support_fields: [...new Set(fieldSupport.map((row) => row.field).filter(Boolean))],
      reference_print_run_numerator_copy_violation_count: printRunViolationCount,
      external_print_run_numerator_copy_violation_count: 0,
      catalog_full_print_run_copy_violation_count: printRunViolationCount,
      eligible_candidate_count: 0,
      blocked_candidate_count: 0
    };
  }

  if (openSetBlockedReason) {
    return {
      eligible: false,
      reason: openSetBlockedReason,
      raw_candidate_count: rawCandidateCount,
      approved_candidate_count: approved.length,
      trust_blocked_count: trustBlockedCount,
      conflict_blocked_count: blocked.length,
      prompt_candidate_count: 0,
      prompt_candidate_ids: [],
      field_support_count: fieldSupport.length,
      field_support_fields: [...new Set(fieldSupport.map((row) => row.field).filter(Boolean))],
      reference_print_run_numerator_copy_violation_count: printRunViolationCount,
      external_print_run_numerator_copy_violation_count: 0,
      catalog_full_print_run_copy_violation_count: printRunViolationCount,
      eligible_candidate_count: 0,
      blocked_candidate_count: approved.length
    };
  }

  if (promptCandidates.length) {
    return {
      eligible: true,
      reason: "approved_identity_candidate_available",
      raw_candidate_count: rawCandidateCount,
      approved_candidate_count: approved.length,
      trust_blocked_count: trustBlockedCount,
      conflict_blocked_count: blocked.length,
      prompt_candidate_count: promptCandidates.length,
      prompt_candidate_ids: promptCandidateIds,
      field_support_count: fieldSupport.length,
      field_support_fields: [...new Set(fieldSupport.map((row) => row.field).filter(Boolean))],
      reference_print_run_numerator_copy_violation_count: printRunViolationCount,
      external_print_run_numerator_copy_violation_count: 0,
      catalog_full_print_run_copy_violation_count: printRunViolationCount,
      eligible_candidate_count: promptCandidates.length,
      blocked_candidate_count: blocked.length
    };
  }
  if (approved.length && blocked.length === approved.length) {
    return {
      eligible: false,
      reason: "approved_identity_candidate_direct_conflict",
      raw_candidate_count: rawCandidateCount,
      approved_candidate_count: approved.length,
      trust_blocked_count: trustBlockedCount,
      conflict_blocked_count: blocked.length,
      prompt_candidate_count: 0,
      prompt_candidate_ids: [],
      field_support_count: fieldSupport.length,
      field_support_fields: [...new Set(fieldSupport.map((row) => row.field).filter(Boolean))],
      reference_print_run_numerator_copy_violation_count: printRunViolationCount,
      external_print_run_numerator_copy_violation_count: 0,
      catalog_full_print_run_copy_violation_count: printRunViolationCount,
      eligible_candidate_count: 0,
      blocked_candidate_count: blocked.length
    };
  }
  if (approved.length) {
    return {
      eligible: false,
      reason: "approved_identity_candidate_missing_identity_anchor",
      raw_candidate_count: rawCandidateCount,
      approved_candidate_count: approved.length,
      trust_blocked_count: trustBlockedCount,
      conflict_blocked_count: blocked.length,
      prompt_candidate_count: 0,
      prompt_candidate_ids: [],
      field_support_count: fieldSupport.length,
      field_support_fields: [...new Set(fieldSupport.map((row) => row.field).filter(Boolean))],
      reference_print_run_numerator_copy_violation_count: printRunViolationCount,
      external_print_run_numerator_copy_violation_count: 0,
      catalog_full_print_run_copy_violation_count: printRunViolationCount,
      eligible_candidate_count: 0,
      blocked_candidate_count: approved.length
    };
  }
  return {
    eligible: false,
    reason: "no_approved_identity_candidate",
    raw_candidate_count: rawCandidateCount,
    approved_candidate_count: 0,
    trust_blocked_count: trustBlockedCount,
    conflict_blocked_count: 0,
    prompt_candidate_count: 0,
    prompt_candidate_ids: [],
    field_support_count: fieldSupport.length,
    field_support_fields: [...new Set(fieldSupport.map((row) => row.field).filter(Boolean))],
    reference_print_run_numerator_copy_violation_count: printRunViolationCount,
    external_print_run_numerator_copy_violation_count: 0,
    catalog_full_print_run_copy_violation_count: printRunViolationCount,
    eligible_candidate_count: 0,
    blocked_candidate_count: 0
  };
}

export function buildVectorCandidateAssistPacket(packet = {}) {
  const retrieval = packet.vector_retrieval || {};
  const candidates = Array.isArray(retrieval.candidates) ? retrieval.candidates : [];
  const eligibility = vectorCandidatePacketAssistEligibility(packet);
  const allowedPromptIds = new Set(eligibility.prompt_candidate_ids || []);
  const fieldSupport = Array.isArray(retrieval.field_support) ? retrieval.field_support : [];
  const promptCandidates = uniquePromptCandidates(candidates.filter((candidate) => (
    isPromptAssistCandidate(candidate) && allowedPromptIds.has(promptCandidateId(candidate))
  ))).map((candidate, index) => ({
    ...candidate,
    rank: index + 1
  }));
  const status = promptCandidates.length || fieldSupport.length ? vectorStatus.COMPLETED : vectorStatus.NO_CONFIDENT_MATCH;
  return {
    vector_retrieval: {
      ...retrieval,
      status,
      status_code: promptCandidates.length
        ? "VECTOR_ASSIST_APPROVED_REFERENCES_AVAILABLE"
        : fieldSupport.length
          ? "VECTOR_ASSIST_FIELD_SUPPORT_AVAILABLE"
        : "VECTOR_ASSIST_NO_APPROVED_PROMPT_CANDIDATES",
      retrieval_strategy: `${retrieval.retrieval_strategy || "vector_retrieval"}_approved_prompt_filter`,
      instruction: "Only APPROVED_REFERENCE candidates without direct conflicts are included as identity candidates. Field support is vocabulary/legal support only and must be verified against current images.",
      candidates: promptCandidates,
      field_support: fieldSupport,
      field_support_count: fieldSupport.length,
      field_support_fields: [...new Set(fieldSupport.map((row) => row.field).filter(Boolean))],
      assist_filter: eligibility,
      unavailable: Array.isArray(retrieval.unavailable) ? retrieval.unavailable : []
    }
  };
}

export function vectorCandidatePacketHasAssistEligibleCandidates(packet = {}) {
  return vectorCandidatePacketAssistEligibility(packet).prompt_candidate_count > 0;
}

export function vectorCandidatePacketFieldSupportCount(packet = {}) {
  const retrieval = packet.vector_retrieval || {};
  if (Array.isArray(retrieval.field_support)) return retrieval.field_support.length;
  return finiteNumber(retrieval.field_support_count, 0) || 0;
}

export function vectorCandidatePacketHasPromptContent(packet = {}) {
  const eligibility = vectorCandidatePacketAssistEligibility(packet);
  return Number(eligibility.prompt_candidate_count || 0) > 0
    || vectorCandidatePacketFieldSupportCount(packet) > 0;
}
