// Read-only product-schema shadow evaluation.
//
// This module observes the terminal Identity Resolver fields after the title is
// finalized. It records agreement and disagreement with the committed source,
// but it does not create candidates, filter candidates, rank candidates, apply
// fields, call the Resolver, or render a title.

import {
  loadProductSchemaRuntimeAdapter,
  normalizeProductSchemaText,
  productSchemaRuntimeAdapterVersion,
  supportedProductSchemaDocumentVersion
} from "./product-schema-runtime-adapter.mjs";
import { createHash } from "node:crypto";

// The adapter module is code-only at import time; the 4.1 MB artifact is read
// solely by loadProductSchemaRuntimeAdapter after an explicit opt-in. Keeping
// this boundary synchronous avoids changing the terminal result builder solely
// for shadow telemetry.

export const productSchemaShadowTraceVersion = "product-schema-shadow-trace-v1";

export const productSchemaShadowVerdicts = Object.freeze({
  AGREEMENT: "AGREEMENT",
  CONFLICT: "CONFLICT",
  AMBIGUOUS: "AMBIGUOUS",
  NOT_EVALUATED: "NOT_EVALUATED",
  UNCHECKED: "UNCHECKED"
});

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const observedTextLimit = 240;
const observedArrayItemLimit = 8;
const matchedSchemaKeySampleLimit = 8;

const boundedObservedText = (value) => cleanText(value).slice(0, observedTextLimit);

function matchedSchemaKeySummary(schemas = []) {
  const keys = [...new Set((Array.isArray(schemas) ? schemas : [])
    .map((schema) => boundedObservedText(schema?.schema_key))
    .filter(Boolean))].sort();
  return {
    matched_schema_key_count: keys.length,
    matched_schema_key_sample_limit: matchedSchemaKeySampleLimit,
    matched_schema_key_sample: keys.slice(0, matchedSchemaKeySampleLimit),
    matched_schema_key_truncated_count: Math.max(0, keys.length - matchedSchemaKeySampleLimit),
    matched_schema_key_sha256: keys.length
      ? `sha256:${createHash("sha256").update(keys.join("\n")).digest("hex")}`
      : null
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstValueFromContainers(containers = [], keys = []) {
  for (const [containerName, record] of containers) {
    if (!record) continue;
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        const items = value
          .slice(0, observedArrayItemLimit)
          .map(boundedObservedText)
          .filter(Boolean);
        if (items.length) {
          return {
            value: items.join(" / ").slice(0, observedTextLimit),
            source_field: key,
            source_container: containerName
          };
        }
        continue;
      }
      const cleaned = boundedObservedText(value);
      if (cleaned) {
        return {
          value: cleaned,
          source_field: key,
          source_container: containerName
        };
      }
    }
  }
  return { value: "", source_field: null, source_container: null };
}

export function extractProductSchemaShadowIdentity(result = {}) {
  const renderedFields = objectRecord(result.rendered_fields);
  const containers = [
    ["resolved_fields", objectRecord(result.resolved_fields)],
    ["rendered_fields.fields", objectRecord(renderedFields?.fields)],
    ["resolved", objectRecord(result.resolved)],
    ["fields", objectRecord(result.fields)],
    ["raw_provider_fields", objectRecord(result.raw_provider_fields)]
  ];
  // Merge only by deterministic container precedence and only for missing
  // fields. This avoids the old failure mode where an empty resolved_fields
  // object hid a usable rendered identity while preserving field provenance.
  const manufacturer = firstValueFromContainers(containers, ["manufacturer", "brand"]);
  const seasonYear = firstValueFromContainers(containers, ["season_year", "year"]);
  const product = firstValueFromContainers(containers, ["product"]);
  const sport = firstValueFromContainers(containers, ["sport", "category"]);
  const set = firstValueFromContainers(containers, ["set_or_insert", "set"]);
  const cardNumber = firstValueFromContainers(containers, [
    "card_number",
    "collector_number",
    "checklist_code",
    "tcg_card_number"
  ]);
  const selectedFields = { manufacturer, seasonYear, product, sport, set, cardNumber };
  const usedContainers = [...new Set(
    Object.values(selectedFields).map((field) => field.source_container).filter(Boolean)
  )];
  return deepFreeze({
    field_container: usedContainers.length === 0
      ? "none"
      : usedContainers.length === 1
        ? usedContainers[0]
        : "precedence_merge",
    manufacturer: manufacturer.value || null,
    season_year: seasonYear.value || null,
    product: product.value || null,
    sport: sport.value || null,
    set: set.value || null,
    card_number: cardNumber.value || null,
    source_fields: {
      manufacturer: manufacturer.source_field,
      season_year: seasonYear.source_field,
      product: product.source_field,
      sport: sport.source_field,
      set: set.source_field,
      card_number: cardNumber.source_field
    },
    source_containers: {
      manufacturer: manufacturer.source_container,
      season_year: seasonYear.source_container,
      product: product.source_container,
      sport: sport.source_container,
      set: set.source_container,
      card_number: cardNumber.source_container
    }
  });
}

