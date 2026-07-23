import { goldenSemLaunchFields } from "./golden-sem-release.mjs";

export const trustedCatalogSemPromotionSchemaVersion = "trusted-catalog-sem-promotion-v2";

const listFields = new Set(["subject", "special_stamp", "search_optimization"]);
const unconditionalLexicalWriterFields = new Set([
  "language",
  "numerical_rarity",
  "release_variant",
  "special_stamp",
  "grading_info"
]);
const catalogContextLexicalFields = new Set([
  "year",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name",
  "card_number",
  "descriptive_rarity",
  "print_finish"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function valuePresent(value) {
  return asArray(value).some((entry) => cleanText(entry));
}

function comparable(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function comparableValue(value) {
  if (Array.isArray(value)) return [...new Set(value.map(comparable).filter(Boolean))].sort().join("|");
  return comparable(value);
}

function tokens(value) {
  const ignored = new Set(["card", "cards", "dual", "triple", "quad", "and", "the"]);
  return new Set(comparableValue(value).split(/[| ]+/).filter((token) => token && !ignored.has(token)));
}

function tokenAgreement(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

function sourceClass(card = {}) {
  const type = cleanText(card.source?.source_type);
  const metadata = card.source?.source_metadata || {};
  if (/OFFICIAL_CHECKLIST/.test(type) && metadata.corrected_title_used !== true) return "OFFICIAL_CATALOG";
  if (type === "INTERNAL_CORRECTED_TITLE" && metadata.writer_title_batch_id) return "INDEPENDENT_WRITER_CATALOG";
  return "INELIGIBLE";
}

function catalogFields(card = {}) {
  const metadata = card.metadata || {};
  return {
    year: card.season_year,
    ip_sport: card.sport,
    language: metadata.language,
    manufacturer: card.manufacturer,
    product: card.product,
    set: card.set_or_insert || card.subset,
    subject: valuePresent(card.players) ? card.players : metadata.character,
    card_name: metadata.card_name,
    card_number: card.card_number || card.checklist_code,
    descriptive_rarity: metadata.rarity,
    print_finish: card.surface_color,
    serial_denominator: cleanText(card.serial_denominator),
    special_stamp: card.observable_components
  };
}

function sourceFeedbackId(card = {}) {
  return cleanText(card.source?.source_metadata?.source_feedback_id);
}

function queryKey(fields = {}) {
  return `${comparableValue(fields.year)}::${comparableValue(fields.product)}`;
}

function manufacturerKey(fields = {}) {
  return `${comparableValue(fields.year)}::${comparableValue(fields.manufacturer)}`;
}

function productKey(fields = {}) {
  return comparableValue(fields.product);
}

function makeCatalogIndex(cards = []) {
  const byYearProduct = new Map();
  const byYearManufacturer = new Map();
  const byProduct = new Map();
  for (const card of cards) {
    const klass = sourceClass(card);
    if (klass === "INELIGIBLE") continue;
    const fields = catalogFields(card);
    const key = queryKey(fields);
    if (!comparableValue(fields.year) || !comparableValue(fields.product)) continue;
    const entry = { card, fields, source_class: klass };
    const bucket = byYearProduct.get(key) || [];
    bucket.push(entry);
    byYearProduct.set(key, bucket);
    const allProductBucket = byProduct.get(productKey(fields)) || [];
    allProductBucket.push(entry);
    byProduct.set(productKey(fields), allProductBucket);
    const makerKey = manufacturerKey(fields);
    if (comparableValue(fields.manufacturer)) {
      const makerBucket = byYearManufacturer.get(makerKey) || [];
      makerBucket.push(entry);
      byYearManufacturer.set(makerKey, makerBucket);
    }
  }
  return { byYearProduct, byYearManufacturer, byProduct };
}

function candidateScore(query = {}, candidate = {}) {
  if (comparableValue(query.year) !== comparableValue(candidate.year)) return 0;
  const productExact = comparableValue(query.product) === comparableValue(candidate.product);
  const manufacturerExact = comparableValue(query.manufacturer)
    && comparableValue(query.manufacturer) === comparableValue(candidate.manufacturer);
  if (!productExact && !manufacturerExact) return 0;
  const subjectAgreement = tokenAgreement(query.subject, candidate.subject);
  const numberExact = comparableValue(query.card_number)
    && comparableValue(query.card_number) === comparableValue(candidate.card_number);
  const cardNameAgreement = tokenAgreement(query.card_name, candidate.card_name);
  if (subjectAgreement < 0.8 && !numberExact && cardNameAgreement < 0.8) return 0;
  let score = 2 + (productExact ? 2 : 0) + (manufacturerExact ? 1 : 0);
  score += subjectAgreement >= 0.8 ? 4 : 0;
  score += numberExact ? 4 : 0;
  score += cardNameAgreement >= 0.8 ? 2 : 0;
  return score;
}

function titleContainsValue(title, value) {
  const haystack = ` ${comparable(title)} `;
  return asArray(value).every((entry) => {
    const needle = comparable(entry);
    return needle && haystack.includes(` ${needle} `);
  });
}

function titleContainsNumericalRarity(title, value) {
  const target = cleanText(value).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!target) return false;
  return [...cleanText(title).matchAll(/(^|[^0-9])(\d+)\s*\/\s*(\d+)(?=[^0-9]|$)/g)]
    .some((match) => Number(match[2]) === Number(target[1]) && Number(match[3]) === Number(target[2]));
}

function titleContainsGrading(title, value) {
  if (typeof value === "string") return titleContainsValue(title, value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const company = cleanText(value.company);
  const grade = cleanText(value.card_grade || value.auto_grade);
  return Boolean(company && grade && titleContainsValue(title, company) && titleContainsValue(title, grade));
}

function lexicalEvidence(field, title, value, hasCatalogContext) {
  if (!unconditionalLexicalWriterFields.has(field)
    && !(hasCatalogContext && catalogContextLexicalFields.has(field))) return false;
  if (field === "numerical_rarity") return titleContainsNumericalRarity(title, value);
  if (field === "grading_info") return titleContainsGrading(title, value);
  return titleContainsValue(title, value);
}

function bestCandidates(item, catalogIndex) {
  const query = item.parser_suggestion?.fields || {};
  const selfId = cleanText(item.source_feedback_id || item.item_id);
  const contextCandidates = (catalogIndex.byYearProduct.get(queryKey(query)) || [])
    .filter((entry) => sourceFeedbackId(entry.card) !== selfId);
  const productCandidates = (catalogIndex.byProduct.get(productKey(query)) || [])
    .filter((entry) => sourceFeedbackId(entry.card) !== selfId);
  const makerCandidates = (catalogIndex.byYearManufacturer.get(manufacturerKey(query)) || [])
    .filter((entry) => sourceFeedbackId(entry.card) !== selfId);
  const pool = [...new Map([...contextCandidates, ...makerCandidates].map((entry) => [entry.card.id, entry])).values()];
  const candidates = pool.flatMap((entry) => {
    if (sourceFeedbackId(entry.card) === selfId) return [];
    const score = candidateScore(query, entry.fields);
    return score > 0 ? [{ ...entry, score }] : [];
  });
  const bestScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
  return {
    context: productCandidates,
    exact_context: contextCandidates,
    strong: candidates.filter((candidate) => candidate.score === bestScore && bestScore >= 7),
    best_score: bestScore >= 7 ? bestScore : 0
  };
}

function rarityDenominator(value) {
  const match = cleanText(value).match(/(?:^|[^0-9])(?:\d+|#)\s*\/\s*(\d+)(?:[^0-9]|$)/);
  return match ? String(Number(match[1])) : "";
}

function finishColor(value) {
  const colors = [
    "black", "blue", "bronze", "brown", "gold", "green", "orange", "pink", "purple",
    "red", "silver", "teal", "white", "yellow"
  ];
  const valueTokens = tokens(value);
  return colors.find((color) => valueTokens.has(color)) || "";
}

function exactIdentityCandidates(query = {}, candidates = []) {
  return candidates.filter((candidate) => {
    const fields = candidate.fields;
    if (comparableValue(query.year) !== comparableValue(fields.year)) return false;
    if (!comparableValue(query.product)
      || comparableValue(query.product) !== comparableValue(fields.product)) return false;
    const numberExact = comparableValue(query.card_number)
      && comparableValue(query.card_number) === comparableValue(fields.card_number);
    if (!numberExact && tokenAgreement(query.subject, fields.subject) < 0.8) return false;

    const discriminators = [];
    if (valuePresent(query.card_number)) discriminators.push(numberExact);
    if (valuePresent(query.set)) discriminators.push(
      valuePresent(fields.set) && comparableValue(query.set) === comparableValue(fields.set)
    );
    if (valuePresent(query.card_name)) discriminators.push(
      valuePresent(fields.card_name) && tokenAgreement(query.card_name, fields.card_name) >= 0.8
    );
    if (valuePresent(query.numerical_rarity)) {
      const expected = rarityDenominator(query.numerical_rarity);
      discriminators.push(Boolean(expected && expected === cleanText(fields.serial_denominator)));
    }
    if (valuePresent(query.print_finish)) {
      const expected = finishColor(query.print_finish);
      discriminators.push(Boolean(expected && expected === finishColor(fields.print_finish)));
    }
    if (valuePresent(query.special_stamp)) {
      const candidateStamps = tokens(fields.special_stamp);
      discriminators.push([...tokens(query.special_stamp)].every((stamp) => candidateStamps.has(stamp)));
    }
    return discriminators.length > 0 && discriminators.every(Boolean);
  });
}

function catalogEvidence(field, suggestion, candidates) {
  const withField = candidates.filter((candidate) => valuePresent(candidate.fields[field]));
  if (!withField.length) return { supported: false, conflict: false, evidence: [] };
  const values = new Map();
  for (const candidate of withField) {
    const key = comparableValue(candidate.fields[field]);
    if (!key) continue;
    const bucket = values.get(key) || [];
    bucket.push(candidate);
    values.set(key, bucket);
  }
  const wanted = comparableValue(suggestion);
  const matching = values.get(wanted) || [];
  const conflict = [...values.keys()].some((value) => value !== wanted);
  return {
    supported: matching.length > 0 && !conflict,
    conflict,
    evidence: matching.map((candidate) => (
      `trusted-catalog:${candidate.source_class.toLowerCase()}:${candidate.card.id}`
    ))
  };
}

function reviewedField(field, suggestion, { title, candidates }) {
  const blankValue = listFields.has(field) ? [] : "";
  if (!valuePresent(suggestion)) {
    return {
      field,
      parser_suggestion: suggestion ?? blankValue,
      reviewed_value: blankValue,
      reviewed_status: "UNKNOWN",
      evidence_sources: [],
      reviewer_notes: "Writer title does not establish this SEM field."
    };
  }
  const taxonomyContext = candidates.exact_context.length ? candidates.exact_context : candidates.context;
  const identityTaxonomyContext = candidates.strong.length ? candidates.strong : taxonomyContext;
  const catalogCandidates = field === "year"
    ? candidates.exact_context
    : (["ip_sport", "manufacturer"].includes(field)
      ? identityTaxonomyContext
      : (field === "product" ? taxonomyContext : candidates.strong));
  const catalog = catalogEvidence(field, suggestion, catalogCandidates);
  if (lexicalEvidence(field, title, suggestion, candidates.context.length > 0)) {
    return {
      field,
      parser_suggestion: suggestion,
      reviewed_value: suggestion,
      reviewed_status: "CONFIRMED",
      evidence_sources: ["writer-reviewed-title:exact-bounded-span"],
      reviewer_notes: "Mechanically verified exact value in the writer-reviewed title."
    };
  }
  if (catalog.supported) {
    return {
      field,
      parser_suggestion: suggestion,
      reviewed_value: suggestion,
      reviewed_status: "CONFIRMED",
      evidence_sources: catalog.evidence,
      reviewer_notes: "Independently corroborated by the highest-scoring trusted catalog identity."
    };
  }
  return {
    field,
    parser_suggestion: suggestion,
    reviewed_value: suggestion,
    reviewed_status: "UNREVIEWED",
    evidence_sources: [],
    reviewer_notes: catalog.conflict
      ? "Trusted catalog candidates conflict; human confirmation required."
      : "No independent trusted evidence covers this parser suggestion."
  };
}

export function promoteGoldenSemWithTrustedCatalog(packet = {}, snapshot = {}, {
  now = () => new Date(),
  reviewer = "TRUSTED_CATALOG_PROMOTION_V1"
} = {}) {
  const generatedAt = now().toISOString();
  const catalogIndex = makeCatalogIndex(snapshot.cards || []);
  const reviewedCatalogByFeedback = new Map((snapshot.cards || []).flatMap((card) => {
    const feedbackId = sourceFeedbackId(card);
    return card.review_status === "REVIEWED_INTERNAL" && feedbackId ? [[feedbackId, card.id]] : [];
  }));
  const items = (packet.items || []).map((item) => {
    const candidates = bestCandidates(item, catalogIndex);
    const exactIdentityMatches = exactIdentityCandidates(
      item.parser_suggestion?.fields || {},
      candidates.strong
    );
    const title = cleanText(item.sealed_reference?.writer_reviewed_title);
    const sealedSourceCandidateId = reviewedCatalogByFeedback.get(
      cleanText(item.source_feedback_id || item.item_id)
    );
    const acceptedCandidateIds = [...new Set(
      exactIdentityMatches.map((candidate) => candidate.card.id).filter(Boolean)
    )];
    const fields = Object.fromEntries(goldenSemLaunchFields.map((field) => [
      field,
      reviewedField(field, item.parser_suggestion?.fields?.[field], { title, candidates })
    ]));
    const unresolved = Object.values(fields).filter((field) => field.reviewed_status === "UNREVIEWED");
    return {
      ...item,
      retrieval_ground_truth: {
        accepted_candidate_ids: acceptedCandidateIds,
        accepted_identity_ids: item.card_identity_id ? [item.card_identity_id] : [],
        sealed_source_candidate_ids: sealedSourceCandidateId ? [sealedSourceCandidateId] : [],
        retrieval_evaluable: Boolean(acceptedCandidateIds.length || item.card_identity_id),
        source: "INDEPENDENT_TRUSTED_CATALOG_IDENTITIES"
      },
      trusted_catalog_promotion: {
        schema_version: trustedCatalogSemPromotionSchemaVersion,
        best_candidate_score: candidates.best_score,
        best_candidate_count: candidates.strong.length,
        exact_identity_candidate_count: exactIdentityMatches.length,
        catalog_context_candidate_count: candidates.context.length,
        exact_catalog_context_candidate_count: candidates.exact_context.length,
        source_classes: [...new Set([...candidates.context, ...candidates.exact_context, ...candidates.strong]
          .map((candidate) => candidate.source_class))].sort(),
        unresolved_fields: unresolved.map((field) => field.field)
      },
      reviewed_ground_truth: {
        review_status: unresolved.length ? "PARTIALLY_PROMOTED" : "APPROVED",
        reviewed_by: unresolved.length ? "" : reviewer,
        reviewed_at: unresolved.length ? "" : generatedAt,
        fields
      }
    };
  });
  const unresolvedItems = items.filter((item) => item.reviewed_ground_truth.review_status !== "APPROVED");
  const auditItems = items.filter((item) => (
    item.recognition_input?.images?.length && item.reviewed_ground_truth.review_status === "APPROVED"
  ));
  const perField = Object.fromEntries(goldenSemLaunchFields.map((field) => {
    const statuses = { CONFIRMED: 0, UNKNOWN: 0, UNREVIEWED: 0 };
    for (const item of items) statuses[item.reviewed_ground_truth.fields[field].reviewed_status] += 1;
    return [field, statuses];
  }));
  return {
    packet: {
      ...packet,
      dataset_id: `${packet.dataset_id}-trusted-catalog-promoted`,
      generated_at: generatedAt,
      evaluation_truth_policy: {
        field_ground_truth_class: "TRUSTED_CATALOG_PROMOTED_FIELD_GROUND_TRUTH",
        formal_oracle_eligible: true,
        unresolved_fields_denominator_eligible: false
      },
      promotion_contract: {
        schema_version: trustedCatalogSemPromotionSchemaVersion,
        same_feedback_self_corroboration_forbidden: true,
        same_feedback_catalog_ids_are_provenance_only: true,
        title_derived_catalog_fields_are_not_intrinsically_ground_truth: true,
        identity_requires_year_product_and_subject_or_card_number_agreement: true,
        retrieval_identity_requires_all_present_discriminators: true,
        physical_instance_catalog_copy_forbidden: true,
        unresolved_nonblank_fields_require_human_review: true
      },
      summary: {
        ...packet.summary,
        approved_item_count: items.length - unresolvedItems.length,
        unresolved_item_count: unresolvedItems.length,
        reviewed_item_count: items.length - unresolvedItems.length
      },
      items
    },
    audit_packet: {
      ...packet,
      dataset_id: `${packet.dataset_id}-trusted-catalog-promoted-image-backed`,
      generated_at: generatedAt,
      evaluation_truth_policy: {
        field_ground_truth_class: "TRUSTED_CATALOG_PROMOTED_FIELD_GROUND_TRUTH",
        formal_oracle_eligible: true,
        unresolved_fields_denominator_eligible: false
      },
      promotion_contract: {
        schema_version: trustedCatalogSemPromotionSchemaVersion,
        same_feedback_self_corroboration_forbidden: true,
        same_feedback_catalog_ids_are_provenance_only: true,
        title_derived_catalog_fields_are_not_intrinsically_ground_truth: true,
        identity_requires_year_product_and_subject_or_card_number_agreement: true,
        retrieval_identity_requires_all_present_discriminators: true,
        physical_instance_catalog_copy_forbidden: true,
        unresolved_nonblank_fields_require_human_review: true
      },
      summary: {
        ...packet.summary,
        source_item_count: auditItems.length,
        review_item_count: auditItems.length,
        with_image_count: auditItems.length,
        approved_item_count: auditItems.length,
        reviewed_item_count: auditItems.length
      },
      items: auditItems
    },
    report: {
      schema_version: trustedCatalogSemPromotionSchemaVersion,
      generated_at: generatedAt,
      source_item_count: items.length,
      image_backed_item_count: items.filter((item) => item.recognition_input?.images?.length).length,
      approved_item_count: items.length - unresolvedItems.length,
      approved_image_backed_item_count: items.filter((item) => (
        item.recognition_input?.images?.length && item.reviewed_ground_truth.review_status === "APPROVED"
      )).length,
      unresolved_item_count: unresolvedItems.length,
      independently_matched_item_count: items.filter((item) => item.trusted_catalog_promotion.best_candidate_count > 0).length,
      independently_field_matched_item_count: items.filter((item) => item.trusted_catalog_promotion.best_candidate_count > 0).length,
      exact_identity_matched_item_count: items.filter((item) => (
        item.trusted_catalog_promotion.exact_identity_candidate_count > 0
      )).length,
      retrieval_evaluable_item_count: items.filter((item) => item.retrieval_ground_truth.retrieval_evaluable).length,
      self_only_retrieval_truth_item_count: items.filter((item) => (
        item.retrieval_ground_truth.sealed_source_candidate_ids.length > 0
        && !item.retrieval_ground_truth.retrieval_evaluable
      )).length,
      catalog_context_item_count: items.filter((item) => item.trusted_catalog_promotion.catalog_context_candidate_count > 0).length,
      per_field: perField
    },
    review_worklist: {
      schema_version: "trusted-catalog-sem-conflict-worklist-v1",
      generated_at: generatedAt,
      item_count: unresolvedItems.length,
      items: unresolvedItems.map((item) => ({
        item_id: item.item_id,
        source_feedback_id: item.source_feedback_id,
        image_count: item.recognition_input?.images?.length || 0,
        unresolved_fields: item.trusted_catalog_promotion.unresolved_fields.map((field) => ({
          field,
          parser_suggestion: item.reviewed_ground_truth.fields[field].parser_suggestion,
          reason: item.reviewed_ground_truth.fields[field].reviewer_notes
        }))
      }))
    }
  };
}
