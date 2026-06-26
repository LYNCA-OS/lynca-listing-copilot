import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { extractQueryExpansionFields } from "./hybrid-reranker.mjs";
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
  reason = "",
  extra = {}
} = {}) {
  return {
    query_id: queryId(family, index),
    family,
    provider_id: queryForProvider(family),
    query,
    fields,
    reason,
    ...extra
  };
}

function normalizeEmbeddingRole(role) {
  const text = String(role || "").trim().toLowerCase();
  if (text.includes("back")) return "back_global";
  if (text.includes("front")) return "front_global";
  if (text.includes("surface")) return "parallel_surface";
  if (text.includes("subject")) return "subject_layout";
  return text || "full_card_global";
}

function visualEmbeddingItems(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.features)) return input.features;
  return [];
}

function validEmbeddingArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((number) => Number.isFinite(Number(number)));
}

function addVisualVectorQueries(planned, visualEmbeddings) {
  visualEmbeddingItems(visualEmbeddings).forEach((feature) => {
    if (!feature || feature.status === "UNAVAILABLE" || feature.status === "DISABLED") return;
    if (!validEmbeddingArray(feature.embedding)) return;

    const embeddingRole = normalizeEmbeddingRole(feature.embedding_role || feature.role);
    const modelId = String(feature.model_id || "").trim();
    const modelRevision = String(feature.model_revision || "").trim();
    const preprocessingVersion = String(feature.preprocessing_version || "").trim();
    const dimensions = Number(feature.dimensions || feature.embedding.length);

    planned.push(makeQuery(retrievalQueryFamilies.VISUAL_VECTOR, planned.length, [
      "visual_vector",
      embeddingRole,
      modelId,
      modelRevision,
      feature.image_id || ""
    ].filter(Boolean).join(":"), {
      fields: ["visual_identity_candidate"],
      reason: "visual embeddings recall candidate card identities but never establish ground truth alone",
      extra: {
        cacheable: false,
        embedding: feature.embedding.map(Number),
        embedding_role: embeddingRole,
        image_role: feature.role || "",
        image_id: feature.image_id || "",
        asset_id: feature.asset_id || "",
        source_feedback_id: feature.source_feedback_id || "",
        physical_card_id: feature.physical_card_id || "",
        physical_instance_group_id: feature.physical_instance_group_id || "",
        content_sha256: feature.content_sha256 || "",
        perceptual_hash: feature.perceptual_hash || feature.phash || "",
        exclude_asset_ids: feature.asset_id ? [feature.asset_id] : [],
        exclude_source_feedback_ids: feature.source_feedback_id ? [feature.source_feedback_id] : [],
        exclude_physical_card_ids: feature.physical_card_id ? [feature.physical_card_id] : [],
        exclude_physical_instance_group_ids: feature.physical_instance_group_id ? [feature.physical_instance_group_id] : [],
        exclude_content_sha256: feature.content_sha256 ? [feature.content_sha256] : [],
        exclude_reference_image_ids: feature.reference_image_id ? [feature.reference_image_id] : [],
        exclude_identity_ids: feature.identity_id ? [feature.identity_id] : [],
        model_id: modelId,
        model_revision: modelRevision,
        preprocessing_version: preprocessingVersion,
        dimensions
      }
    }));
  });
}

function addCatalogFirstQueries(planned, fields, {
  subject = "",
  product = "",
  serialDenom = ""
} = {}) {
  if (fields.checklist_code || fields.collector_number) {
    planned.push(makeQuery(retrievalQueryFamilies.CATALOG_EXACT_CODE, planned.length, [
      fields.checklist_code,
      fields.collector_number,
      subject,
      product
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: ["checklist_code", "collector_number", "players", "product"],
      reason: "catalog exact code lookup runs before visual vector recall",
      extra: {
        exact_checklist_code: fields.checklist_code || "",
        exact_card_number: fields.collector_number || "",
        exact_subject: subject || "",
        exact_year: fields.year || "",
        exact_product: fields.product || fields.set || "",
        match_count: 30
      }
    }));
  }

  if (fields.year && (fields.product || fields.set) && subject) {
    planned.push(makeQuery(retrievalQueryFamilies.CATALOG_YEAR_PRODUCT_SUBJECT, planned.length, [
      fields.year,
      fields.product || fields.set,
      subject
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: ["year", "product", "set", "players"],
      reason: "catalog metadata lookup tests whether a trusted identity candidate exists",
      extra: {
        exact_subject: subject,
        exact_year: fields.year || "",
        exact_product: fields.product || fields.set || "",
        match_count: 30
      }
    }));
  }

  if ((fields.product || fields.set) && serialDenom) {
    planned.push(makeQuery(retrievalQueryFamilies.CATALOG_PRODUCT_SERIAL_DENOMINATOR, planned.length, [
      fields.product || fields.set,
      serialDenom
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: ["product", "serial_denominator", "surface_color"],
      reason: "catalog serial denominator narrows legal color/parallel candidates without supplying serial numerator",
      extra: {
        exact_subject: subject || "",
        exact_year: fields.year || "",
        exact_product: fields.product || fields.set || "",
        exact_serial_denominator: serialDenom,
        match_count: 30
      }
    }));
  }

  if ((fields.insert || fields.set || fields.subset) && subject) {
    planned.push(makeQuery(retrievalQueryFamilies.CATALOG_SET_SUBJECT, planned.length, [
      fields.insert || fields.set || fields.subset,
      subject
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: ["set", "insert", "subset", "players"],
      reason: "catalog set/insert plus subject handles cards without exact card code",
      extra: {
        search_text: [fields.insert || fields.set || fields.subset, subject].filter(Boolean).join(" "),
        exact_subject: subject,
        exact_year: fields.year || "",
        exact_product: fields.product || fields.set || "",
        match_count: 30
      }
    }));
  }
}

export function planRetrievalQueries({
  resolved = {},
  missingFields = [],
  weakFields = [],
  visualEmbeddings = [],
  includeExternal = true,
  includeHybrid = false,
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

  addCatalogFirstQueries(planned, fields, { subject, product, serialDenom });

  if (includeHybrid) {
    const expansion = extractQueryExpansionFields({ resolved: fields });
    const hybridQuery = [
      expansion.checklist_code,
      expansion.collector_number,
      expansion.subject,
      expansion.product_candidate,
      expansion.serial_denominator
    ].filter(Boolean).map(quotePhrase).join(" ");
    if (hybridQuery) {
      planned.push(makeQuery(retrievalQueryFamilies.POSTGRES_HYBRID, planned.length, hybridQuery, {
        fields: ["checklist_code", "collector_number", "players", "character", "year", "product", "set", "serial_number"],
        reason: "hybrid Postgres retrieval recalls identity candidates from exact code, metadata, and full-text without using hidden labels",
        extra: {
          search_text: hybridQuery.replace(/"/g, ""),
          exact_checklist_code: fields.checklist_code || "",
          exact_collector_number: fields.collector_number || "",
          exact_subject: expansion.subject || "",
          exact_year: fields.year || "",
          exact_product: fields.product || fields.set || "",
          match_count: 30
        }
      }));
    }
  }

  addVisualVectorQueries(planned, visualEmbeddings);

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