function observedIdentityFieldCount(identity = {}) {
  return ["manufacturer", "season_year", "product", "sport", "set", "card_number"]
    .filter((key) => Boolean(identity[key])).length;
}

function manufacturerCovered(manufacturer = "", adapter = null) {
  const normalized = normalizeProductSchemaText(manufacturer);
  if (!normalized) return false;
  return (adapter?.source?.covered_manufacturers || [])
    .some((candidate) => normalized.includes(normalizeProductSchemaText(candidate)));
}

function fieldTrace({ status = "UNCHECKED", observed = null, reason, ...rest } = {}) {
  return deepFreeze({
    status,
    observed,
    reason,
    ...rest
  });
}

function unavailableTrace({ adapter = null, identity = {}, reason = "PRODUCT_SCHEMA_UNAVAILABLE" } = {}) {
  return deepFreeze({
    trace_version: productSchemaShadowTraceVersion,
    mode: "SHADOW_READ_ONLY",
    verdict: productSchemaShadowVerdicts.UNCHECKED,
    reason_codes: [reason],
    source: adapter?.source || null,
    adapter: {
      version: adapter?.adapter_version || productSchemaRuntimeAdapterVersion,
      status: adapter?.status || "UNAVAILABLE",
      supported_relations: adapter?.supported_relations || [],
      reason_codes: adapter?.reason_codes || [reason]
    },
    counts: {
      source: adapter?.counts || null,
      observed_field_count: observedIdentityFieldCount(identity),
      checked_field_count: 0,
      agreement_count: 0,
      conflict_count: 0,
      ambiguous_count: 0
    },
    observed_identity: identity,
    field_trace: {},
    effects: {
      candidate_filtering: false,
      candidate_ranking: false,
      candidate_application: false,
      resolver: false,
      renderer: false,
      production_title: false
    }
  });
}

function booleanFlag(value) {
  if (typeof value === "boolean") return value;
  const normalized = cleanText(value).toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return null;
}

function providerOptionsFromShadowPayload(payload = {}) {
  return objectRecord(payload.provider_options)
    || objectRecord(payload.providerOptions)
    || {};
}

export function productSchemaShadowEvaluationEnabled({
  payload = {},
  env = process.env
} = {}) {
  const options = providerOptionsFromShadowPayload(payload);
  const explicitValues = [
    payload.product_schema_shadow_enabled,
    payload.productSchemaShadowEnabled,
    options.enable_product_schema_shadow,
    options.enableProductSchemaShadow,
    env.ENABLE_PRODUCT_SCHEMA_SHADOW
  ];
  for (const value of explicitValues) {
    const enabled = booleanFlag(value);
    if (enabled !== null) return enabled;
  }

  const shadowProfile = cleanText(
    payload.product_schema_shadow_profile
      || payload.productSchemaShadowProfile
      || options.product_schema_shadow_profile
  ).toLowerCase();
  return shadowProfile === "evaluation"
    || shadowProfile === "shadow";
}

