#!/usr/bin/env node
// Build a blind title-writing packet for a second writer.
//
// WHY THIS EXISTS
//
// Every accuracy number on this project is measured against ONE writer's title,
// and the production gate asks for F1 >= 0.90 against it. Nobody has measured
// what two competent writers score against EACH OTHER on the same card. Without
// that number we cannot tell whether 0.90 is a target or an arithmetic
// impossibility -- and the evidence that it might be impossible is already in
// hand: of 285 tokens we emit that the reference lacks, only 33 are factual
// errors; the label oracle that deletes every reference-absent token tops out
// at 0.857.
//
// This is a different question from the 285-dispute calibration packet. That
// one adjudicates individual tokens. This one measures the CEILING of the
// metric itself, and it is cheaper.
//
// SAMPLE SIZE
//
// Per-card F1 standard deviation on this cohort is 0.1439, so n=50 gives a
// 95% interval of about +/-0.040. If writer-writer agreement is near 0.83 that
// sits 3.4 standard errors below 0.90 -- decisive. n=40 is acceptable (3.1 SE);
// below 30 the interval stops separating the hypotheses.
//
// BLINDNESS
//
// The packet carries images and nothing else. Writer A's title, the sealed
// labels and every system output are withheld -- if the second writer sees any
// of them the measurement is destroyed, because agreement is exactly what is
// being measured. Selection is by a hash of the asset id, not by score, so a
// rebuild cannot reshuffle a part-filled sheet and no card is chosen for being
// one we do well or badly on.
//
//   node scripts/build-writer-b-packet.mjs --n 50 --out artifacts/writer-b-packet
//
// Signed image URLs require SUPABASE_URL and a service key in the environment.
// Without them the packet still builds, carrying bucket/object paths instead.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const evalRoot = arg("--eval-root", "/Users/paidaxin/lynca-eval-root");
const cohortPath = arg("--cohort", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const outDir = resolve(arg("--out", "artifacts/writer-b-packet"));
const n = Number(arg("--n", "50"));
if (!Number.isInteger(n) || n < 10) throw new Error("n_must_be_at_least_10");

// The cohort file is read ONLY for its asset ids. Reading a title out of it and
// letting it reach the packet is the one failure this measurement cannot
// survive, so nothing else is carried forward.
const assetIds = [...new Set(readFileSync(cohortPath, "utf8").split(/\n+/).filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((row) => row.arm === "thin_canonical_high")
  .map((row) => row.asset_id))];

const dataset = JSON.parse(readFileSync(resolve(evalRoot,
  "data/eval/reviewed-title-blind/reviewed-title-image-only.json"), "utf8"));
const byAsset = new Map(dataset.items.map((item) => [item.asset_id, item]));

const rank = (id) => createHash("sha256").update(`writer-b-packet-v1|${id}`).digest("hex");
const selected = assetIds.filter((id) => byAsset.has(id))
  .sort((a, b) => (rank(a) < rank(b) ? -1 : 1)).slice(0, n);
if (selected.length < n) throw new Error(`only_${selected.length}_of_${n}_assets_have_images`);

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
const worksheet = [];
for (const assetId of selected) {
  const item = byAsset.get(assetId);
  const images = [];
  for (const image of item.images || []) {
    images.push({
      role: image.role,
      bucket: image.bucket,
      object_path: image.object_path,
      url: await signedUrl(image.bucket, image.object_path)
    });
  }
  worksheet.push({ asset_id: assetId, images, writer_b_title: "" });
}

writeFileSync(resolve(outDir, "worksheet.jsonl"),
  worksheet.map((row) => JSON.stringify(row)).join("\n") + "\n");
writeFileSync(resolve(outDir, "worksheet.csv"),
  "asset_id,front,back,writer_b_title\n" + worksheet.map((row) => {
    const front = row.images.find((i) => /front/.test(i.role)) || {};
    const back = row.images.find((i) => /back/.test(i.role)) || {};
    return [row.asset_id, front.url || front.object_path || "", back.url || back.object_path || "", ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
  }).join("\n") + "\n");

writeFileSync(resolve(outDir, "INSTRUCTIONS.md"), `# 第二写手盲写任务

## 你要做什么

对 \`worksheet.csv\` 里的 ${selected.length} 张卡，每张只看正反面图，写一条你会真实挂到
eBay 上的标题，填进 \`writer_b_title\` 列。

## 规则

- **按你平时的习惯写**，不要迎合任何规范、模板或你以为我们想要的写法。
  这次测的是「两个写手会不会写出同一条标题」，你越像平时，结果越有用。
- 长度控制在 80 字符以内。
- 看不清的信息就不要写，**不要猜**，也不要去网上查这张卡。
- 一张都不要跳过。实在写不出来，填 \`SKIP\` 并在旁边写一句原因。

## 不要做的事

- 不要看任何已有的标题——不管是系统产出的还是别的写手写的。
- 不要和别人讨论具体某张卡该怎么写。
- 不要回头修改已经填过的行来让它们风格一致。

## 交回

填好的 \`worksheet.csv\` 交回即可。
`);

writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify({
  schema_version: "writer-b-agreement-packet-v1",
  cohort: cohortPath,
  selection: "sha256(writer-b-packet-v1|asset_id) ascending",
  n: selected.length,
  signed_urls: worksheet.every((row) => row.images.every((image) => image.url)),
  withheld: ["writer_a_title", "sealed_labels", "system_titles", "system_fields", "scores"],
  purpose: "measure F1(Writer A, Writer B) to establish the ceiling of the title metric"
}, null, 2) + "\n");

process.stdout.write(`${selected.length} 张卡 -> ${outDir}\n`);
process.stdout.write(worksheet.every((row) => row.images.every((image) => image.url))
  ? "图片已签名，直接可看。\n"
  : "未签名：环境里没有 SUPABASE_URL / service key，CSV 里是 bucket 路径。\n");
