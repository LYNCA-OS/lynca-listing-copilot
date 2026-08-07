#!/usr/bin/env node
// Does COS-56's Product > Set > Card Name boundary stop the model disagreeing
// with itself?
//
// The loss COS-56 names is not perception. On 14 real cards run through
// identical input twice, only 4 agreed on every field, and `set` + `card_name`
// carried 12 of the 21 disagreements -- one string moving between two fields
// that had no boundary between them. That is a definition defect, and it is
// wrong on a share of runs by construction.
//
// HOW THIS IS MEASURED, and why not the obvious way:
//
// The obvious way is to re-run the control today and compare against the
// 2026-08-07 number. That is a cross-time comparison, and this project has been
// bitten by one: two arms measured at different times differed by 5.4x the
// noise of two arms measured alternating, which turned a real +0.0231 into
// NOT_PROVEN. So both definitions run HERE, on the same cards, in the same
// minutes, alternating which goes first.
//
// Each card gets FOUR calls: the pre-COS-56 definition twice, and the shipped
// COS-56 definition twice. Each arm is then scored against ITSELF -- the two
// runs of one definition on identical input -- which is exactly the quantity
// COS-56 is about: self-consistency, not accuracy against a label.
//
// PREDICTION, written before the run (2026-08-08), from the stored 2026-08-07
// payloads. Of the 12 set/card_name disagreements:
//   * 8 are decided outright by the rule -- cards 2, 4, 6, 10, 11, where one arm
//     put the whole insert phrase in `card_name` and the other in `set`
//   * 2 are only partly touched -- card 3 read two DIFFERENT set names
//     ("Duals" vs "Timeless Moments"), which the boundary does not settle
//   * 1 is a plural form ("Draft Pick Number" vs "Draft Pick Numbers") that the
//     boundary moves into `set` but does not stop
//   * 1 (card 13) is a genuine misreading and should not move
// So the rule should land near 13 total disagreements, not 0, and cards 5 and 8
// -- which agree today with the insert phrase in `card_name` -- are the ones to
// watch for the rule making an agreeing card disagree.
//
//   OPENAI_API_KEY=... NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 \
//     node scripts/measure-set-card-name-boundary.mjs \
//       --dir /private/tmp/bigcards --cards 14 --per-card 1
import { readdir, readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";
import {
  buildCanonicalFieldsRequest,
  parseCanonicalFields,
  CANONICAL_FIELDS_SCHEMA,
  CANONICAL_FIELDS_PROMPT
} from "../lib/listing/thin/canonical-fields.mjs";
import { disagreeingFields, COMPARED_FIELDS } from "./measure-downscaled-image-parity.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};

// ─── The pre-COS-56 definition, frozen ──────────────────────────────────────
// Verbatim from `canonical-fields.mjs` at 0a7fb58b. Frozen here rather than
// read from git so the baseline arm cannot drift when the file changes again.
const BASELINE_DESCRIPTIONS = Object.freeze({
  product: "Product line as printed: Prizm, Donruss Optic, Chrome, Obsidian. Give the fullest printed product phrase once; do not repeat the manufacturer here.",
  set: "Set or insert line named separately from the product: \"Sapphire Selections\", \"Downtown\". Empty if the product name is the whole of it.",
  card_name: "The printed card-title segment: \"Rated Rookie\", \"Next Stop Signatures\", \"Passing the Torch\", \"Illustrator\". NOT the player name and NOT the parallel."
});
const BASELINE_PROMPT_SENTENCE = "`card_name` is the printed card-title segment (Rated Rookie, Next Stop Signatures) and `release_variant` is a layout difference only (Horizontal, Variation). Most cards have neither.";
const SHIPPED_PROMPT_SENTENCE = "Read `product`, `set` and `card_name` in that order: the product line, then the named insert or subset within it, then -- only if something is left -- what names THIS card apart from the others in that same set. When the product and the set already account for the whole printed phrase, `card_name` is empty; most cards have no card name at all. `release_variant` is a layout difference only (Horizontal, Variation).";

/** An arm that is silently identical to the other measures nothing. This file's
 *  own history is the reason it is asserted: an evaluation arm once supplied a
 *  schema that `buildCanonicalFieldsRequest` discarded, and the run recorded the
 *  arm in its manifest while sending the shipped schema. Zero of 50 cards came
 *  back with the new field, which is what exposed it. */
export function buildBaselineArm() {
  const schema = JSON.parse(JSON.stringify(CANONICAL_FIELDS_SCHEMA));
  for (const [field, description] of Object.entries(BASELINE_DESCRIPTIONS)) {
    if (schema.properties[field].description === description) {
      throw new Error(`baseline_identical_to_shipped:${field} -- nothing to measure`);
    }
    schema.properties[field].description = description;
  }
  if (!CANONICAL_FIELDS_PROMPT.includes(SHIPPED_PROMPT_SENTENCE)) {
    throw new Error("shipped_prompt_sentence_not_found -- the frozen text is stale");
  }
  const prompt = CANONICAL_FIELDS_PROMPT.replace(SHIPPED_PROMPT_SENTENCE, BASELINE_PROMPT_SENTENCE);
  if (prompt === CANONICAL_FIELDS_PROMPT) throw new Error("baseline_prompt_unchanged");
  return { schema, prompt };
}

const mime = (path) => ({
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"
}[extname(path).toLowerCase()] || "image/jpeg");
const dataUrl = async (path) =>
  `data:${mime(path)};base64,${(await readFile(path)).toString("base64")}`;

async function askProvider({ imageUrls, schema, prompt, apiKey }) {
  const body = buildCanonicalFieldsRequest({
    imageUrls,
    model: CSM_THIN_RUNTIME_CONTRACT.model,
    effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    imageDetail: "high",
    schema,
    prompt
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

const choose = (a, b) => { let r = 1; for (let i = 0; i < b; i += 1) r = (r * (a - i)) / (i + 1); return r; };

/** Exact two-sided sign test. 14 cards is small enough that a normal
 *  approximation is the wrong tool, and the binomial is three lines. */
export function signTest(wins, losses) {
  const n = wins + losses;
  if (!n) return { n: 0, p: 1 };
  let tail = 0;
  for (let k = 0; k <= Math.min(wins, losses); k += 1) tail += choose(n, k);
  return { n, p: Math.min(1, 2 * tail / 2 ** n) };
}

/** Field-level McNemar, exact. The card-level sign test throws away most of
 *  what was measured: a card where one arm disagreed on three fields and the
 *  other on one counts as a single win. Here each card-field slot is one paired
 *  observation and only the DISCORDANT slots carry information -- which is the
 *  right question ("does this definition change which fields oscillate?"), and
 *  it is the more powerful test on a cohort this small.
 *
 *  The slots within a card are not independent, so this is a screen, not a
 *  certificate. Say so wherever the number is quoted. */
export function mcnemarExact(rows, fields) {
  let baselineOnly = 0;
  let treatmentOnly = 0;
  let bothDisagree = 0;
  let bothAgree = 0;
  for (const row of rows) {
    for (const field of fields) {
      const b = row.baseline.disagreements.includes(field);
      const c = row.cos56.disagreements.includes(field);
      if (b && !c) baselineOnly += 1;
      else if (!b && c) treatmentOnly += 1;
      else if (b && c) bothDisagree += 1;
      else bothAgree += 1;
    }
  }
  const { p } = signTest(baselineOnly, treatmentOnly);
  return { slots: bothAgree + bothDisagree + baselineOnly + treatmentOnly,
    baseline_only: baselineOnly, treatment_only: treatmentOnly,
    both_disagree: bothDisagree, both_agree: bothAgree, p };
}

async function main() {
  const dir = arg("dir", "");
  const cardLimit = Number(arg("cards", 14));
  const perCard = Number(arg("per-card", 1));
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!dir) { process.stderr.write("--dir is required\n"); process.exit(2); }
  if (!apiKey) { process.stderr.write("OPENAI_API_KEY is required\n"); process.exit(2); }

  const baseline = buildBaselineArm();
  const shipped = { schema: CANONICAL_FIELDS_SCHEMA, prompt: CANONICAL_FIELDS_PROMPT };

  const files = (await readdir(dir)).filter((n) => /\.(jpe?g|png|webp)$/i.test(n)).sort();
  const cards = [];
  for (let index = 0; index + perCard <= files.length && cards.length < cardLimit; index += perCard) {
    cards.push(files.slice(index, index + perCard).map((name) => resolve(dir, name)));
  }

  // Checkpoint after every card. A run that only writes at the end loses
  // everything to one timeout, and these are ~9 seconds of provider time each.
  await mkdir("artifacts/set-card-name-boundary", { recursive: true });
  const out = "artifacts/set-card-name-boundary/report.json";
  const checkpoint = async (payload) => {
    await writeFile(`${out}.tmp`, `${JSON.stringify(payload, null, 2)}\n`);
    await rename(`${out}.tmp`, out);
  };

  const rows = [];
  for (const [index, group] of cards.entries()) {
    const imageUrls = await Promise.all(group.map(dataUrl));
    // Alternate which definition is asked first, so any drift in the provider
    // over the run cannot land on one arm.
    const order = index % 2 === 0
      ? ["baseline", "cos56", "baseline", "cos56"]
      : ["cos56", "baseline", "cos56", "baseline"];
    const answers = { baseline: [], cos56: [] };
    for (const arm of order) {
      const config = arm === "baseline" ? baseline : shipped;
      answers[arm].push(await askProvider({ imageUrls, ...config, apiKey }));
    }
    const row = {
      card: index + 1,
      files: group.map((p) => basename(p)),
      order,
      baseline: { runs: answers.baseline, disagreements: disagreeingFields(...answers.baseline) },
      cos56: { runs: answers.cos56, disagreements: disagreeingFields(...answers.cos56) }
    };
    rows.push(row);
    await checkpoint({ decision: "COS-56", status: "partial", cards_done: rows.length,
      cards_planned: cards.length, rows });
    const b = row.baseline.disagreements;
    const c = row.cos56.disagreements;
    process.stdout.write(
      `${index + 1}/${cards.length}  旧=${b.length}[${b.join(",")}]  新=${c.length}[${c.join(",")}]\n`);
    for (const arm of ["baseline", "cos56"]) {
      for (const field of row[arm].disagreements) {
        const [x, y] = row[arm].runs;
        process.stdout.write(
          `      ${arm === "baseline" ? "旧" : "新"} ${field}: ${JSON.stringify(x[field])} / ${JSON.stringify(y[field])}\n`);
      }
    }
  }

  return report(rows, perCard, checkpoint);
}

/** Scoring, split out so a stored run can be re-scored with no provider calls:
 *  `--analyze artifacts/set-card-name-boundary/report.json`. */
export function scoreBoundaryRows(rows) {
  const score = (arm) => {
    const byField = {};
    let total = 0;
    let agreed = 0;
    for (const row of rows) {
      const fields = row[arm].disagreements;
      total += fields.length;
      if (!fields.length) agreed += 1;
      for (const field of fields) byField[field] = (byField[field] || 0) + 1;
    }
    return { total, agreed, cards: rows.length, by_field: byField };
  };
  const before = score("baseline");
  const after = score("cos56");
  const wins = rows.filter((r) => r.cos56.disagreements.length < r.baseline.disagreements.length).length;
  const losses = rows.filter((r) => r.cos56.disagreements.length > r.baseline.disagreements.length).length;
  const boundary = (s) => (s.by_field.set || 0) + (s.by_field.card_name || 0);
  return {
    before, after, wins, losses, ties: rows.length - wins - losses,
    boundary_before: boundary(before), boundary_after: boundary(after),
    sign_test: signTest(wins, losses),
    mcnemar_all_fields: mcnemarExact(rows, COMPARED_FIELDS),
    mcnemar_boundary_fields: mcnemarExact(rows, ["set", "card_name"])
  };
}

async function report(rows, perCard, checkpoint) {
  const s = scoreBoundaryRows(rows);
  process.stdout.write([
    "",
    `卡片数                ${rows.length}（每张 4 次调用，两定义交替）`,
    `分歧总数   旧 ${s.before.total}  →  新 ${s.after.total}`,
    `set+card_name 分歧  旧 ${s.boundary_before}  →  新 ${s.boundary_after}`,
    `全字段一致 旧 ${s.before.agreed}/${s.before.cards}  →  新 ${s.after.agreed}/${s.after.cards}`,
    `卡级配对   ${s.wins}胜 / ${s.losses}负 / ${s.ties}平   符号检验 p=${s.sign_test.p.toFixed(4)}`,
    `字段级     旧独有 ${s.mcnemar_all_fields.baseline_only} / 新独有 ${s.mcnemar_all_fields.treatment_only}`
      + `（共 ${s.mcnemar_all_fields.slots} 槽位）  McNemar p=${s.mcnemar_all_fields.p.toFixed(4)}`,
    `边界两字段 旧独有 ${s.mcnemar_boundary_fields.baseline_only} / 新独有 ${s.mcnemar_boundary_fields.treatment_only}`
      + `  McNemar p=${s.mcnemar_boundary_fields.p.toFixed(4)}`,
    `旧分布     ${JSON.stringify(s.before.by_field)}`,
    `新分布     ${JSON.stringify(s.after.by_field)}`,
    "",
    "槽位之间并不独立（同一张卡的字段一起动），所以这是筛选不是判决。",
    ""
  ].join("\n"));

  if (checkpoint) {
    await checkpoint({
      decision: "COS-56", status: "complete", cards: rows.length, per_card: perCard,
      model: CSM_THIN_RUNTIME_CONTRACT.model, effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
      ...s, rows
    });
  }
  return s;
}

async function analyze(path) {
  const stored = JSON.parse(await readFile(path, "utf8"));
  process.stdout.write(`重算 ${path}（${stored.rows.length} 张，无 provider 调用）\n`);
  await report(stored.rows, stored.per_card ?? null, null);
}

if (process.argv[1] && process.argv[1].endsWith("measure-set-card-name-boundary.mjs")) {
  const stored = arg("analyze", "");
  if (stored) await analyze(stored); else await main();
}
