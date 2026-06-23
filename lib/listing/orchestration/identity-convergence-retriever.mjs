import { runRetrieval } from "../retrieval/retrieval-engine.mjs";
import { retrievalModes, retrievalQueryFamilies } from "../retrieval/retrieval-contract.mjs";

export const identityConvergenceRetrievalFamilies = Object.freeze([
  retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY,
  retrievalQueryFamilies.INTERNAL_REGISTRY,
  retrievalQueryFamilies.EXACT_CHECKLIST_CODE,
  retrievalQueryFamilies.PLAYER_AND_COLLECTOR_NUMBER,
  retrievalQueryFamilies.PRODUCT_AND_SERIAL_DENOMINATOR,
  retrievalQueryFamilies.OFFICIAL_SOURCES,
  retrievalQueryFamilies.BRAVE
]);

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function unresolvedFieldsFromRequest(request = {}) {
  const conflictFields = (request.conflict_map || [])
    .filter((conflict) => conflict.resolved !== true)
    .map((conflict) => conflict.field);
  return unique([
    ...(request.unresolved_fields || []),
    ...conflictFields
  ]).slice(0, 8);
}

export function createIdentityConvergenceRetriever({
  env = process.env,
  retrievalMode = env.RETRIEVAL_MODE || retrievalModes.AUTO,
  providerRegistry = null,
  cache = null,
  sourcePolicy = null,
  runRetrievalImpl = runRetrieval,
  allowedFamilies = identityConvergenceRetrievalFamilies,
  maxQueries = positiveInteger(env.IDENTITY_CONVERGENCE_MAX_QUERIES, 4)
} = {}) {
  return async function retrieveIdentityConvergenceEvidence(request = {}) {
    const unresolvedFields = unresolvedFieldsFromRequest(request);
    if (!unresolvedFields.length) {
      return {
        evidenceItems: [],
        retrievalCandidates: [],
        registryRecords: [],
        productSchemas: []
      };
    }

    const retrieval = await runRetrievalImpl({
      resolved: request.identity || {},
      missingFields: unresolvedFields,
      weakFields: unresolvedFields,
      mode: retrievalMode,
      env,
      providerRegistry,
      cache,
      sourcePolicy,
      allowedFamilies,
      maxQueries
    });
    const selected = retrieval?.selected_candidate ? [retrieval.selected_candidate] : [];

    return {
      evidenceItems: [],
      retrievalCandidates: selected,
      registryRecords: [],
      productSchemas: [],
      retrieval
    };
  };
}
