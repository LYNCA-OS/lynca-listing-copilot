// A framework for reviewing an exploration, because doing it from memory does
// not work.
//
// Every failure this is built from happened in one session:
//
//   * a headline number was reported and the field-level decomposition only
//     happened when the founder asked for it;
//   * "it bought one right answer for two wrong ones" was only computed on
//     request, so the TRADE was invisible until someone thought to ask;
//   * an arm was judged under a ruler that had drifted from the founder's
//     adjudicated rules, and nobody noticed until the founder said so;
//   * four instrument errors shipped as findings before being caught -- a
//     prompt prohibition read as a capability limit, a ruler tested on strings
//     too short to separate anything, a false positive from a crude regex, and
//     an audit script that silently returned nothing.
//
// The response to all four is the same: STOP RELYING ON REMEMBERING. A review
// that is a habit gets skipped under time pressure; a review that is a function
// runs every time or fails loudly.
//
// Two halves, and the first one matters more:
//
//   preregister()  before the money is spent. What would falsify this? What is
//                  the most it could possibly buy? What bar decides it? Written
//                  down BEFORE the result, because a bar chosen afterwards is
//                  not a bar.
//
//   review()       after. Headline, ruler provenance, per-field decomposition,
//                  the trade ledger, keepable parts, and the verdict against
//                  the pre-registered bar -- all of it, unconditionally, not
//                  the parts that happen to look good.

import { createHash } from "node:crypto";

/** The standing bar, from the founder. Either clause is sufficient. */
export const STANDING_BAR = Object.freeze({
  description: "≥8W/0L, or ΔF1≥+0.003 with p<0.05",
  clean_sweep: Object.freeze({ min_wins: 8, max_losses: 0 }),
  significant: Object.freeze({ min_delta: 0.003, max_p: 0.05 })
});

/**
 * Run-to-run drift, measured. Any effect smaller than this is indistinguishable
 * from the same arm run twice, whatever its p-value says.
 */
export const MEASURED_DRIFT = 0.009;

export class PreregistrationError extends Error {}

/**
 * Write down what would make this worth doing, BEFORE doing it.
 *
 * `ceiling` is the field that stops most waste. An idea whose perfect version
 * is worth +0.004 does not deserve a 50-card paid run, and computing that is
 * usually free -- substitute the reference's own values and re-score.
 *
 * `falsifier` is the second. An exploration with no result that would kill it
 * is not an experiment; it is a plan to find supporting evidence.
 */
export function preregister({
  name,
  hypothesis,
  mechanism,
  ceiling = null,
  falsifier,
  bar = STANDING_BAR,
  cohort,
  cost_note = "",
  alternatives_considered = []
} = {}) {
  const missing = Object.entries({ name, hypothesis, mechanism, falsifier, cohort })
    .filter(([, v]) => !String(v ?? "").trim())
    .map(([k]) => k);
  if (missing.length) {
    throw new PreregistrationError(`preregistration_incomplete:${missing.join(",")}`);
  }
  if (ceiling !== null && Number.isFinite(ceiling) && ceiling < MEASURED_DRIFT) {
    // Not an error -- some cheap ideas are worth running anyway -- but it has
    // to be stated, because "we measured it and it was flat" costs the same as
    // a real experiment and teaches nothing when the ceiling was below noise.
    // eslint-disable-next-line no-console
    console.warn(
      `⚠ ceiling ${ceiling.toFixed(6)} is below measured run-to-run drift ${MEASURED_DRIFT}. `
      + "A null result here will be uninterpretable. Say why it is still worth running."
    );
  }
  const record = {
    schema_version: "exploration-prereg-v1",
    name, hypothesis, mechanism, ceiling, falsifier, bar, cohort, cost_note,
    alternatives_considered
  };
  return { ...record, id: createHash("sha256").update(JSON.stringify(record)).digest("hex").slice(0, 12) };
}

const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const lnFact = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };

export function signTest(wins, losses) {
  const n = wins + losses;
  if (!n) return 1;
  let p = 0;
  for (let k = Math.max(wins, losses); k <= n; k++) {
    p += Math.exp(lnFact(n) - lnFact(k) - lnFact(n - k) - n * Math.log(2));
  }
  return Math.min(1, 2 * p);
}

/**
 * Did the arms differ in anything except the thing under test?
 *
 * A paired evaluation in which both arms silently ran the same configuration
 * has already happened here and still produced clean-looking numbers, which is
 * why served values are read back rather than trusted.
 */
