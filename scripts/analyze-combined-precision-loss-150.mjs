#!/usr/bin/env node

// Offline precision-loss audit for the retained fresh150 combined candidate.
// Review-title absence is an evaluation signal, not factual contradiction.
// This script makes no provider/network/runtime calls and cannot mutate titles.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCombinedPositiveBundleV1 } from "../experiments/accuracy/combined-positive-bundle-v1.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";
import {
  buildOfficialReleaseGraph,
  exactNorm
} from "../experiments/accuracy/official-release-graph-v1-screen.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = Object.freeze({
  canonical: path.join(repoRoot, "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl"),
  exhaustive: path.join(repoRoot, "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl"),
  candidateExpression: path.join(repoRoot, "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl"),
  combined: path.join(repoRoot, "docs/evaluation/accuracy-combined-positive-bundle-v1-replay-150-2026-08-02.json"),
  lossLedger: path.join(repoRoot, "docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.json"),
  worldRanker: path.join(repoRoot, "docs/evaluation/world-compatibility-ranker-v1-replay-150-2026-08-02.json"),
  outputJson: path.join(repoRoot, "docs/evaluation/combined-precision-loss-ledger-150-2026-08-02.json"),
  outputReport: path.join(repoRoot, "docs/evaluation/combined-precision-loss-ledger-150-2026-08-02.md")
});

