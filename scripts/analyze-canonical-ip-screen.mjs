#!/usr/bin/env node

// Zero-cost paired analysis for the canonical IP screen. The live arm is
// compared with an earlier same-card canonical control for diagnosis, then a
// control-field replay isolates the IP projection from unrelated model drift.

import { readFile, writeFile } from "node:fs/promises";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const jsonl = async (path) => (await readFile(path, "utf8")).split("\n").filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const scoreF1 = (reference, title) => {
  const wanted = tokens(reference);
  const predicted = tokens(title);
  const hit = [...wanted].filter((token) => predicted.has(token)).length;
  const recall = wanted.size ? hit / wanted.size : 0;
  const precision = predicted.size ? hit / predicted.size : 0;
  return { recall, precision, f1: (recall + precision) ? 2 * recall * precision / (recall + precision) : 0 };
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null;
const sign = (deltas) => ({
  wins: deltas.filter((delta) => delta > 1e-12).length,
  losses: deltas.filter((delta) => delta < -1e-12).length,
  ties: deltas.filter((delta) => Math.abs(delta) <= 1e-12).length
});

const treatmentRows = await jsonl(arg("--treatment", "artifacts/canonical-ip-screen-20-2026-08-02/thin-path-gpt-5.6-luna.jsonl"));
const controlRows = await jsonl(arg("--control", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl"));
const ids = JSON.parse(await readFile(arg("--asset-ids", "experiments/accuracy/canonical-ip-screen-20.asset-ids.json"), "utf8"));
const selected = new Set(ids);
const treatment = new Map(treatmentRows.filter((row) => selected.has(row.asset_id)).map((row) => [row.asset_id, row]));
const control = new Map(controlRows.filter((row) => row.arm === "thin_canonical_high" && selected.has(row.asset_id)).map((row) => [row.asset_id, row]));
if (treatment.size !== ids.length || control.size !== ids.length) throw new Error(`paired_input_mismatch:${treatment.size}/${control.size}/${ids.length}`);

const raw = [];
const fieldOnly = [];
const contractGrammar = [];
for (const assetId of ids) {
  const live = treatment.get(assetId);
  const base = control.get(assetId);
  const liveFields = JSON.parse(live.raw_title);
  const controlFields = base.fields;
  const rawDelta = live.f1 - base.f1;
  raw.push({
    asset_id: assetId,
    reference: base.reference,
    control_title: base.title,
    treatment_title: live.title,
    control_f1: base.f1,
    treatment_f1: live.f1,
    delta_f1: rawDelta,
    ip: liveFields.ip || "",
    grammar: liveFields.grammar || ""
  });

  // A strict field-only replay: retain the control grammar and every control
  // field, replacing only an actually new IP. This is the no-drift gate.
  const candidateIp = liveFields.ip || controlFields.ip || "";
  const baseTitle = composeFromCanonicalFields({ ...controlFields, ip: controlFields.ip || "" }).title;
  const candidateTitle = composeFromCanonicalFields({ ...controlFields, ip: candidateIp }).title;
  const baseScore = scoreF1(base.reference, baseTitle);
  const candidateScore = scoreF1(base.reference, candidateTitle);
  fieldOnly.push({
    asset_id: assetId,
    reference: base.reference,
    control_ip: controlFields.ip || "",
    treatment_ip: liveFields.ip || "",
    base_title: baseTitle,
    candidate_title: candidateTitle,
    base_f1: baseScore.f1,
    candidate_f1: candidateScore.f1,
    delta_f1: candidateScore.f1 - baseScore.f1
  });

  // A separate diagnostic applies the contract grammar whenever a new IP was
  // emitted. It is intentionally not a promotion rule: this catches the
  // VeeFriends failure where grammar correction evicted a useful card name.
  const contractBase = composeFromCanonicalFields({ ...controlFields, ip: controlFields.ip || "" }).title;
  const contractCandidate = composeFromCanonicalFields({
    ...controlFields,
    grammar: liveFields.ip ? "tcg" : controlFields.grammar,
    ip: candidateIp
  }).title;
  const contractBaseScore = scoreF1(base.reference, contractBase);
  const contractCandidateScore = scoreF1(base.reference, contractCandidate);
  contractGrammar.push({
    asset_id: assetId,
    reference: base.reference,
    base_title: contractBase,
    candidate_title: contractCandidate,
    base_f1: contractBaseScore.f1,
    candidate_f1: contractCandidateScore.f1,
    delta_f1: contractCandidateScore.f1 - contractBaseScore.f1
  });
}

const summarize = (rows, left, right) => {
  const deltas = rows.map((row) => row[right] - row[left]);
  return {
    ...sign(deltas),
    n: rows.length,
    mean_left_f1: rows.reduce((sum, row) => sum + row[left], 0) / rows.length,
    mean_right_f1: rows.reduce((sum, row) => sum + row[right], 0) / rows.length,
    delta_f1: deltas.reduce((sum, delta) => sum + delta, 0) / rows.length
  };
};

const result = {
  schema_version: "canonical-ip-v1-screen-analysis-v1",
  cards: ids.length,
  live_pair: summarize(raw, "control_f1", "treatment_f1"),
  field_only_replay: summarize(fieldOnly, "base_f1", "candidate_f1"),
  contract_grammar_replay: summarize(contractGrammar, "base_f1", "candidate_f1"),
  field_capture: {
    treatment_ip_nonempty: raw.filter((row) => row.ip).length,
    new_ip_over_control: fieldOnly.filter((row) => row.treatment_ip && row.treatment_ip !== row.control_ip).length,
    treatment_tcg: raw.filter((row) => row.grammar === "tcg").length,
    standard_card_ip: raw.filter((row) => row.grammar !== "tcg" && row.ip).length,
    over_80: treatmentRows.filter((row) => selected.has(row.asset_id) && row.length > 80).length
  },
  cost: {
    live_median_latency_ms: median(treatmentRows.filter((row) => selected.has(row.asset_id)).map((row) => row.latency_ms)),
    control_median_latency_ms: median(controlRows.filter((row) => row.arm === "thin_canonical_high" && selected.has(row.asset_id)).map((row) => row.latency_ms)),
    live_median_input_tokens: median(treatmentRows.filter((row) => selected.has(row.asset_id)).map((row) => row.input_tokens)),
    control_median_input_tokens: median(controlRows.filter((row) => row.arm === "thin_canonical_high" && selected.has(row.asset_id)).map((row) => row.input_tokens)),
    live_median_output_tokens: median(treatmentRows.filter((row) => selected.has(row.asset_id)).map((row) => row.output_tokens)),
    control_median_output_tokens: median(controlRows.filter((row) => row.arm === "thin_canonical_high" && selected.has(row.asset_id)).map((row) => row.output_tokens))
  },
  rows: { live_pair: raw, field_only_replay: fieldOnly, contract_grammar_replay: contractGrammar }
};
const out = arg("--out", "artifacts/canonical-ip-screen-20-2026-08-02/analysis.json");
await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
