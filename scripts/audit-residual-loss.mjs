#!/usr/bin/env node
// Where does the remaining loss actually live, and how much of it is OURS?
//
// 255 sealed cards, equivalent F1 0.8253 against a writer-agreement ceiling of
// about 0.929. This sorts every remaining token difference into buckets so the
// founder can adjudicate the classes rather than the cards, the way the
// equivalence layer was built in the first place.
//
// It does NOT propose rules and it does NOT rescore optimistically. It counts,
// and it prints examples for every bucket so a classification can be audited
// instead of trusted -- the buckets are the claim, and a bucket with no
// inspectable examples is exactly the kind of finding this repository has
// shipped wrongly before.
//
// The one number that matters: of the loss that remains, how much is the RULER
// not crediting something we got right, and how much is us being wrong. The
// first is free to fix; the second costs a model.
import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  scoreWithEquivalence, equivalenceTokens, SYNONYM_CLASSES, FINISH_VOCABULARY,
  TRADE_KNOWLEDGE_TOKENS
} from "../lib/listing/evaluation/semantic-equivalence.mjs";

const COHORTS = [
  ["150 队列", "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_pre_copyright"],
  ["105 留出", "artifacts/finish-alignment-105/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_effort_low"]
];

const plain = (t) => String(t ?? "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const setOf = (t) => new Set(plain(t));

const SYNONYM_FORMS = new Set(SYNONYM_CLASSES.flatMap((c) => c.forms));

// A token that is a substring of, or contains, a token on the other side. This
// is the shape of a spelling or spacing difference rather than a missing fact:
// "disney100" against "disney" + "100", "xfractor" against "x-fractor".
const nearMatch = (token, others) => [...others].some((o) => (
  o !== token && (o.includes(token) || token.includes(o)) && Math.min(o.length, token.length) >= 4
));

/**
 * Did we emit a DIFFERENT FORM of the same thing?
 *
 * "auto" against the writer's "autograph" is an un-credited synonym. "Green"
 * against their "Gold" is not: both are colours, and saying the wrong one is an
 * error however similar the vocabulary looks. Only the first is a ruler gap.
 */
function sameClassEmitted(token, got) {
  for (const cls of SYNONYM_CLASSES) {
    if (!cls.forms.includes(token)) continue;
    if (cls.forms.some((f) => f !== token && got.has(f))) return true;
  }
  return false;
}

const BUCKETS = [
  ["A 已在字段里，没进标题", "组装/预算，加知识无用"],
  ["B 拼写或分词差异", "尺子可认，零模型成本"],
  ["C 同义或缩写未收录", "尺子可认，需逐条判定"],
  ["D 写手贸易知识", "卡面无从得知，只能靠语料"],
  ["E 真的漏了", "识别缺口，需要模型"]
];

const fieldTokens = (fields) => {
  const out = new Set();
  const walk = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === "object") { Object.values(v).forEach(walk); return; }
    for (const t of plain(v)) out.add(t);
  };
  walk(fields);
  return out;
};

const tally = Object.fromEntries(BUCKETS.map(([k]) => [k, { count: 0, cards: new Set(), examples: [] }]));
let totalMissing = 0, totalExtra = 0, cards = 0;
const extraExamples = [];
let sumF1 = 0;

for (const [, path, arm] of COHORTS) {
  let rows;
  try {
    rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { continue; }
  for (const row of rows) {
    if (row?.arm !== arm || !row?.fields || !row?.reference) continue;
    cards += 1;
    const reference = String(row.reference);
    const title = composeFromCanonicalFields(row.fields).title;
    sumF1 += scoreWithEquivalence(title, reference).equivalent.f1;

    // Compare under the ruler's own tokens, so anything it ALREADY credits is
    // out of scope: this measures what is left after the ruler has spoken.
    const want = equivalenceTokens(reference);
    const got = equivalenceTokens(title);
    const known = fieldTokens(row.fields);
    const rawTitle = setOf(title);

    for (const token of want) {
      if (got.has(token)) continue;
      totalMissing += 1;
      let bucket;
      if (known.has(token) || rawTitle.has(token)) bucket = "A 已在字段里，没进标题";
      else if (nearMatch(token, got)) bucket = "B 拼写或分词差异";
      // C fires ONLY when we emitted another form of the SAME class -- that is
      // what an un-credited synonym looks like. The first version asked merely
      // whether the token was IN the vocabulary, which swept up every wrong
      // value: we wrote "Green Refractor" against "Gold Refractor" and it was
      // filed as a ruler gap when it is a wrong colour. The examples caught it.
      else if (sameClassEmitted(token, got)) bucket = "C 同义或缩写未收录";
      else if (TRADE_KNOWLEDGE_TOKENS.has(token)) bucket = "D 写手贸易知识";
      else bucket = "E 真的漏了";
      const t = tally[bucket];
      t.count += 1;
      t.cards.add(row.asset_id);
      if (t.examples.length < 4) t.examples.push({ token, title, reference });
    }
    for (const token of got) {
      if (want.has(token)) continue;
      totalExtra += 1;
      if (extraExamples.length < 6) extraExamples.push({ token, title, reference });
    }
  }
}

const pct = (n) => `${(100 * n / (totalMissing || 1)).toFixed(1)}%`;
console.log(`残余失分归类   卡数 ${cards}   当前 equivalent F1 ${(sumF1 / cards).toFixed(4)}`);
console.log(`漏词 ${totalMissing} 个（${(totalMissing / cards).toFixed(2)}/张）   多词 ${totalExtra} 个（${(totalExtra / cards).toFixed(2)}/张）\n`);

for (const [name, note] of BUCKETS) {
  const t = tally[name];
  console.log(`${name.padEnd(26)} ${String(t.count).padStart(4)} 个  ${pct(t.count).padStart(6)}  ${t.cards.size} 张卡   ${note}`);
}

const rulerFixable = tally["B 拼写或分词差异"].count + tally["C 同义或缩写未收录"].count + tally["D 写手贸易知识"].count;
const composition = tally["A 已在字段里，没进标题"].count;
const recognition = tally["E 真的漏了"].count;
console.log(`
分侧汇总：
  尺子侧（B+C+D）  ${rulerFixable} 个  ${pct(rulerFixable)}   ← 零模型成本，逐条判定即可
  组装侧（A）      ${composition} 个  ${pct(composition)}   ← Composer 优先级/预算
  识别侧（E）      ${recognition} 个  ${pct(recognition)}   ← 只有这部分需要模型`);

console.log("\n────── 逐桶样例（供逐条判定，classification 可审）──────");
for (const [name] of BUCKETS) {
  const t = tally[name];
  if (!t.examples.length) continue;
  console.log(`\n【${name}】`);
  for (const e of t.examples) {
    console.log(`  漏词 "${e.token}"`);
    console.log(`    我们: ${e.title.slice(0, 92)}`);
    console.log(`    参考: ${e.reference.slice(0, 92)}`);
  }
}
console.log(`\n【多词（精度侧）样例】`);
for (const e of extraExamples) {
  console.log(`  多词 "${e.token}"`);
  console.log(`    我们: ${e.title.slice(0, 92)}`);
  console.log(`    参考: ${e.reference.slice(0, 92)}`);
}
