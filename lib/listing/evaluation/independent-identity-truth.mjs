import crypto from "node:crypto";

export const independentIdentityTruthSchemaVersion = "independent-identity-truth-v2";

export const independentIdentityFields = Object.freeze([
  "year",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_number",
  "print_finish",
  "serial_denominator"
]);

const confirmedStatuses = new Set(["CONFIRMED", "APPROVED"]);

function clean(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizedSourceType(card = {}) {
  return clean(card.source?.source_type).replaceAll(" ", "_").toUpperCase();
}

function sourceFeedbackId(card = {}) {
  return clean(card.source?.source_metadata?.source_feedback_id);
}

function sourceClass(card = {}) {
  const type = normalizedSourceType(card);
  if (type.endsWith("_OFFICIAL_CHECKLIST")) return "OFFICIAL_CATALOG";
  if (type === "INTERNAL_CORRECTED_TITLE" && card.source?.source_metadata?.writer_title_batch_id) {
    return "INDEPENDENT_WRITER_CATALOG";
  }
  return "INELIGIBLE";
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
}

function tokenSet(value) {
  return new Set(asArray(value).flatMap((entry) => clean(entry).split(" ")).filter(Boolean));
}

function tokenAgreement(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size);
}

function same(left, right) {
  return Boolean(clean(left) && clean(left) === clean(right));
}

function catalogFields(card = {}) {
  return {
    year: card.season_year || "",
    manufacturer: card.manufacturer || "",
    product: card.product || "",
    set: card.set_or_insert || card.subset || "",
    subject: card.players?.length ? card.players : (card.metadata?.character || []),
    card_number: card.card_number || card.checklist_code || "",
    print_finish: card.surface_color || "",
    serial_denominator: card.serial_denominator || card.numerical_rarity?.denominator || ""
  };
}

