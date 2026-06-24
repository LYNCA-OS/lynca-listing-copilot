import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { retrievalQueryFamilies } from "./retrieval-contract.mjs";
import { queryForProvider, queryId, quotePhrase, serialDenominator } from "./query-families.mjs";

function subjectText(resolved) {
  if (Array.isArray(resolved.players) && resolved.players.length) return resolved.players.join(" ");
  return resolved.character || "";
}

function productText(resolved) {
  return [resolved.year, resolved.brand || resolved.manufacturer, resolved.product, resolved.set]
    .filter(Boolean)
    .join(" ");
}

function visualParallelText(resolved) {
  return [
    resolved.surface_color,
    resolved.parallel_family,
    resolved.parallel_exact || resolved.parallel,
    resolved.variation
  ].filter(Boolean).join(" ");
}

function makeQuery(family, index, query, {
  fields = [],
  reason = ""
} = {}) {
  return {
    query_id: queryId(family, index),
    family,
    provider_id: queryForProvider(family),
    query,
    fields,
    reason
  };
}

export function planRetrievalQueries({
  resolved = {},
  missingFields = [],
  weakFields = [],
  includeExternal = true,
  allowOwsFallback = false
} = {}) {
  const fields = normalizeResolvedFields(resolved);
  const subject = subjectText(fields);
  const product = productText(fields);
  const visualParallel = visualParallelText(fields);
  const serialDenom = serialDenominator(fields.serial_number);
  const planned = [];

  planned.push(makeQuery(retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY, planned.length, [
    fields.checklist_code,
    subject,
    product,
    fields.collector_number,
    fields.serial_number
  ].filter(Boolean).map(quotePhrase).join(" "), {
    fields: ["checklist_code", "players", "character", "product", "collector_number", "serial_number"],
    reason: "internal approved history is the highest retrieval priority"
  }));

  planned.push(makeQuery(retrievalQueryFamilies.INTERNAL_REGISTRY, planned.length, [
    fields.checklist_code,
    fields.insert,
    fields.surface_color,
    fields.parallel_family,
    fields.parallel_exact,
    fields.parallel,
    product
  ].filter(Boolean).map(quotePhrase).join(" "), {
    fields: ["checklist_code", "insert", "surface_color", "parallel_family", "parallel_exact", "parallel", "product"],
    reason: "internal registry can map known insert and code families"
  }));

  if (!includeExternal) return planned.filter((query) => query.query);

  if (fields.checklist_code) {
    planned.push(makeQuery(retrievalQueryFamilies.EXACT_CHECKLIST_CODE, planned.length, quotePhrase(fields.checklist_code), {
      fields: ["checklist_code"],
      reason: "exact checklist code has the highest external information gain"
    }));
  }

  if (fields.checklist_code && subject) {
    planned.push(makeQuery(retrievalQueryFamilies.EXACT_CHECKLIST_CODE, planned.length, `${quotePhrase(fields.checklist_code)} ${quotePhrase(subject)}`, {
      fields: ["checklist_code", "players", "character"],
      reason: "checklist code plus subject reduces false candidate matches"
    }));
  }

  if (subject && fields.collector_number) {
    planned.push(makeQuery(retrievalQueryFamilies.PLAYER_AND_COLLECTOR_NUMBER, planned.length, `${quotePhrase(subject)} ${quotePhrase(fields.collector_number)}`, {
      fields: ["players", "character", "collector_number"],
      reason: "subject plus collector number is useful when checklist code is absent"
    }));
  }

  if (product && subject) {
    planned.push(makeQuery(retrievalQueryFamilies.BRAVE, planned.length, `${quotePhrase(product)} ${quotePhrase(subject)}`, {
      fields: ["year", "brand", "product", "set", "players", "character"],
      reason: "product plus subject finds official checklist and structured references"
    }));
  }

  if (product && subject && fields.card_type) {
    planned.push(makeQuery(retrievalQueryFamilies.BRAVE, planned.length, `${quotePhrase(product)} ${quotePhrase(subject)} ${quotePhrase(fields.card_type)}`, {
      fields: ["year", "brand", "product", "set", "players", "character", "card_type"],
      reason: "card type is checked after core identity candidates are recalled"
    }));
  }

  if (subject && (fields.product || fields.brand) && serialDenom) {
    planned.push(makeQuery(retrievalQueryFamilies.PRODUCT_AND_SERIAL_DENOMINATOR, planned.length, [
      subject,
      fields.product || fields.brand,
      fields.card_type,
      serialDenom,
      visualParallel
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: ["players", "character", "product", "card_type", "serial_number", "surface_color", "parallel_family", "parallel_exact", "parallel"],
      reason: "serial denominator and visual parallel candidates filter recalled card identities but do not establish ground truth alone"
    }));
  }

  if (fields.checklist_code) {
    planned.push(makeQuery(retrievalQueryFamilies.OFFICIAL_SOURCES, planned.length, `site:topps.com ${quotePhrase(fields.checklist_code)}`, {
      fields: ["checklist_code"],
      reason: "official domain query is preferred over open web summaries"
    }));
    planned.push(makeQuery(retrievalQueryFamilies.OFFICIAL_SOURCES, planned.length, `site:paniniamerica.net ${quotePhrase(fields.checklist_code)}`, {
      fields: ["checklist_code"],
      reason: "official domain query is preferred over open web summaries"
    }));
  }

  if (subject || product || fields.checklist_code) {
    planned.push(makeQuery(retrievalQueryFamilies.EBAY, planned.length, [
      product,
      subject,
      fields.checklist_code,
      fields.serial_number,
      visualParallel
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: ["market_title_reference"],
      reason: "eBay is marketplace reference only and cannot establish ground truth"
    }));
  }

  if (allowOwsFallback && (missingFields.length || weakFields.length)) {
    planned.push(makeQuery(retrievalQueryFamilies.OWS_FALLBACK, planned.length, [
      fields.checklist_code,
      subject,
      product
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: [...missingFields, ...weakFields],
      reason: "OWS fallback is only planned when configured and unresolved fields remain"
    }));
  }

  return planned.filter((query) => query.query);
}
