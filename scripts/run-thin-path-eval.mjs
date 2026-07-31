#!/usr/bin/env node
// Paired evaluation of two title-writing arms over the sealed reviewed-title set.
//
//   scripts/run-thin-path-eval.sh --arms thin_budgeted,thin_canonical --limit 150
//
// Four rules this harness obeys, each bought with a wasted run:
//
//   * The arms alternate per card and the order rotates. Run-to-run drift was
//     measured at 2.2pp -- larger than most effects worth finding -- so arm A
//     for 150 cards then arm B would confound the difference with time of day.
//   * Every card is flushed to disk as it completes and a rerun resumes from
//     what is there. A probe once sat at 0% CPU for 76 minutes and lost 221
//     scored cards because results were only written at the end.
//   * The comparison is per-card and paired. Arm means are not trustworthy at
//     this sample size; the sign test over paired cards is.
//   * The served effort is read back from the provider. Trusting the requested
//     value produced one paired evaluation in which both arms silently ran the
//     same configuration and still reported clean-looking numbers.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  finishThinTitle, finishCanonicalTitle, buildThinTitleRequest,
  extractProviderTitle, THIN_TITLE_PROMPT
} from "../lib/listing/thin/thin-listing-path.mjs";
import { buildCanonicalFieldsRequest, extractCanonicalPayload } from "../lib/listing/thin/canonical-fields.mjs";

const BARE_PROMPT = "Write the eBay listing title for this sports trading card. "
  + "Reply with the title only -- no explanation, no quotes, no label.";

const SERIAL_CLAUSE = "If the card is serial-numbered, write the full serial including the numerator "
  + "(for example 17/50, not /50).";

function promptArm(prompt) {
  return {
    canonical: false,
    buildRequest: (context) => {
      const request = buildThinTitleRequest(context);
      request.input[0].content[0].text = prompt;
      return request;
    },
    extract: extractProviderTitle,
    finish: (payload) => finishThinTitle(payload)
  };
}

/**
 * An arm is a request builder plus a finisher, not just a prompt: the canonical
 * arm changes what the model is asked to RETURN and therefore changes both
 * ends. Keeping arms as data is what makes any two comparable -- the
 * alternation, the checkpointing and the scoring cannot tell them apart.
 */
const ARM_SPECS = {
  bare_truncated: promptArm(BARE_PROMPT),
  thin_budgeted: promptArm(THIN_TITLE_PROMPT),
  thin_serial: promptArm(THIN_TITLE_PROMPT.replace("Reply with the title only", `${SERIAL_CLAUSE} Reply with the title only`)),
  thin_canonical: {
    canonical: true,
    buildRequest: (context) => buildCanonicalFieldsRequest(context),
    extract: extractCanonicalPayload,
    finish: (payload) => finishCanonicalTitle(payload)
  }
};

const argValue = (argv, name, fallback = "") => {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
};

