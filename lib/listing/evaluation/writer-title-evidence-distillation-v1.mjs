// Label-aware development only.
//
// Writer titles describe what one reviewer chose to publish. They are useful
// weak supervision for omissions, field boundaries, and vocabulary, but they
// are not exhaustive physical-card truth and cannot score factual accuracy.

import { titleDerivedSemSuggestion } from "../csm/title-derived-sem.mjs";
import { projectCompactV4CurrentCanonicalFields } from
  "./model-residual-compact-v4-forward-diagnostic-v2.mjs";

export const WRITER_TITLE_EVIDENCE_DISTILLATION_VERSION =
  "writer-title-evidence-distillation-v1";

const WRITER_PROXY_FIELDS = Object.freeze([
  "year", "language", "manufacturer", "product", "set", "subject", "card_name",
  "card_number", "descriptive_rarity", "numerical_rarity", "release_variant",
  "print_finish", "special_stamp", "grading_info"
]);
const FORBIDDEN_SOURCE_KEYS = new Set([
  "reviewed_title", "writer_title", "reference", "reference_title", "label",
  "labels", "ground_truth", "expected_title"
]);

const record = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

export function writerTitleTokens(value) {
  const normalized = clean(value).normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .toLocaleLowerCase("en-US");
  return (normalized.match(/#?\/\d+(?:\/\d+)*|\d+(?:\/\d+)+|[\p{L}\p{N}]+(?:['.-][\p{L}\p{N}]+)*/gu) || [])
    .map((token) => token.replace(/^#(?=\/)/, ""));
}

function tokenCounts(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}

function unmatchedOccurrences(wanted, available) {
  const pool = tokenCounts(available);
  return wanted.map((token, index) => {
    const remaining = pool.get(token) || 0;
    if (remaining > 0) {
      pool.set(token, remaining - 1);
      return null;
    }
    return { token, index };
  }).filter(Boolean);
}

function contiguousPhrases(occurrences) {
  const phrases = [];
  for (const occurrence of occurrences) {
    const previous = phrases.at(-1);
    if (previous && previous.end_index + 1 === occurrence.index) {
      previous.tokens.push(occurrence.token);
      previous.end_index = occurrence.index;
      previous.phrase = previous.tokens.join(" ");
    } else {
      phrases.push({ phrase: occurrence.token, tokens: [occurrence.token],
        start_index: occurrence.index, end_index: occurrence.index });
    }
  }
  return phrases;
}

function primitiveStrings(value, path = "source", output = []) {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.forEach((child, index) => primitiveStrings(child, `${path}[${index}]`, output));
  } else if (record(value)) {
    for (const [key, child] of Object.entries(value)) {
      invariant(!FORBIDDEN_SOURCE_KEYS.has(key.toLocaleLowerCase("en-US")),
        `writer_distillation_label_leak_in_source:${path}.${key}`);
      primitiveStrings(child, `${path}.${key}`, output);
    }
  } else if (clean(value)) output.push(clean(value));
  return output;
}

function includesSequence(haystack, needle) {
  if (!needle.length || haystack.length < needle.length) return false;
  return haystack.some((_, index) =>
    needle.every((token, offset) => haystack[index + offset] === token));
}

function sourceIndex(sourceBacking) {
  invariant(Array.isArray(sourceBacking), "writer_distillation_source_backing_invalid");
  return sourceBacking.map((source, index) => {
    invariant(record(source) && clean(source.source)
      && !/(?:writer|review|label|reference|ground.?truth)/i.test(source.source),
    `writer_distillation_source_authority_invalid:${index}`);
    const strings = primitiveStrings(source.value, source.source);
    return { source: clean(source.source), strings,
      token_lists: strings.map(writerTitleTokens),
      tokens: new Set(strings.flatMap(writerTitleTokens)) };
  });
}

function backingAvailability(tokens, sources) {
  if (!sources.length) return { status: "SOURCE_UNAVAILABLE", exact_phrase_sources: [],
    token_sources: [] };
  const exact = sources.filter((source) => source.token_lists.some((list) =>
    includesSequence(list, tokens))).map((source) => source.source);
  const tokenSources = sources.filter((source) => tokens.every((token) =>
    source.tokens.has(token))).map((source) => source.source);
  return {
    status: exact.length ? "EXACT_PHRASE_AVAILABLE"
      : tokenSources.length ? "TOKENS_AVAILABLE_NONCONTIGUOUS"
        : "NOT_OBSERVED_IN_PROVIDED_SOURCE",
    exact_phrase_sources: exact,
    token_sources: tokenSources
  };
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (record(value)) return Object.values(value).some(hasValue);
  return clean(value) !== "";
}

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (record(value)) return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, normalizeValue(value[key])]));
  return writerTitleTokens(value).join(" ");
}

