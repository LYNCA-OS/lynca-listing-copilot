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

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import {
  finishThinTitle, finishCanonicalTitle, buildThinTitleRequest,
  extractProviderTitle, THIN_TITLE_PROMPT
} from "../lib/listing/thin/thin-listing-path.mjs";
import {
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_PROMPT_FEWSHOT,
  CANONICAL_SERIAL_EXACT_PROMPT,
  CANONICAL_FIELDS_SCHEMA,
  buildCanonicalFieldsRequest,
  extractCanonicalPayload
} from "../lib/listing/thin/canonical-fields.mjs";
import {
  buildExhaustiveObservationRequest,
  extractExhaustiveObservationPayload,
  finishExhaustiveObservation
} from "../lib/listing/thin/exhaustive-observation.mjs";
import {
  BOUNDED_OPEN_EVIDENCE_VERSION,
  buildBoundedOpenEvidenceRequest,
  finishBoundedOpenEvidenceTitle
} from "../lib/listing/thin/bounded-open-evidence.mjs";
import {
  BOUNDED_EVIDENCE_V2_PROMPT,
  BOUNDED_EVIDENCE_V2_SCHEMA,
  BOUNDED_EVIDENCE_V2_SCHEMA_NAME,
  BOUNDED_EVIDENCE_V2_VERSION,
  buildBoundedEvidenceV2Request,
  finishBoundedEvidenceV2Title
} from "../lib/listing/thin/bounded-evidence-v2.mjs";
import {
  CANDIDATE_EXPRESSION_V3_PROMPT,
  CANDIDATE_EXPRESSION_V3_SCHEMA,
  CANDIDATE_EXPRESSION_V3_SCHEMA_NAME,
  CANDIDATE_EXPRESSION_V3_VERSION,
  buildCandidateExpressionV3Request,
  extractCandidateExpressionV3Payload,
  finishCandidateExpressionV3
} from "../lib/listing/thin/candidate-expression-v3.mjs";
import {
  CANDIDATE_EXPRESSION_V4_PROMPT,
  CANDIDATE_EXPRESSION_V4_SCHEMA,
  CANDIDATE_EXPRESSION_V4_SCHEMA_NAME,
  CANDIDATE_EXPRESSION_V4_VERSION,
  buildCandidateExpressionV4Request,
  extractCandidateExpressionV4Payload,
  finishCandidateExpressionV4
} from "../lib/listing/thin/candidate-expression-v4.mjs";
import {
  CANONICAL_FREE_PRODUCT_V1_PROMPT,
  CANONICAL_FREE_PRODUCT_V1_SCHEMA,
  CANONICAL_FREE_PRODUCT_V1_SCHEMA_NAME,
  CANONICAL_FREE_PRODUCT_V1_VERSION,
  buildCanonicalFreeProductV1Request,
  finishCanonicalFreeProductV1
} from "../lib/listing/thin/canonical-free-product-v1.mjs";
import {
  RESIDUAL_EVIDENCE_LANE_V1_VERSION,
  buildResidualEvidenceLaneV1Prompt,
  buildResidualEvidenceLaneV1Schema,
  parseResidualEvidenceLaneV1,
  withResidualEvidenceLaneV1
} from "../lib/listing/thin/residual-evidence-lane-v1.mjs";
import {
  FIELD_SPECIFIC_OBSERVATION_LANE_V2,
  buildFieldSpecificObservationSchemaV2,
  captureFieldSpecificObservationLaneV2,
  withFieldSpecificObservationLaneV2
} from "../experiments/accuracy/field-specific-observation-lane-v2.mjs";
import { summariseSemQuality } from "../lib/listing/thin/csm-sem-score.mjs";
import { examplesFor, fewShotBlock } from "../lib/listing/evaluation/kfold-few-shot.mjs";

// The reviewed corpus, for the k-fold few-shot arm. Populated once from the
// sealed labels the harness already reads, so the arm and the scorer are
// looking at the same file and cannot disagree about what a card's title is.
let REVIEWED_CORPUS = [];
export function setReviewedCorpus(rows) { REVIEWED_CORPUS = rows; }

const BARE_PROMPT = "Write the eBay listing title for this sports trading card. "
  + "Reply with the title only -- no explanation, no quotes, no label.";

const SERIAL_CLAUSE = "If the card is serial-numbered, write the full serial including the numerator "
  + "(for example 17/50, not /50).";

// Evaluation-only treatment for the largest expression-loss families. It does
// not add a field or change the schema; it only asks the model to make a
// second, explicit pass over printed finish/rarity marks before abstaining.
// Keep it out of production until a paired holdout shows that the extra pass
// improves those fields without changing identity or serials.
const FINISH_RARITY_PROMPT = `${CANONICAL_FIELDS_PROMPT} Before finalising, make one separate pass over the slab label and card front for printed parallel, finish, and rarity words such as Refractor, SSP, SP, Sapphire, Wave, or numbered colour names. Copy a word only when it is printed or clearly stamped; do not infer it from artwork or a generic colour. If the mark is present but uncertain, report the value and put the field in low_confidence rather than silently omitting it. Do not change subject, product, year, serial, grade, or card number merely because of this pass.`;

// Frozen local thin-path evaluation sweet spot. c2 is the latency-constrained
// stable point: the measured c10 arm gained only about 9% throughput while its
// p95 latency rose from 8.6s to 37.3s on the same 20-card screen. c120 belongs
// to a separate hosted canonical-capacity boundary.
export const DEFAULT_THIN_PATH_EVAL_CONCURRENCY = 2;

function promptArm(prompt) {
  return {
    canonical: false,
    buildRequest: (context) => {
      const request = buildThinTitleRequest(context);
      request.input[0].content[0].text = prompt;
      for (const part of request.input[0].content) {
        if (part.type === "input_image") part.detail = context.imageDetail || "high";
      }
      return request;
    },
    extract: extractProviderTitle,
    finish: (payload) => finishThinTitle(payload)
  };
}

// An arm may pin its own reasoning effort. Comparing tiers across two separate
// runs would hand the difference to whatever else moved between them, which is
// the confound the per-card alternation exists to remove -- so the tier travels
// with the arm and both alternate on the same card.
// A pinned effort needs a pinned output budget with it. `max_output_tokens` is
// shared between reasoning and the answer, so at max effort the reasoning eats
// the budget and the JSON arrives truncated -- measured at 4,096 output tokens
// against 122 for none, with F1 collapsing from 0.828 to 0.469 and print_finish
// filled on 2 cards of 4. That is a starved answer, not a worse reader, and
// testing capability on it would have produced a confident wrong conclusion.

// Targeted deliberation, the founder's idea: reasoning is a single knob for the
// whole request, but the prompt can still say WHERE to spend it.
//
// MEASURED, and the verdict splits. The mechanism works and the arm does not.
// Paired on the 105 holdout against the shipped low tier, every predicted
// indicator moved: parallel_family filled on 46 cards against 37, its hit rate
// 59% against 57%, and unreadable stayed low at 9 against 6 -- so naming the
// field as read-not-reasoned does unstick the silence that low effort induces.
//
// It did not become score. F1 0.8387 -> 0.8359, 23 wins to 31, p=0.341, with
// precision down 0.0116. The extra families we coaxed out are words the writer
// does not use, because the prompt still teaches the wrong taxonomy one clause
// away: it offers "Refractor, Prizm, Mojo" as equivalent examples of a finish
// family when Mojo is a pattern that sits on one. Getting the model to answer
// and getting it to answer with the right word are separate problems, and this
// arm only solved the first.
//
// The premise is measured, not assumed. Comparing none against low field by
// field over the 105 holdout, the effect splits cleanly and the win/loss counts
// rule out a pure ceiling artefact:
//
//   hurt by reasoning   parallel_family 45%->38% (0 wins, 4 losses)
//                       grading_info    89%->84% (0/2)
//                       subjects        95%->93% (0/2)
//   helped              set             21%->50% (9/1)
//                       descriptive_rarity 30%->50% (3/1)
//                       serial          58%->72% (7/0)
//
// A subject and a slab grade are transcription: they are printed, and thinking
// about them invents alternatives to something already legible. A set name or a
// print run has to be worked out. So the instruction names both lists rather
// than asking for more effort overall.
const TARGETED_DELIBERATION_PROMPT = `${CANONICAL_FIELDS_PROMPT} `
  + "Spend no deliberation on what is plainly printed: the subject names, the grading company and grades, the manufacturer, and the parallel family. Read those straight off the card or slab and move on -- reconsidering them replaces a legible fact with a guess. "
  + "Deliberate on what has to be worked out: the set or insert line, the printed scarcity wording, the stamped print run, the issue year, and the full product line. Those are where a second look changes the answer.";

