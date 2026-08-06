#!/usr/bin/env node
// Where does a fact the model READ fail to reach the buyer?
//
//   scripts/audit-pipeline-suppression.mjs artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl
//
// "The pipeline suppresses things" is a claim with two very different causes and
// one shared symptom. A word missing from the title is either
//
//   NOT READ    -- the model never put it in a field, or
//   SUPPRESSED  -- it went into a field and something downstream removed it.
//
// They need opposite fixes and the missed-word list cannot tell them apart.
//
// Run on the 150-card v2 output, this said:
//
//   写进标题了      74.4%
//   读到没写出来     3.5%   <- pipeline suppression
//   根本没读到      22.0%   <- recognition gap
//
// and the same audit on the 252-card main pipeline said 71.6 / 6.5 / 21.9. Two
// prompts with nothing in common -- one with 49 suppressive clauses, one with
// none -- and an identical recognition gap. That is the number that moved the
// strategy: the missing fifth is not being suppressed, it is not being read,
// and prompt work cannot reach it.
//
// Of the 3.5% that IS suppressed, everything recoverable was already checked:
// 35 of 57 come back if the eBay profile stops suppressing [Card Number] and
// [Search Optimization] -- which measured WORSE -- and 22 come back only above
// the 80-character cap. There is no free lunch left in this half.

import { readFileSync } from "node:fs";

import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields, BRACKET_ORDER } from "../lib/listing/thin/canonical-composer.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";

const path = process.argv[2];
if (!path) { process.stderr.write("usage: audit-pipeline-suppression.mjs <checkpoint.jsonl>\n"); process.exit(1); }

const rows = readFileSync(path, "utf8").split("\n").filter(Boolean)
  .map((line) => JSON.parse(line)).filter((row) => row.arm === "thin_canonical");

const tokenise = (text) => new Set(String(text ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));

const fieldText = (fields) => [
  fields.year, fields.manufacturer, fields.product, fields.set, fields.card_name,
  fields.release_variant, fields.print_finish, fields.descriptive_rarity,
  (fields.subjects || []).join(" "), fields.team, fields.card_number, fields.serial,
  (fields.attributes || []).join(" "), fields.grade
].filter(Boolean).join(" ");

let shipped = 0;
let readNotShipped = 0;
let neverRead = 0;
const lostByWord = new Map();
const neverByWord = new Map();

for (const row of rows) {
  const { fields } = parseCanonicalFields(row.raw_title);
  const wanted = tokenise(row.reference);
  const inFields = tokenise(fieldText(fields));
  const inTitle = tokenise(finishCanonicalTitle(row.raw_title).title);
  for (const word of wanted) {
    if (inTitle.has(word)) { shipped += 1; continue; }
    if (inFields.has(word)) { readNotShipped += 1; lostByWord.set(word, (lostByWord.get(word) ?? 0) + 1); }
    else { neverRead += 1; neverByWord.set(word, (neverByWord.get(word) ?? 0) + 1); }
  }
}

const total = shipped + readNotShipped + neverRead;
process.stdout.write(`参考标题里的词，共 ${total} 词次（${rows.length} 张卡）\n\n`);
process.stdout.write(`  写进标题了            ${String(shipped).padStart(5)}  ${(100 * shipped / total).toFixed(1)}%\n`);
process.stdout.write(`  模型读到了但没写出来   ${String(readNotShipped).padStart(5)}  ${(100 * readNotShipped / total).toFixed(1)}%   ← 链路压制\n`);
process.stdout.write(`  模型根本没读到        ${String(neverRead).padStart(5)}  ${(100 * neverRead / total).toFixed(1)}%   ← 识别缺口\n`);

const top = (map, n = 20) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  .map(([word, count]) => `${word}:${count}`).join("  ");
process.stdout.write(`\n被链路压掉的词 top20:\n  ${top(lostByWord)}\n`);
process.stdout.write(`\n没读到的词 top20:\n  ${top(neverByWord)}\n`);

// Which stage did it? Re-compose with one stage disabled and see what returns.
process.stdout.write(`\n=== 逐段归因：关掉某一段，多少被压的词回来了 ===\n`);
const stages = {
  "profile 抑制 (卡号/team)": (fields) => composeFromCanonicalFields(fields, {
    profile: { id: "audit", characterBudget: 80, suppress: {} }
  }),
  "预算限制 (放到 300)": (fields) => composeFromCanonicalFields(fields, { limit: 300 }),
  "两者都关": (fields) => composeFromCanonicalFields(fields, {
    profile: { id: "audit", characterBudget: 300, suppress: {} }
  })
};
for (const [name, compose] of Object.entries(stages)) {
  let recovered = 0;
  for (const row of rows) {
    const { fields } = parseCanonicalFields(row.raw_title);
    const wanted = tokenise(row.reference);
    const inFields = tokenise(fieldText(fields));
    const before = tokenise(finishCanonicalTitle(row.raw_title).title);
    const after = tokenise(compose(fields).title);
    for (const word of wanted) {
      if (before.has(word) || !inFields.has(word)) continue;
      if (after.has(word)) recovered += 1;
    }
  }
  process.stdout.write(`${name.padEnd(26)} 回来 ${String(recovered).padStart(4)} / ${readNotShipped} 词次\n`);
}

// A bracket the model filled that this grammar never renders is the most
// complete form of suppression, so it is counted separately.
process.stdout.write(`\n=== 字段有值、但该 grammar 的 bracket 顺序里没有它 ===\n`);
const unrenderable = new Map();
for (const row of rows) {
  const { fields } = parseCanonicalFields(row.raw_title);
  const order = BRACKET_ORDER[fields.grammar] || BRACKET_ORDER.standard;
  for (const [field, bracket] of [["serial", "numerical_rarity"], ["card_number", "card_number"],
    ["team", "search_optimization"], ["print_finish", "print_finish"], ["card_name", "card_name"]]) {
    if (fields[field] && !order.includes(bracket)) {
      const key = `${fields.grammar}.${bracket}`;
      unrenderable.set(key, (unrenderable.get(key) ?? 0) + 1);
    }
  }
}
process.stdout.write(unrenderable.size
  ? `${[...unrenderable.entries()].map(([key, count]) => `  ${key}: ${count} 张`).join("\n")}\n`
  : "  无\n");
