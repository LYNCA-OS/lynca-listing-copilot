#!/usr/bin/env node

// Paid, bounded falsification screen for the two visual mechanisms introduced
// together: same-call orientation attention and literal slab-label priority.
// It never writes Supabase or Production. Existing fresh-150 rows are the
// control; each selected card is called once upright and once rotated 180°.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  buildCanonicalFieldsRequest,
  extractCanonicalPayload
} from "../lib/listing/thin/canonical-fields.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";

const ORIENTATION_PROBE_CLAUSE = "Before reading, determine the text direction of each image. If an image is upside down, mentally rotate it 180 degrees and then read it. A legitimate horizontal card or sideways design is not upside down and must not be rotated merely because the card is landscape.";
const PRODUCTION_PARALLEL_CLAUSE = "The parallel is asked for in three separate pieces and you should answer whichever ones you can: `surface_color` is just the basic colour (a shimmering gold card is simply Gold); `parallel_family` is the finish treatment (Refractor, Prizm, Mojo -- the hobby uses a small fixed set); `parallel_exact` only when the full name is literally printed. Answering the colour alone is a good answer -- the composer combines them.";
const GRADED_COLOUR_PROBE_CLAUSE = "The parallel is asked for in three separate pieces and you should answer whichever ones you can. A parallel or colour name literally printed on a slab label or card outranks visual appearance and belongs in `parallel_exact`. Never treat the slab label's background colour as the card's colour. `surface_color` is only the basic colour of the card treatment; foil glare, rainbow reflections and lighting are not proof of a named colour. `parallel_family` is the finish treatment (Refractor, Prizm, Mojo). If appearance is ambiguous and no text names the treatment, leave the finish fields empty instead of guessing.";

const execFileAsync = promisify(execFile);
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const readJsonl = async (path) => (await readFile(path, "utf8"))
  .split(/\n+/).filter(Boolean).map(JSON.parse);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const f1 = (left, right) => {
  const a = tokens(left); const b = tokens(right);
  const hits = [...a].filter((token) => b.has(token)).length;
  const recall = a.size ? hits / a.size : 0;
  const precision = b.size ? hits / b.size : 0;
  return recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
};
const average = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

const TARGETS = Object.freeze([
  "reviewed_blind_e9dae371785094df079c", // false Rainbow Foil
  "reviewed_blind_ee03ba06dd634655b4ba", // false Blue Foil
  "reviewed_blind_9be0cc1a90961255c312", // false Green Prizm
  "reviewed_blind_659d6de445a5a7f8fdca", // Silver read as Rainbow
  "reviewed_blind_12eca650b27f025d5a1c", // slab says Blue Shimmer
  "reviewed_blind_3304222f844f985e9574", // slab says Orange
  "reviewed_blind_70559ba85193165a2f95", // slab says Blue Refractor
  "reviewed_blind_805d56c3f42c2ad4218c", // slab says Gold Ref
  "reviewed_blind_77f1063c48c35c3d3583", // PSA card/auto 9/10
  "reviewed_blind_ccc908ae3278d88b80dc", // PSA card/auto 9/10
  "reviewed_blind_410c0c9aa76e944a0cbc", // Auto 9 is not Authentic
  "reviewed_blind_0dd3315a29711425e71b", // grade omitted / false lot
  "reviewed_blind_cd081e3a017a5c05b5b5"  // legitimate horizontal card
]);

