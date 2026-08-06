#!/usr/bin/env node
// Zero-provider-cost counterfactual for the proposed architecture:
//
//   free model expression -> evidence filter -> CSM projection -> Composer
//
// It reuses stored `thin_budgeted` titles as the free-expression output. A CSM
// title parser may propose fields, but a proposal is admitted only when all of
// its meaningful tokens occur in the model's title. This keeps the experiment
// about projection, not about silently importing the parser's product aliases.

import { readFileSync } from "node:fs";

import { titleDerivedSemSuggestion } from "../lib/listing/csm/title-derived-sem.mjs";
import { losslessTitleDerivedSem } from "../lib/listing/csm/title-derived-sem-v2.mjs";
import { semGrammarForResolved, semTcgIpLabel } from "../lib/listing/csm/sem-definition.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const tokens = (value) => clean(value).normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function anchored(source, value) {
  const sourceTokens = new Set(tokens(source));
  return tokens(value).every((token) => sourceTokens.has(token));
}

function anchoredValue(source, value) {
  if (Array.isArray(value)) return value.filter((item) => anchored(source, item));
  return value && anchored(source, value) ? value : "";
}

function gradeText(source, grading = {}) {
  const company = anchoredValue(source, grading.company);
  const cardGrade = anchoredValue(source, grading.card_grade);
  return [company, cardGrade].filter(Boolean).join(" ");
}

export function projectFreeTitleThroughCsm(title = "") {
  const sem = titleDerivedSemSuggestion(title);
  const search = anchoredValue(title, sem.search_optimization || []);
  const componentNames = new Set(["RC", "Auto", "Patch", "Relic", "Jersey"]);
  const components = search.filter((value) => componentNames.has(value));
  const team = search.find((value) => !componentNames.has(value)) || "";
  const lotCount = clean(title).match(/\blotx\s*(\d+)\b/i)?.[1] || "";
  const classification = {
    ip: anchoredValue(title, sem.ip_sport),
    product: anchoredValue(title, sem.product),
    set: anchoredValue(title, sem.set),
    card_name: anchoredValue(title, sem.card_name)
  };
  const grammar = lotCount
    ? "lot"
    : semGrammarForResolved(classification) === "TCG" ? "tcg" : "standard";

  const fields = {
    year: anchoredValue(title, sem.year),
    language: anchoredValue(title, sem.language),
    manufacturer: anchoredValue(title, sem.manufacturer),
    product: classification.product,
    set: classification.set,
    subjects: anchoredValue(title, sem.subject || []).slice(0, 3),
    team,
    card_name: classification.card_name,
    release_variant: anchoredValue(title, sem.release_variant),
    // The parser found this exact phrase in the free title. Treat it as an
    // explicit observation so Composer does not demand a second decomposition.
    parallel_exact: anchoredValue(title, sem.print_finish),
    surface_color: "",
    parallel_family: "",
    print_finish: anchoredValue(title, sem.print_finish),
    descriptive_rarity: anchoredValue(title, sem.descriptive_rarity),
    card_number: anchoredValue(title, sem.card_number),
    serial: anchoredValue(title, sem.numerical_rarity),
    attributes: components,
    components,
    grade: gradeText(title, sem.grading_info),
    grammar,
    lot_count: lotCount,
    unreadable: [],
    low_confidence: [],
    ip: grammar === "tcg" ? semTcgIpLabel(classification) : ""
  };
  return { sem, fields, ...composeFromCanonicalFields(fields) };
}

const EXTENSIBLE_FIELDS = Object.freeze(["product", "set", "card_name", "print_finish"]);

function strictTokenExtension(base, candidate) {
  const baseTokens = tokens(base);
  const candidateTokens = tokens(candidate);
  if (!baseTokens.length || candidateTokens.length <= baseTokens.length) return false;
  const candidateSet = new Set(candidateTokens);
  return baseTokens.every((token) => candidateSet.has(token));
}

