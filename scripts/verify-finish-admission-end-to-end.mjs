#!/usr/bin/env node
// End-to-end: re-parse the stored RAW responses so the parse-time admission
// layer actually runs, then score. Scoring pre-parsed `fields` would miss it
// entirely -- those were parsed before the layer existed.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";

const tokens = (v) => new Set(String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = tokens(reference); const got = tokens(title);
  const hits = [...wanted].filter((t) => got.has(t)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference);

const now = rows.map((r) => score(r.reference, finishCanonicalTitle(r.raw_title).title));
const before = rows.map((r) => score(r.reference, r.title ?? ""));
const withheld = rows.map((r) => parseCanonicalFields(r.raw_title).fields.withheld_finish_terms || [])
  .filter((w) => w.length);
const d = now.map((r, i) => r.f1 - before[i].f1);
const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
console.log(`n=${rows.length}`);
console.log(`落库标题   F1=${mean(before.map((r) => r.f1)).toFixed(6)}`);
console.log(`当前代码   F1=${mean(now.map((r) => r.f1)).toFixed(6)}  R=${mean(now.map((r) => r.recall)).toFixed(4)}  P=${mean(now.map((r) => r.precision)).toFixed(4)}`);
console.log(`Δ=${mean(now.map((r) => r.f1)) - mean(before.map((r) => r.f1)) >= 0 ? "+" : ""}${(mean(now.map((r) => r.f1)) - mean(before.map((r) => r.f1))).toFixed(6)}  胜/负/平=${w}/${l}/${d.length - w - l}`);
console.log(`触发拒绝的卡：${withheld.length}  拒绝词次：${withheld.flat().length}`);