export function checkConfounds(pairs) {
  const problems = [];
  const seen = { effort: new Set(), model: new Set(), detail: new Set(), ruler: new Set() };
  for (const { control, treatment } of pairs) {
    seen.effort.add(`${control.served_effort}→${treatment.served_effort}`);
    seen.model.add(`${control.served_model}→${treatment.served_model}`);
    seen.detail.add(`${control.image_detail}→${treatment.image_detail}`);
    if (control.equivalence_version || treatment.equivalence_version) {
      seen.ruler.add(`${control.equivalence_version}→${treatment.equivalence_version}`);
    }
  }
  for (const [axis, values] of Object.entries(seen)) {
    const mixed = [...values].filter((v) => {
      const [a, b] = v.split("→");
      return a !== b && a !== "undefined" && b !== "undefined";
    });
    if (mixed.length) problems.push(`${axis} differs between arms: ${mixed.join(", ")}`);
  }
  return problems;
}

/**
 * The trade, stated as a trade.
 *
 * A headline delta hides the shape of what happened. "Bought one right answer
 * for two wrong ones" and "+0.004 overall" can be the same run, and only the
 * first tells you whether to ship it.
 */
export function tradeLedger(dimensions) {
  return dimensions.map((d) => {
    const gained = d.treatment_hits - d.control_hits;
    const cost = d.treatment_errors - d.control_errors;
    return {
      ...d,
      gained,
      cost,
      free: gained > 0 && cost <= 0,
      net_negative: gained <= 0 || (cost > 0 && cost >= gained),
      verdict: gained > 0 && cost <= 0 ? "FREE"
        : gained > cost && gained > 0 ? "PAID_FOR"
          : gained > 0 ? "BOUGHT_TOO_DEAR"
            : "NO_GAIN"
    };
  });
}

/**
 * Is a number suspicious enough to check the instrument before believing it?
 *
 * Exactly zero, exactly total, and exactly none are the shapes a broken
 * detector produces. Every instrument error in this repository's history
 * announced itself as one of them and was believed anyway.
 */
export function instrumentWarnings(values) {
  const warnings = [];
  for (const [label, { value, total = null }] of Object.entries(values)) {
    if (value === 0) warnings.push(`${label} is exactly 0 -- verify the detector fires at all before concluding "no effect"`);
    if (total !== null && total > 0 && value === total) warnings.push(`${label} is exactly ${total}/${total} -- verify the detector can return a negative`);
    if (total !== null && total === 0) warnings.push(`${label} has an empty denominator -- the population is zero, not the effect`);
  }
  return warnings;
}

/**
 * A. Is the thing we built REACHED by anything?
 *
 * From the founder's question about the world-model enumerator: "why does no
 * request touch it?" The answer was 786 lines that the production import graph
 * reaches zero times. Nothing in the review process asked, so nobody knew.
 *
 * Takes a reachability result rather than computing it, because walking the
 * graph belongs to the caller who knows the entry points -- but the QUESTION is
 * asked unconditionally.
 */
export function checkReach({ name, modulesWalked = 0, reached = false, consumers = [] } = {}) {
  if (!modulesWalked) return [`${name}: 可达性未测。跑一次 import 图再说“它在起作用”。`];
  if (reached) return [];
  const note = consumers.length
    ? `外围仍有 ${consumers.length} 个消费者：${consumers.slice(0, 3).join(", ")}`
    : "零消费者";
  return [`${name}: 生产链路 ${modulesWalked} 个模块零次到达。${note}。它不是在起作用，是在占地方。`];
}

/**
 * B. Is this a capability limit, or a constraint we imposed?
 *
 * From the founder's push: "even if the model didn't see it, the model is
 * surely capable -- it is just a card." It was right. The observation arm had
 * been told "do not infer facts from general card knowledge", so a prompt
 * prohibition had been measured and reported as a ceiling.
 *
 * The same shape appeared twice more in one session: "Supabase should be doable"
 * (a connector existed and went unused) and the eval harness refusing three
 * arms (a design rule, not a limit). Before any "cannot", the constraint has to
 * be located.
 */
export function checkImposedConstraint({ claim, searchedFor = [], foundIn = [] } = {}) {
  const problems = [];
  if (!searchedFor.length) {
    problems.push(`“${claim}” 未做约束定位。先证明限制来自能力，而不是来自我们自己写的一句话或没查的一个工具。`);
  }
  for (const found of foundIn) {
    problems.push(`“${claim}” 其实受限于我们自己施加的约束：${found}。这不是天花板，是设定。`);
  }
  return problems;
}