// The finish-alignment control arm was removed with the change it measured
// (rejected 2026-08-03: combined n=255, +0.003411, 51 wins to 44, p=0.5384).
// Its rebuilder stayed behind and threw at import time, correctly -- the
// passage it reconstructs is gone -- which took the whole test suite with it.
// A guard that fires when its subject is deleted is doing its job; leaving it
// pointed at nothing is the defect.

function canonicalArm(fixedImageDetail = null, prompt = CANONICAL_FIELDS_PROMPT,
                      fixedEffort = null, fixedMaxOutputTokens = null,
                      schema = CANONICAL_FIELDS_SCHEMA, promptForCard = null) {
  return {
    canonical: true,
    responseSchemaName: "canonical_card_fields",
    responseSchema: schema,
    prompt,
    buildRequest: (context) => {
      const request = buildCanonicalFieldsRequest({
        ...context,
        ...(fixedImageDetail ? { imageDetail: fixedImageDetail } : {}),
        ...(fixedMaxOutputTokens ? { maxOutputTokens: fixedMaxOutputTokens } : {})
      });
      // A per-card prompt is how k-fold few-shot reaches the request: the
      // example block depends on which card is being scored, because a card
      // must never see its own reviewed title.
      request.input[0].content[0].text = promptForCard ? promptForCard(context, prompt) : prompt;
      return request;
    },
    extract: extractCanonicalPayload,
    finish: (payload) => finishCanonicalTitle(payload),
    imageDetail: fixedImageDetail,
    effort: fixedEffort
  };
}

function exhaustiveObservationArm(fixedImageDetail = null) {
  return {
    canonical: false,
    diagnostic: true,
    buildRequest: (context) => buildExhaustiveObservationRequest({
      ...context,
      ...(fixedImageDetail ? { imageDetail: fixedImageDetail } : {})
    }),
    extract: extractExhaustiveObservationPayload,
    finish: finishExhaustiveObservation,
    imageDetail: fixedImageDetail
  };
}

function boundedOpenEvidenceArm(fixedImageDetail = null) {
  return {
    canonical: true,
    diagnostic: true,
    evalVersion: BOUNDED_OPEN_EVIDENCE_VERSION,
    buildRequest: (context) => buildBoundedOpenEvidenceRequest({
      ...context,
      ...(fixedImageDetail ? { imageDetail: fixedImageDetail } : {})
    }),
    extract: extractCanonicalPayload,
    finish: finishBoundedOpenEvidenceTitle,
    imageDetail: fixedImageDetail
  };
}

function boundedEvidenceV2Arm(fixedImageDetail = null) {
  return {
    canonical: true,
    diagnostic: true,
    evalVersion: BOUNDED_EVIDENCE_V2_VERSION,
    responseSchemaName: BOUNDED_EVIDENCE_V2_SCHEMA_NAME,
    responseSchema: BOUNDED_EVIDENCE_V2_SCHEMA,
    prompt: BOUNDED_EVIDENCE_V2_PROMPT,
    buildRequest: (context) => buildBoundedEvidenceV2Request({
      ...context,
      ...(fixedImageDetail ? { imageDetail: fixedImageDetail } : {})
    }),
    extract: extractCanonicalPayload,
    finish: finishBoundedEvidenceV2Title,
    imageDetail: fixedImageDetail
  };
}

function candidateExpressionV3Arm(fixedImageDetail = null) {
  return {
    canonical: false,
    diagnostic: true,
    evalVersion: CANDIDATE_EXPRESSION_V3_VERSION,
    responseSchemaName: CANDIDATE_EXPRESSION_V3_SCHEMA_NAME,
    responseSchema: CANDIDATE_EXPRESSION_V3_SCHEMA,
    prompt: CANDIDATE_EXPRESSION_V3_PROMPT,
    buildRequest: (context) => buildCandidateExpressionV3Request({
      ...context,
      ...(fixedImageDetail ? { imageDetail: fixedImageDetail } : {})
    }),
    extract: extractCandidateExpressionV3Payload,
    finish: finishCandidateExpressionV3,
    imageDetail: fixedImageDetail
  };
}

function candidateExpressionV4Arm(fixedImageDetail = null) {
  return {
    canonical: false,
    diagnostic: true,
    evalVersion: CANDIDATE_EXPRESSION_V4_VERSION,
    responseSchemaName: CANDIDATE_EXPRESSION_V4_SCHEMA_NAME,
    responseSchema: CANDIDATE_EXPRESSION_V4_SCHEMA,
    prompt: CANDIDATE_EXPRESSION_V4_PROMPT,
    buildRequest: (context) => buildCandidateExpressionV4Request({
      ...context,
      ...(fixedImageDetail ? { imageDetail: fixedImageDetail } : {})
    }),
    extract: extractCandidateExpressionV4Payload,
    finish: finishCandidateExpressionV4,
    imageDetail: fixedImageDetail
  };
}


function canonicalFreeProductV1Arm(fixedImageDetail = null) {
  return {
    canonical: true,
    diagnostic: true,
    evalVersion: CANONICAL_FREE_PRODUCT_V1_VERSION,
    responseSchemaName: CANONICAL_FREE_PRODUCT_V1_SCHEMA_NAME,
    responseSchema: CANONICAL_FREE_PRODUCT_V1_SCHEMA,
    prompt: CANONICAL_FREE_PRODUCT_V1_PROMPT,
    buildRequest: (context) => buildCanonicalFreeProductV1Request({
      ...context,
      ...(fixedImageDetail ? { imageDetail: fixedImageDetail } : {})
    }),
    extract: extractCanonicalPayload,
    finish: finishCanonicalFreeProductV1,
    imageDetail: fixedImageDetail
  };
}

function canonicalResidualEvidenceV1Arm(fixedImageDetail = "high") {
  const responseSchema = buildResidualEvidenceLaneV1Schema(CANONICAL_FIELDS_SCHEMA);
  const prompt = buildResidualEvidenceLaneV1Prompt(CANONICAL_FIELDS_PROMPT);
  return {
    canonical: true,
    diagnostic: true,
    evalVersion: RESIDUAL_EVIDENCE_LANE_V1_VERSION,
    responseSchemaName: "canonical_card_fields_residual_v1",
    responseSchema,
    prompt,
    buildRequest: (context) => withResidualEvidenceLaneV1(buildCanonicalFieldsRequest({
      ...context,
      imageDetail: fixedImageDetail
    }), { enabled: true }),
    extract: extractCanonicalPayload,
    finish: (payload) => {
      const canonical = finishCanonicalTitle(payload);
      const residual = parseResidualEvidenceLaneV1(payload, { canonicalFields: canonical.fields });
      return {
        ...canonical,
        residual_schema_version: residual.schema_version,
        residual_source_present: residual.source_present,
        residual_candidates: residual.candidates,
        residual_replay_candidates: residual.replay_candidates,
        residual_dropped: residual.dropped,
        residual_defects: residual.defects,
        residual_canonical_fields_unchanged: residual.canonical_fields_unchanged
      };
    },
    imageDetail: fixedImageDetail
  };
}