export function canonicalIdentityId(fields = {}) {
  const identity = independentIdentityFields.map((field) => {
    const value = Array.isArray(fields[field])
      ? [...new Set(fields[field].map(clean).filter(Boolean))].sort()
      : clean(fields[field]);
    return [field, value];
  });
  return `card_identity:${crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function itemFields(item = {}) {
  const reviewed = item.reviewed_ground_truth?.fields || {};
  const parser = item.parser_suggestion?.fields || {};
  return Object.fromEntries(independentIdentityFields.map((field) => {
    const record = reviewed[field];
    const reviewedValue = record && typeof record === "object" && !Array.isArray(record)
      ? record.reviewed_value
      : record;
    return [field, reviewedValue || parser[field] || ""];
  }));
}

function scoreCandidate(query = {}, candidate = {}) {
  const agreements = {
    year: same(query.year, candidate.year),
    manufacturer: same(query.manufacturer, candidate.manufacturer),
    product: same(query.product, candidate.product),
    set: same(query.set, candidate.set),
    subject: tokenAgreement(query.subject, candidate.subject),
    card_number: same(query.card_number, candidate.card_number),
    print_finish: tokenAgreement(query.print_finish, candidate.print_finish)
  };
  const productOverlap = tokenAgreement(query.product, candidate.product);
  // This is a review-queue recall policy, never an automatic truth policy.
  // Broad proposals reduce reviewer search time; only an independently
  // attested label can enter an evaluation denominator.
  const identityAnchor = agreements.card_number || agreements.subject >= 0.5;
  if (!identityAnchor || !agreements.year || (!agreements.product && productOverlap < 0.3)) return null;
  const score = (agreements.card_number ? 6 : 0)
    + agreements.subject * 5
    + (agreements.product ? 4 : productOverlap * 2)
    + (agreements.year ? 3 : 0)
    + (agreements.set ? 2 : 0)
    + (agreements.manufacturer ? 1 : 0)
    + (agreements.print_finish >= 0.8 ? 1 : 0);
  return { score: Number(score.toFixed(3)), agreements };
}

function partitionMap(manifest = {}) {
  return new Map(Object.entries(manifest.partitions || {}).flatMap(([partition, ids]) => (
    (ids || []).map((id) => [String(id), partition])
  )));
}

function validExistingTruth(item = {}, catalogById = new Map()) {
  const truth = item.retrieval_ground_truth || {};
  if (truth.retrieval_evaluable !== true) return [];
  const selfId = clean(item.source_feedback_id || item.item_id);
  return (truth.accepted_candidate_ids || []).filter((id) => {
    const card = catalogById.get(id);
    return card && sourceClass(card) !== "INELIGIBLE" && sourceFeedbackId(card) !== selfId;
  });
}

export function validateIndependentIdentityLabel(label = {}, { item = {}, catalogById = new Map() } = {}) {
  const errors = [];
  if (!confirmedStatuses.has(String(label.status || "").toUpperCase())) errors.push("LABEL_NOT_CONFIRMED");
  if (!label.canonical_identity_id) errors.push("CANONICAL_IDENTITY_ID_MISSING");
  if (!label.source?.source_id) errors.push("SOURCE_ID_MISSING");
  if (label.source?.independent_from_system_under_test !== true) errors.push("SOURCE_NOT_INDEPENDENT");
  if (!label.source?.source_version) errors.push("SOURCE_VERSION_MISSING");
  if (!label.reviewed_by || !label.reviewed_at) errors.push("REVIEW_ATTESTATION_MISSING");
  const writerTruth = label.source?.source_type === "REVIEWED_WRITER_TITLE";
  const candidate = label.source_candidate_id ? catalogById.get(label.source_candidate_id) : null;
  if (writerTruth) {
    if (label.source?.sealed_from_system !== true) errors.push("WRITER_TRUTH_NOT_SEALED");
    if (clean(label.source?.source_id) !== clean(item.source_feedback_id || item.item_id)) errors.push("WRITER_TRUTH_SOURCE_MISMATCH");
    if (label.source_candidate_id) errors.push("WRITER_TRUTH_MUST_NOT_BE_OWNED_BY_CANDIDATE");
  } else {
    if (!label.source_candidate_id) errors.push("SOURCE_CANDIDATE_ID_MISSING");
    if (!candidate) errors.push("CATALOG_IDENTITY_NOT_FOUND");
    if (candidate && sourceClass(candidate) === "INELIGIBLE") errors.push("CATALOG_SOURCE_INELIGIBLE");
    if (candidate && canonicalIdentityId(catalogFields(candidate)) !== label.canonical_identity_id) errors.push("CANONICAL_IDENTITY_MISMATCH");
    if (candidate && sourceFeedbackId(candidate) === clean(item.source_feedback_id || item.item_id)) errors.push("SAME_FEEDBACK_SELF_CORROBORATION");
  }
  const missingFields = independentIdentityFields.filter((field) => !Object.hasOwn(label.fields || {}, field));
  if (missingFields.length) errors.push(`IDENTITY_FIELD_KEYS_MISSING:${missingFields.join(",")}`);
  if (!clean(label.fields?.year) || !clean(label.fields?.product)) errors.push("YEAR_OR_PRODUCT_MISSING");
  if (!clean(label.fields?.card_number) && !asArray(label.fields?.subject).some((value) => clean(value))) {
    errors.push("IDENTITY_ANCHOR_MISSING");
  }
  if (canonicalIdentityId(label.fields) !== label.canonical_identity_id) errors.push("LABEL_FIELDS_IDENTITY_MISMATCH");
  return { valid: errors.length === 0, errors };
}

function reviewedField(item = {}, field) {
  const record = item.reviewed_ground_truth?.fields?.[field];
  if (!record || clean(record.reviewed_status).toUpperCase() !== "CONFIRMED") return "";
  return record.reviewed_value ?? "";
}

function serialDenominator(title = "") {
  const matches = [...String(title).matchAll(/(?:^|\s)(?:\d+|#)\s*\/\s*(\d{1,6})(?=\s|$|[),.-])/g)];
  return matches.at(-1)?.[1] || "";
}

function titleVersion(title = "") {
  return `sha256:${crypto.createHash("sha256").update(String(title).normalize("NFKC").trim()).digest("hex")}`;
}

export function promoteSealedWriterIdentityTruth(reviewPacket = {}, dataset = {}, {
  generatedAt = new Date().toISOString(),
  manualImageLabels = {}
} = {}) {
  const datasetById = new Map((dataset.items || []).map((item) => [item.item_id, item]));
  const items = (reviewPacket.items || []).map((review) => {
    const item = datasetById.get(review.item_id) || {};
    const title = item.sealed_reference?.writer_reviewed_title || review.sealed_reference?.writer_reviewed_title || "";
    const manual = manualImageLabels[review.item_id] || {};
    const base = {
      year: reviewedField(item, "year") || review.observed_identity_fields?.year || "",
      manufacturer: reviewedField(item, "manufacturer") || review.observed_identity_fields?.manufacturer || "",
      product: reviewedField(item, "product") || review.observed_identity_fields?.product || "",
      set: reviewedField(item, "set") || review.observed_identity_fields?.set || "",
      subject: reviewedField(item, "subject") || review.observed_identity_fields?.subject || [],
      card_number: reviewedField(item, "card_number") || review.observed_identity_fields?.card_number || "",
      print_finish: reviewedField(item, "print_finish") || review.observed_identity_fields?.print_finish || "",
      serial_denominator: serialDenominator(title)
    };
    const fields = { ...base, ...(manual.fields || {}) };
    const anchored = clean(fields.year) && clean(fields.product)
      && (clean(fields.card_number) || asArray(fields.subject).some((value) => clean(value)));
    const discriminated = clean(fields.card_number) || clean(fields.set) || clean(fields.print_finish) || clean(fields.serial_denominator);
    if (!anchored || !discriminated || item.sealed_reference?.title_is_reviewed_ground_truth !== true
      || item.sealed_reference?.title_visible_to_recognition !== false) return review;
    return {
      ...review,
      label: {
        status: "CONFIRMED",
        canonical_identity_id: canonicalIdentityId(fields),
        source_candidate_id: null,
        fields,
        source: {
          source_id: item.source_feedback_id || item.item_id,
          source_type: "REVIEWED_WRITER_TITLE",
          source_version: titleVersion(title),
          independent_from_system_under_test: true,
          sealed_from_system: true,
          image_attestation: manual.attestation || null
        },
        reviewed_by: manual.reviewed_by || "SEALED_WRITER_GT_PROJECTION_V1",
        reviewed_at: manual.reviewed_at || item.reviewed_ground_truth?.reviewed_at || generatedAt
      },
      review_lane: "CONFIRMED",
      candidate_proposals_are_ground_truth: false
    };
  });
  return { ...reviewPacket, schema_version: independentIdentityTruthSchemaVersion, generated_at: generatedAt, items };
}

export function buildIndependentIdentityReviewPacket(packet = {}, manifest = {}, catalog = {}, {
  generatedAt = new Date().toISOString(),
  maxCandidates = 5,
  sourceVersion = catalog.generated_at || catalog.schema_version || "unknown"
} = {}) {
  const partitions = partitionMap(manifest);
  const catalogRows = (catalog.cards || []).filter((card) => sourceClass(card) !== "INELIGIBLE");
  const catalogById = new Map(catalogRows.map((card) => [card.id, card]));
  const catalogEntries = catalogRows.map((card) => ({ card, fields: catalogFields(card) }));
  const catalogByYearSubjectToken = new Map();
  const catalogByYearCardNumber = new Map();
  for (const entry of catalogEntries) {
    const year = clean(entry.fields.year);
    if (!year) continue;
    for (const token of tokenSet(entry.fields.subject)) {
      const key = `${year}::${token}`;
      const bucket = catalogByYearSubjectToken.get(key) || [];
      bucket.push(entry);
      catalogByYearSubjectToken.set(key, bucket);
    }
    const cardNumber = clean(entry.fields.card_number);
    if (cardNumber) {
      const key = `${year}::${cardNumber}`;
      const bucket = catalogByYearCardNumber.get(key) || [];
      bucket.push(entry);
      catalogByYearCardNumber.set(key, bucket);
    }
  }
  const scopedItems = (packet.items || []).filter((item) => ["development", "validation"].includes(partitions.get(item.item_id)));
  const items = scopedItems.map((item) => {
    const partition = partitions.get(item.item_id);
    const query = itemFields(item);
    const selfId = clean(item.source_feedback_id || item.item_id);
    const existing = validExistingTruth(item, catalogById);
    const year = clean(query.year);
    const proposalPool = [...new Map([
      ...[...tokenSet(query.subject)].flatMap((token) => catalogByYearSubjectToken.get(`${year}::${token}`) || []),
      ...(catalogByYearCardNumber.get(`${year}::${clean(query.card_number)}`) || [])
    ].map((entry) => [entry.card.id, entry])).values()];
    const proposals = proposalPool.flatMap(({ card, fields: candidateFields }) => {
      if (sourceFeedbackId(card) === selfId) return [];
      const scored = scoreCandidate(query, candidateFields);
      if (!scored) return [];
      return [{
        canonical_identity_id: canonicalIdentityId(candidateFields),
        source_candidate_id: card.id,
        fields: candidateFields,
        source: {
          source_id: card.source?.id || card.id,
          source_type: normalizedSourceType(card),
          source_class: sourceClass(card),
          source_version: sourceVersion,
          independent_from_system_under_test: true,
          source_feedback_id: card.source?.source_metadata?.source_feedback_id || null
        },
        score: scored.score,
        agreements: scored.agreements
      }];
    }).sort((left, right) => right.score - left.score || left.source_candidate_id.localeCompare(right.source_candidate_id))
      .slice(0, maxCandidates);
    const accepted = existing.map((id) => proposals.find((candidate) => candidate.source_candidate_id === id)
      || (() => {
        const card = catalogById.get(id);
        const fields = catalogFields(card);
        return {
          canonical_identity_id: canonicalIdentityId(fields),
          source_candidate_id: id,
          fields,
          source: {
            source_id: card.source?.id || id,
            source_type: normalizedSourceType(card),
            source_class: sourceClass(card),
            source_version: sourceVersion,
            independent_from_system_under_test: true,
            source_feedback_id: card.source?.source_metadata?.source_feedback_id || null
          }
        };
      })());
    return {
      item_id: item.item_id,
      source_feedback_id: item.source_feedback_id,
      partition,
      recognition_input: item.recognition_input,
      sealed_reference: item.sealed_reference,
      observed_identity_fields: query,
      label: accepted.length ? {
        status: "CONFIRMED",
        canonical_identity_id: accepted[0].canonical_identity_id,
        source_candidate_id: accepted[0].source_candidate_id,
        fields: accepted[0].fields,
        source: accepted[0].source,
        reviewed_by: "TRUSTED_CATALOG_PROMOTION_V2",
        reviewed_at: packet.generated_at || generatedAt
      } : {
        status: "UNREVIEWED",
        canonical_identity_id: null,
        source_candidate_id: null,
        fields: Object.fromEntries(independentIdentityFields.map((field) => [field, query[field]])),
        source: null,
        reviewed_by: null,
        reviewed_at: null
      },
      candidate_proposals: proposals,
      review_lane: accepted.length
        ? "CONFIRMED"
        : (proposals.length ? "VERIFY_INDEPENDENT_CANDIDATE" : "EXTERNAL_IDENTITY_RESEARCH"),
      candidate_proposals_are_ground_truth: false
    };
  });
  const confirmed = items.filter((item) => item.label.status === "CONFIRMED");
  const counts = Object.fromEntries(["development", "validation"].map((partition) => {
    const total = items.filter((item) => item.partition === partition).length;
    const confirmedCount = confirmed.filter((item) => item.partition === partition).length;
    const target = partition === "development" ? Math.min(150, total) : Math.min(37, total);
    return [partition, {
      total,
      confirmed: confirmedCount,
      target,
      gap: Math.max(0, target - confirmedCount),
      proposed_candidate_coverage: items.filter((item) => item.partition === partition && item.candidate_proposals.length).length
    }];
  }));
  return {
    schema_version: independentIdentityTruthSchemaVersion,
    generated_at: generatedAt,
    policy: {
      same_feedback_self_corroboration_forbidden: true,
      system_generated_candidates_are_labels: false,
      candidate_proposals_require_independent_review: true,
      holdout_excluded: true,
      retrieval_tuning_allowed: false
    },
    summary: { ...counts, gate_passed: counts.development.confirmed >= 100 && counts.validation.confirmed >= 30 },
    items
  };
}

export function auditIndependentIdentityReviewPacket(reviewPacket = {}, catalog = {}) {
  const catalogById = new Map((catalog.cards || []).map((card) => [card.id, card]));
  const validated = (reviewPacket.items || []).map((item) => {
    const pending = !confirmedStatuses.has(String(item.label?.status || "").toUpperCase());
    return {
      item_id: item.item_id,
      partition: item.partition,
      pending,
      ...(pending
        ? { valid: false, errors: [] }
        : validateIndependentIdentityLabel(item.label, { item, catalogById }))
    };
  });
  const counts = Object.fromEntries(["development", "validation"].map((partition) => {
    const rows = validated.filter((row) => row.partition === partition);
    return [partition, {
      total: rows.length,
      valid: rows.filter((row) => row.valid).length,
      pending: rows.filter((row) => row.pending).length,
      invalid_confirmed: rows.filter((row) => !row.pending && !row.valid).length
    }];
  }));
  return {
    schema_version: "independent-identity-truth-audit-v1",
    counts,
    gate: {
      development_minimum: 100,
      development_target: 150,
      validation_minimum: 30,
      passed: counts.development.valid >= 100 && counts.validation.valid >= 30
    },
    invalid_labels: validated.filter((row) => !row.pending && !row.valid),
    pending_labels: validated.filter((row) => row.pending).map(({ item_id, partition }) => ({ item_id, partition }))
  };
}

export function applyIndependentIdentityLabels(dataset = {}, reviewPacket = {}, catalog = {}) {
  const audit = auditIndependentIdentityReviewPacket(reviewPacket, catalog);
  if (audit.invalid_labels.length) {
    throw new Error(`independent identity labels contain ${audit.invalid_labels.length} invalid confirmed label(s)`);
  }
  const reviewById = new Map((reviewPacket.items || []).map((item) => [item.item_id, item]));
  const scopedItems = (dataset.items || []).flatMap((item) => {
    const review = reviewById.get(item.item_id);
    if (!review) return [];
    const accepted = confirmedStatuses.has(String(review.label?.status || "").toUpperCase());
    return [{
      ...item,
      evaluation_partition: review.partition,
      retrieval_ground_truth: accepted ? {
        accepted_candidate_ids: review.label.source_candidate_id ? [review.label.source_candidate_id] : [],
        accepted_identity_ids: [review.label.canonical_identity_id],
        identity_fields: review.label.fields,
        sealed_source_candidate_ids: item.retrieval_ground_truth?.sealed_source_candidate_ids || [],
        retrieval_evaluable: true,
        source: "INDEPENDENT_EXACT_IDENTITY_LABEL_V2",
        provenance: review.label.source
      } : {
        accepted_candidate_ids: [],
        accepted_identity_ids: [],
        sealed_source_candidate_ids: item.retrieval_ground_truth?.sealed_source_candidate_ids || [],
        retrieval_evaluable: false,
        source: "PENDING_INDEPENDENT_IDENTITY_REVIEW"
      }
    }];
  });
  return {
    ...dataset,
    schema_version: "v4-oracle-independent-identity-dataset-v2",
    evaluation_truth_policy: {
      ...(dataset.evaluation_truth_policy || {}),
      retrieval_truth_class: independentIdentityTruthSchemaVersion,
      same_feedback_self_corroboration_forbidden: true,
      system_candidate_self_labeling_forbidden: true,
      holdout_excluded: true
    },
    identity_truth_summary: {
      ...audit.counts,
      gate: audit.gate
    },
    items: scopedItems
  };
}