const datasetPath = resolve(arg("--dataset", "/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json"));
const labelsPath = resolve(arg("--labels", "/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl"));
const controlPath = resolve(arg("--control", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl"));
const imageDir = resolve(arg("--image-dir", "/tmp/lynca-orientation-audit/images"));
const outPath = resolve(arg("--out", "artifacts/orientation-grading-probe-2026-08-03.jsonl"));
const summaryPath = resolve(arg("--summary", "artifacts/orientation-grading-probe-2026-08-03.json"));
const concurrency = Number(arg("--concurrency", "2"));
const model = arg("--model", "gpt-5.6-luna");
const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
if (!apiKey) throw new Error("OPENAI_API_KEY_is_required");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("concurrency_must_be_1_to_8");

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const labels = new Map((await readJsonl(labelsPath)).map((row) => [row.key, row.reviewed_title]));
const controls = new Map((await readJsonl(controlPath))
  .filter((row) => row.arm === "thin_canonical_high")
  .map((row) => [row.asset_id, row]));
const selected = TARGETS.map((assetId) => dataset.items.find((row) => row.asset_id === assetId));
if (selected.some((row) => !row)) throw new Error("target_missing_from_dataset");

const work = await mkdtemp(join(tmpdir(), "lynca-orientation-probe-"));
const imageDataUrls = async (item, rotated) => {
  const values = [];
  for (const image of item.images) {
    const source = join(imageDir, `${item.asset_id}__${image.role}.jpg`);
    let path = source;
    if (rotated) {
      path = join(work, `${item.asset_id}__${image.role}__180.jpg`);
      await execFileAsync("/usr/bin/sips", ["-r", "180", source, "--out", path]);
    }
    values.push(`data:image/jpeg;base64,${(await readFile(path)).toString("base64")}`);
  }
  return values;
};

const call = async (item, rotated) => {
  const imageUrls = await imageDataUrls(item, rotated);
  const request = buildCanonicalFieldsRequest({ imageUrls, model, effort: "none", imageDetail: "high" });
  const textPart = request.input[0].content.find((part) => part.type === "input_text");
  textPart.text = textPart.text
    .replace("Read this trading card and report what is printed on it.",
      `Read this trading card and report what is printed on it. ${ORIENTATION_PROBE_CLAUSE}`)
    .replace(PRODUCTION_PARALLEL_CLAUSE, GRADED_COLOUR_PROBE_CLAUSE);
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000)
  });
  const body = await response.json();
  if (!response.ok || body?.error) throw new Error(body?.error?.message || `provider_http_${response.status}`);
  const payload = extractCanonicalPayload(body);
  const finished = finishCanonicalTitle(payload);
  return {
    orientation: rotated ? "rotated_180" : "upright",
    title: finished.title,
    fields: finished.fields,
    dropped_brackets: finished.dropped_brackets,
    field_defects: finished.field_defects,
    latency_ms: Date.now() - started,
    input_tokens: body?.usage?.input_tokens ?? null,
    output_tokens: body?.usage?.output_tokens ?? null,
    request_sha256: sha256(JSON.stringify(request))
  };
};

await writeFile(outPath, "", { mode: 0o600 });
const rows = new Array(selected.length);
let cursor = 0;
let appendQueue = Promise.resolve();
const appendDurable = (row) => {
  appendQueue = appendQueue.then(() => appendFile(outPath, `${JSON.stringify(row)}\n`));
  return appendQueue;
};
await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
  while (cursor < selected.length) {
    const index = cursor++;
    const item = selected[index];
    const control = controls.get(item.asset_id);
    const reference = labels.get(item.sealed_eval_label_ref.key);
    if (!control || !reference) throw new Error(`control_or_label_missing:${item.asset_id}`);
    const upright = await call(item, false);
    const rotated = await call(item, true);
    const row = {
      asset_id: item.asset_id,
      reference,
      control: { title: control.title, fields: control.fields, f1: f1(reference, control.title) },
      treatment_upright: { ...upright, f1: f1(reference, upright.title) },
      treatment_rotated_180: { ...rotated, f1: f1(reference, rotated.title) },
      orientation_title_f1: f1(upright.title, rotated.title),
      authority: "evaluation_only",
      production_promoted: false
    };
    rows[index] = row;
    await appendDurable(row);
    process.stderr.write(`${index + 1}/${selected.length} ${item.asset_id} control=${row.control.f1.toFixed(3)} upright=${row.treatment_upright.f1.toFixed(3)} rotated=${row.treatment_rotated_180.f1.toFixed(3)}\n`);
  }
}));
await appendQueue;

const summary = {
  schema_version: "orientation-grading-probe-v1",
  cards: rows.length,
  provider_calls: rows.length * 2,
  control_f1: average(rows.map((row) => row.control.f1)),
  treatment_upright_f1: average(rows.map((row) => row.treatment_upright.f1)),
  treatment_rotated_180_f1: average(rows.map((row) => row.treatment_rotated_180.f1)),
  orientation_title_f1: average(rows.map((row) => row.orientation_title_f1)),
  upright_wins: rows.filter((row) => row.treatment_upright.f1 > row.control.f1 + 1e-12).length,
  upright_losses: rows.filter((row) => row.treatment_upright.f1 < row.control.f1 - 1e-12).length,
  upright_ties: rows.filter((row) => Math.abs(row.treatment_upright.f1 - row.control.f1) <= 1e-12).length,
  rotated_within_005_of_upright: rows.filter((row) => row.treatment_rotated_180.f1 >= row.treatment_upright.f1 - 0.05).length,
  authority: "evaluation_only",
  production_promoted: false
};
await writeFile(summaryPath, `${JSON.stringify({ ...summary, rows }, null, 2)}\n`, { mode: 0o600 });
await rm(work, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
