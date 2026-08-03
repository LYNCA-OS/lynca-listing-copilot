#!/usr/bin/env node
// Dual-axis annotation pilot: 25 cards drawn from the 35 where truth and
// title policy provably diverge.
//
// WHY THESE CARDS
//
// The pilot exists to shake mechanical problems out of the ballot before a
// scored round, so it should spend its labels where the two axes actually pull
// apart. On these cards the observation is TRUE and the title should not carry
// it -- a base Topps Chrome Refractor really does throw a rainbow sheen, and
// `rainbow` appeared 30 times across 150 cards and matched a reviewed title
// zero times. A single mutually-exclusive enum cannot represent that at all,
// which is exactly the defect the pilot needs to expose or refute.
//
// WHAT THIS SAMPLE MAY NOT BE USED FOR
//
// These cards were selected BY a mechanism this author wrote. They are
// therefore disqualified from meta-validation: using them to show the new
// ruler beats token F1 would be scoring the ruler on the sample that produced
// the hypothesis. Per the design, pilot results do not count toward final
// numbers -- this sample is for ballot mechanics only, and the sealed
// meta-validation set must be drawn independently.
//
//   node scripts/build-dual-axis-pilot-ballot.mjs --n 25
//
// Signed image URLs need SUPABASE_URL and a key in the environment
// (set -a && . .env.local && set +a).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { TRUTH_STATUSES, TITLE_POLICIES } from "../lib/listing/evaluation/semantic-publication-ruler.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const evalRoot = arg("--eval-root", "/Users/paidaxin/lynca-eval-root");
const cohortPath = arg("--cohort", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const outDir = resolve(arg("--out", "artifacts/dual-axis-pilot"));
const n = Number(arg("--n", "25"));

const rows = readFileSync(cohortPath, "utf8").split(/\n+/).filter(Boolean)
  .map((line) => JSON.parse(line)).filter((row) => row.arm === "thin_canonical_high" && row.raw_title);

// A card qualifies when the admission layer withheld a finish term: that is
// precisely "observed, and not to be published", the divergent case.
const divergent = [];
for (const row of rows) {
  const { fields } = parseCanonicalFields(row.raw_title);
  const withheld = fields.withheld_finish_terms || [];
  if (!withheld.length) continue;
  // Every finish term observed on this card, WITHOUT saying which the pipeline
  // kept. A reviewer who can see what we chose is grading our choice rather
  // than the card.
  const candidates = [
    ...withheld.map((w) => w.value),
    fields.parallel_exact, fields.surface_color, fields.parallel_family
  ].map((v) => String(v || "").trim()).filter(Boolean);
  divergent.push({ asset_id: row.asset_id, candidates: [...new Set(candidates)] });
}

const rank = (id) => createHash("sha256").update(`dual-axis-pilot-v1|${id}`).digest("hex");
const selected = divergent.sort((a, b) => (rank(a.asset_id) < rank(b.asset_id) ? -1 : 1)).slice(0, n);

const dataset = JSON.parse(readFileSync(resolve(evalRoot,
  "data/eval/reviewed-title-blind/reviewed-title-image-only.json"), "utf8"));
const byAsset = new Map(dataset.items.map((item) => [item.asset_id, item]));

const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "");
async function signedUrl(bucket, objectPath) {
  if (!supabaseUrl || !serviceKey) return null;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${bucket}/${objectPath}`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 })
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body?.signedURL ? `${supabaseUrl}/storage/v1${body.signedURL}` : null;
}

mkdirSync(outDir, { recursive: true });
const ballot = [];
for (const card of selected) {
  const item = byAsset.get(card.asset_id);
  if (!item) continue;
  const images = [];
  for (const image of item.images || []) {
    images.push({ role: image.role, url: await signedUrl(image.bucket, image.object_path), object_path: image.object_path });
  }
  ballot.push({
    asset_id: card.asset_id,
    images,
    // Candidate order is hashed per card, so a reviewer cannot infer which term
    // the pipeline preferred from its position.
    claims: card.candidates
      .map((value) => ({ value, order: rank(`${card.asset_id}|${value}`) }))
      .sort((a, b) => (a.order < b.order ? -1 : 1))
      .map(({ value }) => ({
        field: "print_finish",
        value,
        // TWO fields, never one enum. The whole point of the pilot.
        truth_status: "",
        truth_source: "",
        title_policy: "",
        note: ""
      })),
    // The load-bearing step of gold construction, exercised in miniature. Recall's
    // denominator depends on catching facts that NO candidate list contains, so
    // the ballot has to ask for them explicitly rather than assume the union is
    // complete.
    missing_facts_scan: { finish_terms_not_listed_above: "", other_required_facts: "" }
  });
}

writeFileSync(resolve(outDir, "ballot.jsonl"), ballot.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(resolve(outDir, "ballot.csv"),
  "asset_id,front,back,claim_value,truth_status,truth_source,title_policy,note\n"
  + ballot.flatMap((card) => {
    const front = card.images.find((i) => /front/.test(i.role)) || {};
    const back = card.images.find((i) => /back/.test(i.role)) || {};
    return card.claims.map((claim) => [card.asset_id, front.url || front.object_path || "",
      back.url || back.object_path || "", claim.value, "", "", "", ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }).join("\n") + "\n");

writeFileSync(resolve(outDir, "INSTRUCTIONS.md"), `# 双轴标注 pilot（${ballot.length} 张卡）

这是**试跑**，用来发现表格本身的问题，结果不计入任何结论。发现表达不了的情况，
写在 \`note\` 里，比勉强填一个格子有用得多。

## 每条 claim 要填两个**互相独立**的判断

看正反面图，对列出的每一个工艺/平行版词，分别回答：

**第一轴 · 这张卡实际上是不是这样？**（\`truth_status\`）

| 值 | 含义 |
|---|---|
| \`SUPPORTED\` | 图上看得出确实如此 |
| \`CONTRADICTED\` | 图上看得出不是这样 |
| \`UNKNOWN\` | 图上判断不了 |

**判断不了就填 \`UNKNOWN\`，不要猜。** 猜出来的「假」比空着危害大得多。

同时填 \`truth_source\`：\`CARD_IMAGE\`（卡面）/ \`SLAB_LABEL\`（评级标签）/ \`OFFICIAL_SOURCE\`（查过官方资料，请在 note 写来源）。

**第二轴 · 这个词该不该出现在 eBay 标题里？**（\`title_policy\`）

| 值 | 含义 |
|---|---|
| \`REQUIRED\` | 必须写，不写这条标题就不合格 |
| \`OPTIONAL\` | 写不写都行 |
| \`FORBIDDEN\` | 不该写（例如它只是这个产品的基础外观，不是这张卡的平行版名） |
| \`NOT_APPLICABLE\` | 第一轴是 CONTRADICTED 或 UNKNOWN 时填这个 |

## 两个轴不要互相牵制

这是本次 pilot 最要紧的一条。**一个词完全可以「是真的」并且「不该写进标题」。**
第一轴只问事实，第二轴只问市场表达。请分开判断，不要因为觉得不该写就把事实判成假。

## 还要做一件事：补漏

每张卡最后有两个空格：

- \`finish_terms_not_listed_above\`：上面没列出来、但你在图上看到的工艺/平行版词；
- \`other_required_facts\`：这张卡还有什么信息是**必须**进标题的。

这一步不能跳。上面的候选词是机器给的，只审它们会让「机器和人都漏掉的事实」
从统计里彻底消失。

## 不要做的事

- 不要看任何已有标题（系统的、别的写手的都不行）。
- 不要和别人讨论具体某张卡。
- 不要回头改前面填过的行来求一致。

合法取值：\`truth_status\` ∈ ${TRUTH_STATUSES.join(" / ")}；\`title_policy\` ∈ ${TITLE_POLICIES.join(" / ")}。
`);

writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify({
  schema_version: "dual-axis-annotation-pilot-v1",
  purpose: "shake out ballot mechanics before a scored dual-axis round",
  n: ballot.length,
  drawn_from: `${divergent.length} cards where the finish admission layer withheld a term`,
  selection: "sha256(dual-axis-pilot-v1|asset_id) ascending",
  signed_urls: ballot.every((c) => c.images.every((i) => i.url)),
  withheld: ["writer_a_title", "system_title", "sealed_labels", "scores", "arm_names",
    "which_candidate_the_pipeline_kept"],
  disqualified_for: "meta-validation -- selected by a mechanism this author wrote; "
    + "the sealed set that compares SPG against token F1 must be drawn independently",
  counts_toward_final_results: false
}, null, 2) + "\n");

process.stdout.write(`可用发散卡 ${divergent.length} 张，抽出 ${ballot.length} 张 -> ${outDir}\n`);
process.stdout.write(`claim 总数 ${ballot.reduce((sum, c) => sum + c.claims.length, 0)}\n`);
process.stdout.write(ballot.every((c) => c.images.every((i) => i.url))
  ? "图片已签名。\n" : "未签名：环境缺 SUPABASE_URL / key。\n");
