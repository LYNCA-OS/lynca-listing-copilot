// Label-aware development only.
//
// Writer titles are weak supervision for vocabulary and marketplace expression,
// never typed or factual gold. Every held-out proposal is built from other
// folds plus model-output text; the held-out writer title is opened only by the
// proxy scorer. This module cannot mutate runtime fields or call a provider.

import { titleDerivedSemSuggestion } from "../csm/title-derived-sem.mjs";
import { composeFromCanonicalFields } from "../thin/canonical-composer.mjs";
import { FOLD_COUNT, foldFor } from "./kfold-few-shot.mjs";
import { writerTitleTokens } from "./writer-title-evidence-distillation-v1.mjs";

export const WRITER_TITLE_PRODUCT_PHRASE_PARETO_V1 =
  "writer-title-product-phrase-pareto-v1";

const FORBIDDEN_SOURCE_KEYS = new Set([
  "reviewed_title", "writer_title", "reference", "reference_title", "label",
  "labels", "ground_truth", "expected_title"
]);
const clean = (value) => String(value ?? "").normalize("NFC")
  .replace(/\s+/g, " ").trim();
const record = (value) => Boolean(value && typeof value === "object"
  && !Array.isArray(value));

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function primitiveStrings(value, path = "source", output = []) {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.forEach((child, index) => primitiveStrings(child, `${path}[${index}]`, output));
  } else if (record(value)) {
    for (const [key, child] of Object.entries(value)) {
      invariant(!FORBIDDEN_SOURCE_KEYS.has(key.toLocaleLowerCase("en-US")),
        `product_phrase_label_leak_in_source:${path}.${key}`);
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

function sourceIndex(sourceBacking = []) {
  invariant(Array.isArray(sourceBacking), "product_phrase_source_backing_invalid");
  return sourceBacking.map((source, index) => {
    invariant(record(source) && clean(source.source)
      && !/(?:writer|review|label|reference|ground.?truth)/i.test(source.source),
    `product_phrase_source_authority_invalid:${index}`);
    return {
      source: clean(source.source),
      token_lists: primitiveStrings(source.value, source.source).map(writerTitleTokens)
    };
  });
}

function exactPhraseSources(value, sourceBacking) {
  const wanted = writerTitleTokens(value);
  if (!wanted.length) return [];
  return sourceIndex(sourceBacking).filter((source) => source.token_lists.some((tokens) =>
    includesSequence(tokens, wanted))).map((source) => source.source);
}

function escaped(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripManufacturerPrefix(value, manufacturer) {
  const phrase = clean(value);
  const maker = clean(manufacturer);
  if (!phrase || !maker) return phrase;
  const stripped = phrase.replace(new RegExp(`^${escaped(maker)}(?:\\s*[-–—]\\s*|\\s+)`, "i"), "");
  return clean(stripped) || phrase;
}

function counts(tokens) {
  const result = new Map();
  for (const token of tokens) result.set(token, (result.get(token) || 0) + 1);
  return result;
}

function multisetDifference(left, right) {
  const pool = counts(right);
  return left.filter((token) => {
    const available = pool.get(token) || 0;
    if (available <= 0) return true;
    pool.set(token, available - 1);
    return false;
  });
}

function strictTokenExtension(base, candidate) {
  const oldTokens = writerTitleTokens(base);
  const newTokens = writerTitleTokens(candidate);
  if (!oldTokens.length || newTokens.length <= oldTokens.length) return false;
  return multisetDifference(oldTokens, newTokens).length === 0;
}

function productPhraseFromWriter(row) {
  const proxy = titleDerivedSemSuggestion(row.writer_title);
  const value = stripManufacturerPrefix(proxy.product,
    proxy.manufacturer || row.candidate_fields?.manufacturer);
  const tokens = writerTitleTokens(value);
  if (!value || !tokens.length || tokens.length > 6
      || /^(?:other collectibles?|unknown|n\/a)$/i.test(value)) return null;
  const exactSources = exactPhraseSources(value, row.source_backing);
  if (!exactSources.length) return null;
  return { value, key: tokens.join(" "), tokens, exact_sources: exactSources };
}

export function buildHeldoutProductPhraseBankV1(rows = [], { minimumSupport = 2 } = {}) {
  invariant(Array.isArray(rows) && Number.isInteger(minimumSupport) && minimumSupport >= 2,
    "product_phrase_bank_options_invalid");
  const entries = new Map();
  for (const row of rows) {
    invariant(clean(row?.asset_id) && clean(row?.writer_title) && record(row?.candidate_fields),
      "product_phrase_training_row_invalid");
    const phrase = productPhraseFromWriter(row);
    if (!phrase) continue;
    const current = entries.get(phrase.key) || {
      value: phrase.value, tokens: phrase.tokens, asset_ids: new Set(),
      training_source_names: new Set()
    };
    current.asset_ids.add(clean(row.asset_id));
    phrase.exact_sources.forEach((source) => current.training_source_names.add(source));
    entries.set(phrase.key, current);
  }
  return [...entries.values()].filter((entry) => entry.asset_ids.size >= minimumSupport)
    .map((entry) => ({
      value: entry.value,
      token_key: entry.tokens.join(" "),
      token_count: entry.tokens.length,
      support_cards: entry.asset_ids.size,
      training_source_names: [...entry.training_source_names].sort(),
      authority: "other_fold_writer_proxy_plus_model_output_availability",
      factual_truth: false
    })).sort((left, right) => right.support_cards - left.support_cards
      || right.token_count - left.token_count || left.token_key.localeCompare(right.token_key));
}

function unchanged(reason, details = {}) {
  return {
    changed: false,
    reason,
    authority: "label_aware_development_only",
    production_authorized: false,
    ...details
  };
}

// Deliberately does not accept a writer/reference title. A test asserts that
// changing the held-out label cannot change this decision.
export function proposeHeldoutProductPhraseExtensionV1({ candidateFields = {},
  sourceBacking = [], phraseBank = [] } = {}) {
  const fields = structuredClone(candidateFields ?? {});
  if (clean(fields.grammar).toLowerCase() === "lot" || clean(fields.lot_count)) {
    return unchanged("lot_product_extension_disallowed");
  }
  const before = clean(fields.product);
  if (!before) return unchanged("missing_existing_product");
  const manufacturer = clean(fields.manufacturer);
  const baseCore = stripManufacturerPrefix(before, manufacturer);
  const baseHadManufacturerPrefix = baseCore !== before;
  const matches = phraseBank.flatMap((entry) => {
    if (!strictTokenExtension(baseCore, entry.value)) return [];
    const addedTokens = multisetDifference(writerTitleTokens(entry.value),
      writerTitleTokens(baseCore));
    if (!addedTokens.length || addedTokens.some((token) => /\d/.test(token))) return [];
    const heldoutSources = exactPhraseSources(entry.value, sourceBacking);
    if (!heldoutSources.length) return [];
    const proposed = baseHadManufacturerPrefix
      ? `${manufacturer} ${entry.value}` : entry.value;
    if (!strictTokenExtension(before, proposed)) return [];
    return [{ ...entry, proposed, added_tokens: addedTokens,
      heldout_exact_phrase_sources: heldoutSources }];
  }).sort((left, right) => right.support_cards - left.support_cards
    || right.token_count - left.token_count || left.token_key.localeCompare(right.token_key));
  if (!matches.length) return unchanged("no_compatible_exact_source_phrase");
  const best = matches[0];
  const tied = matches.filter((entry) => entry.support_cards === best.support_cards
    && entry.token_count === best.token_count && entry.token_key !== best.token_key);
  if (tied.length) return unchanged("ambiguous_top_phrase", {
    ambiguous_values: [best, ...tied].map((entry) => entry.value).sort()
  });
  return {
    changed: true,
    reason: "other_fold_supported_strict_exact_source_extension",
    before,
    after: best.proposed,
    added_product_tokens: best.added_tokens,
    support_cards: best.support_cards,
    heldout_exact_phrase_sources: best.heldout_exact_phrase_sources,
    alternative_matches: matches.length - 1,
    authority: "label_aware_development_only",
    source_backing_scope: "MODEL_OUTPUT_AVAILABILITY_NOT_INDEPENDENT_FACT_VERIFICATION",
    production_authorized: false
  };
}

function tokenScore(reference, title) {
  const wanted = writerTitleTokens(reference);
  const got = writerTitleTokens(title);
  const shared = wanted.length - multisetDifference(wanted, got).length;
  const recall = wanted.length ? shared / wanted.length : 0;
  const precision = got.length ? shared / got.length : 0;
  return { recall, precision,
    f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

function composerGuard(fields, proposal) {
  const baseline = composeFromCanonicalFields(fields);
  if (!proposal.changed) return { accepted: false, reason: proposal.reason,
    baseline, attempted: baseline, lost_title_tokens: [], added_title_tokens: [] };
  const attemptedFields = { ...structuredClone(fields), product: proposal.after };
  const attempted = composeFromCanonicalFields(attemptedFields);
  const lost = multisetDifference(writerTitleTokens(baseline.title),
    writerTitleTokens(attempted.title));
  const added = multisetDifference(writerTitleTokens(attempted.title),
    writerTitleTokens(baseline.title));
  const accepted = attempted.title !== baseline.title && !lost.length
    && attempted.length <= 80 && added.length > 0;
  return {
    accepted,
    reason: accepted ? "accepted" : attempted.length > 80 ? "composer_over_80_guard"
      : lost.length ? "composer_displacement_guard"
        : "composer_no_visible_extension",
    baseline,
    attempted,
    lost_title_tokens: lost,
    added_title_tokens: added
  };
}

function sign(values) {
  return {
    wins: values.filter((value) => value > 1e-12).length,
    losses: values.filter((value) => value < -1e-12).length,
    ties: values.filter((value) => Math.abs(value) <= 1e-12).length
  };
}

const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function evaluateKfoldProductPhraseExtensionV1(rows = [], {
  folds = FOLD_COUNT, minimumSupport = 2
} = {}) {
  invariant(Array.isArray(rows) && rows.length > 0 && Number.isInteger(folds) && folds >= 2,
    "product_phrase_screen_input_invalid");
  const ids = rows.map((row) => clean(row?.asset_id));
  invariant(ids.every(Boolean) && new Set(ids).size === ids.length,
    "product_phrase_screen_asset_ids_invalid");
  const banks = new Map();
  for (let fold = 0; fold < folds; fold += 1) {
    banks.set(fold, buildHeldoutProductPhraseBankV1(rows.filter((row) =>
      foldFor(row.asset_id, folds) !== fold), { minimumSupport }));
  }
  const cards = rows.map((row) => {
    const fold = foldFor(row.asset_id, folds);
    const proposal = proposeHeldoutProductPhraseExtensionV1({
      candidateFields: row.candidate_fields,
      sourceBacking: row.source_backing,
      phraseBank: banks.get(fold)
    });
    const guarded = composerGuard(row.candidate_fields, proposal);
    // Label scoring starts here, after both proposal and guard are frozen.
    const finalTitle = guarded.accepted ? guarded.attempted.title : guarded.baseline.title;
    const beforeScore = tokenScore(row.writer_title, guarded.baseline.title);
    const afterScore = tokenScore(row.writer_title, finalTitle);
    return {
      asset_id: row.asset_id,
      fold,
      proposal,
      composer_guard: {
        accepted: guarded.accepted,
        reason: guarded.reason,
        baseline_title: guarded.baseline.title,
        attempted_title: guarded.attempted.title,
        final_title: finalTitle,
        lost_title_tokens: guarded.lost_title_tokens,
        added_title_tokens: guarded.added_title_tokens,
        within_80_characters: guarded.attempted.length <= 80
      },
      writer_title_proxy_score: {
        before: beforeScore,
        after: afterScore,
        delta_f1: afterScore.f1 - beforeScore.f1,
        factual_regression: null
      }
    };
  });
  const deltas = cards.map((card) => card.writer_title_proxy_score.delta_f1);
  const actions = cards.filter((card) => card.composer_guard.accepted);
  const actionDeltas = actions.map((card) => card.writer_title_proxy_score.delta_f1);
  return {
    schema_version: WRITER_TITLE_PRODUCT_PHRASE_PARETO_V1,
    authority: "label_aware_development_only",
    production_authorized: false,
    execution: { network_calls: 0, provider_calls: 0, runtime_mutations: 0 },
    preregistered_method: {
      folds,
      fold_assignment: "sha256_asset_id_mod_fold_count",
      minimum_other_fold_support_cards: minimumSupport,
      candidate_rule: "strict_product_token_extension_exact_in_heldout_model_output",
      numeric_added_product_tokens_allowed: false,
      composer_guard: "no_baseline_title_token_displacement_and_length_lte_80",
      heldout_writer_title_visible_to_candidate_selection: false,
      threshold_tuning_after_label_open: false
    },
    summary: {
      cards: cards.length,
      fold_sizes: Object.fromEntries([...Array(folds).keys()].map((fold) => [fold,
        cards.filter((card) => card.fold === fold).length])),
      phrase_bank_entries_by_heldout_fold: Object.fromEntries([...banks].map(([fold, bank]) =>
        [fold, bank.length])),
      proposed_cards: cards.filter((card) => card.proposal.changed).length,
      accepted_cards: actions.length,
      composer_guard_rejections: cards.filter((card) => card.proposal.changed
        && !card.composer_guard.accepted).length,
      baseline_macro_writer_title_f1_proxy: mean(cards.map((card) =>
        card.writer_title_proxy_score.before.f1)),
      final_macro_writer_title_f1_proxy: mean(cards.map((card) =>
        card.writer_title_proxy_score.after.f1)),
      delta_macro_writer_title_f1_proxy: mean(deltas),
      all_cards_sign: sign(deltas),
      accepted_actions_sign: sign(actionDeltas),
      accepted_added_title_token_occurrences: actions.reduce((sum, card) =>
        sum + card.composer_guard.added_title_tokens.length, 0),
      accepted_lost_title_token_occurrences: actions.reduce((sum, card) =>
        sum + card.composer_guard.lost_title_tokens.length, 0)
    },
    supervision: {
      writer_titles: "WEAK_MARKETPLACE_TITLE_SUPERVISION",
      typed_gold: false,
      model_output_phrase_availability_is_factual_truth: false,
      proxy_loss_is_factual_regression: false
    },
    factual_metrics: {
      independent_typed_gold_cards: 0,
      typed_field_precision: null,
      typed_field_recall: null,
      factual_error_cards: null,
      critical_factual_error_cards: null,
      factual_regression_cards: null
    },
    cards
  };
}

function overlapOccurrences(left, right) {
  return left.length - multisetDifference(left, right).length;
}

function bankArm(distillation, bank, complexity) {
  const proposals = distillation.cards.flatMap((card) => card.candidate_proposals
    .filter((proposal) => proposal.bank === bank)
    .map((proposal) => ({ ...proposal, asset_id: card.asset_id,
      omission_tokens: card.omission_tokens.map((item) => item.token) })));
  const addressable = proposals.filter((proposal) => overlapOccurrences(
    writerTitleTokens(proposal.value), proposal.omission_tokens) > 0);
  const exact = proposals.filter((proposal) =>
    proposal.source_backing.status === "EXACT_PHRASE_AVAILABLE").length;
  const parserOnly = proposals.filter((proposal) => proposal.bases?.length === 1
    && proposal.bases[0] === "WRITER_TITLE_PARSER_PROXY").length;
  return {
    bank,
    proposal_occurrences: proposals.length,
    proposal_cards: new Set(proposals.map((proposal) => proposal.asset_id)).size,
    addressable_cards: new Set(addressable.map((proposal) => proposal.asset_id)).size,
    addressable_token_occurrences: addressable.reduce((sum, proposal) => sum
      + overlapOccurrences(writerTitleTokens(proposal.value), proposal.omission_tokens), 0),
    exact_model_output_phrase_rate: proposals.length ? exact / proposals.length : null,
    parser_only_proposal_rate: proposals.length ? parserOnly / proposals.length : null,
    implementation_complexity_units: complexity,
    factual_precision: null
  };
}

function dominates(left, right) {
  const dimensions = [
    left.addressable_cards >= right.addressable_cards,
    left.exact_model_output_phrase_rate >= right.exact_model_output_phrase_rate,
    left.parser_only_proposal_rate <= right.parser_only_proposal_rate,
    left.implementation_complexity_units <= right.implementation_complexity_units
  ];
  return dimensions.every(Boolean) && [
    left.addressable_cards > right.addressable_cards,
    left.exact_model_output_phrase_rate > right.exact_model_output_phrase_rate,
    left.parser_only_proposal_rate < right.parser_only_proposal_rate,
    left.implementation_complexity_units < right.implementation_complexity_units
  ].some(Boolean);
}

export function computeWriterTitlePhraseParetoV1(distillation = {}) {
  invariant(distillation?.authority === "label_aware_development_only"
    && Array.isArray(distillation.cards), "product_phrase_pareto_distillation_invalid");
  const arms = [bankArm(distillation, "product", 2), bankArm(distillation, "set", 2),
    bankArm(distillation, "slab", 3)];
  const frontier = arms.filter((arm) => !arms.some((other) => other.bank !== arm.bank
    && dominates(other, arm)));
  const feasible = frontier.filter((arm) => arm.addressable_cards > 0
    && arm.exact_model_output_phrase_rate >= 0.8);
  const selected = [...feasible].sort((left, right) =>
    right.addressable_cards - left.addressable_cards
      || left.implementation_complexity_units - right.implementation_complexity_units
      || right.exact_model_output_phrase_rate - left.exact_model_output_phrase_rate)[0] || null;
  return {
    schema_version: WRITER_TITLE_PRODUCT_PHRASE_PARETO_V1,
    authority: "label_aware_development_only",
    objective: "maximize_addressable_cards_subject_to_exact_model_output_rate_gte_0.8_and_no_schema_change",
    dimensions: {
      maximize: ["addressable_cards", "exact_model_output_phrase_rate"],
      minimize: ["parser_only_proposal_rate", "implementation_complexity_units"]
    },
    arms,
    pareto_frontier: frontier.map((arm) => arm.bank),
    selected_next_step: selected?.bank || null,
    ineligible: [{ arm: "compact_residual_schema_retry", status: "STOP",
      reason: "previously_stopped_schema_cannot_be_revived_by_writer_title_proxy" }],
    factual_metrics: { factual_precision: null, factual_regression_cards: null }
  };
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (record(value)) return Object.values(value).some(hasValue);
  return clean(value) !== "";
}

// After the ex-ante Pareto winner is screened, compute a conservative upper
// bound for every bank. Set/slab are eligible only when the current canonical
// field is empty; a title omission of an already-populated field is Composer
// expression behavior, not a missing typed candidate.
export function computePhraseBankExecutableBoundsV1(rows = [], distillation = {},
  productScreen = {}) {
  invariant(Array.isArray(rows) && Array.isArray(distillation?.cards)
    && Array.isArray(productScreen?.cards), "product_phrase_bounds_input_invalid");
  const byId = new Map(rows.map((row) => [clean(row.asset_id), row]));
  invariant(byId.size === rows.length && distillation.cards.length === rows.length,
    "product_phrase_bounds_cohort_invalid");
  const stats = Object.fromEntries(["product", "set", "slab"].map((bank) => [bank, {
    exact_addressable_cards: new Set(),
    current_field_already_populated_cards: new Set(),
    empty_field_exact_candidate_cards: new Set(),
    strict_extension_exact_candidate_cards: new Set()
  }]));
  for (const card of distillation.cards) {
    const row = byId.get(clean(card.asset_id));
    invariant(row, `product_phrase_bounds_missing_row:${clean(card.asset_id)}`);
    const omissions = card.omission_tokens.map((item) => item.token);
    for (const proposal of card.candidate_proposals) {
      if (!stats[proposal.bank]
          || proposal.source_backing.status !== "EXACT_PHRASE_AVAILABLE"
          || overlapOccurrences(writerTitleTokens(proposal.value), omissions) <= 0) continue;
      const bankStats = stats[proposal.bank];
      bankStats.exact_addressable_cards.add(card.asset_id);
      if (proposal.bank === "product") {
        const manufacturer = row.candidate_fields?.manufacturer;
        const base = stripManufacturerPrefix(row.candidate_fields?.product, manufacturer);
        const candidate = stripManufacturerPrefix(proposal.value, manufacturer);
        if (strictTokenExtension(base, candidate)) {
          bankStats.strict_extension_exact_candidate_cards.add(card.asset_id);
        }
        continue;
      }
      const occupied = proposal.bank === "set"
        ? hasValue(row.candidate_fields?.set)
        : hasValue(row.candidate_fields?.grading_info) || hasValue(row.candidate_fields?.grade);
      if (occupied) bankStats.current_field_already_populated_cards.add(card.asset_id);
      else bankStats.empty_field_exact_candidate_cards.add(card.asset_id);
    }
  }
  const productCrossfold = new Set(productScreen.cards.filter((card) =>
    card.proposal.changed).map((card) => card.asset_id));
  const bounds = Object.fromEntries(Object.entries(stats).map(([bank, value]) => [bank, {
    exact_addressable_cards: value.exact_addressable_cards.size,
    current_field_already_populated_cards: value.current_field_already_populated_cards.size,
    empty_field_exact_candidate_cards: value.empty_field_exact_candidate_cards.size,
    strict_extension_exact_candidate_cards: value.strict_extension_exact_candidate_cards.size,
    label_blind_crossfold_executable_cards: bank === "product" ? productCrossfold.size
      : value.empty_field_exact_candidate_cards.size,
    factual_precision: null
  }]));
  const executable = Object.values(bounds).reduce((sum, row) =>
    sum + row.label_blind_crossfold_executable_cards, 0);
  return {
    authority: "label_aware_development_only",
    interpretation: "WEAK_PROXY_EXECUTABILITY_NOT_FACTUAL_ACCURACY",
    canonical_field_mapping: {
      product: "candidate_fields.product",
      set: "candidate_fields.set",
      slab: "candidate_fields.grading_info_or_grade"
    },
    bounds,
    recommendation: executable > 0 ? "CONTINUE_SELECTED_EVALUATION_ONLY_SCREEN"
      : "STOP_PHRASE_BANK_EXPANSION_UNDER_CURRENT_EVIDENCE",
    guard_policy: "DO_NOT_RELAX_SOURCE_ROLE_OR_CROSSFOLD_GUARDS_TO_CREATE_COVERAGE",
    factual_metrics: { factual_precision: null, factual_regression_cards: null }
  };
}
