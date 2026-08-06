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
        // Asked BEFORE the two axes, because a reviewer who cannot judge a
        // claim on our terms must be able to say so instead of picking the
        // least-wrong box. A ballot that always yields a clean answer is not
        // evidence that the frame fits -- it is evidence that the frame was
        // not falsifiable, which is the failure this project keeps repeating.
        //
        // OK_TO_JUDGE | WRONG_FIELD | WRONG_GRANULARITY | TERM_UNKNOWN | OTHER
        claim_verdict: "",
        // TWO fields, never one enum. The whole point of the pilot.
        truth_status: "",
        truth_source: "",
        evidence_refs: [],
        title_policy: "",
        // WHY, not just what. CSM already fixes title policy at the FIELD level
        // -- [Print Finish] is a secondary-priority bracket, include it if it
        // fits -- so every claim on this ballot gets the same answer from the
        // contract. What CSM cannot say is whether a given VALUE names this
        // card's parallel or merely describes the base product it was printed
        // on, and that is a fact about the product, not a matter of taste.
        //
        // So the reason is the load-bearing answer. If FORBIDDEN is almost
        // always PRODUCT_BASE_APPEARANCE, the judgement is derivable from a
        // registry and should never have been asked of a person. If it is
        // often WRITER_CONVENTION, the second axis is real and has to stay.
        // This single column decides whether COS-43 replaces human labour here
        // or merely supplements it.
        policy_reason: "",
        note: ""
      })),
    // The load-bearing step of gold construction, exercised in miniature. Recall's
    // denominator depends on catching facts that NO candidate list contains, so
    // the ballot has to ask for them explicitly rather than assume the union is
    // complete.
    missing_facts_scan: {
      finish_terms_not_listed_above: "",
      other_required_facts: "",
      // Let the reviewer simply state the right answer rather than navigate our
      // option set to approximate it.
      what_this_cards_finish_actually_is: ""
    }
  });
}

