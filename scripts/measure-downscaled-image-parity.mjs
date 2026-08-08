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
//
// `--control` gives BOTH arms the original image, which is what makes any of
// these numbers readable: the model disagrees with itself on identical input,
// so a downscale arm's disagreement count means nothing until you know the
// floor. It was run that way on 2026-08-07 and the flag was never committed --
// COS-56's baseline (21 disagreements over 14 cards, 4/14 agreeing) cited a
// flag this file did not have. `scripts/measure-downscaled-image-parity.test.mjs`
// now replays that run's stored payloads through `summarizeParityRows` and
// asserts those exact numbers, so the instrument is checked against a case
// whose answer is known before it is trusted again.
//
// `--per-card` is how many images make up one card (2 = front and back, the
// writer flow's pairing; the 2026-08-07 cohort was 1).
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
const flag = (name) => process.argv.includes(`--${name}`);

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
async function downscale(path, workDir, longEdge) {
  const out = join(workDir, `${basename(path, extname(path))}-${longEdge}.jpg`);
  await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80",
    "-Z", String(longEdge), path, "--out", out]);
  return out;
}

async function askProvider(imageUrls, apiKey) {
  const startedAt = Date.now();
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
  const fields = parsed.fields || parsed;
  // Latency is the point of COS-53, so it is measured here rather than
  // inferred: production shows provider time rising with bytes even though
  // `detail: "high"` bounds what the model consumes, and that claim is a
  // correlation across DIFFERENT cards. Same card, both sizes, same session
  // is the paired version of it.
  Object.defineProperty(fields, "__provider_ms", { value: Date.now() - startedAt, enumerable: false });
  return fields;
}

export const COMPARED_FIELDS = Object.freeze(["year", "manufacturer", "product", "set", "subjects",
  "card_name", "card_number", "serial", "descriptive_rarity", "parallel_exact", "release_variant", "grade"]);

export const normalizeFieldValue = (value) => Array.isArray(value)
  ? value.map((entry) => String(entry).trim().toLowerCase()).join("|")
  : String(value ?? "").trim().toLowerCase();

export const disagreeingFields = (a = {}, b = {}) =>
  COMPARED_FIELDS.filter((field) => normalizeFieldValue(a[field]) !== normalizeFieldValue(b[field]));

/** The scoring, separated from the calling so a stored run can be replayed
 *  through it. `disagreements` is recomputed rather than read off the row:
 *  a summary that trusts the row's own tally cannot detect a comparison bug. */
export function summarizeParityRows(rows = []) {
  const byField = {};
  let disagreements = 0;
  let agreed = 0;
  for (const row of rows) {
    const fields = disagreeingFields(row.full, row.reduced);
    if (!fields.length) agreed += 1;
    disagreements += fields.length;
    for (const field of fields) byField[field] = (byField[field] || 0) + 1;
  }
  return { cards: rows.length, agreed, disagreements, by_field: byField };
}