// Evaluation-only same-call capture arm.  The observation rows are retained
// as candidate evidence, never projected into CSM, Composer, persistence, or
// Production.  Keeping this in the paired harness makes request bytes,
// checkpoint identity, and provider usage auditable against the canonical
// control while preserving the one-call boundary.
function canonicalFieldObservationV2Arm(fixedImageDetail = "high") {
  return {
    canonical: true,
    diagnostic: true,
    evalVersion: FIELD_SPECIFIC_OBSERVATION_LANE_V2,
    responseSchemaName: "canonical_card_fields_field_observation_v2",
    responseSchema: buildFieldSpecificObservationSchemaV2(CANONICAL_FIELDS_SCHEMA),
    prompt: null,
    buildRequest: (context) => withFieldSpecificObservationLaneV2(buildCanonicalFieldsRequest({
      ...context,
      imageDetail: fixedImageDetail
    }), { enabled: true }),
    extract: extractCanonicalPayload,
    finish: (payload) => {
      const canonical = finishCanonicalTitle(payload);
      const capture = captureFieldSpecificObservationLaneV2(payload, {
        canonicalFields: canonical.fields
      });
      return {
        ...canonical,
        observations: capture.candidates,
        observation_candidates: capture.candidates,
        observation_dropped: capture.dropped,
        observation_defects: capture.defects,
        observation_schema_version: capture.schema_version,
        observation_source_present: capture.source_present,
        observation_canonical_fields_unchanged: capture.canonical_fields_unchanged,
        observation_automatic_csm_admission: capture.automatic_csm_admission,
        observation_automatic_renderer_admission: capture.automatic_renderer_admission,
        observation_persistence_authority: capture.persistence_authority
      };
    },
    imageDetail: fixedImageDetail
  };
}

// Evaluation-only visual treatment. The extra image is a deterministic
// native-pixel bottom-band sheet supplied by the cohort manifest. It is an
// additive view: originals remain first and are never replaced or cropped.
function canonicalVisualBottomBandV1Arm(fixedImageDetail = "high") {
  return {
    canonical: true,
    diagnostic: true,
    evalVersion: "visual-bottom-two-band-v1",
    requiresExtraImages: true,
    responseSchemaName: "canonical_card_fields",
    responseSchema: CANONICAL_FIELDS_SCHEMA,
    prompt: CANONICAL_FIELDS_PROMPT,
    buildRequest: (context) => {
      const request = buildCanonicalFieldsRequest({
        ...context,
        imageDetail: fixedImageDetail
      });
      const content = request.input[0].content;
      for (const url of context.extraImageUrls || []) {
        content.push({ type: "input_image", image_url: url, detail: fixedImageDetail });
      }
      return request;
    },
    extract: extractCanonicalPayload,
    finish: (payload) => finishCanonicalTitle(payload),
    imageDetail: fixedImageDetail
  };
}


/**
 * An arm is a request builder plus a finisher, not just a prompt: the canonical
 * arm changes what the model is asked to RETURN and therefore changes both
 * ends. Keeping arms as data is what makes any two comparable -- the
 * alternation, the checkpointing and the scoring cannot tell them apart.
 */
export const ARM_SPECS = {
  bare_truncated: promptArm(BARE_PROMPT),
  thin_budgeted: promptArm(THIN_TITLE_PROMPT),
  thin_serial: promptArm(THIN_TITLE_PROMPT.replace("Reply with the title only", `${SERIAL_CLAUSE} Reply with the title only`)),
  thin_canonical: canonicalArm(),
  thin_canonical_high: canonicalArm("high"),
  // Reasoning-effort tiers. Tested once before the prompt was rewritten, with
  // no clear gain; the pipeline it was measured on no longer exists.
  thin_canonical_high_effort_none: canonicalArm("high", CANONICAL_FIELDS_PROMPT, "none"),
  // `low` is the only tier that can reach production. `max` took 43,187ms
  // against 5,193 for none on the smoke run -- the writer budget is 6-8s, so
  // its accuracy is moot. Kept for diagnosis, not for shipping.
  thin_canonical_high_effort_low: canonicalArm("high", CANONICAL_FIELDS_PROMPT, "low", 8192),
  thin_canonical_fewshot_low: canonicalArm("high", CANONICAL_FIELDS_PROMPT_FEWSHOT, "low", 8192),
  // k-fold few-shot over the REAL reviewed corpus. Examples come only from
  // other folds AND are filtered against the card's own title, because the
  // corpus contains near-duplicates of itself. Verified on all 255 with zero
  // leaks before this cost anything.
  thin_canonical_kfold_fewshot_low: canonicalArm(
    "high", CANONICAL_FIELDS_PROMPT, "low", 8192, CANONICAL_FIELDS_SCHEMA,
    (context, basePrompt) => {
      if (!context?.cardKey || !REVIEWED_CORPUS.length) return basePrompt;
      const block = fewShotBlock(examplesFor({ key: context.cardKey, corpus: REVIEWED_CORPUS }));
      return block ? `${basePrompt}\n${block}` : basePrompt;
    }
  ),
  // Both arms run at low, the shipped tier, so the only difference is the rule.
  thin_canonical_low_targeted: canonicalArm("high", TARGETED_DELIBERATION_PROMPT, "low", 8192),
  // medium sits between low and max so the marginal curve can be read rather
  // than assumed: whether the second step buys as much as the first.
  thin_canonical_high_effort_medium: canonicalArm("high", CANONICAL_FIELDS_PROMPT, "medium", 16384),
  thin_canonical_high_effort_max: canonicalArm("high", CANONICAL_FIELDS_PROMPT, "max", 32768),
  thin_canonical_original: canonicalArm("original"),
  thin_canonical_serial_exact_high: canonicalArm("high", CANONICAL_SERIAL_EXACT_PROMPT),
  thin_canonical_finish_rarity_high: canonicalArm("high", FINISH_RARITY_PROMPT),
  thin_canonical_bounded_evidence_v1: boundedOpenEvidenceArm(),
  thin_canonical_bounded_evidence_v2_high: boundedEvidenceV2Arm("high"),
  candidate_expression_v3_high: candidateExpressionV3Arm("high"),
  candidate_expression_v4_high: candidateExpressionV4Arm("high"),
  thin_canonical_free_product_v1_high: canonicalFreeProductV1Arm("high"),
  thin_canonical_residual_v1_high: canonicalResidualEvidenceV1Arm("high"),
  thin_canonical_field_observation_v2_high: canonicalFieldObservationV2Arm("high"),
  thin_canonical_visual_bottom_band_v1_high: canonicalVisualBottomBandV1Arm("high"),
  exhaustive_observation_high: exhaustiveObservationArm("high"),
  exhaustive_observation_original: exhaustiveObservationArm("original")
};

const argValue = (argv, name, fallback = "") => {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
};

function positiveIntegerArg(argv, name, fallback, minimum = 1) {
  const raw = argValue(argv, name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name.slice(2)}_must_be_integer_at_least_${minimum}`);
  return value;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const REPO_ROOT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_URLS = Object.freeze({
  thin_listing_path: new URL("../lib/listing/thin/thin-listing-path.mjs", import.meta.url),
  bounded_open_evidence: new URL("../lib/listing/thin/bounded-open-evidence.mjs", import.meta.url),
  bounded_evidence_v2: new URL("../lib/listing/thin/bounded-evidence-v2.mjs", import.meta.url),
  candidate_expression_v3: new URL("../lib/listing/thin/candidate-expression-v3.mjs", import.meta.url),
  residual_evidence_v1: new URL("../lib/listing/thin/residual-evidence-lane-v1.mjs", import.meta.url),
  exhaustive_observation: new URL("../lib/listing/thin/exhaustive-observation.mjs", import.meta.url),
  csm_sem_score: new URL("../lib/listing/thin/csm-sem-score.mjs", import.meta.url)
});
const ARM_SOURCE_ROOTS = Object.freeze({
  bare_truncated: [SOURCE_URLS.thin_listing_path],
  thin_budgeted: [SOURCE_URLS.thin_listing_path],
  thin_serial: [SOURCE_URLS.thin_listing_path],
  thin_canonical: [SOURCE_URLS.thin_listing_path],
  thin_canonical_high: [SOURCE_URLS.thin_listing_path],
  thin_canonical_original: [SOURCE_URLS.thin_listing_path],
  thin_canonical_serial_exact_high: [SOURCE_URLS.thin_listing_path],
  thin_canonical_finish_rarity_high: [SOURCE_URLS.thin_listing_path],
  thin_canonical_bounded_evidence_v1: [SOURCE_URLS.bounded_open_evidence],
  thin_canonical_bounded_evidence_v2_high: [SOURCE_URLS.bounded_evidence_v2],
  candidate_expression_v3_high: [SOURCE_URLS.candidate_expression_v3],
  candidate_expression_v4_high: [new URL("../lib/listing/thin/candidate-expression-v4.mjs", import.meta.url)],
  thin_canonical_free_product_v1_high: [new URL("../lib/listing/thin/canonical-free-product-v1.mjs", import.meta.url)],
  thin_canonical_residual_v1_high: [SOURCE_URLS.thin_listing_path, SOURCE_URLS.residual_evidence_v1],
  thin_canonical_field_observation_v2_high: [
    SOURCE_URLS.thin_listing_path,
    new URL("../experiments/accuracy/field-specific-observation-lane-v2.mjs", import.meta.url)
  ],
  thin_canonical_visual_bottom_band_v1_high: [SOURCE_URLS.thin_listing_path],
  exhaustive_observation_high: [SOURCE_URLS.exhaustive_observation],
  exhaustive_observation_original: [SOURCE_URLS.exhaustive_observation]
});

function relativeImportUrls(body, sourceUrl) {
  const found = new Set();
  for (const pattern of [/\bfrom\s+["'](\.[^"']+)["']/g, /\bimport\s*["'](\.[^"']+)["']/g]) {
    for (const match of body.matchAll(pattern)) found.add(new URL(match[1], sourceUrl).href);
  }
  return [...found].map((href) => new URL(href));
}

function sourceName(url, scorerRootPath = null) {
  const path = fileURLToPath(url);
  const repoName = relative(REPO_ROOT_PATH, path);
  if (repoName && !repoName.startsWith("..")) return `repo:${repoName}`;
  if (scorerRootPath) return `scorer:${relative(scorerRootPath, path)}`;
  return `external:${sha256(path).slice(0, 16)}`;
}

async function sourceClosureHashes(rootUrls, { scorerRootPath = null } = {}) {
  const queue = [...new Map(rootUrls.map((url) => [url.href, url])).values()];
  const bodies = new Map();
  while (queue.length) {
    const url = queue.shift();
    if (bodies.has(url.href)) continue;
    const body = await readFile(url, "utf8");
    bodies.set(url.href, { url, body });
    for (const imported of relativeImportUrls(body, url)) {
      if (!bodies.has(imported.href)) queue.push(imported);
    }
  }
  return [...bodies.values()]
    .map(({ url, body }) => [sourceName(url, scorerRootPath), sha256(body)])
    .sort(([left], [right]) => left.localeCompare(right));
}

function providerRequestTemplates(arm, { model, effort, imageDetail }) {
  return [0, 1, 2].map((imageCount) => requestFingerprint(arm.buildRequest({
    imageUrls: Array.from({ length: imageCount }, (_, index) => `https://contract.invalid/image-${index + 1}`),
    model,
    effort,
    imageDetail
  })));
}