async function signImageUrls(images = [], { supabaseUrl, serviceKey, expiresIn = 3600 }) {
  const urls = [];
  for (const image of images.slice(0, 2)) {
    const bucket = String(image?.bucket || "").trim();
    const objectPath = String(image?.object_path || image?.objectPath || "").trim();
    if (!bucket || !objectPath) continue;
    const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${bucket}/${objectPath}`, {
      method: "POST",
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn })
    });
    if (!response.ok) throw new Error(`sign_failed:${response.status}:${objectPath}`);
    const body = await response.json();
    urls.push(`${supabaseUrl}/storage/v1${body.signedURL || body.signedUrl}`);
  }
  return urls;
}

async function readSealedLabels(path) {
  const raw = await readFile(path, "utf8");
  const byKey = new Map();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed);
    const key = row.key || row.sealed_eval_label_key || row.id;
    const title = row.reviewed_title || row.title;
    if (key && title) byKey.set(String(key), String(title));
  }
  return byKey;
}

function signTest(deltas) {
  const wins = deltas.filter((delta) => delta > 1e-9).length;
  const losses = deltas.filter((delta) => delta < -1e-9).length;
  const trials = wins + losses;
  if (!trials) return { wins, losses, ties: deltas.length, p: 1 };
  // Exact two-sided binomial at p=0.5. No normal approximation: at these counts
  // the tail is where the answer lives, and that is where it is worst.
  let tail = 0;
  let coefficient = 1;
  const extreme = Math.min(wins, losses);
  for (let k = 0; k <= extreme; k += 1) {
    if (k > 0) coefficient = (coefficient * (trials - k + 1)) / k;
    tail += coefficient;
  }
  return { wins, losses, ties: deltas.length - trials, p: Math.min(1, 2 * tail * Math.pow(0.5, trials)) };
}

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Precision matters as much as recall: the reviewed titles are the DESIRED
// output, not a sample of facts, so a word the reviewer did not write is a word
// that wasted the 80-character budget. Recall-only scoring is what made an arm
// that writes more win by construction.
const tokenise = (text) => new Set(String(text ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));

function scoreF1(reference, title) {
  const want = tokenise(reference);
  const got = tokenise(title);
  const hit = [...want].filter((token) => got.has(token)).length;
  const recall = want.size ? hit / want.size : 0;
  const precision = got.size ? hit / got.size : 0;
  return { recall, precision, f1: (recall + precision) ? (2 * recall * precision) / (recall + precision) : 0 };
}

export async function main(argv = process.argv.slice(2)) {
  const evalRoot = argValue(argv, "--eval-root", "/Users/paidaxin/lynca-eval-root");
  const { policyFairTokenRecall } = await import(resolve(evalRoot, "scripts/evaluate-cloud-listing-api.mjs"));

  const ARMS = argValue(argv, "--arms", "thin_budgeted,thin_canonical")
    .split(",").map((key) => key.trim()).filter(Boolean)
    .map((key) => {
      if (!ARM_SPECS[key]) throw new Error(`unknown arm: ${key} (have ${Object.keys(ARM_SPECS).join(", ")})`);
      return { key, ...ARM_SPECS[key] };
    });
  if (ARMS.length !== 2) throw new Error("exactly two arms: the comparison is paired");

  const model = argValue(argv, "--model", "gpt-5.6-luna");
  const effort = argValue(argv, "--effort", "none");
  // 150 is the verdict size, from a bootstrap over the 255-card paired run:
  // 93% power on a 3pp effect, against 45% at n=50. Below that, 50 is a screen
  // and not a verdict.
  const limit = Number(argValue(argv, "--limit", "150")) || 150;
  const dataset = resolve(evalRoot, argValue(argv, "--dataset", "data/eval/reviewed-title-blind/reviewed-title-image-only.json"));
  const sealedLabels = resolve(evalRoot, argValue(argv, "--sealed-labels", "data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl"));
  const outDir = resolve(argValue(argv, "--out-dir", "artifacts/thin-path-eval"));
  const requestTimeoutMs = Math.max(10_000, Number(argValue(argv, "--request-timeout-ms", "120000")) || 120_000);
  const maxAttempts = Math.max(1, Number(argValue(argv, "--max-attempts", "3")) || 3);

  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  const apiKey = String(process.env.OPENAI_API_KEY || "");
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and a service key are required");
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");

  await mkdir(outDir, { recursive: true });
  const checkpointPath = resolve(outDir, `thin-path-${model}.jsonl`);

  const done = new Map();
  if (existsSync(checkpointPath)) {
    for (const line of (await readFile(checkpointPath, "utf8")).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const row = JSON.parse(trimmed);
      done.set(`${row.asset_id}::${row.arm}`, row);
    }
    process.stderr.write(`resuming: ${done.size} card-arms already on disk\n`);
  }

  const manifest = JSON.parse(await readFile(dataset, "utf8"));
  const labels = await readSealedLabels(sealedLabels);
  const items = (manifest.items || []).slice(0, limit);

  const callProvider = (request) => fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(request)
  });

  for (const [index, item] of items.entries()) {
    const reference = labels.get(String(item?.sealed_eval_label_ref?.key || ""));
    if (!reference) { process.stderr.write(`  ${index + 1}/${items.length}: no sealed label, skipped\n`); continue; }

    // Rotate which arm goes first: whatever drifts within a card -- signed-URL
    // warmth, provider load -- otherwise lands on the same arm every time.
    const order = index % 2 === 0 ? ARMS : [...ARMS].reverse();

    let imageUrls = null;
    for (const arm of order) {
      const key = `${item.asset_id}::${arm.key}`;
      if (done.has(key)) continue;
      if (!imageUrls) imageUrls = await signImageUrls(item.images, { supabaseUrl, serviceKey });

      const request = arm.buildRequest({ imageUrls, model, effort });
      const startedAt = Date.now();
      let body = null;
      let response = null;
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          response = await callProvider(request);
          body = await response.json();
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          process.stderr.write(`  ${index + 1}/${items.length} ${arm.key}: attempt ${attempt}/${maxAttempts} ${error?.name || "failed"}\n`);
        }
      }
      if (lastError || !response.ok || body?.error) {
        process.stderr.write(`  ${index + 1}/${items.length} ${arm.key}: FAILED ${lastError?.message || body?.error?.message || response?.status}\n`);
        continue;
      }
      const servedEffort = body?.reasoning?.effort ?? effort;
      if (servedEffort !== effort) {
        process.stderr.write(`  ${index + 1}/${items.length} ${arm.key}: DISCARDED, provider ran ${servedEffort}\n`);
        continue;
      }

      const payload = arm.extract(body);
      const finished = arm.finish(payload);
      const quality = scoreF1(reference, finished.title);
      const row = {
        asset_id: item.asset_id,
        arm: arm.key,
        score: policyFairTokenRecall(reference, finished.title),
        f1: quality.f1,
        recall: quality.recall,
        precision: quality.precision,
        title: finished.title,
        raw_title: payload,
        reference,
        sanitised: finished.sanitised,
        truncated: finished.truncated,
        raw_length: finished.raw_length,
        length: finished.length,
        latency_ms: Date.now() - startedAt,
        output_tokens: body?.usage?.output_tokens ?? null,
        // Canonical arms only; the field report keys off this.
        fields: finished.fields ?? null,
        field_defects: finished.field_defects ?? null,
        grammar: finished.grammar ?? null,
        brackets: finished.brackets ?? null,
        dropped_brackets: finished.dropped_brackets ?? null,
        suppressed_brackets: finished.suppressed_brackets ?? null,
        empty_fields: finished.empty_fields ?? null,
        unreadable_fields: finished.unreadable_fields ?? null,
        low_confidence_fields: finished.low_confidence_fields ?? null
      };

      await writeFile(checkpointPath, `${JSON.stringify(row)}\n`, { flag: "a", encoding: "utf8" });
      done.set(key, row);
      process.stderr.write(`  ${index + 1}/${items.length} ${arm.key}: F1 ${row.f1.toFixed(3)} (${row.length}c)\n`);
    }
  }

  const byArm = new Map(ARMS.map((arm) => [arm.key, new Map()]));
  for (const row of done.values()) byArm.get(row.arm)?.set(row.asset_id, row);

  const [control, treatment] = ARMS;
  const paired = [...byArm.get(control.key).keys()]
    .filter((assetId) => byArm.get(treatment.key).has(assetId))
    .map((assetId) => ({ control: byArm.get(control.key).get(assetId), treatment: byArm.get(treatment.key).get(assetId) }));

  const deltas = paired.map(({ control: a, treatment: b }) => b.f1 - a.f1);
  const test = signTest(deltas);

  const summary = {
    schema_version: "thin-path-eval-v2",
    model,
    effort,
    cards_paired: paired.length,
    arms: ARMS.map((arm) => {
      const rows = [...byArm.get(arm.key).values()];
      const canonical = rows.filter((row) => row.fields);
      return {
        arm: arm.key,
        n: rows.length,
        f1: rows.length ? average(rows.map((row) => row.f1)) : null,
        recall: rows.length ? average(rows.map((row) => row.recall)) : null,
        precision: rows.length ? average(rows.map((row) => row.precision)) : null,
        token_recall: rows.length ? average(rows.map((row) => row.score)) : null,
        median_length: rows.length ? median(rows.map((row) => row.length)) : null,
        median_latency_ms: rows.length ? median(rows.map((row) => row.latency_ms)) : null,
        median_output_tokens: rows.length ? median(rows.map((row) => row.output_tokens ?? 0)) : null,
        // The questions this run exists to answer, each written down before it.
        print_finish_stated: canonical.filter((row) => row.fields.print_finish).length,
        card_name_stated: canonical.filter((row) => row.fields.card_name).length,
        release_variant_stated: canonical.filter((row) => row.fields.release_variant).length,
        descriptive_rarity_stated: canonical.filter((row) => row.fields.descriptive_rarity).length,
        low_confidence_used: canonical.filter((row) => (row.low_confidence_fields || []).length).length,
        unreadable_used: canonical.filter((row) => (row.unreadable_fields || []).length).length,
        canonical_n: canonical.length
      };
    }),
    paired_delta_f1: deltas.length ? average(deltas) : null,
    sign_test: test
  };

  await writeFile(resolve(outDir, `thin-path-${model}.json`), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  process.stdout.write(`\narm              n      F1  recall  precis  tok_rec  len  latency  out_tok\n`);
  for (const arm of summary.arms) {
    process.stdout.write(
      `${arm.arm.padEnd(15)} ${String(arm.n).padStart(3)}  ${(arm.f1 ?? NaN).toFixed(4)}  `
      + `${(arm.recall ?? NaN).toFixed(4)}  ${(arm.precision ?? NaN).toFixed(4)}   ${(arm.token_recall ?? NaN).toFixed(4)}  `
      + `${String(arm.median_length).padStart(3)}  ${String(Math.round(arm.median_latency_ms ?? NaN)).padStart(7)}  ${String(arm.median_output_tokens).padStart(7)}\n`
    );
  }
  for (const arm of summary.arms) {
    if (!arm.canonical_n) continue;
    process.stdout.write(
      `\n${arm.arm} 字段填充 (n=${arm.canonical_n})  print_finish=${arm.print_finish_stated}  `
      + `card_name=${arm.card_name_stated}  release_variant=${arm.release_variant_stated}  `
      + `descriptive_rarity=${arm.descriptive_rarity_stated}\n`
      + `  low_confidence 用在 ${arm.low_confidence_used} 张   unreadable 用在 ${arm.unreadable_used} 张   [上一版 unreadable 3/150]\n`
    );
  }
  process.stdout.write(
    `\npaired n=${paired.length}  delta_F1=${(summary.paired_delta_f1 ?? NaN).toFixed(4)}  `
    + `${treatment.key} wins ${test.wins} : ${control.key} wins ${test.losses} : ties ${test.ties}  p=${test.p.toExponential(2)}\n`
  );
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`thin path eval failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
