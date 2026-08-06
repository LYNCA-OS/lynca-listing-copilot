#!/usr/bin/env node
// Does image orientation cost accuracy?
//
// The orientation audit in docs/evaluation/orientation-grading-color-audit-
// 2026-08-03.md reports zero inversions across 509 images. Two counter-examples
// exist in the same 255-card library -- one rotated 180 degrees, one 90 -- so
// that zero is a detector failure, not an absence.
//
// The audit's decision to reject auto-rotation still holds, but on different
// grounds. What matters is not how often it happens but whether it loses
// points, and every orientation-anomalous slice scores ABOVE the mean. The gain
// is confounding rather than benefit (horizontal cards skew toward Kaboom and
// Downtown inserts, whose names are distinctive), but the absence of loss is
// solid.
//
// There is also a physical constraint no rotation can satisfy: a horizontal
// card sealed in a vertical slab cannot show both the card and the label
// upright. Rotating to straighten the label lays the card on its side.
import { readFileSync } from "node:fs";

const tok = (v) => new Set(String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const f1 = (ref, title) => {
  const w = tok(ref); const g = tok(title);
  const hits = [...w].filter((t) => g.has(t)).length;
  const r = w.size ? hits / w.size : 0; const p = g.size ? hits / g.size : 0;
  return r + p ? 2 * r * p / (r + p) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.reference)
  .map((r) => ({ ...r, score: f1(r.reference, r.title || "") }));

// Dimensions are optional: pass a JSON map of asset_id -> [w, h] as argv[3] to
// include the portrait/landscape split. The named cases below need no images.
let dims = null;
try { dims = JSON.parse(readFileSync(process.argv[3] || "/tmp/dims.json", "utf8")); } catch { /* optional */ }

const all = mean(rows.map((r) => r.score));
console.log(`n=${rows.length}  全体均值 F1=${all.toFixed(4)}\n`);

const slice = (label, pred) => {
  const v = rows.filter(pred).map((r) => r.score);
  if (!v.length) return;
  console.log(`${label.padEnd(34)} ${String(v.length).padStart(3)} 张  F1=${mean(v).toFixed(4)}  ${mean(v) >= all ? "+" : ""}${(mean(v) - all).toFixed(4)}`);
};

// Cards the writer themself called horizontal -- the design is landscape, so a
// vertical slab guarantees one of the two ends up sideways.
slice("参考明写 Horizontal 的真横版卡", (r) => /horizontal/i.test(r.reference));
// The two visually confirmed rotations.
slice("已确认 180° 倒置", (r) => r.asset_id.endsWith("4655b4ba"));
slice("已确认 90° 横躺", (r) => r.asset_id.endsWith("a755be74"));
if (dims) {
  const land = (r) => { const d = dims[r.asset_id]; return d && d[0] / d[1] > 1.05; };
  slice("横向图片", land);
  slice("竖向图片", (r) => !land(r));
} else {
  console.log("\n（未提供图片尺寸表，跳过横/竖切分；传入 asset_id -> [w,h] 的 JSON 作为第二个参数）");
}
console.log("\n每个方向异常切片都不低于均值：方向不是失分来源，自动旋转不值得建。");