export async function buildFinisherFingerprint({ arms, scorer = null }) {
  const armRoots = arms.flatMap((arm) => ARM_SOURCE_ROOTS[arm.key] || []);
  const scorerUrl = scorer ? pathToFileURL(resolve(scorer)) : null;
  const sourceEntries = await sourceClosureHashes([
    SOURCE_URLS.csm_sem_score,
    ...armRoots,
    ...(scorerUrl ? [scorerUrl] : [])
  ], { scorerRootPath: scorerUrl ? dirname(fileURLToPath(scorerUrl)) : null });
  const contract = {
    schema_version: "thin-path-eval-finisher-contract-v1",
    derivation_contract: "thin-path-eval-derived-metrics-v1",
    arms: arms.map(({ key }) => key),
    source_sha256: Object.fromEntries(sourceEntries)
  };
  return { fingerprint: sha256(JSON.stringify(contract)), contract };
}

export async function buildRunManifest({
  arms, model, effort, imageDetail, limit, dataset, sealedLabels, assetIdsFile = null,
  scorer = null, concurrency = 1, requestTimeoutMs = 120_000, maxAttempts = 3,
  datasetBody = null, sealedLabelsBody = null, assetIdsBody = null,
  selectedAssetIds = null, selectionRole = "unspecified"
}) {
  const datasetBytes = datasetBody ?? await readFile(dataset);
  const labelBytes = sealedLabelsBody ?? await readFile(sealedLabels);
  // Best-effort: several tests drive this function with label bodies that are
  // not JSONL, and the k-fold arm is the only consumer. A corpus that fails to
  // parse must leave that arm without examples, never break a run that does not
  // use it.
  try {
    setReviewedCorpus(
      String(labelBytes).split("\n").filter(Boolean).map((line) => JSON.parse(line))
    );
  } catch {
    setReviewedCorpus([]);
  }
  const assetIdBytes = assetIdsBody ?? (assetIdsFile ? await readFile(assetIdsFile) : null);
  const finisher = await buildFinisherFingerprint({ arms, scorer });
  const armContracts = arms.map((arm) => ({
    key: arm.key,
    fixed_image_detail: arm.imageDetail || null,
    eval_version: arm.evalVersion || null,
    response_schema_name: arm.responseSchemaName || null,
    response_schema_sha256: arm.responseSchema ? sha256(JSON.stringify(arm.responseSchema)) : null,
    prompt_sha256: arm.prompt ? sha256(arm.prompt) : null,
    request_template_sha256: providerRequestTemplates(arm, { model, effort, imageDetail })
  }));
  const contract = {
    schema_version: "thin-path-eval-run-contract-v2",
    model,
    effort,
    image_detail: imageDetail,
    execution: {
      concurrency,
      request_timeout_ms: requestTimeoutMs,
      max_attempts: maxAttempts,
      retry_policy: RETRY_POLICY_VERSION
    },
    cohort: { selection_role: selectionRole },
    arms: armContracts,
    dataset_sha256: sha256(datasetBytes),
    asset_ids_sha256: assetIdBytes ? sha256(assetIdBytes) : null,
    sealed_labels_sha256: sha256(labelBytes),
    // This is intentionally a behavior fingerprint, not a file hash. It binds
    // every paid request shape while allowing zero-cost finisher/resolver replay.
    source_sha256: {
      provider_request_behavior: sha256(JSON.stringify(armContracts.map(({ request_template_sha256 }) => (
        request_template_sha256
      ))))
    }
  };
  return {
    schema_version: "thin-path-eval-run-manifest-v2",
    fingerprint: sha256(JSON.stringify(contract)),
    contract,
    finisher,
    max_requested_limit: limit,
    max_requested_asset_ids_sha256: Array.isArray(selectedAssetIds)
      ? sha256(JSON.stringify(selectedAssetIds))
      : null,
    created_at: new Date().toISOString()
  };
}

export function requestFingerprint(request) {
  let imageIndex = 0;
  const normalized = JSON.parse(JSON.stringify(request, (key, value) => {
    if (key === "image_url" && typeof value === "string") {
      imageIndex += 1;
      return `signed-image-${imageIndex}`;
    }
    return value;
  }));
  return sha256(JSON.stringify(normalized));
}