writeFileSync(resolve(outDir, "ballot.jsonl"), ballot.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(resolve(outDir, "ballot.csv"),
  "asset_id,front,back,claim_value,claim_verdict,truth_status,truth_source,evidence_refs,title_policy,policy_reason,note\n"
  + ballot.flatMap((card) => {
    const front = card.images.find((i) => /front/.test(i.role)) || {};
    const back = card.images.find((i) => /back/.test(i.role)) || {};
    return card.claims.map((claim) => [card.asset_id, front.url || front.object_path || "",
      back.url || back.object_path || "", claim.value, "", "", "", "", "", "", ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }).join("\n") + "\n");

// One row per card. Keeping this separate from the claim-level CSV prevents a
// reviewer from repeating or contradicting the unrestricted scan on every
// candidate row, and makes the load-bearing recall-denominator check actually
// fillable outside the JSON representation.
writeFileSync(resolve(outDir, "missing-facts.csv"),
  "asset_id,front,back,what_this_cards_finish_actually_is,finish_terms_not_listed_above,other_required_facts,note\n"
  + ballot.map((card) => {
    const front = card.images.find((i) => /front/.test(i.role)) || {};
    const back = card.images.find((i) => /back/.test(i.role)) || {};
    return [card.asset_id, front.url || front.object_path || "", back.url || back.object_path || "", "", "", "", ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
  }).join("\n") + "\n");

writeFileSync(resolve(outDir, "INSTRUCTIONS.md"), `# 双轴标注 pilot（${ballot.length} 张卡 / ${ballot.reduce((s, c) => s + c.claims.length, 0)} 条判断）

这是**试跑**。我们要检验的不是你判得准不准，而是**这张表本身够不够用**。
结果不计入任何结论。

> **最重要的一条**：如果你觉得我们给的选项没有一个对，那正是我们想知道的。
> 请用 \`claim_verdict\` 说出来，或者写进 \`note\`。
> **选「都不对」是这次试跑的成功结果，不是你没做完。**
> 被迫往不合适的格子里填一个答案，会让我们拿到一份看起来干净、实际错误的数据。

---

## 第 0 步：这条判断本身成不成立？（\`claim_verdict\`）

我们从卡上提取了一些**工艺/平行版**候选词，逐条请你判断。但这些词可能本身就有问题：

| 值 | 什么时候用 |
|---|---|
| \`OK_TO_JUDGE\` | 这个词确实是这张卡的工艺/平行版候选，可以往下判 |
| \`WRONG_FIELD\` | 这个词根本不是工艺（例如它是套组名的一部分、是球队、是卡名） |
| \`WRONG_GRANULARITY\` | 拆错了。比如我们分开列了「Gold」和「Prismatic」，但这张卡的平行版名就叫「Gold Prismatic」，该算一个 |
| \`TERM_UNKNOWN\` | 我不认识这个词，不确定它指什么 |
| \`OTHER\` | 别的问题，写在 \`note\` |

**只有填 \`OK_TO_JUDGE\` 才需要继续填后面两轴。** 其余情况后面留空即可。

---

## 第 1 轴：这张卡实际上是不是这样？（\`truth_status\`）

| 值 | 含义 |
|---|---|
| \`SUPPORTED\` | 图上看得出确实如此 |
| \`CONTRADICTED\` | 图上看得出不是这样 |
| \`UNKNOWN\` | 图上判断不了 |

**判断不了就填 \`UNKNOWN\`，不要猜。** 猜出来的「假」比空着危害大得多。

同时填 \`truth_source\`：\`CARD_IMAGE\`（卡面）/ \`SLAB_LABEL\`（评级标签）/ \`OFFICIAL_SOURCE\`（查过官方资料，请在 note 写来源）。

\`evidence_refs\` 不能为空：写明具体是正面还是反面、卡上哪个位置，或稳定的官方来源标识。
只写「我判断过」不构成可复核证据。

---

## 第 2 轴：这个词该不该出现在 eBay 标题里？（\`title_policy\`）

| 值 | 含义 |
|---|---|
| \`REQUIRED\` | 必须写，不写这条标题就不合格 |
| \`OPTIONAL\` | 写不写都行 |
| \`FORBIDDEN\` | 不该写（例如它只是这个产品的基础外观，不是这张卡的平行版名） |
| \`NOT_APPLICABLE\` | 第 1 轴填了 CONTRADICTED 或 UNKNOWN 时用这个 |

### 还要填理由（\`policy_reason\`）—— 这一列比上面那格更重要

我们的标题规则（哪些 bracket、什么顺序、谁先让位）**已经写死在 CSM 里了**，
所以「print_finish 该不该进标题」这个问题，契约对每一条的回答都一样。
契约回答不了的是：**这个词到底是在指认这张卡的版本，还是只是在描述它印在什么产品上。**

| 值 | 什么时候用 |
|---|---|
| \`PRODUCT_BASE_APPEARANCE\` | 这个词描述的是这个产品**基础卡本来的样子**，不是这张卡的平行版名 |
| \`NAMES_THE_PARALLEL\` | 这个词就是这张卡平行版的名字 |
| \`WRITER_CONVENTION\` | 事实没问题，但写手圈子里一般不这么写 / 一般不写它 |
| \`REDUNDANT\` | 标题里别的地方已经表达了 |
| \`OTHER\` | 写进 \`note\` |

这一格**没有标准答案**，按你真实的判断填。选项的排列顺序每条都不同，不代表倾向。

## 两个轴不要互相牵制

这是本次试跑最要紧的检验点。**一个词完全可以「是真的」并且「不该写进标题」。**
第 1 轴只问事实，第 2 轴只问市场表达。请分开判断，
不要因为觉得不该写就把事实判成假，也不要因为是真的就觉得必须写。

---

## 每张卡还要填一张 \`missing-facts.csv\`

- \`what_this_cards_finish_actually_is\`：**直接写出你认为这张卡的工艺/平行版到底是什么。**
  不用管我们上面列了什么。如果我们列的全不对，这一格就是正确答案。
- \`finish_terms_not_listed_above\`：上面没列、但你在图上看到的其他工艺词
- \`other_required_facts\`：这张卡还有什么信息是**必须**进标题的

这一步不能跳。上面的候选词是机器给的，只审它们会让「机器和人都漏掉的事实」
从统计里彻底消失。

---

## 不要做的事

- 不要看任何已有标题（系统产出的、别的写手写的都不行）。
- 不要和别人讨论具体某张卡。
- 不要回头改前面填过的行来求一致。
- **不要为了填满而填。** 空着并说明原因，比填一个你不信的值有用。

合法取值：\`truth_status\` ∈ ${TRUTH_STATUSES.join(" / ")}；\`title_policy\` ∈ ${TITLE_POLICIES.join(" / ")}。
`);

writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify({
  schema_version: "dual-axis-annotation-pilot-v1",
  purpose: "shake out ballot mechanics before a scored dual-axis round",
  n: ballot.length,
  drawn_from: `${divergent.length} cards where the finish admission layer withheld a term`,
  selection: "sha256(dual-axis-pilot-v1|asset_id) ascending",
  signed_urls: ballot.every((c) => c.images.every((i) => i.url)),
  outputs: ["ballot.jsonl", "ballot.csv", "missing-facts.csv", "INSTRUCTIONS.md"],
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