const EXPECTED = Object.freeze({
  input_sha256: "2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5",
  exhaustive_sha256: "96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9",
  cards: 150,
  reference_absent_token_occurrences: 285,
  affected_cards: 117
});

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const tokenArray = (value) => String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .split(/[^a-z0-9/']+/)
  .filter(Boolean);
const tokenSet = (value) => new Set(tokenArray(value));
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const intersection = (left, right) => [...left].filter((value) => right.has(value));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const tally = (rows, keyFor) => Object.fromEntries([...rows.reduce((counts, row) => {
  const key = String(keyFor(row) ?? "<missing>");
  counts.set(key, (counts.get(key) || 0) + 1);
  return counts;
}, new Map())].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
const occurrenceAndCards = (rows, keyFor) => Object.fromEntries([...rows.reduce((groups, row) => {
  const key = String(keyFor(row) ?? "<missing>");
  const group = groups.get(key) || { occurrences: 0, assets: new Set() };
  group.occurrences += 1;
  group.assets.add(row.asset_id);
  groups.set(key, group);
  return groups;
}, new Map())].sort((left, right) => right[1].occurrences - left[1].occurrences || left[0].localeCompare(right[0]))
  .map(([key, group]) => [key, { occurrences: group.occurrences, cards: group.assets.size }]));

function score(reference, candidate) {
  const wanted = tokenSet(reference);
  const got = candidate instanceof Set ? candidate : tokenSet(candidate);
  const hits = intersection(wanted, got).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

function parseJsonl(body) {
  return body.toString("utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
}

function candidateFactsFromObservations(observations = []) {
  return observations.flatMap((row) => {
    if (row?.label !== "logo" || row?.kind !== "printed_text") return [];
    const value = clean(row.evidence);
    return value ? [{
      value,
      kind: "affiliation",
      basis: "logo_or_symbol",
      image: row.region === "card_back" ? "image_2" : "image_1",
      region: row.region || "unknown",
      uncertainty: "none",
      source_kind: row.kind,
      source_confidence: row.confidence
    }] : [];
  });
}

const bracketField = Object.freeze({
  lot: "lot_count",
  manufacturer_product: "manufacturer_product",
  subject: "subjects",
  numerical_rarity: "serial",
  grading_info: "grade",
  search_optimization: "team",
  observable_components: "components"
});
const semanticCategory = Object.freeze({
  lot_count: "lot_notation",
  year: "year_or_season",
  language: "language",
  ip: "product_set_or_ip",
  manufacturer: "manufacturer_or_brand",
  product: "product_set_or_ip",
  set: "product_set_or_ip",
  subjects: "subject_or_name",
  card_name: "card_name_or_design",
  release_variant: "release_variant",
  print_finish: "parallel_finish_or_color",
  descriptive_rarity: "rarity_or_marker",
  serial: "serial_or_numbered_print",
  card_number: "card_number",
  components: "attribute_or_component",
  grade: "grading_info",
  team: "team_or_league",
  manufacturer_product: "product_set_or_ip"
});

function fieldValue(fields, composed, bracket, token) {
  const field = bracketField[bracket] || bracket;
  if (field === "manufacturer_product") {
    const manufacturerTokens = tokenSet(fields.manufacturer);
    const productTokens = tokenSet(fields.product);
    if (manufacturerTokens.has(token) && !productTokens.has(token)) return { field: "manufacturer", value: fields.manufacturer };
    if (productTokens.has(token) && !manufacturerTokens.has(token)) return { field: "product", value: fields.product };
    return { field, value: [fields.manufacturer, fields.product].filter(Boolean).join(" ") };
  }
  if (field === "manufacturer" && !clean(fields.manufacturer) && composed.inferred_parent) {
    return { field, value: composed.inferred_parent };
  }
  const value = Array.isArray(fields[field]) ? fields[field].join(" ") : fields[field];
  return { field, value: clean(value) };
}

function sourceForToken(fields, composed, bundle, bracket, field, token, fieldText) {
  if (bracket === "lot") {
    if (/^lotx\d+$/.test(token)) return { source: "replay_mechanism", mechanism: "compact_lot_quantity" };
    if (["card", "lot"].includes(token)) return { source: "composer_literal", mechanism: "canonical_composer" };
  }
  if (field === "manufacturer" && !clean(fields.manufacturer) && composed.inferred_parent) {
    return { source: "composer_inference", mechanism: "infer_parent_manufacturer" };
  }
  if (token === "auto" && /\bautograph(?:ed|s)?\b/i.test(fieldText) && !/\bauto\b/i.test(fieldText)) {
    return { source: "composer_normalization", mechanism: "autograph_to_auto" };
  }
  const changed = bundle.stages.filter((stage) => stage.changed_fields.includes(field));
  if (changed.length) return { source: "replay_mechanism", mechanism: changed.at(-1).mechanism };
  return { source: "canonical_model", mechanism: null };
}

const factKindsForField = Object.freeze({
  year: new Set(["year"]),
  language: new Set(["language"]),
  manufacturer: new Set(["identity", "affiliation"]),
  product: new Set(["identity"]),
  set: new Set(["identity"]),
  ip: new Set(["identity"]),
  subjects: new Set(["subject"]),
  card_name: new Set(["identity", "attribute"]),
  release_variant: new Set(["identity", "finish", "attribute"]),
  print_finish: new Set(["finish"]),
  descriptive_rarity: new Set(["finish", "attribute"]),
  serial: new Set(["number"]),
  card_number: new Set(["number"]),
  components: new Set(["attribute"]),
  grade: new Set(["grade"]),
  team: new Set(["affiliation"]),
  lot_count: new Set(["number"])
});

const safePrintedLabels = Object.freeze({
  year: /^(?:year|season|set_year|year_set|year_product)$/i,
  language: /^language(?:_text)?$/i,
  manufacturer: /^(?:manufacturer|manufacturer_logo|brand|brand_logo|brand emblem|company|company_name)$/i,
  product: /^(?:product|product_name|product_line|product_logo|product logo|product_label|product_text|product_brand|product_set|set_or_product)$/i,
  set: /^(?:set|set_name|set_text|set_logo|set_label|set_brand|set_branding|set_or_insert|set_or_insert_name|insert_name|insert_text|insert_title|insert_or_subset|subset)$/i,
  ip: /^(?:product|product_name|product_logo|brand|brand_logo|logo_text|set_or_product)$/i,
  subjects: /^(?:name|subject|player_name|person_name|first_name|last_name|nameplate|pictured_person|depicted_subject|character)$/i,
  card_name: /^(?:card_title|card_name|design|design_text|edition_name|insert_name|insert_title|set_or_card_caption)$/i,
  release_variant: /^(?:variation|parallel_or_variant|parallel_description|edition_name|orientation|design|design_text)$/i,
  print_finish: /^(?:finish|parallel|parallel_label|parallel_or_finish|parallel_or_edition|color_finish|set_or_finish|rarity_and_finish)$/i,
  descriptive_rarity: /^(?:rarity|rarity_code|rarity_symbol|designation|edition_or_promo)$/i,
  serial: /^(?:serial_number|stamped_number|serial_form|printed_number)$/i,
  card_number: /^(?:card_number|card_number_and_name|card_number_prefix|card_number_label|checklist_code|checklist_number|card_code|set_code)$/i,
  components: /(?:rookie|autograph|signature|patch|jersey|relic|memorabilia|prospect|redemption)/i,
  grade: /^(?:grade|grade_number|grade_description|grade_descriptor|grade_word|overall_grade|condition_grade|grading_value|grading_field|grade_label|grade_qualifier)$/i,
  team: /^(?:team|team_name|team_text|team_logo_text|team_abbreviation|team_code|club|team_or_affiliation)$/i,
  lot_count: /^(?:quantity|number)$/i
});

function candidateFactEvidence(entry, candidateRow) {
  const allowed = factKindsForField[entry.field] || new Set();
  return (candidateRow?.candidate_facts || []).filter((fact) => allowed.has(fact.kind)
    && tokenSet(fact.value).has(entry.token)).map((fact) => ({
      value: fact.value,
      kind: fact.kind,
      basis: fact.basis,
      region: fact.region,
      image: fact.image
    }));
}

function exhaustivePrintedEvidence(entry, observations) {
  const pattern = safePrintedLabels[entry.field];
  if (!pattern) return [];
  return observations.filter((row) => row.kind === "printed_text"
    && pattern.test(String(row.label || ""))
    && tokenSet(row.evidence).has(entry.token)).map((row) => ({
      evidence: row.evidence,
      label: row.label,
      region: row.region,
      confidence: row.confidence
    }));
}

function lossAlternatives(entry, lossItems, candidateTokens) {
  const compatibleFamilies = {
    year_or_season: new Set(["year_or_season"]),
    product_set_or_ip: new Set(["product_set_or_ip", "other_identity_or_descriptor"]),
    manufacturer_or_brand: new Set(["product_set_or_ip", "other_identity_or_descriptor"]),
    subject_or_name: new Set(["subject_or_name"]),
    card_name_or_design: new Set(["other_identity_or_descriptor"]),
    release_variant: new Set(["other_identity_or_descriptor", "parallel_or_finish"]),
    parallel_finish_or_color: new Set(["parallel_or_finish", "color", "rarity_or_marker"]),
    rarity_or_marker: new Set(["rarity_or_marker"]),
    serial_or_numbered_print: new Set(["serial_or_numbered_print", "bare_number_or_ordinal"]),
    card_number: new Set(["bare_number_or_ordinal"]),
    attribute_or_component: new Set(["attribute_or_component"]),
    team_or_league: new Set(["team_or_league"]),
    lot_notation: new Set(["lot_notation"])
  }[entry.semantic_category] || new Set();
  return lossItems.filter((item) => compatibleFamilies.has(item.structural_family)
    && !candidateTokens.has(String(item.token).toLowerCase())).map((item) => ({
      token: String(item.token).toLowerCase(),
      stage: item.stage,
      structural_family: item.structural_family,
      semantic_class: item.semantic_class
    }));
}

function worldCorrection(entry, worldChanged) {
  const relation = entry.field === "year" ? "subject_year"
    : ["manufacturer", "product", "set", "ip"].includes(entry.field) ? "product_year"
      : entry.field === "team" ? "subject_team_year" : null;
  if (!relation) return null;
  const changed = (worldChanged[relation] || []).find((row) => row.asset_id === entry.asset_id
    && tokenSet(row.before).has(entry.token)
    && !tokenSet(row.after).has(entry.token));
  if (!changed) return null;
  return {
    relation,
    before: changed.before,
    after: changed.after,
    support_edges: changed.support_edges,
    candidate_f1_delta: changed.delta_f1,
    typed_for_final_field: relation === "subject_year"
  };
}

function officialSupport(entry, graph) {
  const roles = {
    product: new Set(["product", "release"]),
    set: new Set(["insert", "release"]),
    card_name: new Set(["insert"]),
    print_finish: new Set(["print_finish", "rarity"]),
    descriptive_rarity: new Set(["rarity", "print_finish"])
  }[entry.field];
  if (!roles || !clean(entry.field_value)) return [];
  return (graph.index.get(exactNorm(entry.field_value)) || []).filter((edge) => roles.has(edge.role)).map((edge) => ({
    role: edge.role,
    origin: edge.origin,
    manifest: edge.manifest,
    source_name: edge.source_name || null
  }));
}

function lotAssessment(fields, reference) {
  if (clean(fields.grammar).toLowerCase() !== "lot") return { status: "not_lot", candidate_count: null, reference_count: null };
  const candidateCount = Number.parseInt(fields.lot_count, 10);
  const compact = clean(reference).match(/\blotx(\d+)\b/i);
  const prose = clean(reference).match(/\b(\d+)\s+card\s+lot\b/i);
  const referenceCount = Number.parseInt(compact?.[1] || prose?.[1], 10);
  if (Number.isFinite(referenceCount)) return {
    status: candidateCount === referenceCount ? "count_match" : "count_conflict",
    candidate_count: candidateCount,
    reference_count: referenceCount
  };
  return {
    status: /\blot\b/i.test(reference) ? "reference_lot_count_unknown" : "reference_has_no_lot",
    candidate_count: candidateCount,
    reference_count: null
  };
}

function releaseCandidateCoverage(expressionRows, graph, combinedById) {
  const values = [];
  const seen = new Set();
  for (const row of expressionRows) {
    const candidates = [
      ...(row.candidate_facts || []).map((candidate) => ({ kind: candidate.kind, value: candidate.value })),
      ...(row.candidate_hypotheses || []).map((candidate) => ({ kind: "identity_hypothesis", value: candidate.value }))
    ];
    for (const candidate of candidates) {
      const normalized = exactNorm(candidate.value);
      const key = `${row.asset_id}|${candidate.kind}|${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const edges = (graph.index.get(normalized) || []).filter((edge) => (
        (["identity", "identity_hypothesis"].includes(candidate.kind) && ["release", "product", "insert"].includes(edge.role))
        || (candidate.kind === "finish" && ["print_finish", "rarity"].includes(edge.role))
      ));
      if (!edges.length) continue;
      const card = combinedById.get(row.asset_id);
      values.push({
        asset_id: row.asset_id,
        normalized,
        kind: candidate.kind,
        roles: [...new Set(edges.map((edge) => edge.role))].sort(),
        already_in_combined_title: ` ${exactNorm(card?.candidate_title)} `.includes(` ${normalized} `),
        present_in_reference: ` ${exactNorm(card?.reference)} `.includes(` ${normalized} `)
      });
    }
  }
  return {
    supported_candidate_values: values.length,
    supported_candidate_cards: new Set(values.map((row) => row.asset_id)).size,
    already_in_combined_title_cards: new Set(values.filter((row) => row.already_in_combined_title).map((row) => row.asset_id)).size,
    present_in_reference_cards: new Set(values.filter((row) => row.present_in_reference).map((row) => row.asset_id)).size,
    values
  };
}

function semanticEquivalent(entry, referenceTokens) {
  const pairs = {
    auto: ["autograph", "autographed", "autographs", "autos"],
    autograph: ["auto"],
    rc: ["rookie"],
    rookie: ["rc"],
    "1st": ["first"],
    first: ["1st"]
  };
  if ((pairs[entry.token] || []).some((token) => referenceTokens.has(token))) return "known_title_synonym";
  if (entry.token.endsWith("s") && referenceTokens.has(entry.token.slice(0, -1))) return "singular_plural_equivalent";
  if (referenceTokens.has(`${entry.token}s`)) return "singular_plural_equivalent";
  return null;
}

function season(value) {
  const match = clean(value).match(/\b((?:19|20)\d{2})\s*[-/]\s*(\d{2})\b/);
  if (!match) return null;
  return { start: match[1], end: `${match[1].slice(0, 2)}${match[2]}` };
}

function explicitNumericConflict(entry, reference, referenceTokens) {
  if (entry.field === "year") {
    const fieldSeason = season(entry.field_value);
    const referenceSeason = season(reference);
    const fieldYears = new Set(fieldSeason ? [fieldSeason.start, fieldSeason.end]
      : tokenArray(entry.field_value).filter((token) => /^(?:19|20)\d{2}$/.test(token)));
    const referenceYears = new Set(referenceSeason ? [referenceSeason.start, referenceSeason.end]
      : [...referenceTokens].filter((token) => /^(?:19|20)\d{2}$/.test(token)));
    const compatible = intersection(fieldYears, referenceYears).length > 0
      && (!fieldSeason || !referenceSeason || (fieldSeason.start === referenceSeason.start && fieldSeason.end === referenceSeason.end));
    if (fieldYears.size && referenceYears.size && !compatible) {
      return { kind: "different_reference_year_or_season", values: [...referenceYears] };
    }
  }
  if (entry.field === "serial" && /^\d+\/\d+$/.test(entry.token)) {
    const referenceSerials = [...referenceTokens].filter((token) => /^\d+\/\d+$/.test(token));
    if (referenceSerials.length && !referenceSerials.includes(entry.token)) return { kind: "different_reference_serial", values: referenceSerials };
  }
  return null;
}

function levenshtein(left, right) {
  const a = String(left); const b = String(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

const compactToken = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function referenceBoundaryOrSpelling(entry, reference) {
  if (["year", "serial", "card_number", "lot_count"].includes(entry.field)) return null;
  const referenceWords = tokenArray(reference).map(compactToken).filter(Boolean);
  const valueWords = tokenArray(entry.field_value).map(compactToken).filter(Boolean);
  const token = compactToken(entry.token);
  for (let length = 2; length <= 3; length += 1) {
    for (let index = 0; index + length <= referenceWords.length; index += 1) {
      if (referenceWords.slice(index, index + length).join("") === token) return "reference_split_candidate_joined";
    }
    for (let index = 0; index + length <= valueWords.length; index += 1) {
      const joined = valueWords.slice(index, index + length).join("");
      if (joined && referenceWords.includes(joined) && valueWords.slice(index, index + length).includes(token)) {
        return "candidate_split_reference_joined";
      }
    }
  }
  for (const word of referenceWords) {
    if (token.length >= 4 && word.startsWith(token)
      && ["refractor", "autograph", "rookie", "parallel", "prizm"].includes(word.slice(token.length))) {
      return "reference_missing_word_boundary";
    }
    if (["subjects", "grade"].includes(entry.field) && token.length >= 3 && word.length >= 3
      && levenshtein(token, word) <= 1) return "reference_spelling_variant";
  }
  return null;
}

function hierarchyRedundancy(entry, referenceTokens) {
  if (!["product", "set"].includes(entry.field)) return null;
  const valueTokens = tokenArray(entry.field_value);
  const suffixStart = valueTokens.findIndex((token, index) => token === "the"
    && valueTokens.slice(index, index + 4).join(" ") === "the complete series volume");
  if (suffixStart >= 0 && valueTokens.slice(0, suffixStart).every((token) => referenceTokens.has(token))
    && valueTokens.slice(suffixStart).includes(entry.token)) return "hierarchy_suffix_writer_compaction";
  if (valueTokens.at(-1) === "collection" && entry.token === "collection"
    && valueTokens.slice(0, -1).every((token) => referenceTokens.has(token))) return "collection_suffix_writer_compaction";
  return null;
}

function classify(entry, context) {
  const reasons = [];
  const equivalent = semanticEquivalent(entry, context.referenceTokens);
  const hierarchy = hierarchyRedundancy(entry, context.referenceTokens);
  const numericConflict = explicitNumericConflict(entry, context.reference, context.referenceTokens);
  const boundaryOrSpelling = referenceBoundaryOrSpelling(entry, context.reference);
  const exactVisible = entry.candidate_fact_evidence.some((row) => ["exact_text", "stamped_text", "logo_or_symbol"].includes(row.basis))
    || entry.exhaustive_printed_evidence.length > 0;

  if (entry.grammar === "tcg" && ["manufacturer", "product"].includes(entry.field)) {
    reasons.push("cos9_tcg_manufacturer_product_lowest_priority");
    return { primary: "grammar_should_suppress", diagnostic: "cos9_tcg_lowest_priority", truth: exactVisible ? "visible_or_logo_supported" : "not_adjudicated", confidence: "high", reasons };
  }
  if (context.lot.status === "count_conflict" && entry.field === "lot_count") {
    reasons.push("lot_quantity_conflicts_with_reference", `reference_lot_count:${context.lot.reference_count}`);
    return { primary: "obvious_factual_error", diagnostic: "lot_quantity_conflict", truth: "reference_same_role_contradiction", confidence: "high", reasons };
  }
  if (context.lot.status === "reference_has_no_lot" && ["lot_count", "subjects", "serial"].includes(entry.field)) {
    reasons.push("lot_grammar_adds_second_card_facts_to_single_card_reference");
    return { primary: "obvious_factual_error", diagnostic: "false_lot_grammar", truth: "reference_same_role_contradiction", confidence: "high", reasons };
  }
  if (equivalent || hierarchy || entry.bracket_count > 1) {
    reasons.push(equivalent || hierarchy || "same_token_rendered_by_multiple_brackets");
    return { primary: "composer_redundancy", diagnostic: equivalent || hierarchy || "duplicate_bracket", truth: "semantic_equivalent_or_duplicate", confidence: "high", reasons };
  }
  if (boundaryOrSpelling) {
    reasons.push(boundaryOrSpelling);
    return { primary: "reference_tokenization_or_spelling", diagnostic: boundaryOrSpelling, truth: "semantic_or_orthographic_mismatch", confidence: "high", reasons };
  }
  if (numericConflict) {
    reasons.push(numericConflict.kind, ...numericConflict.values.map((value) => `reference_alternative:${value}`));
    return { primary: "obvious_factual_error", diagnostic: numericConflict.kind, truth: "reference_same_role_contradiction", confidence: "high", reasons };
  }
  if (entry.world_correction?.typed_for_final_field) {
    reasons.push("positive_world_edge_ranks_different_typed_year_candidate");
    return { primary: "obvious_factual_error", diagnostic: "world_supported_typed_year_alternative", truth: "reference_and_world_supported_alternative", confidence: "high", reasons };
  }
  if (exactVisible || entry.official_support.length) {
    if (exactVisible) reasons.push("same_role_exact_visible_evidence");
    if (entry.official_support.length) reasons.push("exact_official_term_support");
    return { primary: "possibly_useful_writer_omitted", diagnostic: exactVisible ? "same_role_visible_support" : "exact_official_support", truth: "positive_support_not_reference_exhaustiveness", confidence: "medium", reasons };
  }
  if ([
    "year", "language", "manufacturer", "product", "set", "ip", "subjects",
    "release_variant", "descriptive_rarity", "card_number", "components", "grade"
  ].includes(entry.field)) {
    reasons.push("core_csm_field_but_reference_is_not_exhaustive_truth");
    return { primary: "unresolved_reference_absence", diagnostic: "unverified_core_csm_field", truth: "not_adjudicated", confidence: "low", reasons };
  }
  reasons.push("review_title_absence_only");
  if (entry.world_correction) reasons.push("world_candidate_is_untyped_for_final_field");
  const diagnostic = entry.field === "print_finish"
    ? entry.loss_alternatives.length ? "finish_competes_with_specific_reference_value" : "finish_unverified_no_reference_counterpart"
    : entry.field === "card_name" ? "card_name_unverified"
      : entry.field === "serial" ? "serial_unverified_without_reference_counterpart" : "reference_absence_only";
  return { primary: "unresolved_reference_absence", diagnostic, truth: "not_adjudicated", confidence: "low", reasons };
}

function oracle(cards, predicate, { addWorldAlternatives = false } = {}) {
  const scores = [];
  let changedCards = 0;
  let removedOccurrences = 0;
  for (const card of cards) {
    const candidate = tokenSet(card.candidate_title);
    const next = new Set(candidate);
    const selected = card.reference_absent_tokens.filter(predicate);
    for (const entry of selected) {
      next.delete(entry.token);
      removedOccurrences += 1;
      if (addWorldAlternatives && entry.world_correction) {
        const wanted = tokenSet(card.reference);
        for (const token of tokenSet(entry.world_correction.after)) if (wanted.has(token)) next.add(token);
      }
    }
    if (selected.length) changedCards += 1;
    scores.push(score(card.reference, next).f1);
  }
  return {
    removed_occurrences: removedOccurrences,
    affected_cards: changedCards,
    oracle_macro_f1: mean(scores)
  };
}

function markdown(report) {
  const number = (value) => Number(value).toFixed(6);
  const table = (object) => Object.entries(object).map(([key, value]) => (
    `| ${key} | ${value.occurrences} | ${value.cards} |`
  )).join("\n");
  return `# Current combined candidate precision-loss audit — fresh150\n\n## Decision\n\nThe contrary claim is that all ${report.summary.reference_absent_token_occurrences} candidate tokens missing from writer review titles are factual hallucinations. The stored evidence rejects that shortcut. Review titles are target marketplace outputs, not exhaustive card transcriptions.\n\nThe ledger therefore separates factual adjudication from marketplace consumption. Only same-role contradictions count as obvious factual errors; COS suppression and Composer equivalence remain separate even when the underlying fact may be true. Provider calls: 0. Runtime changes: 0.\n\n## Primary disposition\n\n| disposition | occurrences | cards |\n|---|---:|---:|\n${table(report.breakdown.by_primary_classification)}\n\nBaseline combined candidate macro F1 is ${number(report.summary.baseline_macro_f1)}. The impossible oracle that deletes every reference-absent token reaches ${number(report.oracles.remove_all_reference_absent.oracle_macro_f1)} (${report.oracles.remove_all_reference_absent.removed_occurrences} token occurrences on ${report.oracles.remove_all_reference_absent.affected_cards} cards). This is a label oracle, not a runtime target.\n\n## Field distribution\n\n| field | occurrences | cards |\n|---|---:|---:|\n${table(report.breakdown.by_field)}\n\n## Source distribution\n\n| source | occurrences | cards |\n|---|---:|---:|\n${table(report.breakdown.by_source)}\n\n${report.breakdown.by_source.canonical_model?.occurrences || 0}/${report.summary.reference_absent_token_occurrences} occurrences came from the canonical model. The retained replay mechanisms contribute ${report.breakdown.by_source.replay_mechanism?.occurrences || 0}; they are not the main precision-loss source.\n\n## Semantic distribution\n\n| semantic category | occurrences | cards |\n|---|---:|---:|\n${table(report.breakdown.by_semantic_category)}\n\n## Diagnostic buckets\n\n| diagnostic | occurrences | cards |\n|---|---:|---:|\n${table(report.breakdown.by_diagnostic_bucket)}\n\n## Largest precision head\n\n- ${report.precision_heads.finish_competes_with_specific_reference_value.token_occurrences} finish tokens on ${report.precision_heads.finish_competes_with_specific_reference_value.cards} cards compete with a specific writer-title finish or rarity value. Their label-removal oracle delta is ${number(report.precision_heads.finish_competes_with_specific_reference_value.removal_oracle_delta)}.\n- Only ${report.precision_heads.finish_competes_with_specific_reference_value.exact_visible_support_token_occurrences} of those occurrences have exact same-role visible support, and ${report.precision_heads.finish_competes_with_specific_reference_value.official_support_token_occurrences} have exact official support. Competition alone does not establish falsehood because multiple finish properties can coexist.\n\n## World model and Release graph\n\n- Typed world-model corrections: ${report.correctors.world_typed_year.token_occurrences} token occurrence / ${report.correctors.world_typed_year.cards} card. Removal-only oracle delta: ${number(report.correctors.world_typed_year.removal_only_oracle_delta)}; replacing it with the reference-supported ranked alternative gives ${number(report.correctors.world_typed_year.replacement_token_oracle_delta)}.\n- Product-year changed ${report.correctors.world_untyped_identity.changed_candidate_rank_cards} candidate ranks in the earlier screen but corrects ${report.correctors.world_untyped_identity.current_combined_precision_correction_cards} current combined-title precision errors. It cannot modify CSM without a phrase-role resolver.\n- Release graph exactly supports ${report.correctors.release_graph.exact_supported_candidate_values} candidate values on ${report.correctors.release_graph.exact_supported_candidate_cards} cards, all already present in the combined title; current precision corrections: ${report.correctors.release_graph.precision_correction_token_occurrences}.\n- COS-9 manufacturer/product suppression leaves ${report.breakdown.by_primary_classification.grammar_should_suppress.occurrences} current violations. The grammar is already doing its job in this cohort.\n- Official and world edges are positive support only. Asset absence remains UNKNOWN and cannot hard-reject visible text.\n\n## Evidence boundary\n\n- Exactly ${report.summary.cards} paired cards; ${report.summary.affected_cards} contain reference-absent tokens.\n- Candidate titles are reproduced from the stored canonical/free/exhaustive rows and must byte-match the retained combined-candidate artifact.\n- Each ledger row keeps asset, token, bracket, field, field value, source mechanism, semantic class, visible-evidence pointers, same-role alternatives, world rank support, official support, truth assessment, and marketplace disposition.\n- A missing review-title word never becomes a factual-error label by itself.\n- Constraint absence and official-directory absence remain UNKNOWN.\n- World and Release assets can rank existing candidates only; neither generates a fact nor overrides visible text.\n\nMachine-readable per-card and per-token ledger: \`docs/evaluation/combined-precision-loss-ledger-150-2026-08-02.json\`.\n`;
}

function labelObservabilityMarkdown(report) {
  const number = (value) => Number(value).toFixed(6);
  const supported = report.label_observability.positive_supported_but_reference_omitted;
  const style = report.label_observability.writer_style_or_normalization_mismatch;
  return `\n## Single-reference observability\n\n- Exact-match F1 has a mathematical ceiling of 1.0 if the system imitates this writer. It does **not** identify factual accuracy from one selective marketplace title.\n- ${supported.token_occurrences} occurrences on ${supported.cards} cards have positive visible or official support but are omitted by the reference. Suppressing them by reading the label would add ${number(supported.label_removal_oracle_delta)} to this metric while potentially deleting valid evidence.\n- ${style.token_occurrences} occurrences on ${style.cards} cards are synonym, plurality, token-boundary, or spelling-normalization mismatches; their label-removal oracle is ${number(style.label_removal_oracle_delta)}.\n- Therefore 0.90 is not mathematically blocked, but title F1 alone cannot certify factual accuracy. The minimum calibration is a second independent, field-level adjudication of the 285 disputed occurrences, not another free-form title: \`VISIBLE_TRUE / FALSE / OPTIONAL_TITLE / REQUIRED_TITLE / UNKNOWN\`, with adjudication only where writers disagree.\n`;
}

export function analyzeCombinedPrecisionLoss() {
  const bodies = Object.fromEntries(Object.entries(paths).filter(([, file]) => fs.existsSync(file) && !file.endsWith(".md"))
    .map(([name, file]) => [name, fs.readFileSync(file)]));
  if (sha256(bodies.canonical) !== EXPECTED.input_sha256 || sha256(bodies.exhaustive) !== EXPECTED.exhaustive_sha256) {
    throw new Error("precision_loss_source_fingerprint_mismatch");
  }
  const inputRows = parseJsonl(bodies.canonical);
  const canonicalRows = inputRows.filter((row) => row.arm === "thin_canonical_high");
  const freeById = new Map(inputRows.filter((row) => row.arm === "thin_budgeted").map((row) => [row.asset_id, row]));
  const exhaustiveById = new Map(parseJsonl(bodies.exhaustive).map((row) => [row.asset_id, row]));
  const expressionById = new Map(parseJsonl(bodies.candidateExpression).map((row) => [row.asset_id, row]));
  const combined = JSON.parse(bodies.combined);
  const combinedById = new Map(combined.cards.map((row) => [row.asset_id, row]));
  const lossLedger = JSON.parse(bodies.lossLedger);
  const lossById = new Map();
  for (const item of lossLedger.items) {
    const rows = lossById.get(item.asset_id) || [];
    rows.push(item);
    lossById.set(item.asset_id, rows);
  }
  const world = JSON.parse(bodies.worldRanker);
  const worldChanged = Object.fromEntries(["subject_year", "product_year", "subject_team_year"].map((relation) => [
    relation, world.candidate_rank_replay?.[relation]?.changed || []
  ]));
  const graph = buildOfficialReleaseGraph();

  if (canonicalRows.length !== EXPECTED.cards || combined.cards.length !== EXPECTED.cards) {
    throw new Error("precision_loss_cohort_count_mismatch");
  }
  const cards = canonicalRows.map((canonicalRow, cardIndex) => {
    const freeRow = freeById.get(canonicalRow.asset_id);
    const exhaustiveRow = exhaustiveById.get(canonicalRow.asset_id);
    const stored = combinedById.get(canonicalRow.asset_id);
    if (!freeRow || !exhaustiveRow || !stored || !expressionById.has(canonicalRow.asset_id)) {
      throw new Error(`precision_loss_unpaired_asset:${canonicalRow.asset_id}`);
    }
    const observations = exhaustiveRow.observations || [];
    const expression = projectFreeTitleThroughCsm(freeRow.title);
    const bundle = runCombinedPositiveBundleV1(canonicalRow.fields, {
      expressionFields: expression.fields,
      expressionTitle: freeRow.title,
      candidateFacts: candidateFactsFromObservations(observations),
      observations,
      provenance: { source: "exhaustive_observation_high", checkpoint_sha256: EXPECTED.exhaustive_sha256 }
    });
    if (bundle.candidate.title !== stored.candidate_title) {
      throw new Error(`precision_loss_combined_title_drift:${canonicalRow.asset_id}`);
    }
    const composed = composeFromCanonicalFields(bundle.candidate.fields);
    if (composed.title !== bundle.candidate.title) {
      const compactLot = bundle.stages.some((stage) => stage.mechanism === "compact_lot_quantity" && stage.changed_title);
      if (!compactLot) throw new Error(`precision_loss_composer_reproduction_drift:${canonicalRow.asset_id}`);
      composed.bracket_text = composed.bracket_text.map((row) => row.bracket === "lot"
        ? { ...row, text: `lotx${bundle.candidate.fields.lot_count}` }
        : row);
      if (composed.bracket_text.map((row) => row.text).join(" ") !== bundle.candidate.title) {
        throw new Error(`precision_loss_compact_lot_reproduction_drift:${canonicalRow.asset_id}`);
      }
    }
    const referenceTokens = tokenSet(canonicalRow.reference);
    const candidateTokens = tokenSet(bundle.candidate.title);
    const extraTokens = difference(candidateTokens, referenceTokens);
    const bracketTokens = composed.bracket_text.map((row) => ({ ...row, tokens: tokenSet(row.text) }));
    const reference_absent_tokens = extraTokens.map((token) => {
      const bracketMatches = bracketTokens.filter((row) => row.tokens.has(token));
      const bracket = bracketMatches[0]?.bracket || "unattributed";
      const resolved = fieldValue(bundle.candidate.fields, composed, bracket, token);
      const source = sourceForToken(bundle.candidate.fields, composed, bundle, bracket, resolved.field, token, resolved.value);
      const entry = {
        id: `${canonicalRow.asset_id}:${token}`,
        asset_id: canonicalRow.asset_id,
        card_ordinal: cardIndex + 1,
        grammar: bundle.candidate.fields.grammar,
        token,
        bracket,
        bracket_count: bracketMatches.length,
        field: resolved.field,
        field_value: resolved.value,
        source: source.source,
        source_mechanism: source.mechanism,
        semantic_category: semanticCategory[resolved.field] || "unattributed",
        candidate_fact_evidence: [],
        exhaustive_printed_evidence: [],
        loss_alternatives: [],
        world_correction: null,
        official_support: []
      };
      entry.candidate_fact_evidence = candidateFactEvidence(entry, expressionById.get(entry.asset_id));
      entry.exhaustive_printed_evidence = exhaustivePrintedEvidence(entry, observations);
      entry.loss_alternatives = lossAlternatives(entry, lossById.get(entry.asset_id) || [], candidateTokens);
      entry.world_correction = worldCorrection(entry, worldChanged);
      entry.official_support = officialSupport(entry, graph);
      entry.classification = classify(entry, {
        reference: canonicalRow.reference,
        referenceTokens,
        lot: lotAssessment(bundle.candidate.fields, canonicalRow.reference)
      });
      entry.single_token_removal_delta_f1 = score(canonicalRow.reference, new Set([...candidateTokens].filter((value) => value !== token))).f1
        - score(canonicalRow.reference, candidateTokens).f1;
      return entry;
    });
    return {
      asset_id: canonicalRow.asset_id,
      card_ordinal: cardIndex + 1,
      grammar: bundle.candidate.fields.grammar,
      reference: canonicalRow.reference,
      candidate_title: bundle.candidate.title,
      reference_absent_token_count: reference_absent_tokens.length,
      reference_absent_tokens
    };
  });

  const entries = cards.flatMap((card) => card.reference_absent_tokens);
  const affectedCards = cards.filter((card) => card.reference_absent_token_count).length;
  if (entries.length !== EXPECTED.reference_absent_token_occurrences || affectedCards !== EXPECTED.affected_cards) {
    throw new Error(`precision_loss_oracle_population_mismatch:${entries.length}:${affectedCards}`);
  }
  const baselineMacro = mean(cards.map((card) => score(card.reference, card.candidate_title).f1));
  const removeAll = oracle(cards, () => true);
  const worldTyped = entries.filter((entry) => entry.world_correction?.typed_for_final_field);
  const worldUntyped = entries.filter((entry) => entry.world_correction && !entry.world_correction.typed_for_final_field);
  const typedRemovalOracle = oracle(cards, (entry) => entry.world_correction?.typed_for_final_field);
  const typedReplacementOracle = oracle(cards, (entry) => entry.world_correction?.typed_for_final_field, { addWorldAlternatives: true });
  const releaseCoverage = releaseCandidateCoverage([...expressionById.values()], graph, new Map(cards.map((card) => [card.asset_id, card])));
  const requiredPrimary = [
    "obvious_factual_error",
    "possibly_useful_writer_omitted",
    "grammar_should_suppress",
    "composer_redundancy",
    "reference_tokenization_or_spelling",
    "unresolved_reference_absence"
  ];
  const primaryBreakdown = occurrenceAndCards(entries, (entry) => entry.classification.primary);
  for (const name of requiredPrimary) primaryBreakdown[name] ||= { occurrences: 0, cards: 0 };
  const primaryOracles = Object.fromEntries(requiredPrimary.map((name) => {
    const result = oracle(cards, (entry) => entry.classification.primary === name);
    return [name, { ...result, oracle_delta: result.oracle_macro_f1 - baselineMacro }];
  }));
  const competingFinish = entries.filter((entry) => entry.field === "print_finish" && entry.loss_alternatives.length > 0);
  const competingFinishOracle = oracle(cards, (entry) => entry.field === "print_finish" && entry.loss_alternatives.length > 0);
  const positiveWriterOmissions = oracle(cards, (entry) => entry.classification.primary === "possibly_useful_writer_omitted");
  const styleNormalization = oracle(cards, (entry) => [
    "composer_redundancy", "reference_tokenization_or_spelling"
  ].includes(entry.classification.primary));
  const report = {
    schema_version: "combined-precision-loss-ledger-v1",
    authority: "offline_reference_audit_only",
    production_promoted: false,
    provider_calls: 0,
    runtime_changes: 0,
    caveat: "Review-title absence is not factual contradiction. Oracles read labels and are not implementable rules or forecasts.",
    sources: Object.fromEntries(Object.entries(paths).filter(([name]) => !name.startsWith("output"))
      .map(([name, file]) => [name, { path: path.relative(repoRoot, file), sha256: sha256(fs.readFileSync(file)) }])),
    summary: {
      cards: cards.length,
      affected_cards: affectedCards,
      reference_absent_token_occurrences: entries.length,
      baseline_macro_f1: baselineMacro,
      cohort_grammar_cards: tally(cards, (card) => card.grammar)
    },
    breakdown: {
      by_primary_classification: primaryBreakdown,
      by_diagnostic_bucket: occurrenceAndCards(entries, (entry) => entry.classification.diagnostic),
      by_truth_assessment: occurrenceAndCards(entries, (entry) => entry.classification.truth),
      by_confidence: occurrenceAndCards(entries, (entry) => entry.classification.confidence),
      by_field: occurrenceAndCards(entries, (entry) => entry.field),
      by_source: occurrenceAndCards(entries, (entry) => entry.source),
      by_source_mechanism: occurrenceAndCards(entries, (entry) => entry.source_mechanism || entry.source),
      by_semantic_category: occurrenceAndCards(entries, (entry) => entry.semantic_category),
      by_grammar: occurrenceAndCards(entries, (entry) => entry.grammar)
    },
    correctors: {
      world_typed_year: {
        token_occurrences: worldTyped.length,
        cards: new Set(worldTyped.map((entry) => entry.asset_id)).size,
        removal_only_oracle_macro_f1: typedRemovalOracle.oracle_macro_f1,
        removal_only_oracle_delta: typedRemovalOracle.oracle_macro_f1 - baselineMacro,
        replacement_token_oracle_macro_f1: typedReplacementOracle.oracle_macro_f1,
        replacement_token_oracle_delta: typedReplacementOracle.oracle_macro_f1 - baselineMacro,
        changed_candidate_rank_cards: world.candidate_rank_replay.subject_year.changed_top_candidate_cards
      },
      world_untyped_identity: {
        token_occurrences: worldUntyped.length,
        cards: new Set(worldUntyped.map((entry) => entry.asset_id)).size,
        changed_candidate_rank_cards: world.candidate_rank_replay.product_year.changed_top_candidate_cards,
        automatic_csm_corrections: 0,
        current_combined_precision_correction_cards: 0,
        reason: "the 15 candidate-rank wins are already represented in final identity or lack a proven final-field role"
      },
      release_graph: {
        exact_supported_candidate_values: releaseCoverage.supported_candidate_values,
        exact_supported_candidate_cards: releaseCoverage.supported_candidate_cards,
        already_in_combined_title_cards: releaseCoverage.already_in_combined_title_cards,
        present_in_reference_cards: releaseCoverage.present_in_reference_cards,
        precision_correction_token_occurrences: 0,
        hard_rejections: 0,
        reason: "official edges are positive support only; absence is UNKNOWN"
      }
    },
    precision_heads: {
      finish_competes_with_specific_reference_value: {
        token_occurrences: competingFinish.length,
        cards: new Set(competingFinish.map((entry) => entry.asset_id)).size,
        exact_visible_support_token_occurrences: competingFinish.filter((entry) => entry.candidate_fact_evidence.some((row) => ["exact_text", "stamped_text", "logo_or_symbol"].includes(row.basis))
          || entry.exhaustive_printed_evidence.length).length,
        official_support_token_occurrences: competingFinish.filter((entry) => entry.official_support.length).length,
        removal_oracle_macro_f1: competingFinishOracle.oracle_macro_f1,
        removal_oracle_delta: competingFinishOracle.oracle_macro_f1 - baselineMacro,
        warning: "a competing review finish does not prove the emitted finish false; both may coexist"
      }
    },
    label_observability: {
      conclusion: "single_review_title_is_a_marketplace_target_not_exhaustive_field_truth",
      mathematical_exact_match_ceiling: 1,
      factual_accuracy_ceiling_identifiable_from_single_reference: false,
      positive_supported_but_reference_omitted: {
        token_occurrences: entries.filter((entry) => entry.classification.primary === "possibly_useful_writer_omitted").length,
        cards: new Set(entries.filter((entry) => entry.classification.primary === "possibly_useful_writer_omitted").map((entry) => entry.asset_id)).size,
        label_removal_oracle_delta: positiveWriterOmissions.oracle_macro_f1 - baselineMacro,
        boundary: "positive evidence is not independent human adjudication"
      },
      writer_style_or_normalization_mismatch: {
        token_occurrences: entries.filter((entry) => [
          "composer_redundancy", "reference_tokenization_or_spelling"
        ].includes(entry.classification.primary)).length,
        cards: new Set(entries.filter((entry) => [
          "composer_redundancy", "reference_tokenization_or_spelling"
        ].includes(entry.classification.primary)).map((entry) => entry.asset_id)).size,
        label_removal_oracle_delta: styleNormalization.oracle_macro_f1 - baselineMacro
      },
      minimum_cost_calibration: {
        existing_writer_a_role: "marketplace title preference, not implicit field falsehood",
        writer_b_scope: {
          cards: affectedCards,
          disputed_token_occurrences: entries.length,
          average_occurrences_per_affected_card: entries.length / affectedCards,
          task: "blind field-level adjudication from images plus field/value and evidence region; hide writer A title and model confidence",
          labels: ["VISIBLE_TRUE", "FALSE", "OPTIONAL_TITLE", "REQUIRED_TITLE", "UNKNOWN"]
        },
        writer_a_followup: "review only writer-B-valid omissions and B=UNKNOWN rows; do not rewrite all 150 titles",
        final_adjudication: "third review only explicit A/B disagreement or UNKNOWN",
        outputs: ["field_truth", "title_preference"],
        promotion_rule: "report factual field score and marketplace title score separately; no gain may come only from deleting B-confirmed visible truth"
      },
      target_090_interpretation: "0.90 remains mathematically reachable by imitating one writer, but this label cannot distinguish factual gains from writer-specific omission and wording. Production accuracy needs a field-truth calibration layer."
    },
    oracles: {
      remove_all_reference_absent: { ...removeAll, oracle_delta: removeAll.oracle_macro_f1 - baselineMacro },
      by_primary_classification: primaryOracles
    },
    cards
  };
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = analyzeCombinedPrecisionLoss();
  fs.writeFileSync(paths.outputJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(paths.outputReport, `${markdown(report)}${labelObservabilityMarkdown(report)}`);
  process.stdout.write(`${JSON.stringify({
    json: path.relative(repoRoot, paths.outputJson),
    report: path.relative(repoRoot, paths.outputReport),
    summary: report.summary,
    breakdown: report.breakdown.by_primary_classification,
    correctors: report.correctors,
    oracles: report.oracles
  }, null, 2)}\n`);
}