export async function writeFileAtomic(path, body) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, body, { flag: "wx", encoding: "utf8" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

const LOCK_NAME = ".thin-path-eval.lock";
const DEFAULT_UNKNOWN_LOCK_STALE_MS = 5 * 60 * 1000;

async function readLockOwner(lockPath) {
  try {
    return JSON.parse(await readFile(resolve(lockPath, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function localProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function lockCanBeReclaimed(lockPath, { unknownLockStaleMs, processAlive }) {
  const owner = await readLockOwner(lockPath);
  if (owner?.hostname === hostname() && Number.isInteger(owner?.pid) && owner.pid > 0) {
    return !processAlive(owner.pid);
  }
  const metadata = await stat(lockPath).catch(() => null);
  return Boolean(metadata && Math.max(0, Date.now() - metadata.mtimeMs) >= unknownLockStaleMs);
}

export async function acquireOutDirLock(outDir, {
  unknownLockStaleMs = DEFAULT_UNKNOWN_LOCK_STALE_MS,
  processAlive = localProcessAlive
} = {}) {
  const lockPath = resolve(outDir, LOCK_NAME);
  const token = randomUUID();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await mkdir(lockPath);
      const owner = {
        schema_version: "thin-path-eval-lock-v1",
        token,
        pid: process.pid,
        hostname: hostname(),
        created_at: new Date().toISOString()
      };
      try {
        await writeFile(resolve(lockPath, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, "utf8");
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return async () => {
        const current = await readLockOwner(lockPath);
        if (current?.token === token) await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!await lockCanBeReclaimed(lockPath, { unknownLockStaleMs, processAlive })) {
        const owner = await readLockOwner(lockPath);
        throw new Error(`evaluation_out_dir_locked:${owner?.pid || "unknown"}@${owner?.hostname || "unknown"}`);
      }
      const tombstone = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
      try {
        await rename(lockPath, tombstone);
      } catch (renameError) {
        if (renameError?.code === "ENOENT") continue;
        throw renameError;
      }
      await rm(tombstone, { recursive: true, force: true });
    }
  }
  throw new Error("evaluation_out_dir_lock_race");
}

function parseSealedLabels(raw) {
  const byKey = new Map();
  for (const [index, line] of String(raw).split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed);
    const key = row.key || row.sealed_eval_label_key || row.id;
    const title = row.reviewed_title || row.title;
    if (!key || !title) continue;
    const normalizedKey = String(key);
    if (byKey.has(normalizedKey)) throw new Error(`sealed_labels_duplicate_key:${normalizedKey}:line_${index + 1}`);
    byKey.set(normalizedKey, String(title));
  }
  return byKey;
}

async function loadEvaluationInputs({ dataset, sealedLabels, assetIdsFile, limit }) {
  const [datasetBody, sealedLabelsBody, assetIdsBody] = await Promise.all([
    readFile(dataset),
    readFile(sealedLabels),
    assetIdsFile ? readFile(assetIdsFile) : Promise.resolve(null)
  ]);
  const manifest = JSON.parse(datasetBody.toString("utf8"));
  if (!Array.isArray(manifest.items)) throw new Error("dataset_items_must_be_array");
  const datasetIds = manifest.items.map((item) => String(item?.asset_id || "").trim());
  if (datasetIds.some((id) => !id)) throw new Error("dataset_asset_id_missing");
  if (new Set(datasetIds).size !== datasetIds.length) throw new Error("dataset_duplicate_asset_ids");
  const labels = parseSealedLabels(sealedLabelsBody.toString("utf8"));

  let selectedItems = manifest.items;
  if (assetIdsBody) {
    const selectedIds = JSON.parse(assetIdsBody.toString("utf8"));
    if (!Array.isArray(selectedIds) || selectedIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new Error("asset_ids_file_must_be_json_string_array");
    }
    if (new Set(selectedIds).size !== selectedIds.length) throw new Error("asset_ids_file_contains_duplicates");
    const byId = new Map(manifest.items.map((item) => [item.asset_id, item]));
    const missing = selectedIds.filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`asset_ids_missing_from_dataset:${missing.slice(0, 3).join(",")}`);
    selectedItems = selectedIds.map((id) => byId.get(id));
  }
  const items = selectedItems.slice(0, limit);
  if (items.length !== limit) throw new Error(`selected_asset_count_mismatch:${items.length}/${limit}`);
  const missingLabels = items.filter((item) => !labels.has(String(item?.sealed_eval_label_ref?.key || "")));
  if (missingLabels.length) {
    throw new Error(`selected_assets_missing_sealed_labels:${missingLabels.slice(0, 3).map(({ asset_id }) => asset_id).join(",")}`);
  }
  return { datasetBody, sealedLabelsBody, assetIdsBody, labels, items };
}

export function imageSetFingerprint(item, images = null) {
  const sourceImages = images || item?.images || [];
  const imageLimit = images ? 3 : 2;
  return sha256(JSON.stringify(sourceImages.slice(0, imageLimit).map((image) => ({
    bucket: image?.bucket || null,
    object_path: image?.object_path || image?.objectPath || null,
    role: image?.role || null,
    ...(image?.local_path || image?.localPath ? {
      local_path: image.local_path || image.localPath,
      content_sha256: image?.content_sha256 || null
    } : {})
  }))));
}

function expectedCheckpointIdentity({ item, arm, model, effort, imageDetail }) {
  const armEffort = arm.effort ?? effort;
  const sourceImages = [
    ...(item?.images || []).slice(0, 2),
    ...(arm.requiresExtraImages ? (item?.visual_extra_images || []).slice(0, 1) : [])
  ];
  const isSignable = (image) => (
    (String(image?.bucket || "").trim()
      && String(image?.object_path || image?.objectPath || "").trim())
    || String(image?.local_path || image?.localPath || "").trim()
  );
  const primarySignable = (item?.images || []).slice(0, 2).filter(isSignable);
  const extraSignable = arm.requiresExtraImages
    ? (item?.visual_extra_images || []).slice(0, 1).filter(isSignable)
    : [];
  const imageUrls = primarySignable.map((_, index) => `https://checkpoint.invalid/image-${index + 1}`);
  const extraImageUrls = extraSignable.map((_, index) => `https://checkpoint.invalid/extra-image-${index + 1}`);
  const request = arm.buildRequest({ imageUrls, extraImageUrls, model, effort: armEffort, imageDetail, cardKey: item?.key });
  return {
    request_sha256: requestFingerprint(request),
    image_set_sha256: imageSetFingerprint(item, sourceImages),
    image_count: imageUrls.length + extraImageUrls.length,
    image_detail: arm.imageDetail || imageDetail,
    arm_eval_version: arm.evalVersion || null
  };
}

export function validateCheckpointRows(checkpointBody, {
  arms, items, labels, runFingerprint, finisherFingerprint, model, effort, imageDetail
}) {
  const armByKey = new Map(arms.map((arm) => [arm.key, arm]));
  const itemById = new Map(items.map((item) => [item.asset_id, item]));
  const done = new Map();
  for (const [index, line] of String(checkpointBody || "").split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      throw new Error(`checkpoint_invalid_json:line_${index + 1}`);
    }
    if (row.run_fingerprint !== runFingerprint) throw new Error(`checkpoint_row_fingerprint_mismatch:line_${index + 1}`);
    if (row.finisher_fingerprint !== finisherFingerprint) {
      throw new Error(`checkpoint_finisher_replay_required:line_${index + 1}`);
    }
    const arm = armByKey.get(row.arm);
    if (!arm) throw new Error(`checkpoint_row_unexpected_arm:${row.arm || "missing"}:line_${index + 1}`);
    const item = itemById.get(row.asset_id);
    if (!item) throw new Error(`checkpoint_row_outside_selected_cohort:${row.asset_id || "missing"}:line_${index + 1}`);
    const key = `${row.asset_id}::${row.arm}`;
    if (done.has(key)) throw new Error(`checkpoint_duplicate_key:${key}`);
    const reference = labels.get(String(item?.sealed_eval_label_ref?.key || ""));
    if (row.reference !== reference) throw new Error(`checkpoint_reference_mismatch:${row.asset_id}`);
    const expected = expectedCheckpointIdentity({ item, arm, model, effort, imageDetail });
    for (const field of ["request_sha256", "image_set_sha256", "image_count", "image_detail", "arm_eval_version"]) {
      if ((row[field] ?? null) !== (expected[field] ?? null)) throw new Error(`checkpoint_request_shape_mismatch:${field}:${key}`);
    }
    const armEffort = arm.effort ?? effort;
    if (row.model !== model || row.requested_effort !== armEffort || row.served_effort !== armEffort) {
      throw new Error(`checkpoint_request_contract_mismatch:${key}`);
    }
    done.set(key, row);
  }
  return done;
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 429]);
const RETRY_POLICY_VERSION = "bounded-retry-after-jitter-v1";

function retryAfterMs(response) {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function retryableBodyError(body) {
  const marker = `${body?.error?.type || ""} ${body?.error?.code || ""} ${body?.error?.message || ""}`.toLowerCase();
  return /rate.?limit|server|overload|temporar|timeout|unavailable/.test(marker);
}

export function providerRetryDelayMs({ attempt, response = null, random = Math.random }) {
  const backoff = Math.min(30_000, 500 * (2 ** Math.max(0, attempt - 1)));
  const floor = Math.max(backoff, retryAfterMs(response));
  return Math.min(30_000, Math.ceil(floor * (1 + Math.max(0, Math.min(1, random())) * 0.25)));
}

export async function callProviderWithRetry({
  request,
  maxAttempts,
  callProvider,
  recordAttempt = async () => {},
  sleepImpl = sleep,
  random = Math.random
}) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = new Date().toISOString();
    let response = null;
    let body = null;
    let thrown = null;
    try {
      response = await callProvider(request);
      body = await response.json();
    } catch (error) {
      thrown = error;
    }
    const status = Number(response?.status || 0) || null;
    const successful = !thrown && response?.ok && !body?.error;
    const retryableStatus = RETRYABLE_HTTP_STATUSES.has(status) || Number(status) >= 500;
    const failFast4xx = status >= 400 && status < 500 && !RETRYABLE_HTTP_STATUSES.has(status);
    const retryable = !successful && !failFast4xx
      && (Boolean(thrown) || retryableStatus || retryableBodyError(body));
    const willRetry = retryable && attempt < maxAttempts;
    const delayMs = willRetry ? providerRetryDelayMs({ attempt, response, random }) : 0;
    const entry = {
      schema_version: "thin-path-provider-attempt-v1",
      attempt,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      http_status: status,
      outcome: successful ? "provider_success" : thrown ? "transport_error" : "provider_error",
      retryable,
      will_retry: willRetry,
      final: !successful && !willRetry,
      retry_delay_ms: delayMs,
      error_code: body?.error?.code || body?.error?.type || thrown?.name || null,
      error_message: String(body?.error?.message || thrown?.message || "").slice(0, 240) || null
    };
    attempts.push(entry);
    await recordAttempt(entry);
    if (successful) return { ok: true, response, body, attemptCount: attempt, attempts };
    if (!willRetry) return { ok: false, response, body, error: thrown, attemptCount: attempt, attempts };
    await sleepImpl(delayMs);
  }
  throw new Error("provider_retry_loop_unreachable");
}

export async function signImageUrls(images = [], { supabaseUrl, serviceKey, expiresIn = 3600, fetchImpl = fetch }) {
  const urls = [];
  for (const image of images.slice(0, 2)) {
    const bucket = String(image?.bucket || "").trim();
    const objectPath = String(image?.object_path || image?.objectPath || "").trim();
    const localPath = String(image?.local_path || image?.localPath || "").trim();
    if (!bucket || !objectPath) {
      if (!localPath) continue;
      const bytes = await readFile(localPath);
      const contentType = String(image?.content_type || image?.contentType || "image/jpeg").trim();
      urls.push(`data:${contentType};base64,${bytes.toString("base64")}`);
      continue;
    }
    const response = await fetchImpl(`${supabaseUrl}/storage/v1/object/sign/${bucket}/${objectPath}`, {
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

async function mapConcurrent(items, concurrency, worker) {
  const source = Array.from(items || []);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), source.length || 1) }, async () => {
    while (cursor < source.length) {
      const index = cursor++;
      await worker(source[index], index);
    }
  }));
}

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

