import { retrievalQueryFamilies } from "../retrieval/retrieval-contract.mjs";
import { isResolutionBudgetExhausted } from "./resolution-budget.mjs";

export const completionActions = Object.freeze({
  RE_READ_FRONT: "RE_READ_FRONT",
  RE_READ_BACK: "RE_READ_BACK",
  READ_ALTERNATE_VIEW: "READ_ALTERNATE_VIEW",
  CROP_AND_READ_SUBJECT: "CROP_AND_READ_SUBJECT",
  CROP_AND_READ_SERIAL: "CROP_AND_READ_SERIAL",
  CROP_AND_READ_CARD_CODE: "CROP_AND_READ_CARD_CODE",
  CROP_AND_READ_GRADE_LABEL: "CROP_AND_READ_GRADE_LABEL",
  CROP_AND_READ_YEAR_PRODUCT: "CROP_AND_READ_YEAR_PRODUCT",
  TRY_ALTERNATIVE_OCR: "TRY_ALTERNATIVE_OCR",
  SEARCH_INTERNAL_APPROVED_HISTORY: "SEARCH_INTERNAL_APPROVED_HISTORY",
  SEARCH_INTERNAL_REGISTRY: "SEARCH_INTERNAL_REGISTRY",
  SEARCH_EXACT_CHECKLIST_CODE: "SEARCH_EXACT_CHECKLIST_CODE",
  SEARCH_PLAYER_AND_COLLECTOR_NUMBER: "SEARCH_PLAYER_AND_COLLECTOR_NUMBER",
  SEARCH_PRODUCT_AND_SERIAL_DENOMINATOR: "SEARCH_PRODUCT_AND_SERIAL_DENOMINATOR",
  SEARCH_OFFICIAL_SOURCES: "SEARCH_OFFICIAL_SOURCES",
  SEARCH_BRAVE: "SEARCH_BRAVE",
  SEARCH_EBAY: "SEARCH_EBAY",
  SEARCH_OWS_FALLBACK: "SEARCH_OWS_FALLBACK",
  VERIFY_CANDIDATE: "VERIFY_CANDIDATE",
  AGNES_FOCUSED_RECHECK: "AGNES_FOCUSED_RECHECK",
  REQUEST_TARGETED_RESCAN: "REQUEST_TARGETED_RESCAN",
  ROUTE_TO_MANUAL: "ROUTE_TO_MANUAL"
});

export const retrievalFamiliesByAction = Object.freeze({
  [completionActions.SEARCH_INTERNAL_APPROVED_HISTORY]: [retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY],
  [completionActions.SEARCH_INTERNAL_REGISTRY]: [retrievalQueryFamilies.INTERNAL_REGISTRY],
  [completionActions.SEARCH_EXACT_CHECKLIST_CODE]: [retrievalQueryFamilies.EXACT_CHECKLIST_CODE],
  [completionActions.SEARCH_PLAYER_AND_COLLECTOR_NUMBER]: [retrievalQueryFamilies.PLAYER_AND_COLLECTOR_NUMBER],
  [completionActions.SEARCH_PRODUCT_AND_SERIAL_DENOMINATOR]: [retrievalQueryFamilies.PRODUCT_AND_SERIAL_DENOMINATOR],
  [completionActions.SEARCH_OFFICIAL_SOURCES]: [retrievalQueryFamilies.OFFICIAL_SOURCES],
  [completionActions.SEARCH_BRAVE]: [retrievalQueryFamilies.BRAVE],
  [completionActions.SEARCH_EBAY]: [retrievalQueryFamilies.EBAY],
  [completionActions.SEARCH_OWS_FALLBACK]: [retrievalQueryFamilies.OWS_FALLBACK]
});

const regionRecoveryActions = Object.freeze({
  subject_name: completionActions.CROP_AND_READ_SUBJECT,
  serial_number: completionActions.CROP_AND_READ_SERIAL,
  collector_number: completionActions.CROP_AND_READ_CARD_CODE,
  checklist_code: completionActions.CROP_AND_READ_CARD_CODE,
  grade_label: completionActions.CROP_AND_READ_GRADE_LABEL,
  year_product: completionActions.CROP_AND_READ_YEAR_PRODUCT
});

const actionInformationGain = Object.freeze({
  [completionActions.CROP_AND_READ_SERIAL]: 0.74,
  [completionActions.CROP_AND_READ_CARD_CODE]: 0.72,
  [completionActions.CROP_AND_READ_GRADE_LABEL]: 0.7,
  [completionActions.CROP_AND_READ_YEAR_PRODUCT]: 0.68,
  [completionActions.CROP_AND_READ_SUBJECT]: 0.64,
  [completionActions.SEARCH_EXACT_CHECKLIST_CODE]: 0.66,
  [completionActions.SEARCH_INTERNAL_APPROVED_HISTORY]: 0.62,
  [completionActions.SEARCH_INTERNAL_REGISTRY]: 0.56,
  [completionActions.SEARCH_PLAYER_AND_COLLECTOR_NUMBER]: 0.52,
  [completionActions.SEARCH_PRODUCT_AND_SERIAL_DENOMINATOR]: 0.5,
  [completionActions.SEARCH_OFFICIAL_SOURCES]: 0.48,
  [completionActions.SEARCH_BRAVE]: 0.44,
  [completionActions.SEARCH_EBAY]: 0.25,
  [completionActions.SEARCH_OWS_FALLBACK]: 0.22,
  [completionActions.AGNES_FOCUSED_RECHECK]: 0.42,
  [completionActions.REQUEST_TARGETED_RESCAN]: 0.38,
  [completionActions.ROUTE_TO_MANUAL]: 0
});