/**
 * E. Did the complexity earn its keep?
 *
 * From the founder's standing preference that the pipeline be as clean as
 * possible. A change that gains within drift but adds a module, a call or a
 * failure mode is a net loss even when its delta reads positive.
 */
export function checkComplexityCost({ delta, addedModules = 0, addedCalls = 0, addedLatencyMs = 0 } = {}) {
  const problems = [];
  const added = addedModules + addedCalls;
  if (!added && !addedLatencyMs) return problems;
  if (Math.abs(delta) < MEASURED_DRIFT && added) {
    problems.push(`加了 ${addedModules} 个模块 / ${addedCalls} 次调用，但 |Δ|=${Math.abs(delta).toFixed(6)} 小于漂移 ${MEASURED_DRIFT}：复杂度确定，收益不确定。`);
  }
  if (addedLatencyMs > 0 && delta > 0 && delta < MEASURED_DRIFT) {
    problems.push(`延迟 +${addedLatencyMs}ms 换来漂移以内的收益。写手预算是 6-8s。`);
  }
  return problems;
}

/**
 * G. Is this question already settled?
 *
 * From the founder's sharpest correction: "we spent nearly a day going through
 * the ruler rule by rule" -- said because a settled decision was being
 * re-derived instead of applied. Re-litigating costs trust as well as time.
 */
export function checkSettled({ topic, settledDecisions = [] } = {}) {
  const hit = settledDecisions.filter((d) => (
    String(topic).toLowerCase().includes(String(d.topic).toLowerCase())
    || String(d.topic).toLowerCase().includes(String(topic).toLowerCase())
  ));
  return hit.map((d) => `“${topic}” 已于 ${d.decided_on} 判定：${d.ruling}。应当应用，而不是重新论证。`);
}

/**
 * The full review. Everything, always, in one object.
 *
 * `keepable` answers the founder's standing question -- keep the parts that
 * gain, revert the rest -- and it answers it with a threshold rather than an
 * eyeball, because a +1-of-29 improvement on 50 cards is noise and fitting a
 * rule to it is the specific mistake this repository keeps making.
 */
export function review({
  prereg,
  controlScores,
  treatmentScores,
  pairs = [],
  dimensions = [],
  rulerVersion = null,
  minKeepableSupport = 10,
  // The four the founder had to ask for by hand. Passing null is allowed and
  // is reported as UNASKED rather than skipped silently: an unanswered question
  // is a finding.
  reach = null,
  imposedConstraint = null,
  complexity = null,
  settled = null
} = {}) {
  if (!prereg?.id) throw new PreregistrationError("review_without_preregistration");
  const n = Math.min(controlScores.length, treatmentScores.length);
  let wins = 0, losses = 0, ties = 0;
  for (let i = 0; i < n; i++) {
    if (treatmentScores[i] > controlScores[i] + 1e-9) wins += 1;
    else if (controlScores[i] > treatmentScores[i] + 1e-9) losses += 1;
    else ties += 1;
  }
  const delta = mean(treatmentScores.slice(0, n)) - mean(controlScores.slice(0, n));
  const p = signTest(wins, losses);

  const meetsSweep = wins >= prereg.bar.clean_sweep.min_wins && losses <= prereg.bar.clean_sweep.max_losses;
  const meetsSignificant = delta >= prereg.bar.significant.min_delta && p < prereg.bar.significant.max_p;
  const passes = meetsSweep || meetsSignificant;

  const ledger = tradeLedger(dimensions);
  const keepable = ledger.filter((d) => d.free && (d.support ?? 0) >= minKeepableSupport);
  const belowSupport = ledger.filter((d) => d.free && (d.support ?? 0) < minKeepableSupport);

  const blockers = [];
  blockers.push(...checkConfounds(pairs));
  // Only quantities where 0 means "the detector never fired". A losses count
  // of 0 is the DESIRED result of a clean sweep, and an earlier version of
  // this very function flagged it as a broken instrument -- the exact failure
  // mode it exists to catch, produced by itself.
  blockers.push(...instrumentWarnings({ paired_cards: { value: n } }));

  // The four questions the founder had to ask by hand. Each is answered, or
  // recorded as unanswered -- never dropped.
  const standingQuestions = [];
  const ask = (label, value, fn) => {
    if (value === null) { standingQuestions.push({ label, status: "UNASKED", notes: [] }); return; }
    const notes = fn(value);
    standingQuestions.push({ label, status: notes.length ? "PROBLEM" : "OK", notes });
    // A real problem blocks; an unanswered question is shown and does not.
    blockers.push(...notes);
  };
  ask("A 有没有被用到", reach, checkReach);
  ask("B 是能力上限还是我们设的限制", imposedConstraint, checkImposedConstraint);
  ask("E 复杂度挣回来了吗", complexity, (c) => checkComplexityCost({ ...c, delta }));
  ask("G 这事是不是已经定过了", settled, checkSettled);

  return {
    schema_version: "exploration-review-v1",
    preregistration_id: prereg.id,
    name: prereg.name,
    headline: {
      n, delta, wins, losses, ties, p,
      control_mean: mean(controlScores.slice(0, n)),
      treatment_mean: mean(treatmentScores.slice(0, n))
    },
    ruler: { version: rulerVersion },
    // The pre-registered ceiling next to what was actually collected, so an
    // exploration that captured 8% of its own upside is visible as such.
    ceiling: prereg.ceiling,
    captured_share: prereg.ceiling ? delta / prereg.ceiling : null,
    below_drift: Math.abs(delta) < MEASURED_DRIFT,
    trade_ledger: ledger,
    standing_questions: standingQuestions,
    keepable,
    keepable_but_unsupported: belowSupport,
    blockers,
    verdict: blockers.length ? "BLOCKED"
      : passes ? "SHIP"
        : keepable.length ? "REJECT_WHOLE_KEEP_PARTS"
          : "REJECT",
    // Rejections are recorded, never silently deleted: this repository's
    // rejected-mechanism list is what stops the same idea being re-tried.
    record_rejection_in: passes ? null : "the module the change would have shipped in"
  };
}

