#!/usr/bin/env node
// Does sending a DOWNSCALED image change what the model reads?
//
// The question behind the question. Recognition currently waits for the full
// original to upload -- verbatim, up to 25MB -- before it starts, which is
// where a writer's wall clock goes. Starting recognition from a small derived
// image would remove that wait, but only if the model reads the same card.
//
// Structurally the risk is smaller than it looks: production sends
// `detail: "high"`, and the provider bounds what it consumes at that setting,
// so bytes above its bound are discarded before the model ever sees them. What
// that argument CANNOT settle is whether OUR downscale is as kind to fine print
// -- card numbers and serials like 027/150 are a few pixels tall -- as the
// provider's own. That is measurable, so it is measured rather than argued.
//
// No labels needed: the same card goes through both arms and the canonical
// fields are compared to each other. Agreement means no degradation. Every
// disagreement is printed for inspection, because on fine print the interesting
// number is not the rate but which arm was right.
//
//   OPENAI_API_KEY=... node scripts/measure-downscaled-image-parity.mjs \
//     --dir "/path/to/cards" --cards 12 --long-edge 1600
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join, extname, basename } from "node:path";
import { tmpdir } from "node:os";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";
import { buildCanonicalFieldsRequest, parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";

const run = promisify(execFile);
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const dir = arg("dir", "");
const cardLimit = Number(arg("cards", 12));
const longEdge = Number(arg("long-edge", 1600));
const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
if (!dir) { process.stderr.write("--dir is required\n"); process.exit(2); }
if (!apiKey) { process.stderr.write("OPENAI_API_KEY is required\n"); process.exit(2); }

const mime = (path) => ({
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"
}[extname(path).toLowerCase()] || "image/jpeg");

const dataUrl = async (path) =>
  `data:${mime(path)};base64,${(await readFile(path)).toString("base64")}`;

/** macOS ships sips, so this needs no dependency the repo does not already have.
 *  JPEG out, deliberately: the browser's own downscale is
 *  `canvasToDataUrl(canvas, quality)`, which is JPEG, so this reproduces the
 *  re-encode the real client would do rather than an idealised resize. (sips
 *  can read webp but not write it, which surfaced the point.) */
async function downscale(path, workDir) {
  const out = join(workDir, `${basename(path, extname(path))}-${longEdge}.jpg`);
  await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80",
    "-Z", String(longEdge), path, "--out", out]);
  return out;
}

async function askProvider(imageUrls) {
  const body = buildCanonicalFieldsRequest({
    imageUrls,
    model: CSM_THIN_RUNTIME_CONTRACT.model,
    effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    imageDetail: "high"
  });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`provider_${response.status}:${JSON.stringify(payload).slice(0, 200)}`);
  const text = (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("");
  const parsed = parseCanonicalFields(text);
  return parsed.fields || parsed;
}

const files = (await readdir(dir)).filter((n) => /\.(jpe?g|png|webp)$/i.test(n)).sort();
// Two images per card, in the pairing the writer flow uses.
const cards = [];
for (let index = 0; index + 1 < files.length && cards.length < cardLimit; index += 2) {
  cards.push([resolve(dir, files[index]), resolve(dir, files[index + 1])]);
}
const workDir = join(tmpdir(), `downscale-parity-${cards.length}`);
await mkdir(workDir, { recursive: true });

const COMPARED = ["year", "manufacturer", "product", "set", "subjects", "card_name",
  "card_number", "serial", "descriptive_rarity", "parallel_exact", "release_variant", "grade"];
const norm = (value) => Array.isArray(value)
  ? value.map((entry) => String(entry).trim().toLowerCase()).join("|")
  : String(value ?? "").trim().toLowerCase();

const rows = [];
let originalBytes = 0;
let smallBytes = 0;
for (const [index, pair] of cards.entries()) {
  const small = await Promise.all(pair.map((path) => downscale(path, workDir)));
  const [originalSizes, smallSizes] = await Promise.all([
    Promise.all(pair.map(async (p) => (await readFile(p)).length)),
    Promise.all(small.map(async (p) => (await readFile(p)).length))
  ]);
  originalBytes += originalSizes.reduce((a, b) => a + b, 0);
  smallBytes += smallSizes.reduce((a, b) => a + b, 0);

  const [full, reduced] = await Promise.all([
    askProvider(await Promise.all(pair.map(dataUrl))),
    askProvider(await Promise.all(small.map(dataUrl)))
  ]);
  const disagreements = COMPARED.filter((field) => norm(full[field]) !== norm(reduced[field]));
  rows.push({ card: index + 1, files: pair.map((p) => basename(p)), disagreements, full, reduced });
  process.stdout.write(`${index + 1}/${cards.length} ${disagreements.length ? `≠ ${disagreements.join(",")}` : "= 一致"}\n`);
  for (const field of disagreements) {
    process.stdout.write(`      ${field}: 原图=${JSON.stringify(full[field])}  缩图=${JSON.stringify(reduced[field])}\n`);
  }
}

const agreed = rows.filter((row) => !row.disagreements.length).length;
const byField = {};
for (const row of rows) for (const field of row.disagreements) byField[field] = (byField[field] || 0) + 1;
process.stdout.write([
  "",
  `卡片数            ${rows.length}`,
  `全字段一致        ${agreed}/${rows.length}`,
  `分歧字段          ${Object.keys(byField).length ? JSON.stringify(byField) : "（无）"}`,
  `原图总字节        ${originalBytes.toLocaleString()}`,
  `缩图总字节        ${smallBytes.toLocaleString()}  (${(100 * smallBytes / originalBytes).toFixed(1)}%)`,
  ""
].join("\n"));

await mkdir("artifacts/downscaled-image-parity", { recursive: true });
await writeFile("artifacts/downscaled-image-parity/report.json",
  `${JSON.stringify({ long_edge: longEdge, cards: rows.length, agreed, by_field: byField,
    original_bytes: originalBytes, small_bytes: smallBytes, rows }, null, 2)}\n`);