export function evaluateProductSchemaShadow({
  result = {},
  adapter = loadProductSchemaRuntimeAdapter()
} = {}) {
  const identity = extractProductSchemaShadowIdentity(result);
  if (!adapter || adapter.status !== "READY") {
    return unavailableTrace({
      adapter,
      identity,
      reason: adapter?.reason_codes?.[0] || "PRODUCT_SCHEMA_UNAVAILABLE"
    });
  }
  if (!manufacturerCovered(identity.manufacturer, adapter)) {
    return unavailableTrace({
      adapter,
      identity,
      reason: identity.manufacturer
        ? "PRODUCT_SCHEMA_MANUFACTURER_NOT_COVERED"
        : "PRODUCT_SCHEMA_MANUFACTURER_MISSING"
    });
  }

  const reasonCodes = [];
  const fields = {};
  let productSchemas = [];
  let productYearSchemas = [];

  if (identity.product) {
    productSchemas = adapter.findSchemas({ product: identity.product });
    const productStatus = productSchemas.length ? "AGREEMENT" : "UNCHECKED";
    fields.product = fieldTrace({
      status: productStatus,
      observed: identity.product,
      reason: productSchemas.length
        ? "PRODUCT_FOUND_IN_SOURCE"
        : "PRODUCT_NOT_COVERED_BY_SOURCE_SNAPSHOT",
      matched_schema_count: productSchemas.length,
      ...matchedSchemaKeySummary(productSchemas)
    });
    reasonCodes.push(fields.product.reason);

    if (identity.season_year) {
      productYearSchemas = adapter.findSchemas({
        product: identity.product,
        season_year: identity.season_year
      });
      const productYearStatus = productYearSchemas.length ? "AGREEMENT" : "UNCHECKED";
      fields.product_year = fieldTrace({
        status: productYearStatus,
        observed: `${identity.season_year}|${identity.product}`,
        reason: productYearSchemas.length
          ? "PRODUCT_YEAR_FOUND_IN_SOURCE"
          : "PRODUCT_YEAR_NOT_COVERED_BY_SOURCE_SNAPSHOT",
        matched_schema_count: productYearSchemas.length,
        ...matchedSchemaKeySummary(productYearSchemas)
      });
      reasonCodes.push(fields.product_year.reason);
    }
  } else {
    reasonCodes.push("PRODUCT_SCHEMA_PRODUCT_MISSING");
  }

  if (identity.set) {
    const ownership = adapter.setOwnershipForSet(identity.set, {
      product: identity.product,
      season_year: identity.season_year
    });
    const claimHasProductContext = Boolean(identity.product || identity.season_year);
    let setStatus = "UNCHECKED";
    let setReason = "SET_OWNER_AVAILABLE_WITHOUT_PRODUCT_CONTEXT";
    if (!ownership.owner_count) {
      setStatus = "UNCHECKED";
      setReason = "SET_NOT_COVERED_BY_SOURCE_SNAPSHOT";
    } else if (claimHasProductContext && ownership.agreeing_owner_count) {
      setStatus = "AGREEMENT";
      setReason = "SET_OWNER_AGREES_WITH_OBSERVED_IDENTITY";
    } else if (claimHasProductContext) {
      // The current artifact is a harvested, non-exhaustive presence table.
      // A missing matching owner is not an explicit exclusion and therefore
      // cannot be promoted into negative evidence.
      setStatus = "UNCHECKED";
      setReason = "SET_OWNER_NO_AGREEMENT_NONAUTHORITATIVE";
    } else if (ownership.owner_count > 1) {
      setStatus = "AMBIGUOUS";
      setReason = "SET_HAS_MULTIPLE_SOURCE_OWNERS";
    }
    fields.set_to_products = fieldTrace({
      status: setStatus,
      observed: identity.set,
      reason: setReason,
      ...ownership
    });
    reasonCodes.push(setReason);
  }

  if (identity.card_number) {
    if (!identity.product || !identity.season_year || !productYearSchemas.length) {
      fields.card_numbers = fieldTrace({
        status: "UNCHECKED",
        observed: identity.card_number,
        reason: "CARD_NUMBER_REQUIRES_MATCHED_PRODUCT_YEAR",
        matched_schema_count: productYearSchemas.length
      });
    } else {
      const agreeingSchemas = productYearSchemas.filter((schema) => (
        adapter.schemaHasCardNumber(schema.schema_key, identity.card_number)
      ));
      fields.card_numbers = fieldTrace({
        status: agreeingSchemas.length ? "AGREEMENT" : "UNCHECKED",
        observed: identity.card_number,
        reason: agreeingSchemas.length
          ? "CARD_NUMBER_FOUND_IN_MATCHED_PRODUCT_YEAR"
          : "CARD_NUMBER_NOT_COVERED_BY_MATCHED_PRODUCT_YEAR_SNAPSHOT",
        matched_schema_count: productYearSchemas.length,
        agreeing_schema_count: agreeingSchemas.length,
        ...matchedSchemaKeySummary(agreeingSchemas)
      });
    }
    reasonCodes.push(fields.card_numbers.reason);
  }

  const statuses = Object.values(fields).map((field) => field.status);
  const agreementCount = statuses.filter((status) => status === "AGREEMENT").length;
  const conflictCount = statuses.filter((status) => status === "CONFLICT").length;
  const ambiguousCount = statuses.filter((status) => status === "AMBIGUOUS").length;
  const checkedFieldCount = agreementCount + conflictCount + ambiguousCount;
  const verdict = conflictCount > 0
    ? productSchemaShadowVerdicts.CONFLICT
    : ambiguousCount > 0
      ? productSchemaShadowVerdicts.AMBIGUOUS
      : agreementCount > 0
        ? productSchemaShadowVerdicts.AGREEMENT
        : productSchemaShadowVerdicts.UNCHECKED;

  if (!statuses.length) reasonCodes.push("PRODUCT_SCHEMA_NO_EVALUABLE_FIELDS");

  return deepFreeze({
    trace_version: productSchemaShadowTraceVersion,
    mode: "SHADOW_READ_ONLY",
    verdict,
    reason_codes: [...new Set(reasonCodes)],
    source: adapter.source,
    adapter: {
      version: adapter.adapter_version,
      status: adapter.status,
      supported_relations: adapter.supported_relations,
      reason_codes: adapter.reason_codes
    },
    counts: {
      source: adapter.counts,
      observed_field_count: observedIdentityFieldCount(identity),
      checked_field_count: checkedFieldCount,
      agreement_count: agreementCount,
      conflict_count: conflictCount,
      ambiguous_count: ambiguousCount
    },
    observed_identity: identity,
    field_trace: fields,
    effects: {
      candidate_filtering: false,
      candidate_ranking: false,
      candidate_application: false,
      resolver: false,
      renderer: false,
      production_title: false
    }
  });
}