function sameValue(left, right) {
  return JSON.stringify(normalizeValue(left)) === JSON.stringify(normalizeValue(right));
}

function gradingPhrase(value) {
  if (!record(value)) return "";
  const company = clean(value.company);
  const card = clean(value.card_grade);
  const auto = clean(value.auto_grade);
  if (card && auto) return `${company} ${card}/${auto}`.trim();
  if (auto) return `${company} Auto ${auto}`.trim();
  return `${company} ${card}`.trim();
}

function phrasePublished(title, value) {
  const wanted = writerTitleTokens(value);
  return wanted.length > 0 && includesSequence(writerTitleTokens(title), wanted);
}

function candidateProposals({ writerTitle, writerProxy, candidateProjection }) {
  const proposals = [];
  const add = (bank, value, basis) => {
    const display = clean(value);
    if (display) proposals.push({ bank, value: display, basis });
  };
  for (const field of ["product", "set"]) {
    if (hasValue(writerProxy[field])) add(field, writerProxy[field], "WRITER_TITLE_PARSER_PROXY");
    if (hasValue(candidateProjection[field])
        && phrasePublished(writerTitle, candidateProjection[field])) {
      add(field, candidateProjection[field], "MODEL_FIELD_PUBLISHED_IN_WRITER_TITLE");
    }
  }
  const writerSlab = gradingPhrase(writerProxy.grading_info);
  const modelSlab = gradingPhrase(candidateProjection.grading_info);
  if (writerSlab) add("slab", writerSlab, "WRITER_TITLE_PARSER_PROXY");
  if (modelSlab && phrasePublished(writerTitle, modelSlab)) {
    add("slab", modelSlab, "MODEL_FIELD_PUBLISHED_IN_WRITER_TITLE");
  }
  const deduplicated = new Map();
  for (const proposal of proposals) {
    const key = `${proposal.bank}:${writerTitleTokens(proposal.value).join(" ")}`;
    const current = deduplicated.get(key) || { ...proposal, bases: [] };
    current.bases = [...new Set([...current.bases, proposal.basis])].sort();
    delete current.basis;
    deduplicated.set(key, current);
  }
  return [...deduplicated.values()];
}

function projectCandidateFields(fields) {
  const projected = projectCompactV4CurrentCanonicalFields(fields);
  if (!projected.grading_info && clean(fields.grade)) {
    projected.grading_info = titleDerivedSemSuggestion(fields.grade).grading_info || null;
  }
  return projected;
}