async function main() {
  const dir = arg("dir", "");
  const cardLimit = Number(arg("cards", 12));
  const longEdge = Number(arg("long-edge", 1600));
  const perCard = Number(arg("per-card", 2));
  // Both arms get the original. The point is the floor: the model disagrees
  // with itself on identical input, and a downscale number is unreadable
  // without knowing by how much.
  const control = flag("control");
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!dir) { process.stderr.write("--dir is required\n"); process.exit(2); }
  if (!apiKey) { process.stderr.write("OPENAI_API_KEY is required\n"); process.exit(2); }
  if (!Number.isInteger(perCard) || perCard < 1) { process.stderr.write("--per-card must be >= 1\n"); process.exit(2); }

  const files = (await readdir(dir)).filter((n) => /\.(jpe?g|png|webp)$/i.test(n)).sort();
  // `perCard` images make up one card, in the grouping the writer flow uses.
  const cards = [];
  for (let index = 0; index + perCard <= files.length && cards.length < cardLimit; index += perCard) {
    cards.push(files.slice(index, index + perCard).map((name) => resolve(dir, name)));
  }
  const workDir = join(tmpdir(), `downscale-parity-${cards.length}`);
  await mkdir(workDir, { recursive: true });

  const rows = [];
  let originalBytes = 0;
  let smallBytes = 0;
  for (const [index, pair] of cards.entries()) {
    const small = control
      ? pair
      : await Promise.all(pair.map((path) => downscale(path, workDir, longEdge)));
    const [originalSizes, smallSizes] = await Promise.all([
      Promise.all(pair.map(async (p) => (await readFile(p)).length)),
      Promise.all(small.map(async (p) => (await readFile(p)).length))
    ]);
    originalBytes += originalSizes.reduce((a, b) => a + b, 0);
    smallBytes += smallSizes.reduce((a, b) => a + b, 0);

    // Sequential, and alternating which arm goes first. Concurrent calls were
    // fine while this only compared FIELDS, but they cannot measure latency:
    // two in-flight requests contend, and whichever finishes second wears the
    // wait. Alternating keeps any drift over the run off one arm.
    const originalUrls = await Promise.all(pair.map(dataUrl));
    const reducedUrls = await Promise.all(small.map(dataUrl));
    let full;
    let reduced;
    if (index % 2 === 0) {
      full = await askProvider(originalUrls, apiKey);
      reduced = await askProvider(reducedUrls, apiKey);
    } else {
      reduced = await askProvider(reducedUrls, apiKey);
      full = await askProvider(originalUrls, apiKey);
    }
    const disagreements = disagreeingFields(full, reduced);
    rows.push({
      card: index + 1, files: pair.map((p) => basename(p)), disagreements, full, reduced,
      original_ms: full.__provider_ms, reduced_ms: reduced.__provider_ms,
      original_bytes: originalSizes.reduce((a, b) => a + b, 0),
      reduced_bytes: smallSizes.reduce((a, b) => a + b, 0)
    });
    process.stdout.write(`${index + 1}/${cards.length} ${disagreements.length ? `≠ ${disagreements.join(",")}` : "= 一致"}\n`);
    for (const field of disagreements) {
      process.stdout.write(`      ${field}: A=${JSON.stringify(full[field])}  B=${JSON.stringify(reduced[field])}\n`);
    }
  }

  const summary = summarizeParityRows(rows);
  const ms = (key) => rows.map((row) => row[key]).filter((value) => Number.isFinite(value));
  const mean = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0);
  const median = (values) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)]);
  };
  const originalMs = ms("original_ms");
  const reducedMs = ms("reduced_ms");
  const faster = rows.filter((row) => row.reduced_ms < row.original_ms).length;
  process.stdout.write([
    "",
    `provider 耗时  原图 mean ${mean(originalMs)}ms / median ${median(originalMs)}ms`,
    `               缩图 mean ${mean(reducedMs)}ms / median ${median(reducedMs)}ms`,
    `               缩图更快的卡 ${faster}/${rows.length}`,
    ""
  ].join("\n"));
  process.stdout.write([
    "",
    `模式              ${control ? "control（两臂同为原图）" : `downscale（长边 ${longEdge}）`}`,
    `卡片数            ${summary.cards}`,
    `全字段一致        ${summary.agreed}/${summary.cards}`,
    `分歧字段总数      ${summary.disagreements}`,
    `分歧分布          ${Object.keys(summary.by_field).length ? JSON.stringify(summary.by_field) : "（无）"}`,
    `A 臂总字节        ${originalBytes.toLocaleString()}`,
    `B 臂总字节        ${smallBytes.toLocaleString()}  (${(100 * smallBytes / originalBytes).toFixed(1)}%)`,
    ""
  ].join("\n"));

  const out = control
    ? "artifacts/downscaled-image-parity/control-report.json"
    : "artifacts/downscaled-image-parity/report.json";
  await mkdir("artifacts/downscaled-image-parity", { recursive: true });
  await writeFile(out, `${JSON.stringify({ mode: control ? "control" : "downscale",
    long_edge: control ? null : longEdge, per_card: perCard, ...summary,
    original_bytes: originalBytes, small_bytes: smallBytes, rows }, null, 2)}\n`);
  process.stdout.write(`写入 ${out}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("measure-downscaled-image-parity.mjs")) await main();
