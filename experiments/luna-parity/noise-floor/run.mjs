#!/usr/bin/env node

// Paired, alternating test of ONE variable: does putting the CSM Canonical
// Naming Layer's own criteria into context beat the hand-compressed 15-clause
// paraphrase the runtime ships today?
//
// Control    = CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT, unchanged
// Treatment  = the same prompt plus the CSM frozen naming rules, verbatim
//
// Everything else is held: same model, same effort, same schema, same images,
// same composer. Order alternates per card so a provider-side drift cannot
// align with an arm.
//
// LEAKAGE: the CSM document carries three regression fixtures, and all three
// are cards in this cohort. Injecting the document whole would put the literal
// answer for 3 of 33 cards into the treatment prompt and manufacture a win.
// Two guards, both applied: the fixtures section is never injected (only the
// criteria are), and the three cards are dropped from the cohort entirely.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT,
  CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA
} from "../../../lib/listing/thin/captured-production-e1ae-assets.mjs";
import { finishCanonicalTitle } from "../../../lib/listing/thin/thin-listing-path.mjs";

const BASE_SCHEMA = CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const COHORT = resolve(HERE, "../csm-source-context/cohort.json");
const LEAK = resolve(HERE, "../field-semantics/excluded.json");
const OUT = resolve(HERE, "results");
const MODEL = "gpt-5.6-luna";
const EFFORT = "low";
const MAX_OUTPUT_TOKENS = 8192;
const TIMEOUT_MS = 180_000;

// ── the injected criteria ───────────────────────────────────────────────────
// Verbatim from "40 Marketplace Composer" (Linear, CSM project). Criteria only.
// The "Regression fixtures" section and everything naming a specific card is
// deliberately absent -- see LEAKAGE above. Arm D already showed examples do
// not help, so nothing of value is lost by excluding them.
// The complete specification, byte-identical on every call so it forms a
// cacheable stable prefix. The shipped prompt is only 695 tokens -- BELOW
// OpenAI's 1024-token caching minimum -- which is why 100/100 measured calls
// had cached_tokens: 0. Compression cost us the criteria AND the cache.
//
// The "Regression fixtures" section is excluded: three of its fixtures are
// cards in this cohort.
// The CSM canonical LANGUAGE, not the Composer projection spec. The previous
// two experiments injected "40 Marketplace Composer", which governs how output
// is rendered -- it teaches nothing about which field a fact belongs in. The
// measured failures are exactly there: card_name MATCH 0 / MISSED 15,
// release_variant FABRICATED 3, print_finish MISSED 15. Those are field-boundary
// failures, so this injects the field boundaries.
//
// Named examples are stripped: Power Chords, Kaboom!, Regalia Relics and Downtown
// are card_name examples in the source, and three of them are golden answers in
// this cohort.


// Spec FIRST, shipped prompt second, images last. Order matters: a cache hit
// needs the stable bytes at the front of the request, and the images are the
// part that changes per card.
// Noise floor. Five identical requests per card, nothing varied.
//
// The second-look run left an accidental control behind: on the 29 cards where
// no second look triggered, both arms sent byte-identical requests. 79% of them
// came back with a different title and 28% flipped fabrication state. The mean
// |F1 difference| from pure resampling was 0.0529 -- larger than every effect
// measured all day (+0.0233, +0.0178, +0.0064, +0.0006, -0.0095).
//
// So five NO_MECHANISM_SIGNAL verdicts do not mean "these changes do nothing".
// They mean the instrument cannot resolve effects of that size. This run
// measures the instrument instead of the runtime.
//
// The model cannot be made deterministic: the shipped optimization pack records
// `sampling_parameters: "omit"` because Luna rejects temperature/top_p/seed. The
// variance is a property of the model, so it can only be averaged down.
const REPEATS = 5;
const ARMS = Object.fromEntries(Array.from({ length: REPEATS }, (_, i) => [
  `rep${i + 1}`,
  { key: `rep${i + 1}`, instructions: CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT, schema: BASE_SCHEMA }
]));



const sha256 = (v) => createHash("sha256").update(v).digest("hex");

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}