export function attachProductSchemaShadowEvaluation(result = {}, {
  adapter = null,
  enabled = null,
  loadAdapter = loadProductSchemaRuntimeAdapter,
  payload = {},
  env = process.env,
  now = () => globalThis.performance?.now?.() ?? Date.now()
} = {}) {
  const safeResult = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const shouldEvaluate = typeof enabled === "boolean"
    ? enabled
    : productSchemaShadowEvaluationEnabled({ payload, env });
  if (!shouldEvaluate) {
    // Production default is a true no-op: no artifact load, no identity walk,
    // and no response-contract expansion. Evaluation profiles opt in.
    return safeResult;
  }
  const startedAt = now();
  try {
    const runtimeAdapter = adapter || loadAdapter();
    const adapterReadyAt = now();
    const trace = evaluateProductSchemaShadow({
      result: safeResult,
      adapter: runtimeAdapter
    });
    const completedAt = now();
    return {
      ...safeResult,
      product_schema_shadow: deepFreeze({
        ...trace,
        timing: {
          adapter_access_ms: Math.max(0, adapterReadyAt - startedAt),
          evaluation_ms: Math.max(0, completedAt - adapterReadyAt),
          total_ms: Math.max(0, completedAt - startedAt)
        }
      })
    };
  } catch {
    const completedAt = now();
    return {
      ...safeResult,
      product_schema_shadow: deepFreeze({
        ...unavailableTrace({
          adapter,
          identity: extractProductSchemaShadowIdentity(safeResult),
          reason: "PRODUCT_SCHEMA_SHADOW_EVALUATION_FAILED"
        }),
        timing: {
          adapter_access_ms: null,
          evaluation_ms: null,
          total_ms: Math.max(0, completedAt - startedAt)
        }
      })
    };
  }
}

export const __productSchemaShadowEvaluatorTestHooks = Object.freeze({
  deepFreeze,
  manufacturerCovered,
  unavailableTrace
});
