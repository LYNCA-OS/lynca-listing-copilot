// The review that runs itself, at the end of the run that produced the data.
//
// Shared by the eval harness (which calls it automatically) and
// `review-exploration.mjs` (which calls it for a run that already finished), so
// there is exactly one implementation and the automatic path cannot drift from
// the manual one.
//
// It spends nothing: it rescores artifacts already on disk under the one ruler.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { scoreWithEquivalence, EQUIVALENCE_VERSION } from "../lib/listing/evaluation/semantic-equivalence.mjs";
import { preregister, review, formatReview } from "../lib/listing/evaluation/exploration-review.mjs";
import {
  probeReach, probeImposedConstraint, probeComplexity, probeSettled, promptSourcesForRun
} from "../lib/listing/evaluation/standing-question-probes.mjs";

/**
 * Ledger dimensions. Defined here, not passed in, so a review cannot quietly
 * omit the dimension that would have failed it -- transcription in particular,
 * which is what the rejected prompt arms damaged while their headline read
 * merely flat.
 */
export const REVIEW_DIMENSIONS = Object.freeze([
  ["工艺 finish", ["refractor", "prizm", "holo", "foil", "sapphire", "mojo", "wave", "shimmer",
    "sparkle", "pulsar", "geometric", "hyper", "disco", "scope", "xfractor", "raywave",
    "prismatic", "lucky", "crystallized", "marble", "velocity", "shock"]],
  ["部件 components", ["auto", "rc", "jersey", "patch", "relic"]],
  ["稀有度 rarity", ["ssp", "sp", "1st"]],
  ["评级 grading", ["psa", "bgs", "cgc", "sgc", "scd"]]
]);

const tokenise = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9/]+/).filter(Boolean));

export function buildReview({ artifactPath, control, treatment, preregPath = null, changedModules = [] }) {
  const rows = readFileSync(artifactPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const byAsset = new Map();
  for (const r of rows) {
    if (!r.asset_id) continue;
    if (!byAsset.has(r.asset_id)) byAsset.set(r.asset_id, {});
    byAsset.get(r.asset_id)[r.arm] = r;
  }

  const controlScores = [], treatmentScores = [], pairs = [];
  const dims = REVIEW_DIMENSIONS.map(([name, vocab]) => ({
    name, vocab: new Set(vocab), support: 0,
    control_hits: 0, treatment_hits: 0, control_errors: 0, treatment_errors: 0
  }));
  let serialSupport = 0, serialControl = 0, serialTreatment = 0;

  for (const [, pair] of byAsset) {
    const c = pair[control], t = pair[treatment];
    if (!c || !t || !c.reference) continue;
    const reference = String(c.reference);
    const ct = c.fields ? composeFromCanonicalFields(c.fields).title : String(c.title || "");
    const tt = t.fields ? composeFromCanonicalFields(t.fields).title : String(t.title || "");
    controlScores.push(scoreWithEquivalence(ct, reference).equivalent.f1);
    treatmentScores.push(scoreWithEquivalence(tt, reference).equivalent.f1);
    pairs.push({ control: c, treatment: t });

    const ref = tokenise(reference), cTok = tokenise(ct), tTok = tokenise(tt);
    for (const d of dims) {
      const wanted = [...d.vocab].filter((v) => ref.has(v));
      if (wanted.length) {
        d.support += 1;
        if (wanted.some((v) => cTok.has(v))) d.control_hits += 1;
        if (wanted.some((v) => tTok.has(v))) d.treatment_hits += 1;
      }
      d.control_errors += [...d.vocab].filter((v) => cTok.has(v) && !ref.has(v)).length;
      d.treatment_errors += [...d.vocab].filter((v) => tTok.has(v) && !ref.has(v)).length;
    }
    const serial = reference.match(/\b\d{2,4}\/\d{2,4}\b/);
    if (serial) {
      serialSupport += 1;
      if (ct.includes(serial[0])) serialControl += 1;
      if (tt.includes(serial[0])) serialTreatment += 1;
    }
  }

  const dimensions = [
    ...dims.map(({ vocab, ...rest }) => rest),
    {
      name: "转录 serial", support: serialSupport,
      control_hits: serialControl, treatment_hits: serialTreatment,
      control_errors: serialSupport - serialControl,
      treatment_errors: serialSupport - serialTreatment
    }
  ];

  const prereg = preregPath && existsSync(preregPath)
    ? JSON.parse(readFileSync(preregPath, "utf8"))
    : preregister({
      name: `${treatment} vs ${control}`,
      hypothesis: "未在跑批前记录",
      mechanism: "未在跑批前记录",
      falsifier: "未在跑批前记录 —— 本次复盘无法判断门槛是否事后所定",
      cohort: artifactPath
    });

  return {
    result: review({
      prereg, controlScores, treatmentScores, pairs, dimensions,
      rulerVersion: EQUIVALENCE_VERSION,
      // The four standing questions ANSWER THEMSELVES. Taking them as
      // parameters meant a form nobody filled in, which is the same failure as
      // a review nobody remembers to run.
      reach: probeReach(changedModules),
      imposedConstraint: probeImposedConstraint(promptSourcesForRun()),
      complexity: probeComplexity({ artifactPath }),
      settled: probeSettled(treatment)
    }),
    preregistered: Boolean(preregPath && existsSync(preregPath))
  };
}

/** Formatted block for the harness to print when a run finishes. */
export async function runAutoReview({ outDir, model, control, treatment, preregPath = null }) {
  const artifactPath = resolve(outDir, `thin-path-${model}.jsonl`);
  const { result, preregistered } = buildReview({ artifactPath, control, treatment, preregPath });
  const lines = ["", "".padEnd(72, "─"), "自动复盘（跑批结束时自动生成，未额外花费）", "".padEnd(72, "─"), formatReview(result)];
  if (!preregistered) {
    lines.push("", "⚠ 本次无预注册：无法判断门槛是不是看到结果之后才定的。");
    lines.push("  下次先写 docs/explorations/<日期>-<名称>.json 再花钱，用 preregister() 校验。");
  }
  lines.push("");
  return lines.join("\n");
}