function attemptedActionName(action) {
  return typeof action === "string" ? action : action?.action;
}

export function hasAttemptedAction(attemptedActions = [], action) {
  return attemptedActions.some((attempted) => attemptedActionName(attempted) === action);
}

function decision(action, reason) {
  return {
    action,
    reason,
    estimated_information_gain: actionInformationGain[action] ?? 0.3
  };
}

function gapSet(state = {}) {
  return new Set([
    ...(state.missing_fields || []),
    ...(state.weak_fields || []),
    ...(state.conflicting_fields || [])
  ]);
}

function hasSubject(fields = {}) {
  return Array.isArray(fields.players) && fields.players.length > 0 || Boolean(fields.character);
}

function hasProductAnchor(fields = {}) {
  return Boolean(fields.product || fields.set || fields.brand || fields.manufacturer);
}

function serialHasDenominator(fields = {}) {
  return /\/\s*\d{1,4}\b/.test(String(fields.serial_number || ""));
}

function firstAvailable(attemptedActions, candidates) {
  return candidates.find(({ action, condition = true }) => {
    return condition && !hasAttemptedAction(attemptedActions, action);
  });
}

export function chooseNextBestAction({
  state = {},
  resolved = {},
  budget = null
} = {}) {
  const attemptedActions = state.attempted_actions || [];
  const gaps = gapSet(state);

  if (state.resolution_state === "EVIDENCE_CLOSED") {
    return decision(null, "All tracked critical fields have sufficient evidence.");
  }

  if (budget && isResolutionBudgetExhausted(budget)) {
    return decision(completionActions.ROUTE_TO_MANUAL, "Resolution budget is exhausted.");
  }

  if (state.conflicting_fields?.length && state.candidate_cards?.length && !hasAttemptedAction(attemptedActions, completionActions.VERIFY_CANDIDATE)) {
    return decision(completionActions.VERIFY_CANDIDATE, "Candidate conflict needs verification before selecting ground truth.");
  }

  const occludedAction = firstAvailable(
    attemptedActions,
    (state.critical_region_occlusion || []).map((item) => ({
      action: regionRecoveryActions[item.region],
      condition: Boolean(regionRecoveryActions[item.region]) && (
        gaps.has(item.region)
          || (item.region === "subject_name" && (gaps.has("players") || gaps.has("character")))
          || (item.region === "year_product" && (gaps.has("year") || gaps.has("product") || gaps.has("brand")))
          || (item.region === "grade_label" && (gaps.has("grade_company") || gaps.has("card_grade") || gaps.has("auto_grade")))
        )
    }))
  );

  if (occludedAction) {
    return decision(occludedAction.action, "Critical image region is occluded and should be focused before manual routing.");
  }

  const retrievalCandidate = firstAvailable(attemptedActions, [
    {
      action: completionActions.SEARCH_INTERNAL_APPROVED_HISTORY,
      condition: true
    },
    {
      action: completionActions.SEARCH_INTERNAL_REGISTRY,
      condition: hasProductAnchor(resolved) || Boolean(resolved.insert || resolved.parallel || resolved.checklist_code)
    },
    {
      action: completionActions.SEARCH_EXACT_CHECKLIST_CODE,
      condition: Boolean(resolved.checklist_code)
    },
    {
      action: completionActions.SEARCH_PLAYER_AND_COLLECTOR_NUMBER,
      condition: hasSubject(resolved) && Boolean(resolved.collector_number)
    },
    {
      action: completionActions.SEARCH_PRODUCT_AND_SERIAL_DENOMINATOR,
      condition: hasSubject(resolved) && hasProductAnchor(resolved) && serialHasDenominator(resolved)
    },
    {
      action: completionActions.SEARCH_OFFICIAL_SOURCES,
      condition: Boolean(resolved.checklist_code)
    },
    {
      action: completionActions.SEARCH_BRAVE,
      condition: hasSubject(resolved) && hasProductAnchor(resolved)
    },
    {
      action: completionActions.SEARCH_EBAY,
      condition: hasSubject(resolved) || hasProductAnchor(resolved) || Boolean(resolved.checklist_code)
    },
    {
      action: completionActions.SEARCH_OWS_FALLBACK,
      condition: state.missing_fields?.length || state.weak_fields?.length
    }
  ]);

  if (retrievalCandidate) {
    return decision(retrievalCandidate.action, "Next retrieval family has the highest available evidence gain.");
  }

  if (!hasAttemptedAction(attemptedActions, completionActions.AGNES_FOCUSED_RECHECK)) {
    return decision(completionActions.AGNES_FOCUSED_RECHECK, "Remaining gaps need a primary-provider focused recheck, not GPT emergency fallback.");
  }

  if ((state.critical_region_occlusion || []).length && !hasAttemptedAction(attemptedActions, completionActions.REQUEST_TARGETED_RESCAN)) {
    return decision(completionActions.REQUEST_TARGETED_RESCAN, "Critical region remains occluded after focused recovery, retrieval constraints, and primary-provider recheck.");
  }

  return decision(completionActions.ROUTE_TO_MANUAL, "All configured evidence completion paths are exhausted.");
}