async function signedBytes({ url, key, bucket, objectPath }) {
  const sign = await fetch(`${url}/storage/v1/object/sign/${bucket}/${objectPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 1800 })
  });
  if (!sign.ok) throw new Error(`sign_failed_${sign.status}`);
  const body = await sign.json();
  const path = body.signedURL || body.signedUrl;
  const full = path.startsWith("http") ? path : `${url}/storage/v1${path}`;
  const res = await fetch(full);
  if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function callProvider({ apiKey, instructions, imageDataUrls, schema }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        instructions,
        reasoning: { effort: EFFORT },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [{
          role: "user",
          content: imageDataUrls.map((image_url) => ({ type: "input_image", image_url, detail: "high" }))
        }],
        text: {
          format: {
            type: "json_schema",
            name: "canonical_card_fields",
            strict: true,
            schema
          }
        }
      })
    });
    const latencyMs = Date.now() - started;
    const body = await res.json();
    if (!res.ok) throw new Error(`provider_${res.status}:${JSON.stringify(body).slice(0, 300)}`);
    return { body, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

function extractPayload(body) {
  for (const item of body.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) return JSON.parse(part.text);
    }
  }
  throw new Error("provider_no_output_text");
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const env = loadEnv(await readFile("/Users/paidaxin/lynca-thin-path/.env.local", "utf8"));
  const supabaseUrl = env.SUPABASE_URL.replace(/\/+$/, "");
  const supabaseKey = env.SUPABASE_SECRET_KEY;
  const apiKey = env.OPENAI_API_KEY;
  if (!supabaseUrl || !supabaseKey || !apiKey) throw new Error("credentials_missing");

  const recovered = JSON.parse(await readFile(
    resolve(REPO, "experiments/luna-parity/shadow-53-gamma/input/recovered-supabase-images.json"), "utf8"));
  const labels = new Map();
  const labelText = await readFile(
    resolve(REPO, "experiments/luna-parity/shadow-53-gamma/golden/sealed-labels.jsonl"), "utf8");
  for (const line of labelText.split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line);
    labels.set(row.key, row.reviewed_title);
  }

  // Byte-exactness against the 2026-08-15 manifest matters only for REPLAYING
  // that run. This is a fresh paired test: both arms see the same bytes for a
  // given card, so a differently-exported copy of the same physical card is a
  // valid sample. Constraining the cohort to Supabase-recoverable cards cost 16
  // cards of power for nothing -- cohort.json restores them from the founder's
  // local export, and records which source each card came from.
  const LEAKING = new Set(JSON.parse(await readFile(LEAK, "utf8")));
  const cohortFile = JSON.parse(await readFile(COHORT, "utf8"));
  const cohort = cohortFile.items
    .filter((item) => !LEAKING.has(item.asset))
    .map((item) => ({ ...item, reference: labels.get(item.asset) }))
    .sort((a, b) => a.asset.localeCompare(b.asset));

  const sources = cohort.reduce((acc, item) => ({ ...acc, [item.source]: (acc[item.source] || 0) + 1 }), {});
  console.log(`cohort: ${cohort.length} cards ${JSON.stringify(sources)} (excluded ${LEAKING.size} CSM-fixture cards)`);
  console.log(`${REPEATS} identical repeats per card, sha ${sha256(CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT).slice(0, 12)}`);
  console.log(`${cohort.length * REPEATS} calls total. Nothing is varied between repeats.`);

  const resultsPath = resolve(OUT, "raw-results.jsonl");
  const done = new Set();
  if (existsSync(resultsPath)) {
    for (const line of (await readFile(resultsPath, "utf8")).split(/\r?\n/).filter(Boolean)) {
      const row = JSON.parse(line);
      done.add(`${row.asset}::${row.arm}`);
    }
    console.log(`resuming: ${done.size} jobs already on disk`);
  }

  for (const [index, card] of cohort.entries()) {
    // alternate which arm goes first, so order effects cannot align with an arm
    const order = Object.keys(ARMS);
    let dataUrls = null;
    for (const armKey of order) {
      if (done.has(`${card.asset}::${armKey}`)) continue;
      if (!dataUrls) {
        const buffers = await Promise.all(card.images.map((image) => (image.local_path
          ? readFile(image.local_path)
          : signedBytes({
            url: supabaseUrl, key: supabaseKey, bucket: image.bucket, objectPath: image.object_path
          }))));
        buffers.forEach((buffer, i) => {
          const expected = card.images[i].content_sha256;
          const actual = createHash("sha256").update(buffer).digest("hex");
          if (expected !== actual) {
            throw new Error(`image_bytes_changed:${card.images[i].object_path || card.images[i].local_path}`);
          }
        });
        dataUrls = buffers.map((buffer) => `data:image/webp;base64,${buffer.toString("base64")}`);
      }
      let row;
      try {
        const { body, latencyMs } = await callProvider({
          apiKey, instructions: ARMS[armKey].instructions, imageDataUrls: dataUrls,
          schema: ARMS[armKey].schema
        });
        const payload = extractPayload(body);
        const finished = finishCanonicalTitle(payload, { compose: true });
        row = {
          asset: card.asset,
          arm: armKey,
          order_position: order.indexOf(armKey),
          title: finished.title || "",
          fields: finished.fields || null,
          latency_ms: latencyMs,
          served_effort: body?.reasoning?.effort ?? null,
          usage: body?.usage ?? null,
          cached_tokens: body?.usage?.input_tokens_details?.cached_tokens ?? null,
          low_confidence: payload?.low_confidence ?? null,
          unreadable: payload?.unreadable ?? null,
          raw_payload: payload
        };
      } catch (error) {
        row = { asset: card.asset, arm: armKey, error: String(error && error.message || error) };
      }
      await appendFile(resultsPath, `${JSON.stringify(row)}\n`);
      const mark = row.error
        ? `ERROR ${row.error.slice(0, 60)}`
        : `${row.latency_ms}ms  ${row.title}`;
      console.log(`[${index + 1}/${cohort.length}] ${armKey.padEnd(9)} ${mark}`);
    }
  }

  await writeFile(resolve(OUT, "run-manifest.json"), JSON.stringify({
    schema: "noise-floor-repeats-v1",
    model: MODEL,
    effort: EFFORT,
    cards: cohort.length,
    excluded_leaking_cards: [...LEAKING],
    instructions_sha256: sha256(CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT),
    repeats: REPEATS,

    csm_source_document: "https://linear.app/lynca/document/40-marketplace-composer-16c6118194f4"
  }, null, 1));
  console.log("done");
}

await main();