export async function main(argv = process.argv.slice(2), {
  fetchImpl = fetch,
  sleepImpl = sleep,
  random = Math.random
} = {}) {
  const evalRoot = argValue(argv, "--eval-root", "/Users/paidaxin/lynca-eval-root");
  const scorerPath = resolve(evalRoot, "scripts/evaluate-cloud-listing-api.mjs");
  const { policyFairTokenRecall } = await import(scorerPath);

  const armKeys = argValue(argv, "--arms", "thin_budgeted,thin_canonical")
    .split(",").map((key) => key.trim()).filter(Boolean);
  if (new Set(armKeys).size !== armKeys.length) throw new Error("duplicate_arms_not_allowed");
  const ARMS = armKeys
    .map((key) => {
      if (!ARM_SPECS[key]) throw new Error(`unknown arm: ${key} (have ${Object.keys(ARM_SPECS).join(", ")})`);
      return { key, ...ARM_SPECS[key] };
    });
  if (ARMS.length < 1 || ARMS.length > 2) {
    throw new Error("one or two arms required; two-arm comparisons remain paired");
  }

  const model = argValue(argv, "--model", "gpt-5.6-luna");
  const effort = argValue(argv, "--effort", "none");
  const imageDetail = argValue(argv, "--image-detail", "high");
  if (!["high", "original"].includes(imageDetail)) throw new Error("image_detail_must_be_high_or_original");
  // 150 is the verdict size, from a bootstrap over the 255-card paired run:
  // 93% power on a 3pp effect, against 45% at n=50. Below that, 50 is a screen
  // and not a verdict.
  const limit = positiveIntegerArg(argv, "--limit", 150);
  const dataset = resolve(evalRoot, argValue(argv, "--dataset", "data/eval/reviewed-title-blind/reviewed-title-image-only.json"));
  const sealedLabels = resolve(evalRoot, argValue(argv, "--sealed-labels", "data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl"));
  const assetIdsArg = argValue(argv, "--asset-ids-file", "").trim();
  const assetIdsFile = assetIdsArg ? resolve(assetIdsArg) : null;
  const selectionRole = argValue(argv, "--selection-role", "unspecified").trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(selectionRole)) throw new Error("selection_role_must_be_lower_snake_case");
  const outDir = resolve(argValue(argv, "--out-dir", "artifacts/thin-path-eval"));
  const requestTimeoutMs = positiveIntegerArg(argv, "--request-timeout-ms", 120_000, 10_000);
  const maxAttempts = positiveIntegerArg(argv, "--max-attempts", 3);
  const concurrency = positiveIntegerArg(argv, "--concurrency", DEFAULT_THIN_PATH_EVAL_CONCURRENCY);

  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  const apiKey = String(process.env.OPENAI_API_KEY || "");
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and a service key are required");
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");

  await mkdir(outDir, { recursive: true });
  const releaseLock = await acquireOutDirLock(outDir);
  try {
  const checkpointPath = resolve(outDir, `thin-path-${model}.jsonl`);
  const manifestPath = resolve(outDir, `thin-path-${model}.manifest.json`);
  const inputs = await loadEvaluationInputs({ dataset, sealedLabels, assetIdsFile, limit });
  const { labels, items } = inputs;
  const expectedManifest = await buildRunManifest({
    arms: ARMS,
    model,
    effort,
    imageDetail,
    limit,
    dataset,
    sealedLabels,
    assetIdsFile,
    scorer: scorerPath,
    concurrency,
    requestTimeoutMs,
    maxAttempts,
    datasetBody: inputs.datasetBody,
    sealedLabelsBody: inputs.sealedLabelsBody,
    assetIdsBody: inputs.assetIdsBody,
    selectedAssetIds: items.map(({ asset_id }) => asset_id),
    selectionRole
  });
  let storedManifest = null;
  if (existsSync(manifestPath)) {
    storedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (storedManifest.fingerprint !== expectedManifest.fingerprint) {
      throw new Error("checkpoint_manifest_mismatch: use a fresh --out-dir");
    }
    const storedLimit = Number(storedManifest.max_requested_limit || 0);
    if (!Number.isInteger(storedLimit) || storedLimit < 1 || storedLimit > items.length) {
      throw new Error("checkpoint_manifest_invalid_max_requested_limit");
    }
    if (limit < storedLimit) {
      throw new Error("checkpoint_limit_cannot_shrink: use a fresh --out-dir");
    }
    const storedCohortHash = sha256(JSON.stringify(items.slice(0, storedLimit).map(({ asset_id }) => asset_id)));
    if (storedManifest.max_requested_asset_ids_sha256 !== storedCohortHash) {
      throw new Error("checkpoint_manifest_selected_cohort_mismatch");
    }
    expectedManifest.created_at = storedManifest.created_at || expectedManifest.created_at;
    expectedManifest.max_requested_limit = Math.max(limit, storedLimit);
  } else if (existsSync(checkpointPath)) {
    throw new Error("checkpoint_manifest_missing: legacy checkpoints cannot be resumed safely; use a fresh --out-dir");
  }
  let done = new Map();
  const checkpointBody = existsSync(checkpointPath) ? await readFile(checkpointPath) : null;
  if (storedManifest?.checkpoint_sha256) {
    if (!checkpointBody || sha256(checkpointBody) !== storedManifest.checkpoint_sha256) {
      throw new Error("checkpoint_sha256_mismatch");
    }
    const storedRows = checkpointBody.toString("utf8").split("\n").filter((line) => line.trim()).length;
    if (storedRows !== Number(storedManifest.checkpoint_rows)) throw new Error("checkpoint_row_count_mismatch");
  } else if (storedManifest?.completed_at) {
    throw new Error("completed_manifest_missing_checkpoint_sha256");
  }
  if (checkpointBody) {
    done = validateCheckpointRows(checkpointBody.toString("utf8"), {
      arms: ARMS,
      items,
      labels,
      runFingerprint: expectedManifest.fingerprint,
      finisherFingerprint: expectedManifest.finisher.fingerprint,
      model,
      effort,
      imageDetail
    });
    if (storedManifest?.finisher?.fingerprint !== expectedManifest.finisher.fingerprint) {
      throw new Error("checkpoint_finisher_replay_required: provider rows remain reusable; replay derived fields before resume");
    }
    process.stderr.write(`resuming: ${done.size} card-arms already on disk\n`);
  }
  // All parameters, cohort rows and any existing checkpoint are valid now.
  // Only at this point may an expanded limit become durable.
  await writeFileAtomic(manifestPath, `${JSON.stringify(expectedManifest, null, 2)}\n`);

  const callProvider = (request) => fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(request)
  });

  const attemptLogPath = resolve(outDir, `thin-path-${model}.attempts.jsonl`);
  let durableWrite = Promise.resolve();
  const appendDurable = async (path, value) => {
    durableWrite = durableWrite.then(() => writeFile(
      path, `${JSON.stringify(value)}\n`, { flag: "a", encoding: "utf8" }
    ));
    await durableWrite;
  };
  await mapConcurrent(items, concurrency, async (item, index) => {
    const reference = labels.get(String(item?.sealed_eval_label_ref?.key || ""));
    if (!reference) { process.stderr.write(`  ${index + 1}/${items.length}: no sealed label, skipped\n`); return; }

    // Rotate which arm goes first: whatever drifts within a card -- signed-URL
    // warmth, provider load -- otherwise lands on the same arm every time.
    const order = index % 2 === 0 ? ARMS : [...ARMS].reverse();

    let imageUrls = null;
    let extraImageUrls = null;
    for (const arm of order) {
      const key = `${item.asset_id}::${arm.key}`;
      if (done.has(key)) continue;
      if (!imageUrls) imageUrls = await signImageUrls(item.images, { supabaseUrl, serviceKey, fetchImpl });
      if (arm.requiresExtraImages && !extraImageUrls) {
        extraImageUrls = await signImageUrls(item.visual_extra_images || [], { supabaseUrl, serviceKey, fetchImpl });
      }

      const requestExtraImageUrls = arm.requiresExtraImages ? (extraImageUrls || []) : [];
      // The arm's pinned tier wins over the run-level default, so two efforts
      // can alternate on the same card within one run.
      const armEffort = arm.effort ?? effort;
      const request = arm.buildRequest({ imageUrls, extraImageUrls: requestExtraImageUrls, model, effort: armEffort, imageDetail, cardKey: key });
      const requestSha256 = requestFingerprint(request);
      const requestImageEntries = [
        ...(item.images || []).slice(0, 2),
        ...(arm.requiresExtraImages ? (item.visual_extra_images || []).slice(0, 1) : [])
      ];
      const imageSetSha256 = imageSetFingerprint(item, requestImageEntries);
      const startedAt = Date.now();
      const startedAtIso = new Date(startedAt).toISOString();
      const providerResult = await callProviderWithRetry({
        request,
        maxAttempts,
        callProvider,
        sleepImpl,
        random,
        recordAttempt: (attempt) => appendDurable(attemptLogPath, {
          ...attempt,
          event: "provider_attempt",
          run_fingerprint: expectedManifest.fingerprint,
          asset_id: item.asset_id,
          arm: arm.key,
          request_sha256: requestSha256
        })
      });
      if (!providerResult.ok) {
        process.stderr.write(`  ${index + 1}/${items.length} ${arm.key}: FAILED ${providerResult.error?.message || providerResult.body?.error?.message || providerResult.response?.status}\n`);
        continue;
      }
      const { body, attemptCount } = providerResult;
      // Read back rather than assumed. One paired evaluation ran both arms on
      // the same configuration and still reported clean-looking numbers.
      const servedEffort = body?.reasoning?.effort ?? armEffort;
      if (servedEffort !== armEffort) {
        await appendDurable(attemptLogPath, {
          schema_version: "thin-path-provider-final-v1",
          event: "final_status",
          status: "discarded_served_effort",
          run_fingerprint: expectedManifest.fingerprint,
          asset_id: item.asset_id,
          arm: arm.key,
          request_sha256: requestSha256,
          completed_at: new Date().toISOString()
        });
        process.stderr.write(`  ${index + 1}/${items.length} ${arm.key}: DISCARDED, provider ran ${servedEffort}\n`);
        continue;
      }

      let payload;
      let finished;
      let quality;
      try {
        payload = arm.extract(body);
        finished = arm.finish(payload);
        quality = scoreF1(reference, finished.title);
      } catch (error) {
        await appendDurable(attemptLogPath, {
          schema_version: "thin-path-provider-final-v1",
          event: "final_status",
          status: "derivation_failed",
          error: String(error?.message || error).slice(0, 240),
          run_fingerprint: expectedManifest.fingerprint,
          asset_id: item.asset_id,
          arm: arm.key,
          request_sha256: requestSha256,
          completed_at: new Date().toISOString()
        });
        throw error;
      }
      const row = {
        asset_id: item.asset_id,
        arm: arm.key,
        image_detail: arm.imageDetail || imageDetail,
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
        input_tokens: body?.usage?.input_tokens ?? null,
        output_tokens: body?.usage?.output_tokens ?? null,
        total_tokens: body?.usage?.total_tokens ?? null,
        cached_input_tokens: body?.usage?.input_tokens_details?.cached_tokens ?? null,
        model,
        served_model: body?.model ?? null,
        requested_effort: armEffort,
        served_effort: servedEffort,
        request_sha256: requestSha256,
        image_set_sha256: imageSetSha256,
        image_count: imageUrls.length + requestExtraImageUrls.length,
        request_attempt_count: attemptCount,
        provider_attempts: providerResult.attempts,
        run_fingerprint: expectedManifest.fingerprint,
        finisher_fingerprint: expectedManifest.finisher.fingerprint,
        arm_eval_version: arm.evalVersion || null,
        started_at: startedAtIso,
        completed_at: new Date().toISOString(),
        // Canonical arms only; the field report keys off this.
        fields: finished.fields ?? null,
        canonical_control_title: finished.canonical_control_title ?? null,
        canonical_control_length: finished.canonical_control_length ?? null,
        field_defects: finished.field_defects ?? null,
        grammar: finished.grammar ?? null,
        brackets: finished.brackets ?? null,
        dropped_brackets: finished.dropped_brackets ?? null,
        suppressed_brackets: finished.suppressed_brackets ?? null,
        empty_fields: finished.empty_fields ?? null,
        unreadable_fields: finished.unreadable_fields ?? null,
        low_confidence_fields: finished.low_confidence_fields ?? null,
        observations: finished.observations ?? null,
        unreadable_regions: finished.unreadable_regions ?? null,
        observation_defects: finished.observation_defects ?? null,
        candidate_schema_version: finished.candidate_schema_version ?? null,
        candidate_facts: finished.candidate_facts ?? null,
        candidate_hypotheses: finished.candidate_hypotheses ?? null,
        candidate_defects: finished.candidate_defects ?? null,
        free_title: finished.free_title ?? null,
        eval_version: finished.eval_version ?? null,
        open_evidence: finished.open_evidence ?? null,
        evidence_schema_version: finished.evidence_schema_version ?? null,
        evidence_spans: finished.evidence_spans ?? null,
        evidence_candidates: finished.evidence_candidates ?? null,
        evidence_noise_dropped: finished.evidence_noise_dropped ?? null,
        evidence_promotions: finished.evidence_promotions ?? null,
        evidence_defects: finished.evidence_defects ?? null,
        evidence_resolution: finished.evidence_resolution ?? null,
        evidence_resolver_version: finished.evidence_resolver_version ?? null,
        residual_schema_version: finished.residual_schema_version ?? null,
        residual_source_present: finished.residual_source_present ?? null,
        residual_candidates: finished.residual_candidates ?? null,
        residual_replay_candidates: finished.residual_replay_candidates ?? null,
        residual_dropped: finished.residual_dropped ?? null,
        residual_defects: finished.residual_defects ?? null,
        residual_canonical_fields_unchanged: finished.residual_canonical_fields_unchanged ?? null,
        observation_schema_version: finished.observation_schema_version ?? null,
        observation_source_present: finished.observation_source_present ?? null,
        observation_candidates: finished.observation_candidates ?? null,
        observation_dropped: finished.observation_dropped ?? null,
        observation_defects: finished.observation_defects ?? null,
        observation_canonical_fields_unchanged: finished.observation_canonical_fields_unchanged ?? null,
        observation_automatic_csm_admission: finished.observation_automatic_csm_admission ?? null,
        observation_automatic_renderer_admission: finished.observation_automatic_renderer_admission ?? null,
        observation_persistence_authority: finished.observation_persistence_authority ?? null,
        production_promoted: finished.production_promoted ?? null
      };

      await appendDurable(checkpointPath, row);
      done.set(key, row);
      await appendDurable(attemptLogPath, {
        schema_version: "thin-path-provider-final-v1",
        event: "final_status",
        status: "checkpoint_committed",
        run_fingerprint: expectedManifest.fingerprint,
        finisher_fingerprint: expectedManifest.finisher.fingerprint,
        asset_id: item.asset_id,
        arm: arm.key,
        request_sha256: requestSha256,
        completed_at: new Date().toISOString()
      });
      process.stderr.write(`  ${index + 1}/${items.length} ${arm.key}: F1 ${row.f1.toFixed(3)} (${row.length}c)\n`);
    }
  });

  const byArm = new Map(ARMS.map((arm) => [arm.key, new Map()]));
  for (const row of done.values()) byArm.get(row.arm)?.set(row.asset_id, row);

  let [control, treatment] = ARMS;
  let paired;
  if (ARMS.length === 2) {
    paired = [...byArm.get(control.key).keys()]
      .filter((assetId) => byArm.get(treatment.key).has(assetId))
      .map((assetId) => ({ control: byArm.get(control.key).get(assetId), treatment: byArm.get(treatment.key).get(assetId) }));
  } else if (control.evalVersion === BOUNDED_EVIDENCE_V2_VERSION) {
    treatment = control;
    control = { key: "same_response_canonical_control" };
    paired = [...byArm.get(treatment.key).values()].map((row) => ({
      control: {
        ...row,
        title: row.canonical_control_title,
        length: row.canonical_control_length,
        ...scoreF1(row.reference, row.canonical_control_title)
      },
      treatment: row
    }));
  } else {
    treatment = control;
    control = { key: "external_control_not_run" };
    paired = [];
  }

  const deltas = paired.map(({ control: a, treatment: b }) => b.f1 - a.f1);
  const test = signTest(deltas);
  const effectiveImageDetails = [...new Set(ARMS.map((arm) => arm.imageDetail || imageDetail))];

  const summary = {
    schema_version: "thin-path-eval-v2",
    run_fingerprint: expectedManifest.fingerprint,
    finisher_fingerprint: expectedManifest.finisher.fingerprint,
    selection_role: selectionRole,
    comparison_mode: ARMS.length === 2
      ? "paired_live_arms"
      : ARMS[0].evalVersion === BOUNDED_EVIDENCE_V2_VERSION
        ? "same_response_canonical_vs_evidence_candidate"
        : "single_live_arm",
    model,
    effort,
    image_detail: effectiveImageDetails.length === 1 ? effectiveImageDetails[0] : "mixed",
    cards_paired: paired.length,
    arms: ARMS.map((arm) => {
      const rows = [...byArm.get(arm.key).values()];
      const canonical = rows.filter((row) => row.fields);
      // CSM's own ruler, run alongside ours. It was written for the writer
      // feedback loop, so it has no stake in which arm wins -- the property
      // every metric built for this comparison lacked.
      const sem = summariseSemQuality(rows);
      return {
        arm: arm.key,
        image_detail: arm.imageDetail || imageDetail,
        n: rows.length,
        f1: rows.length ? average(rows.map((row) => row.f1)) : null,
        recall: rows.length ? average(rows.map((row) => row.recall)) : null,
        precision: rows.length ? average(rows.map((row) => row.precision)) : null,
        token_recall: rows.length ? average(rows.map((row) => row.score)) : null,
        median_length: rows.length ? median(rows.map((row) => row.length)) : null,
        median_latency_ms: rows.length ? median(rows.map((row) => row.latency_ms)) : null,
        median_input_tokens: rows.length ? median(rows.map((row) => row.input_tokens ?? 0)) : null,
        median_output_tokens: rows.length ? median(rows.map((row) => row.output_tokens ?? 0)) : null,
        input_tokens_total: rows.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0),
        output_tokens_total: rows.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0),
        total_tokens: rows.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0),
        // The questions this run exists to answer, each written down before it.
        print_finish_stated: canonical.filter((row) => row.fields.print_finish).length,
        card_name_stated: canonical.filter((row) => row.fields.card_name).length,
        release_variant_stated: canonical.filter((row) => row.fields.release_variant).length,
        descriptive_rarity_stated: canonical.filter((row) => row.fields.descriptive_rarity).length,
        low_confidence_used: canonical.filter((row) => (row.low_confidence_fields || []).length).length,
        unreadable_used: canonical.filter((row) => (row.unreadable_fields || []).length).length,
        canonical_n: canonical.length,
        sem_confidence: sem.sem_confidence,
        sem_field_count: sem.mean_field_count,
        sem_structurally_valid: sem.structurally_valid
      };
    }),
    same_response_canonical_control: ARMS.length === 1
      && ARMS[0].evalVersion === BOUNDED_EVIDENCE_V2_VERSION
      ? {
          n: paired.length,
          f1: paired.length ? average(paired.map(({ control: row }) => row.f1)) : null,
          recall: paired.length ? average(paired.map(({ control: row }) => row.recall)) : null,
          precision: paired.length ? average(paired.map(({ control: row }) => row.precision)) : null,
          median_length: paired.length ? median(paired.map(({ control: row }) => row.length)) : null
        }
      : null,
    paired_delta_f1: deltas.length ? average(deltas) : null,
    sign_test: test
  };

  await writeFileAtomic(resolve(outDir, `thin-path-${model}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  const completedCheckpointBody = existsSync(checkpointPath) ? await readFile(checkpointPath) : Buffer.alloc(0);
  const completedCheckpointRows = completedCheckpointBody.toString("utf8")
    .split("\n").filter((line) => line.trim()).length;
  await writeFileAtomic(manifestPath, `${JSON.stringify({
    ...expectedManifest,
    completed_at: new Date().toISOString(),
    checkpoint_rows: completedCheckpointRows,
    checkpoint_sha256: sha256(completedCheckpointBody),
    checkpoint_bytes: completedCheckpointBody.length,
    paired_cards: paired.length
  }, null, 2)}\n`);

  process.stdout.write(`\narm              n      F1  recall  precis  tok_rec  SEM_conf  len  latency  in_tok  out_tok\n`);
  for (const arm of summary.arms) {
    process.stdout.write(
      `${arm.arm.padEnd(15)} ${String(arm.n).padStart(3)}  ${(arm.f1 ?? NaN).toFixed(4)}  `
      + `${(arm.recall ?? NaN).toFixed(4)}  ${(arm.precision ?? NaN).toFixed(4)}   ${(arm.token_recall ?? NaN).toFixed(4)}    `
      + `${(arm.sem_confidence ?? NaN).toFixed(4)}  `
      + `${String(arm.median_length).padStart(3)}  ${String(Math.round(arm.median_latency_ms ?? NaN)).padStart(7)}  `
      + `${String(arm.median_input_tokens).padStart(6)}  ${String(arm.median_output_tokens).padStart(7)}\n`
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
  // The review runs HERE, at the end of the run that produced the data, not
  // when someone remembers to run it. Every failure this framework is built
  // from was a review that did not happen: a field-level decomposition the
  // founder had to ask for, a trade ledger nobody computed, a keepable part
  // found only on request.
  //
  // It spends nothing -- it rescores what is already on disk -- so there is no
  // reason for it to be optional, and it is deliberately not behind a flag.
  // A failure here must never lose the run: the artifact is already written.
  try {
    const { runAutoReview } = await import("./auto-review-run.mjs");
    process.stdout.write(await runAutoReview({
      outDir, model, control: control.key, treatment: treatment.key
    }));
  } catch (error) {
    process.stdout.write(`\n⚠ 自动复盘未能生成：${error?.message || error}\n`
      + `  产物已落盘，可手动跑：node scripts/review-exploration.mjs --artifact ${outDir}/thin-path-${model}.jsonl `
      + `--control ${control.key} --treatment ${treatment.key}\n`);
  }

  return summary;
  } finally {
    await releaseLock();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`thin path eval failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