/** Add only evidence that the canonical observation omitted; never replace a conflict. */
export function mergeFreeEvidenceIntoCanonical(canonical = {}, free = {}, { only = null } = {}) {
  const merged = { ...canonical };
  const allowed = only ? new Set(only) : null;
  const includes = (field) => !allowed || allowed.has(field);
  for (const field of ["year", "language", "manufacturer", "set", "card_name", "release_variant",
    "descriptive_rarity", "card_number", "serial", "grade", "team"]) {
    if (includes(field) && !clean(merged[field]) && clean(free[field])) merged[field] = free[field];
  }
  for (const field of EXTENSIBLE_FIELDS) {
    if (!includes(field)) continue;
    if (!clean(merged[field]) && clean(free[field])) merged[field] = free[field];
    else if (strictTokenExtension(merged[field], free[field])) merged[field] = free[field];
  }
  if (includes("print_finish") && merged.print_finish === free.print_finish && clean(free.parallel_exact)) {
    merged.parallel_exact = free.parallel_exact;
  }
  if (includes("components")) {
    merged.components = [...new Set([...(merged.components || []), ...(free.components || [])])];
    merged.attributes = [...new Set([...(merged.attributes || []), ...(free.attributes || [])])];
  }
  return merged;
}

function score(reference, candidate) {
  const wanted = new Set(tokens(reference));
  const got = new Set(tokens(candidate));
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

function allValueTokens(value) {
  if (Array.isArray(value)) return value.flatMap(allValueTokens);
  if (value && typeof value === "object") return Object.values(value).flatMap(allValueTokens);
  return tokens(value);
}

function bracketValues(output, names = []) {
  const wanted = new Set(names);
  return (output.bracket_text || [])
    .filter((row) => wanted.has(row.bracket))
    .flatMap((row) => tokens(row.text));
}

/**
 * Explain every reference-helpful token that the CSM projection removed.
 *
 * The stages are mutually exclusive and ordered by the earliest point where a
 * token becomes unavailable. This is intentionally token-level rather than a
 * single reason per card: one title can lose a product phrase in the parser
 * and a team at the marketplace profile at the same time.
 */
export function diagnoseProjectionLoss({ row, output, before, after }) {
  if (after.f1 >= before.f1 - 1e-9) return null;
  const reference = new Set(tokens(row.reference));
  const input = new Set(tokens(row.title));
  const rendered = new Set(tokens(output.title));
  const sem = new Set(allValueTokens(output.sem));
  const admitted = new Set(allValueTokens(output.fields));
  const suppressed = new Set([
    ...bracketValues(output, output.suppressed),
    ...(output.suppressed.includes("search_optimization") ? tokens(output.fields.team) : [])
  ]);
  const dropped = new Set(bracketValues(output, output.dropped));
  const lostHelpful = [...reference].filter((token) => input.has(token) && !rendered.has(token));
  const causes = {
    parser: [],
    admission_filter: [],
    marketplace_profile: [],
    budget_drop: [],
    composer_normalization: []
  };
  for (const token of lostHelpful) {
    if (!sem.has(token)) causes.parser.push(token);
    else if (!admitted.has(token)) causes.admission_filter.push(token);
    else if (suppressed.has(token)) causes.marketplace_profile.push(token);
    else if (dropped.has(token) || output.dropped.length) causes.budget_drop.push(token);
    else causes.composer_normalization.push(token);
  }
  return {
    asset_id: row.asset_id,
    input: row.title,
    output: output.title,
    reference: row.reference,
    delta_f1: after.f1 - before.f1,
    lost_helpful_tokens: lostHelpful,
    causes
  };
}

function summarizeLosses(projected) {
  const rows = projected.map(diagnoseProjectionLoss).filter(Boolean);
  const stages = ["parser", "admission_filter", "marketplace_profile", "budget_drop", "composer_normalization"];
  const byStage = Object.fromEntries(stages.map((stage) => {
    const affected = rows.filter((row) => row.causes[stage].length);
    const frequency = new Map();
    for (const row of affected) for (const token of row.causes[stage]) {
      frequency.set(token, (frequency.get(token) || 0) + 1);
    }
    return [stage, {
      affected_rows: affected.length,
      lost_token_occurrences: affected.reduce((sum, row) => sum + row.causes[stage].length, 0),
      top_tokens: [...frequency.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 20).map(([token, count]) => ({ token, count }))
    }];
  }));
  const parserLost = rows.flatMap((row) => row.causes.parser.map((token) => ({ row, token })));
  const losslessRecovered = parserLost.filter(({ row, token }) => {
    const ledger = losslessTitleDerivedSem(row.input).token_ledger;
    return ledger.some((entry) => tokens(entry.text).includes(token));
  });
  return {
    loss_rows: rows.length,
    by_stage: byStage,
    lossless_v2_recovery: {
      parser_lost_token_occurrences: parserLost.length,
      preserved_as_evidence: losslessRecovered.length,
      promoted_to_canonical: 0,
      interpretation: "information recovery only; no F1 credit until a later resolver assigns the span"
    },
    rows
  };
}

function signTest(deltas) {
  const wins = deltas.filter((delta) => delta > 1e-9).length;
  const losses = deltas.filter((delta) => delta < -1e-9).length;
  const trials = wins + losses;
  let coefficient = 1;
  let tail = 0;
  for (let k = 0; k <= Math.min(wins, losses); k += 1) {
    if (k) coefficient = coefficient * (trials - k + 1) / k;
    tail += coefficient;
  }
  return { wins, losses, ties: deltas.length - trials, p: trials ? Math.min(1, 2 * tail * 0.5 ** trials) : 1 };
}

export function measure(rows = []) {
  const canonicalByAsset = new Map(rows.filter((row) => row.arm === "thin_canonical" && row.fields)
    .map((row) => [row.asset_id, row]));
  const projected = rows.filter((row) => row.arm === "thin_budgeted").map((row) => {
    const output = projectFreeTitleThroughCsm(row.title);
    const canonical = canonicalByAsset.get(row.asset_id);
    const canonicalComposed = canonical ? composeFromCanonicalFields(canonical.fields) : null;
    const mergedFields = canonical ? mergeFreeEvidenceIntoCanonical(canonical.fields, output.fields) : null;
    const merged = mergedFields ? composeFromCanonicalFields(mergedFields) : null;
    return {
      row,
      output,
      canonical,
      canonicalComposed,
      merged,
      before: score(row.reference, row.title),
      after: score(row.reference, output.title),
      // Recompose both sides with the same current Composer. Comparing a new
      // merge with the historical artifact title would confound evidence gain
      // with unrelated grammar/drop-order fixes made since that run.
      canonicalScore: canonicalComposed ? score(row.reference, canonicalComposed.title) : null,
      mergedScore: merged ? score(row.reference, merged.title) : null
    };
  });
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
  const deltas = projected.map(({ before, after }) => after.f1 - before.f1);
  const pairedMerge = projected.filter(({ canonicalScore, mergedScore }) => canonicalScore && mergedScore);
  const mergeDeltas = pairedMerge.map(({ canonicalScore, mergedScore }) => mergedScore.f1 - canonicalScore.f1);
  const mergeFieldGroups = ["year", "language", "manufacturer", "product", "set", "card_name",
    "release_variant", "print_finish", "descriptive_rarity", "card_number", "serial", "grade", "team", "components"];
  const mergeFieldAblation = Object.fromEntries(mergeFieldGroups.map((field) => {
    const comparisons = projected.filter(({ canonical }) => canonical).map(({ row, output, canonical, canonicalScore }) => {
      const candidate = composeFromCanonicalFields(mergeFreeEvidenceIntoCanonical(
        canonical.fields, output.fields, { only: [field] }
      ));
      const candidateScore = score(row.reference, candidate.title);
      return { delta: candidateScore.f1 - canonicalScore.f1 };
    });
    const deltas = comparisons.map(({ delta }) => delta);
    return [field, {
      n: comparisons.length,
      delta_f1: average(deltas),
      sign_test: signTest(deltas)
    }];
  }));
  return {
    n: projected.length,
    before: {
      f1: average(projected.map(({ before }) => before.f1)),
      recall: average(projected.map(({ before }) => before.recall)),
      precision: average(projected.map(({ before }) => before.precision))
    },
    after: {
      f1: average(projected.map(({ after }) => after.f1)),
      recall: average(projected.map(({ after }) => after.recall)),
      precision: average(projected.map(({ after }) => after.precision))
    },
    delta_f1: average(deltas),
    sign_test: signTest(deltas),
    canonical_plus_free_evidence: {
      n: pairedMerge.length,
      canonical_f1: average(pairedMerge.map(({ canonicalScore }) => canonicalScore.f1)),
      merged_f1: average(pairedMerge.map(({ mergedScore }) => mergedScore.f1)),
      delta_f1: average(mergeDeltas),
      sign_test: signTest(mergeDeltas),
      field_ablation: mergeFieldAblation
    },
    loss_diagnosis: summarizeLosses(projected),
    examples: [...projected].sort((a, b) => (b.after.f1 - b.before.f1) - (a.after.f1 - a.before.f1))
      .slice(0, 5).map(({ row, output, before, after }) => ({
        input: row.title, output: output.title, reference: row.reference, delta_f1: after.f1 - before.f1
      }))
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: measure-free-title-csm-projection.mjs <checkpoint.jsonl>");
  const rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  process.stdout.write(`${JSON.stringify(measure(rows), null, 2)}\n`);
}
