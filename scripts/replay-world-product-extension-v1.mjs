#!/usr/bin/env node

// Full-title, zero-provider replay for the previously positive product-year
// candidate ranking signal. Reviewed titles score the frozen treatment only;
// they are never read by the ranker, parser, or extension rule.

import { readFile, writeFile } from "node:fs/promises";

import { loadConstraintModelSnapshot } from "../lib/listing/catalog/constraint-model-store.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  buildWorldCompatibilityIndexes,
  rankProductCandidates
} from "../experiments/accuracy/world-compatibility-ranker-v1.mjs";
import { proposeWorldProductExtensionV1 } from "../experiments/accuracy/world-product-extension-v1.mjs";

const CANONICAL = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const EXPRESSION = "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl";
const OUTPUT = "docs/evaluation/world-product-extension-v1-replay-150-2026-08-02.json";
const REPORT = "docs/evaluation/world-product-extension-v1-replay-150-2026-08-02.md";

const rows = (body) => String(body).trim().split("\n").filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const score = (reference, title) => {
  const wanted = tokens(reference);
  const got = tokens(title);
  const hit = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hit / wanted.size : 0;
  const precision = got.size ? hit / got.size : 0;
  return recall + precision ? 2 * recall * precision / (recall + precision) : 0;
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

const [canonicalBody, expressionBody, model] = await Promise.all([
  readFile(CANONICAL, "utf8"),
  readFile(EXPRESSION, "utf8"),
  loadConstraintModelSnapshot()
]);
const canonical = rows(canonicalBody).filter((row) => row.arm === "thin_canonical_high");
const expression = new Map(rows(expressionBody).map((row) => [row.asset_id, row]));
if (canonical.length !== 150 || expression.size !== 150
    || canonical.some((row) => !expression.has(row.asset_id))) throw new Error("fresh150_alignment_failed");
const indexes = buildWorldCompatibilityIndexes(model);

const cardRows = canonical.map((row) => {
  const facts = expression.get(row.asset_id).candidate_facts || [];
  const identities = facts.filter((fact) => fact.kind === "identity");
  const ranked = rankProductCandidates(identities, facts, model, indexes);
  const extension = proposeWorldProductExtensionV1(row.fields, ranked);
  const baselineTitle = composeFromCanonicalFields(row.fields).title;
  const candidateTitle = extension.changed ? composeFromCanonicalFields(extension.fields).title : baselineTitle;
  const baselineTokens = tokens(baselineTitle);
  const candidateTokens = tokens(candidateTitle);
  const referenceTokens = tokens(row.reference);
  const baselineF1 = score(row.reference, baselineTitle);
  const candidateF1 = score(row.reference, candidateTitle);
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baselineTitle,
    candidate_title: candidateTitle,
    delta_f1: candidateF1 - baselineF1,
    changed: extension.changed,
    reason: extension.reason || null,
    before_product: extension.before || row.fields.product,
    after_product: extension.after || row.fields.product,
    support_edges: extension.support_edges || [],
    reference_losses: difference(new Set([...baselineTokens].filter((token) => referenceTokens.has(token))), candidateTokens),
    numeric_losses: difference(new Set([...baselineTokens].filter((token) => /^\d+(?:\/\d+)?$/.test(token))), candidateTokens),
    over_80: candidateTitle.length > 80
  };
});

const changed = cardRows.filter((row) => row.changed);
const summary = {
  cards: cardRows.length,
  changed_cards: changed.length,
  baseline_macro_f1: mean(cardRows.map((row) => score(row.reference, row.baseline_title))),
  candidate_macro_f1: mean(cardRows.map((row) => score(row.reference, row.candidate_title))),
  delta_macro_f1: mean(cardRows.map((row) => row.delta_f1)),
  wins: cardRows.filter((row) => row.delta_f1 > 1e-12).length,
  losses: cardRows.filter((row) => row.delta_f1 < -1e-12).length,
  ties: cardRows.filter((row) => Math.abs(row.delta_f1) <= 1e-12).length,
  reference_loss_cards: cardRows.filter((row) => row.reference_losses.length).length,
  numeric_loss_cards: cardRows.filter((row) => row.numeric_losses.length).length,
  over_80_cards: cardRows.filter((row) => row.over_80).length
};
const gate = {
  delta_at_least_0003: summary.delta_macro_f1 >= 0.003,
  at_least_8_wins: summary.wins >= 8,
  zero_losses: summary.losses === 0,
  zero_reference_losses: summary.reference_loss_cards === 0,
  zero_numeric_losses: summary.numeric_loss_cards === 0,
  zero_over_80: summary.over_80_cards === 0
};
const passedTitleGate = Object.values(gate).every(Boolean);
const result = {
  schema_version: "world-product-extension-v1-replay-150",
  authority: "evaluation_only_untrusted_snapshot_provenance",
  provider_calls: 0,
  production_promoted: false,
  decision: passedTitleGate ? "HOLD_REBUILD_PROVENANCE_BEFORE_INDEPENDENT_TEST" : "STOP_FINAL_TITLE_GATE",
  summary,
  gate,
  caveat: "The constraint snapshot lacks row-level disjoint provenance; even a passing title result cannot be promoted.",
  changed_cards: changed,
  cards: cardRows
};
const changedRows = changed.map((row) => `| \`${row.asset_id}\` | ${row.before_product} -> ${row.after_product} | ${row.delta_f1 >= 0 ? "+" : ""}${row.delta_f1.toFixed(6)} | ${row.support_edges.join(", ")} |`).join("\n");
const markdown = `# World product extension v1 — full-title fresh150 replay\n\n`
  + `Decision: **${result.decision}**. Provider calls: 0. Production promoted: false.\n\n`
  + `This closes the old gap between a positive candidate-ranking result and the actual CSM/SEM Composer title. `
  + `The ranker may only reorder Luna-emitted identity candidates with positive product-year support; the extension only lengthens a compatible existing Product from visible text.\n\n`
  + `| Metric | Result |\n|---|---:|\n`
  + `| Macro F1 | ${summary.baseline_macro_f1.toFixed(6)} -> ${summary.candidate_macro_f1.toFixed(6)} (${summary.delta_macro_f1 >= 0 ? "+" : ""}${summary.delta_macro_f1.toFixed(6)}) |\n`
  + `| Wins / losses / ties | ${summary.wins} / ${summary.losses} / ${summary.ties} |\n`
  + `| Changed cards | ${summary.changed_cards} |\n`
  + `| Reference-loss cards | ${summary.reference_loss_cards} |\n`
  + `| Numeric-loss cards | ${summary.numeric_loss_cards} |\n`
  + `| Titles over 80 | ${summary.over_80_cards} |\n\n`
  + `## Changed-card ledger\n\n| Asset | Product change | Delta F1 | Positive support edge |\n|---|---|---:|---|\n${changedRows || "| none | none | 0 | none |"}\n\n`
  + `The snapshot still lacks row-level disjoint provenance. Passing this replay would only justify rebuilding the same support graph from source-addressed rows, not a paid or production promotion.\n`;

await Promise.all([writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`), writeFile(REPORT, markdown)]);
console.log(JSON.stringify({ decision: result.decision, summary, gate, outputs: [OUTPUT, REPORT] }, null, 2));