function distillCard(row) {
  const assetId = clean(row.asset_id);
  invariant(assetId && clean(row.writer_title) && typeof row.candidate_title === "string"
    && record(row.candidate_fields), `writer_distillation_card_invalid:${assetId || "missing"}`);
  const sources = sourceIndex(row.source_backing || []);
  const writerTokens = writerTitleTokens(row.writer_title);
  const candidateTokens = writerTitleTokens(row.candidate_title);
  const omissionOccurrences = unmatchedOccurrences(writerTokens, candidateTokens);
  const additionOccurrences = unmatchedOccurrences(candidateTokens, writerTokens);
  const omissionTokens = omissionOccurrences.map(({ token, index }) => ({ token, index,
    source_backing: backingAvailability([token], sources) }));
  const omissionPhrases = contiguousPhrases(omissionOccurrences).map((phrase) => ({
    ...phrase, source_backing: backingAvailability(phrase.tokens, sources)
  }));
  const writerProxy = titleDerivedSemSuggestion(row.writer_title);
  const candidateProjection = projectCandidateFields(row.candidate_fields);
  const fieldDisagreements = WRITER_PROXY_FIELDS.filter((field) => hasValue(writerProxy[field]))
    .filter((field) => !sameValue(writerProxy[field], candidateProjection[field]))
    .map((field) => ({ field, writer_title_proxy_value: writerProxy[field],
      candidate_value: candidateProjection[field] }));
  const proposals = candidateProposals({ writerTitle: row.writer_title, writerProxy,
    candidateProjection }).map((proposal) => ({ ...proposal,
      source_backing: backingAvailability(writerTitleTokens(proposal.value), sources) }));
  const shared = writerTokens.length - omissionOccurrences.length;
  return {
    asset_id: assetId,
    title_proxy: {
      exact_normalized_title_agreement: clean(row.writer_title).toLocaleLowerCase("en-US")
        === clean(row.candidate_title).toLocaleLowerCase("en-US"),
      token_multiset_agreement: omissionOccurrences.length === 0
        && additionOccurrences.length === 0,
      writer_token_occurrences: writerTokens.length,
      candidate_token_occurrences: candidateTokens.length,
      shared_token_occurrences: shared,
      token_recall_proxy: writerTokens.length ? shared / writerTokens.length : null,
      token_precision_proxy: candidateTokens.length ? shared / candidateTokens.length : null,
      omission_token_occurrences: omissionOccurrences.length,
      addition_token_occurrences: additionOccurrences.length
    },
    omission_tokens: omissionTokens,
    omission_phrases: omissionPhrases,
    field_proxy: {
      compared_fields: WRITER_PROXY_FIELDS.filter((field) => hasValue(writerProxy[field])),
      disagreements: fieldDisagreements,
      factual_regressions: null
    },
    candidate_proposals: proposals
  };
}

function availabilityCounts(items, select) {
  const counts = { EXACT_PHRASE_AVAILABLE: 0, TOKENS_AVAILABLE_NONCONTIGUOUS: 0,
    NOT_OBSERVED_IN_PROVIDED_SOURCE: 0, SOURCE_UNAVAILABLE: 0 };
  for (const item of items) counts[select(item).status] += 1;
  return counts;
}

function aggregateBank(items, keyFor, valueFor) {
  const bank = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    const current = bank.get(key) || { value: valueFor(item), occurrences: 0,
      asset_ids: new Set(), exact_phrase_available: 0, tokens_available_noncontiguous: 0,
      not_observed_in_provided_source: 0, source_unavailable: 0, bases: new Set() };
    current.occurrences += 1;
    current.asset_ids.add(item.asset_id);
    for (const basis of item.bases || []) current.bases.add(basis);
    const statusKey = {
      EXACT_PHRASE_AVAILABLE: "exact_phrase_available",
      TOKENS_AVAILABLE_NONCONTIGUOUS: "tokens_available_noncontiguous",
      NOT_OBSERVED_IN_PROVIDED_SOURCE: "not_observed_in_provided_source",
      SOURCE_UNAVAILABLE: "source_unavailable"
    }[item.source_backing.status];
    current[statusKey] += 1;
    bank.set(key, current);
  }
  return [...bank.values()].map((item) => ({
    ...item,
    cards: item.asset_ids.size,
    asset_ids: [...item.asset_ids].sort(),
    bases: [...item.bases].sort(),
    admission_authority: false
  })).sort((left, right) => right.occurrences - left.occurrences
    || left.value.localeCompare(right.value));
}

