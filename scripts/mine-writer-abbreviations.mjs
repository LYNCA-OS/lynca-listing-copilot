#!/usr/bin/env node
// Which abbreviations does the writer actually use?
//
// Not which ones look equivalent to me. The 358 draft/final pairs record
// substitutions the writer performed: a word present in the draft and gone from
// the final, alongside a word absent from the draft and present in the final,
// on the same card. Where the two are related by form, that is an abbreviation
// the writer applies, evidenced rather than assumed.
//
// Person names are the case the founder named: a title carrying the full name
// and a final carrying part of it is the same fact under the current metric's
// blindness, exactly as Auto and Autograph were.
import { readFileSync } from "node:fs";

const tok = (v) => String(v ?? "").split(/[^A-Za-z0-9/'.&-]+/).filter(Boolean);
const rows = JSON.parse(readFileSync(process.argv[2] || "/tmp/wf/feedback.json", "utf8"));

// Related by form: initialism, prefix, or one contained in the other.
function relation(a, b) {
  const [x, y] = a.length <= b.length ? [a, b] : [b, a];
  const lx = x.toLowerCase(); const ly = y.toLowerCase();
  if (lx === ly) return null;
  if (ly.startsWith(lx) && lx.length >= 2) return "前缀截断";
  if (ly.replace(/[^a-z0-9]/g, "").startsWith(lx.replace(/[^a-z0-9]/g, "")) && lx.length >= 2) return "前缀截断";
  const initials = ly.split(/[\s.-]+/).map((w) => w[0]).join("");
  if (lx.replace(/[^a-z0-9]/g, "") === initials && lx.length >= 2) return "首字母";
  if (lx.length >= 3 && ly.includes(lx)) return "包含";
  // Dropped vowels: prizm/przm style
  if (lx.length >= 3 && ly.replace(/[aeiou]/g, "").startsWith(lx.replace(/[aeiou]/g, ""))) return "去元音";
  return null;
}

const pairs = new Map();
for (const r of rows) {
  const draft = tok(r.generated_title); const final = tok(r.corrected_title);
  const dSet = new Set(draft.map((t) => t.toLowerCase()));
  const fSet = new Set(final.map((t) => t.toLowerCase()));
  const removed = draft.filter((t) => !fSet.has(t.toLowerCase()));
  const addedWords = final.filter((t) => !dSet.has(t.toLowerCase()));
  for (const a of removed) for (const b of addedWords) {
    const rel = relation(a, b);
    if (!rel) continue;
    const key = `${a.toLowerCase()} -> ${b.toLowerCase()}`;
    const rec = pairs.get(key) || { from: a, to: b, rel, n: 0 };
    rec.n++; pairs.set(key, rec);
  }
}
const ranked = [...pairs.values()].sort((a, b) => b.n - a.n);
console.log(`草稿→定稿里形态相关的替换，出现 >=2 次的：\n`);
console.log("替换".padEnd(34) + "次数  关系");
for (const p of ranked.filter((x) => x.n >= 2)) {
  console.log(`${(p.from + " -> " + p.to).padEnd(34)} ${String(p.n).padStart(4)}  ${p.rel}`);
}
console.log(`\n只出现 1 次的形态相关替换 ${ranked.filter((x) => x.n === 1).length} 组，样例：`);
for (const p of ranked.filter((x) => x.n === 1).slice(0, 12)) {
  console.log(`  ${(p.from + " -> " + p.to).padEnd(38)} ${p.rel}`);
}
