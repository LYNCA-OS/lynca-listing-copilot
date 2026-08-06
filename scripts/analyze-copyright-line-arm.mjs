#!/usr/bin/env node
// Verdict for the copyright-line arm, stratified.
//
// The hypothesis is specific: a raw card's copyright line is the equivalent of
// a slab label, so the gain must appear on RAW cards. A gain that shows up only
// on graded cards would mean something else moved, and the brief commits to
// failing the arm in that case rather than banking the number.
import { readFileSync } from "node:fs";

const TREAT = "thin_canonical_high";
const CONTROL = "thin_canonical_high_pre_copyright";

const tok = (v) => new Set(String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const f1 = (ref, title) => {
  const w = tok(ref); const g = tok(title);
  const hits = [...w].filter((t) => g.has(t)).length;
  const r = w.size ? hits / w.size : 0; const p = g.size ? hits / g.size : 0;
  return r + p ? 2 * r * p / (r + p) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const lnFact = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const signTest = (w, l) => {
  const n = w + l; if (!n) return 1;
  let p = 0;
  for (let k = Math.max(w, l); k <= n; k++) p += Math.exp(lnFact(n) - lnFact(k) - lnFact(n - k) - n * Math.log(2));
  return Math.min(1, 2 * p);
};

const rows = readFileSync(process.argv[2]
  || "artifacts/copyright-line-150-2026-08-03/thin-path.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l));

const byCard = new Map();
for (const r of rows) {
  if (!r.reference) continue;
  const slot = byCard.get(r.asset_id) || {};
  slot[r.arm] = r; slot.reference = r.reference;
  byCard.set(r.asset_id, slot);
}
const paired = [...byCard.values()].filter((c) => c[TREAT] && c[CONTROL]);
const graded = (c) => /\b(psa|bgs|sgc|cgc|beckett)\b/i.test(c.reference);

const report = (label, cards) => {
  if (!cards.length) return;
  const c = cards.map((x) => f1(x.reference, x[CONTROL].title || ""));
  const t = cards.map((x) => f1(x.reference, x[TREAT].title || ""));
  const d = t.map((v, i) => v - c[i]);
  const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
  console.log(`${label.padEnd(12)} n=${String(cards.length).padStart(3)}  对照=${mean(c).toFixed(4)}  处理=${mean(t).toFixed(4)}  Δ=${mean(t) - mean(c) >= 0 ? "+" : ""}${(mean(t) - mean(c)).toFixed(6)}  胜/负=${w}/${l}  p=${signTest(w, l).toFixed(3)}`);
  return { d: mean(t) - mean(c), w, l, p: signTest(w, l) };
};

console.log(`配对成功 ${paired.length} 张\n`);
const all = report("全体", paired);
const raw = report("裸卡", paired.filter((c) => !graded(c)));
const gr = report("已评级", paired.filter(graded));

// Year is the field the mechanism names.
const yearHit = (c, arm) => {
  const ref = tok(c.reference);
  const y = [...tok(c[arm].title || "")].filter((t) => /^(19|20)\d{2}$/.test(t));
  return y.length ? y.some((t) => ref.has(t)) : false;
};
const rawCards = paired.filter((c) => !graded(c));
console.log(`\n年份命中率（裸卡 n=${rawCards.length}）  对照 ${(rawCards.filter((c) => yearHit(c, CONTROL)).length / rawCards.length * 100).toFixed(1)}%  ->  处理 ${(rawCards.filter((c) => yearHit(c, TREAT)).length / rawCards.length * 100).toFixed(1)}%`);

const inTok = (arm) => mean(paired.map((c) => c[arm].input_tokens || c[arm].in_tok || 0));
const growth = inTok(CONTROL) ? (inTok(TREAT) - inTok(CONTROL)) / inTok(CONTROL) * 100 : 0;
console.log(`输入 token  对照 ${inTok(CONTROL).toFixed(0)}  处理 ${inTok(TREAT).toFixed(0)}  ${growth >= 0 ? "+" : ""}${growth.toFixed(2)}%  ${Math.abs(growth) > 5 ? "<- 超 5% 护栏，判失败" : "(在护栏内)"}`);
const over80 = paired.filter((c) => (c[TREAT].title || "").length > 80).length;
console.log(`超 80 字符标题 ${over80} 张  ${over80 ? "<- 必须为 0" : ""}`);

console.log(`\n判定：`);
if (!raw || !gr) console.log("  数据不足");
else if (raw.d <= 0 && gr.d > 0) console.log("  失败 —— 增益只在已评级卡上，机制解释错误（任务书第 5 节）");
else if (all.w >= 8 && all.l === 0) console.log("  通过 —— 满足 8胜0负");
else if (all.d >= 0.003 && all.p < 0.05) console.log("  通过 —— ΔF1>=+0.003 且符号检验显著");
else console.log(`  未过门槛 —— 需 8胜0负，或 ΔF1>=+0.003 且 p<0.05（当前 Δ=${all.d.toFixed(6)}, p=${all.p.toFixed(3)}）`);
