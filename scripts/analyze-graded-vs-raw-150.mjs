#!/usr/bin/env node
// Graded cards carry their own identity on the slab label. A PSA label reads
// "2025-26 DONRUSS RD/WC '26 #1 LIONEL MESSI KABOOM 9" -- year, product, set,
// subject, card number and grade, already transcribed by a third party.
//
// If that is true, recognition on graded cards should be a reading problem
// rather than a seeing problem, and accuracy on them should be markedly higher.
// If it is NOT higher, we are failing to use a source that is right there.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tok = (v) => new Set(String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (ref, title) => {
  const w = tok(ref); const g = tok(title);
  const hits = [...w].filter((t) => g.has(t)).length;
  const recall = w.size ? hits / w.size : 0;
  const precision = g.size ? hits / g.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => {
    const fields = parseCanonicalFields(r.raw_title).fields;
    return { ...r, fields, ...score(r.reference, composeFromCanonicalFields(fields).title) };
  });

// Graded by OUR observation, and graded by the reference -- reported separately
// so a disagreement about gradedness does not silently define the split.
const ourGrade = (r) => Boolean(String(r.fields.grade || "").trim());
const refGrade = (r) => /\b(psa|bgs|sgc|cgc|beckett)\b/i.test(r.reference);

const group = (name, pred) => {
  const yes = rows.filter(pred); const no = rows.filter((r) => !pred(r));
  console.log(`${name}`);
  console.log(`  已评级 ${String(yes.length).padStart(3)} 张  F1=${mean(yes.map((r) => r.f1)).toFixed(4)}  R=${mean(yes.map((r) => r.recall)).toFixed(4)}  P=${mean(yes.map((r) => r.precision)).toFixed(4)}`);
  console.log(`  未评级 ${String(no.length).padStart(3)} 张  F1=${mean(no.map((r) => r.f1)).toFixed(4)}  R=${mean(no.map((r) => r.recall)).toFixed(4)}  P=${mean(no.map((r) => r.precision)).toFixed(4)}`);
  console.log(`  差    ${(mean(yes.map((r) => r.f1)) - mean(no.map((r) => r.f1))).toFixed(4)}\n`);
};
console.log(`n=${rows.length}\n`);
group("按参考标题判定是否已评级", refGrade);
group("按我们自己读到的 grade 判定", ourGrade);

// Where the two disagree: the reference says graded and we did not read one.
const missed = rows.filter((r) => refGrade(r) && !ourGrade(r));
console.log(`参考显示已评级、我们没读到 grade：${missed.length} 张`);
for (const r of missed.slice(0, 6)) console.log(`   ${r.asset_id.slice(-8)}  ${r.reference.slice(0, 78)}`);