const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function distillWriterTitleEvidenceV1(rows = [], { minimumWriterTitles = 200 } = {}) {
  invariant(Array.isArray(rows) && Number.isInteger(minimumWriterTitles)
    && minimumWriterTitles > 0 && rows.length >= minimumWriterTitles,
  `writer_distillation_requires_${minimumWriterTitles}_titles`);
  const ids = rows.map((row) => clean(row?.asset_id));
  invariant(ids.every(Boolean) && new Set(ids).size === ids.length,
    "writer_distillation_asset_ids_invalid");
  const cards = rows.map(distillCard);
  const omissionTokens = cards.flatMap((card) => card.omission_tokens
    .map((item) => ({ ...item, asset_id: card.asset_id })));
  const omissionPhrases = cards.flatMap((card) => card.omission_phrases
    .map((item) => ({ ...item, asset_id: card.asset_id })));
  const proposals = cards.flatMap((card) => card.candidate_proposals
    .map((item) => ({ ...item, asset_id: card.asset_id })));
  const disagreementCounts = Object.fromEntries(WRITER_PROXY_FIELDS.map((field) => [field,
    cards.filter((card) => card.field_proxy.disagreements.some((row) => row.field === field)).length
  ]).filter(([, count]) => count > 0));
  const candidate_banks = Object.fromEntries(["product", "set", "slab"].map((bank) => [bank,
    aggregateBank(proposals.filter((item) => item.bank === bank),
      (item) => writerTitleTokens(item.value).join(" "), (item) => item.value)
  ]));
  return {
    schema_version: WRITER_TITLE_EVIDENCE_DISTILLATION_VERSION,
    authority: "label_aware_development_only",
    production_authorized: false,
    execution: { network_calls: 0, provider_calls: 0, runtime_mutations: 0 },
    supervision: {
      writer_titles: "WEAK_MARKETPLACE_TITLE_SUPERVISION",
      typed_gold: false,
      title_omission_is_factual_error: false,
      field_parser_output_is_factual_truth: false,
      source_backing_scope: "MODEL_OUTPUT_AVAILABILITY_NOT_INDEPENDENT_FACT_VERIFICATION"
    },
    data_policy: {
      training_eligible: false,
      threshold_tuning_eligible: false,
      runtime_candidate_eligible: false,
      catalog_promotion_eligible: false,
      model_prompt_eligible: false,
      commit_label_derived_rows: false
    },
    summary: {
      cards: cards.length,
      exact_normalized_title_agreement_cards: cards.filter((card) =>
        card.title_proxy.exact_normalized_title_agreement).length,
      token_multiset_agreement_cards: cards.filter((card) =>
        card.title_proxy.token_multiset_agreement).length,
      cards_with_token_omissions: cards.filter((card) =>
        card.title_proxy.omission_token_occurrences > 0).length,
      omission_token_occurrences: omissionTokens.length,
      omission_phrase_occurrences: omissionPhrases.length,
      mean_writer_title_token_recall_proxy: mean(cards.map((card) =>
        card.title_proxy.token_recall_proxy).filter(Number.isFinite)),
      mean_writer_title_token_precision_proxy: mean(cards.map((card) =>
        card.title_proxy.token_precision_proxy).filter(Number.isFinite)),
      cards_with_field_proxy_disagreement: cards.filter((card) =>
        card.field_proxy.disagreements.length > 0).length,
      field_proxy_disagreement_cells: cards.reduce((sum, card) =>
        sum + card.field_proxy.disagreements.length, 0),
      omission_token_source_backing: availabilityCounts(omissionTokens,
        (item) => item.source_backing),
      omission_phrase_source_backing: availabilityCounts(omissionPhrases,
        (item) => item.source_backing),
      candidate_bank_entries: Object.fromEntries(Object.entries(candidate_banks)
        .map(([bank, entries]) => [bank, entries.length]))
    },
    field_proxy_disagreement_cards_by_field: disagreementCounts,
    omission_token_bank: aggregateBank(omissionTokens, (item) => item.token,
      (item) => item.token),
    omission_phrase_bank: aggregateBank(omissionPhrases, (item) => item.phrase,
      (item) => item.phrase),
    candidate_banks,
    factual_metrics: {
      independent_typed_gold_cards: 0,
      typed_field_precision: null,
      typed_field_recall: null,
      factual_error_cards: null,
      critical_factual_error_cards: null,
      factual_regression_cards: null,
      required_missing_cards: null,
      wrong_role_cards: null
    },
    cards
  };
}