/** Human-readable, because a review nobody reads is a review that did not run. */
export function formatReview(r) {
  const pct = (v) => (v === null ? "—" : `${(100 * v).toFixed(0)}%`);
  const lines = [
    `═══ ${r.name}   [${r.verdict}] ═══`,
    `  n=${r.headline.n}  Δ=${r.headline.delta >= 0 ? "+" : ""}${r.headline.delta.toFixed(6)}  `
    + `${r.headline.wins}W/${r.headline.losses}L/${r.headline.ties}T  p=${r.headline.p.toFixed(4)}`,
    `  对照 ${r.headline.control_mean.toFixed(6)} → 处理 ${r.headline.treatment_mean.toFixed(6)}`
  ];
  if (r.ceiling) lines.push(`  天花板 +${r.ceiling.toFixed(6)}，本次拿到 ${pct(r.captured_share)}`);
  if (r.below_drift) lines.push(`  ⚠ |Δ| 小于实测漂移 ${MEASURED_DRIFT}，与同臂跑两次无法区分`);
  if (r.ruler.version) lines.push(`  尺子 ${r.ruler.version}`);
  if (r.trade_ledger.length) {
    lines.push("  取舍账:");
    for (const d of r.trade_ledger) {
      lines.push(`    ${String(d.name).padEnd(18)} 命中 ${d.control_hits}→${d.treatment_hits} (${d.gained >= 0 ? "+" : ""}${d.gained})  `
        + `错误 ${d.control_errors}→${d.treatment_errors} (${d.cost >= 0 ? "+" : ""}${d.cost})  [${d.verdict}]  n=${d.support ?? "?"}`);
    }
  }
  if (r.standing_questions?.length) {
    lines.push("  常设追问:");
    for (const q of r.standing_questions) {
      const mark = q.status === "OK" ? "✓" : q.status === "UNASKED" ? "?" : "✗";
      lines.push(`    ${mark} ${q.label}${q.status === "UNASKED" ? "  (本次未回答)" : ""}`);
      for (const note of q.notes) lines.push(`        ${note}`);
    }
  }
  if (r.keepable.length) lines.push(`  可保留: ${r.keepable.map((d) => d.name).join(", ")}`);
  if (r.keepable_but_unsupported.length) {
    lines.push(`  只赚不赔但样本不足(不保留): ${r.keepable_but_unsupported.map((d) => `${d.name} n=${d.support}`).join(", ")}`);
  }
  for (const b of r.blockers) lines.push(`  ⛔ ${b}`);
  if (r.record_rejection_in) lines.push(`  → 否决须记录在: ${r.record_rejection_in}`);
  return lines.join("\n");
}
