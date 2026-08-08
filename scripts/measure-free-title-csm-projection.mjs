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
const FREE_ARM = "thin_budgeted";
const CANONICAL_ARMS = new Set(["thin_canonical", "thin_canonical_high"]);

function normalizedNumericSegment(value) {
  const normalized = String(value).replace(/^0+(?=\d)/, "");
  return normalized || "0";
}

function tokenIdentity(token) {
  return /^\d+$/.test(token) ? `n:${normalizedNumericSegment(token)}` : `t:${token}`;
}

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

function addedTokens(source, candidate) {
  const sourceTokens = new Set(tokens(source).map(tokenIdentity));
  return [...new Set(tokens(candidate))].filter((token) => !sourceTokens.has(tokenIdentity(token)));
}

function numericClaims(value) {
  return [...new Set((clean(value).match(/#?\/\d+(?:\/\d+)*|\b\d+(?:\/\d+)+|\b\d+\b/g) || [])
    .map((claim) => claim.replace(/^#/, "").split("/")
      .map((part) => part ? normalizedNumericSegment(part) : "")
      .join("/")))];
}

function numericClaimIsBacked(claim, sourceClaims) {
  // Stay role-agnostic and conservative: 2024/25 -> #/25 and #136 + /175
  // -> 136/175 are mutations even though every digit existed in the source.
  // Prefix '#' and leading zero changes are normalized by numericClaims().
  return sourceClaims.has(claim);
}

function summarizeProjectionSafety(projected) {
  const cards = projected.map(({ row, output }) => {
    const unbacked = addedTokens(row.title, output.title);
    const sourceNumeric = new Set(numericClaims(row.title));
    const newNumericClaims = numericClaims(output.title)
      .filter((claim) => !numericClaimIsBacked(claim, sourceNumeric));
    return {
      asset_id: row.asset_id,
      unbacked_new_tokens: unbacked,
      new_numeric_claims: newNumericClaims,
      input: row.title,
      output: output.title
    };
  });
  return {
    cards_with_unbacked_new_tokens: cards.filter((row) => row.unbacked_new_tokens.length).length,
    cards_with_new_numeric_claims: cards.filter((row) => row.new_numeric_claims.length).length,
    numeric_check: "normalized numeric-expression equality; conservative across role or specificity changes",
    rows: cards.filter((row) => row.unbacked_new_tokens.length || row.new_numeric_claims.length)
  };
}

function validateAndIndexRows(rows) {
  if (!Array.isArray(rows)) throw new Error("free_title_projection_rows_not_array");
  const budgetedRows = rows.filter((row) => row?.arm === FREE_ARM);
  if (!budgetedRows.length) throw new Error("free_title_projection_missing_budgeted_arm");
  const canonicalRows = rows.filter((row) => CANONICAL_ARMS.has(row?.arm));
  const canonicalArms = [...new Set(canonicalRows.map((row) => row.arm))];
  if (canonicalArms.length > 1) {
    throw new Error(`free_title_projection_ambiguous_canonical_arms:${canonicalArms.sort().join(",")}`);
  }

  const indexUnique = (armRows, arm) => {
    const index = new Map();
    for (const row of armRows) {
      const assetId = clean(row.asset_id);
      if (!assetId) throw new Error(`free_title_projection_missing_asset_id:${arm}`);
      if (index.has(assetId)) throw new Error(`free_title_projection_duplicate_asset:${arm}:${assetId}`);
      if (!clean(row.reference)) throw new Error(`free_title_projection_missing_reference:${arm}:${assetId}`);
      index.set(assetId, row);
    }
    return index;
  };

  const budgetedByAsset = indexUnique(budgetedRows, FREE_ARM);
  const canonicalArm = canonicalArms[0] || null;
  const canonicalByAsset = indexUnique(canonicalRows, canonicalArm || "canonical");
  if (canonicalRows.some((row) => !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))) {
    throw new Error(`free_title_projection_missing_canonical_fields:${canonicalArm}`);
  }

  let imageSetVerifiedPairs = 0;
  let runFingerprintVerifiedPairs = 0;
  let configurationVerifiedPairs = 0;
  if (canonicalRows.length) {
    if (canonicalRows.length !== budgetedRows.length) {
      throw new Error(`free_title_projection_pair_count_mismatch:${budgetedRows.length}/${canonicalRows.length}`);
    }
    for (const [assetId, budgeted] of budgetedByAsset) {
      const canonical = canonicalByAsset.get(assetId);
      if (!canonical) throw new Error(`free_title_projection_unpaired_asset:${assetId}`);
      if (canonical.reference !== budgeted.reference) {
        throw new Error(`free_title_projection_reference_mismatch:${assetId}`);
      }
      const budgetedHasImageSet = Boolean(clean(budgeted.image_set_sha256));
      const canonicalHasImageSet = Boolean(clean(canonical.image_set_sha256));
      if (budgetedHasImageSet !== canonicalHasImageSet) {
        throw new Error(`free_title_projection_image_set_presence_mismatch:${assetId}`);
      }
      if (budgetedHasImageSet) {
        if (budgeted.image_set_sha256 !== canonical.image_set_sha256) {
          throw new Error(`free_title_projection_image_set_mismatch:${assetId}`);
        }
        imageSetVerifiedPairs += 1;
      }
      const budgetedHasRun = Boolean(clean(budgeted.run_fingerprint));
      const canonicalHasRun = Boolean(clean(canonical.run_fingerprint));
      if (budgetedHasRun !== canonicalHasRun) {
        throw new Error(`free_title_projection_run_fingerprint_presence_mismatch:${assetId}`);
      }
      if (budgetedHasRun) {
        if (budgeted.run_fingerprint !== canonical.run_fingerprint) {
          throw new Error(`free_title_projection_run_fingerprint_mismatch:${assetId}`);
        }
        runFingerprintVerifiedPairs += 1;
      }
      const nuisanceFields = ["image_detail", "image_count", "model", "served_model",
        "requested_effort", "served_effort"];
      const comparableFields = [];
      for (const field of nuisanceFields) {
        const budgetedHasField = budgeted[field] !== null && budgeted[field] !== undefined;
        const canonicalHasField = canonical[field] !== null && canonical[field] !== undefined;
        if (budgetedHasField !== canonicalHasField) {
          throw new Error(`free_title_projection_nuisance_presence_mismatch:${field}:${assetId}`);
        }
        if (budgetedHasField) comparableFields.push(field);
      }
      for (const field of comparableFields) {
        if (budgeted[field] !== canonical[field]) {
          throw new Error(`free_title_projection_nuisance_mismatch:${field}:${assetId}`);
        }
      }
      if (comparableFields.length === nuisanceFields.length) configurationVerifiedPairs += 1;
    }
  }

  return {
    budgetedRows,
    canonicalByAsset,
    audit: {
      free_arm: FREE_ARM,
      canonical_arm: canonicalArm,
      budgeted_rows: budgetedRows.length,
      canonical_rows: canonicalRows.length,
      paired_rows: canonicalRows.length,
      reference_verified_pairs: canonicalRows.length,
      image_set_verified_pairs: imageSetVerifiedPairs,
      run_fingerprint_verified_pairs: runFingerprintVerifiedPairs,
      configuration_verified_pairs: configurationVerifiedPairs
    }
  };
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
  const finalMacroF1 = projected.reduce((sum, row) => sum + row.after.f1, 0) / (projected.length || 1);
  const boundaryOracle = Object.fromEntries(stages.map((stage) => {
    const deltas = projected.map((entry) => {
      const loss = rows.find((row) => row.asset_id === entry.row.asset_id);
      const restored = loss?.causes?.[stage] || [];
      const candidate = [...new Set([...tokens(entry.output.title), ...restored])].join(" ");
      return score(entry.row.reference, candidate).f1 - entry.after.f1;
    });
    return [stage, {
      macro_f1: finalMacroF1 + deltas.reduce((sum, value) => sum + value, 0) / (deltas.length || 1),
      delta_f1: deltas.reduce((sum, value) => sum + value, 0) / (deltas.length || 1),
      sign_test: signTest(deltas),
      scope: "net_f1_loss_rows",
      scope_rows: rows.length,
      interpretation: "reference-reading token restoration oracle on net-loss rows; not a deployable mechanism"
    }];
  }));
  return {
    loss_rows: rows.length,
    by_stage: byStage,
    lossless_v2_recovery: {
      parser_lost_token_occurrences: parserLost.length,
      preserved_as_evidence: losslessRecovered.length,
      promoted_to_canonical: 0,
      interpretation: "information recovery only; no F1 credit until a later resolver assigns the span"
    },
    boundary_reference_oracles: boundaryOracle,
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
  const { budgetedRows, canonicalByAsset, audit: pairing } = validateAndIndexRows(rows);
  const projected = budgetedRows.map((row) => {
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
    pairing,
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
    projection_safety: summarizeProjectionSafety(projected),
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
  const result = measure(rows);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
