import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { extractQueryExpansionFields } from "./hybrid-reranker.mjs";
import { retrievalProviderIds, retrievalQueryFamilies } from "./retrieval-contract.mjs";
import { queryForProvider, queryId, quotePhrase, serialDenominator } from "./query-families.mjs";

function subjectText(resolved) {
  if (Array.isArray(resolved.players) && resolved.players.length) return resolved.players.join(" ");
  return resolved.character || "";
}

function productText(resolved) {
  const brand = resolved.brand || resolved.manufacturer;
  const product = resolved.product || "";
  const normalizedProduct = String(product).toLowerCase();
  const normalizedBrand = String(brand || "").toLowerCase();
  const parts = [
    resolved.year,
    brand && normalizedProduct && normalizedProduct.includes(normalizedBrand) ? "" : brand,
    product,
    resolved.set
  ];
  return parts.filter(Boolean).join(" ");
}

function normalizedComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function retrievalContextText(resolved = {}) {
  return String(resolved?.retrieval_context_text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

function catalogProductAnchor(fields = {}) {
  const direct = String(fields.product || fields.set || "").trim();
  if (direct) return direct;

  const brand = String(fields.brand || "").trim();
  if (!brand) return "";
  const manufacturer = String(fields.manufacturer || "").trim();
  const normalizedBrand = normalizedComparableText(brand);
  const normalizedManufacturer = normalizedComparableText(manufacturer);
  if (normalizedManufacturer && normalizedBrand === normalizedManufacturer) return "";

  // A compound brand such as "Topps Finest" is a useful product-family
  // anchor. A bare manufacturer such as "Topps" is not.
  if (normalizedBrand.split(" ").filter(Boolean).length >= 2) return brand;
  return normalizedManufacturer ? brand : "";
}

function normalizedExclusionIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function finalizePlannedQueries(planned = [], excludeSourceFeedbackIds = []) {
  const exclusions = normalizedExclusionIds(excludeSourceFeedbackIds);
  return planned
    .filter((query) => query.query)
    .map((query) => {
      // Formal evaluation supplies only the current source id. Exclude that
      // answer from both catalog and vector retrieval while leaving every
      // other historical directory row reusable. Mark these queries
      // non-cacheable because the shared retrieval cache key intentionally
      // describes the semantic query, not its per-card exclusion scope.
      if (!exclusions.length || ![
        retrievalProviderIds.CATALOG,
        retrievalProviderIds.VISUAL_VECTOR
      ].includes(query.provider_id)) {
        return query;
      }
      return {
        ...query,
        cacheable: false,
        exclude_source_feedback_ids: normalizedExclusionIds([
          ...(Array.isArray(query.exclude_source_feedback_ids)
            ? query.exclude_source_feedback_ids
            : [query.exclude_source_feedback_ids]),
          ...exclusions
        ])
      };
    });
}

function visualParallelText(resolved) {
  return [
    resolved.surface_color,
    resolved.parallel_family,
    resolved.parallel_exact || resolved.parallel,
    resolved.variation
  ].filter(Boolean).join(" ");
}

function printRunDenominatorText(fields = {}) {
  return fields.print_run_denominator
    || fields.numbered_to
    || fields.serial_denominator
    || fields.expected_serial_denominator
    || serialDenominator(fields.print_run_number)
    || serialDenominator(fields.numerical_rarity)
    || serialDenominator(fields.serial_number);
}

function stringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  return text ? [text] : [];
}

function categoryScopes(raw = {}, fields = {}) {
  const categories = [
    fields.category,
    ...stringList(raw.category_candidates),
    ...stringList(raw.secondary_categories)
  ]
    .map((category) => String(category || "").trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(categories)];
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
  serialDenom = "",
  categories = [],
  retrievalContext = ""
} = {}) {
  const categoryExtra = categories.length ? { category_candidates: categories } : {};
  const collectorNumber = fields.collector_number || fields.card_number || "";
  const productAnchor = catalogProductAnchor(fields);
  if (fields.checklist_code || collectorNumber) {
    planned.push(makeQuery(retrievalQueryFamilies.CATALOG_EXACT_CODE, planned.length, [
      fields.checklist_code,
      collectorNumber,
      subject,
      product
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: ["checklist_code", "collector_number", "players", "product"],
      reason: "catalog exact code lookup runs before visual vector recall",
      extra: {
        ...categoryExtra,
        exact_checklist_code: fields.checklist_code || "",
        exact_card_number: collectorNumber,
        exact_subject: subject || "",
        // Exact printed code + subject + product is a stronger identity key
        // than an observed year. Do not let a stats/copyright-year mistake
        // prevent the catalog from returning the candidate that can correct it.
        ignore_observed_year: true,
        exact_product: productAnchor,
        match_count: 30
      }
    }));
  }

  if (fields.year && productAnchor && subject) {
    planned.push(makeQuery(retrievalQueryFamilies.CATALOG_YEAR_PRODUCT_SUBJECT, planned.length, [
      fields.year,
      productAnchor,
      subject
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: ["year", "product", "set", "players"],
      reason: "catalog metadata lookup tests whether a trusted identity candidate exists",
      extra: {
        ...categoryExtra,
        search_text: [fields.year, productAnchor, subject, retrievalContext].filter(Boolean).join(" "),
        exact_subject: subject,
        exact_year: fields.year || "",
        exact_product: productAnchor,
        match_count: 30
      }
    }));
  }

  if (productAnchor || fields.card_name || fields.insert) {
    planned.push(makeQuery(retrievalQueryFamilies.CATALOG_PRODUCT_VOCABULARY, planned.length, [
      fields.year,
      productAnchor,
      fields.card_name || fields.insert
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: ["year", "product", "set", "insert", "card_name"],
      reason: "catalog product vocabulary lookup supplies legal product/card-name support without claiming identity",
      extra: {
        ...categoryExtra,
        lookup_scope: "product_vocabulary",
        search_text: [
          fields.year,
          productAnchor,
          fields.card_name || fields.insert
        ].filter(Boolean).join(" "),
        exact_year: fields.year || "",
        exact_product: productAnchor,
        match_count: 30
      }
    }));
  }

  if (productAnchor && serialDenom) {
    planned.push(makeQuery(retrievalQueryFamilies.CATALOG_PRODUCT_SERIAL_DENOMINATOR, planned.length, [
      productAnchor,
      serialDenom
    ].filter(Boolean).map(quotePhrase).join(" "), {
      fields: ["product", "serial_denominator", "surface_color"],
      reason: "catalog serial denominator narrows legal color/parallel candidates without supplying serial numerator",
      extra: {
        ...categoryExtra,
        exact_subject: subject || "",
        exact_year: fields.year || "",
        exact_product: productAnchor,
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
        ...categoryExtra,
        search_text: [fields.insert || fields.set || fields.subset, subject].filter(Boolean).join(" "),
        exact_subject: subject,
        exact_year: fields.year || "",
        // A model can confuse an insert/set name with the product itself
        // (for example Mega Futures). Set+subject+year should still retrieve a
        // trusted product hierarchy candidate for deterministic arbitration.
        ignore_observed_product: true,
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
  allowOwsFallback = false,
  excludeSourceFeedbackIds = []
} = {}) {
  const retrievalContext = retrievalContextText(resolved);
  const fields = normalizeResolvedFields(resolved);
  const productAnchor = catalogProductAnchor(fields);
  const categories = categoryScopes(resolved, fields);
  const subject = subjectText(fields);
  const product = productText(fields);
  const visualParallel = visualParallelText(fields);
  const serialDenom = printRunDenominatorText(fields);
  const planned = [];

  planned.push(makeQuery(retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY, planned.length, [
    fields.checklist_code,
    subject,
    product,
    fields.collector_number,
    fields.print_run_number || fields.serial_number
  ].filter(Boolean).map(quotePhrase).join(" "), {
    fields: ["checklist_code", "players", "character", "product", "collector_number", "print_run_number", "print_run_denominator", "numbered_to", "serial_number"],
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

  addCatalogFirstQueries(planned, fields, {
    subject,
    product,
    serialDenom,
    categories,
    retrievalContext
  });

  if (includeHybrid) {
    const expansion = extractQueryExpansionFields({ resolved: fields });
    const hybridQuery = [
      expansion.checklist_code,
      expansion.collector_number || fields.card_number,
      expansion.subject,
      expansion.product_candidate,
      expansion.serial_denominator || serialDenom,
      retrievalContext
    ].filter(Boolean).map(quotePhrase).join(" ");
    if (hybridQuery) {
      planned.push(makeQuery(retrievalQueryFamilies.POSTGRES_HYBRID, planned.length, hybridQuery, {
        fields: ["checklist_code", "collector_number", "players", "character", "year", "product", "set", "print_run_denominator", "numbered_to", "serial_number"],
        reason: "hybrid Postgres retrieval recalls identity candidates from exact code, metadata, and full-text without using hidden labels",
        extra: {
          category_candidates: categories,
          search_text: hybridQuery.replace(/"/g, ""),
          exact_checklist_code: fields.checklist_code || "",
          exact_collector_number: fields.collector_number || fields.card_number || "",
          exact_subject: expansion.subject || "",
          exact_year: fields.year || "",
          exact_product: productAnchor,
          match_count: 30
        }
      }));
    }
  }

  addVisualVectorQueries(planned, visualEmbeddings);

  if (!includeExternal) return finalizePlannedQueries(planned, excludeSourceFeedbackIds);

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
      reason: "product plus subject finds official checklist and structured references",
      extra: {
        category_candidates: categories
      }
    }));
  }

  if (product && subject && fields.card_type) {
    planned.push(makeQuery(retrievalQueryFamilies.BRAVE, planned.length, `${quotePhrase(product)} ${quotePhrase(subject)} ${quotePhrase(fields.card_type)}`, {
      fields: ["year", "brand", "product", "set", "players", "character", "card_type"],
      reason: "card type is checked after core identity candidates are recalled",
      extra: {
        category_candidates: categories
      }
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
      fields: ["players", "character", "product", "card_type", "print_run_denominator", "numbered_to", "serial_number", "surface_color", "parallel_family", "parallel_exact", "parallel"],
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
      fields.print_run_number || fields.serial_number,
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

  return finalizePlannedQueries(planned, excludeSourceFeedbackIds);
}
