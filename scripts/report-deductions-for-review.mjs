#!/usr/bin/env node
// Every way we currently lose points, laid out for someone who knows the trade
// to adjudicate.
//
// Recall losses are words the writer published and we did not; precision losses
// are words we published and the writer did not. Both are grouped so a domain
// judgement can be made per group rather than per card, and each group carries
// real examples because the group label alone is not enough to judge it.
//
// Anything already forgiven by the equivalence layer is excluded, so this shows
// what is left to decide.
import { readFileSync } from "node:fs";
import { equivalenceTokens } from "../lib/listing/evaluation/semantic-equivalence.mjs";

const ARM = process.argv[3] || "thin_canonical_high_pre_copyright";
const rows = readFileSync(process.argv[2] || "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === ARM && r.reference);

const missing = new Map(); const surplus = new Map();
for (const r of rows) {
  const want = equivalenceTokens(r.reference);
  const got = equivalenceTokens(r.title || "");
  for (const w of want) if (!got.has(w)) {
    const rec = missing.get(w) || { n: 0, ctx: [] };
    rec.n++; if (rec.ctx.length < 2) rec.ctx.push(r.reference.slice(0, 62));
    missing.set(w, rec);
  }
  for (const w of got) if (!want.has(w)) {
    const rec = surplus.get(w) || { n: 0, ctx: [] };
    rec.n++; if (rec.ctx.length < 2) rec.ctx.push(`我们:${(r.title || "").slice(0, 48)} | 写手:${r.reference.slice(0, 40)}`);
    surplus.set(w, rec);
  }
}
const show = (title, map, note) => {
  const total = [...map.values()].reduce((s, v) => s + v.n, 0);
  console.log(`\n${"=".repeat(72)}\n${title}   共 ${total} 词次 / ${map.size} 个不同的词\n${note}\n`);
  const ranked = [...map.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [w, v] of ranked.filter(([, v]) => v.n >= 3)) {
    console.log(`  ${String(v.n).padStart(3)}×  ${w}`);
    for (const c of v.ctx) console.log(`          ${c}`);
  }
  const tail = ranked.filter(([, v]) => v.n < 3);
  console.log(`\n  出现 1-2 次的长尾 ${tail.length} 个词，合计 ${tail.reduce((s, [, v]) => s + v.n, 0)} 词次`);
  console.log(`  样例: ${tail.slice(0, 24).map(([w]) => w).join(", ")}`);
};
console.log(`臂=${ARM}  n=${rows.length}  （已扣除等价层宽恕的部分）`);
show("【召回损失】写手写了、我们没发出", missing, "问：这些词里，哪些是「不发出也不该算错」？");
show("【精度损失】我们发出了、写手没写", surplus, "问：这些词里，哪些是「发出来也不该算错」？");
