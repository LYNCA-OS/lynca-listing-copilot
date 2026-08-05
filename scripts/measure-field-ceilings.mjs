#!/usr/bin/env node
// What is a PERFECT version of each field worth?
//
// The research report recommends extending the structured-field treatment from
// `grading_info` to `serial` and `card_number`, and adding source/evidence
// grounding. Each of those is a paid run. This is the free question that comes
// first: if the field were answered perfectly, how much F1 would it buy?
//
// A field whose perfect version is worth less than measured run-to-run drift
// does not deserve an experiment, however good the reasoning behind it. That is
// the check `preregister()` asks for and this is what supplies the number.
//
// The oracle substitutes the reference's own value for the field and recomposes.
// It is a cheating upper bound by construction: no implementation can beat it,
// and most will capture a fraction.
import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { scoreWithEquivalence } from "../lib/listing/evaluation/semantic-equivalence.mjs";
import { MEASURED_DRIFT } from "../lib/listing/evaluation/exploration-review.mjs";

const COHORTS = [
  ["150 队列", "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_pre_copyright"],
  ["105 留出", "artifacts/finish-alignment-105/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_effort_low"]
];

const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

/**
 * Pull the reference's own value for a field out of its title.
 *
 * Deliberately conservative: a pattern that cannot find the value leaves the
 * card out of that field's population rather than guessing, so a small
 * population is reported as a small population instead of being padded with
 * cards the oracle could not actually improve.
 */
const EXTRACTORS = {
  serial: (ref) => (ref.match(/\b\d{1,4}\/\d{1,4}\b/) || [])[0] || null,
  card_number: (ref) => (ref.match(/#\s?([A-Z]{0,4}-?\d{1,4}[A-Z]?)\b/) || [])[1] || null,
  // Everything the writer wrote that looks like a finish, in their own order.
  print_finish: (ref) => {
    const WORDS = /\b(refractor|prizm|holo|foil|sapphire|mojo|wave|shimmer|sparkle|pulsar|geometric|hyper|disco|scope|xfractor|raywave|prismatic|lucky|crystallized|gold|silver|red|blue|green|orange|purple|black|pink|yellow|teal|bronze|platinum|emerald|rainbow)\b/gi;
    const hits = [...new Set((ref.match(WORDS) || []).map((w) => w))];
    return hits.length ? hits.join(" ") : null;
  },
  team: (ref) => null
};

const FIELDS = ["serial", "card_number", "print_finish"];

for (const [label, path, arm] of COHORTS) {
  let rows;
  try {
    rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { console.log(`${label}: 原料缺失`); continue; }
  const cards = rows.filter((r) => r?.arm === arm && r?.fields && r?.reference);
  if (!cards.length) { console.log(`${label}: arm 未命中`); continue; }

  console.log(`\n══ ${label}  n=${cards.length} ══`);
  const base = cards.map((r) => scoreWithEquivalence(
    composeFromCanonicalFields(r.fields).title, r.reference
  ).equivalent.f1);
  console.log(`   现状 = ${mean(base).toFixed(6)}`);

  for (const field of FIELDS) {
    const extract = EXTRACTORS[field];
    let population = 0, alreadyRight = 0;
    const oracle = cards.map((r, i) => {
      const truth = extract(String(r.reference));
      if (!truth) return base[i];
      population += 1;
      const ours = composeFromCanonicalFields(r.fields).title;
      if (ours.toLowerCase().includes(String(truth).toLowerCase())) { alreadyRight += 1; return base[i]; }
      const patched = field === "print_finish"
        ? { ...r.fields, print_finish: truth, parallel_exact: truth }
        : { ...r.fields, [field]: truth };
      return scoreWithEquivalence(
        composeFromCanonicalFields(patched).title, r.reference
      ).equivalent.f1;
    });
    const delta = mean(oracle) - mean(base);
    const verdict = delta < MEASURED_DRIFT
      ? `低于漂移 ${MEASURED_DRIFT}，不值得付费实验`
      : "高于漂移，值得设计实验";
    console.log(
      `   ${field.padEnd(12)} 完美 = ${mean(oracle).toFixed(6)}   天花板 Δ=+${delta.toFixed(6)}   `
      + `参考含该字段 ${population} 张，已写对 ${alreadyRight} 张   ← ${verdict}`
    );
  }
}

console.log(`
读法：天花板是作弊上限——用参考标题自己的值回填。任何实现只能拿到其中一部分。
低于实测漂移 ${MEASURED_DRIFT} 的字段，即使做到完美也无法与"同臂跑两次"区分。
`);
