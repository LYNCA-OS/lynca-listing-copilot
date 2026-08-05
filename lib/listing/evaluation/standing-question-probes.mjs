// The four standing questions, answered by the framework rather than by a
// person filling in a form.
//
// The first version took them as parameters and reported UNASKED when nobody
// supplied an answer, which is a form that never gets filled in -- the same
// failure as a review that runs only when someone remembers. Each of the four
// is computable from what is already on disk:
//
//   A  reachability   walk the production import graph
//   B  imposed limit  grep the prompts and configs for prohibitions
//   E  complexity     count what the diff added, read latency from the run
//   G  settled        scan the recorded rejections for the same mechanism
//
// None of them spends money and none needs a running service.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, relative, join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../..");

/** Entry points a real production request actually enters through. */
export const PRODUCTION_ENTRY_POINTS = Object.freeze([
  "api/csm-listing-title.js",
  "api/csm-listing-title-ingest.js",
  "api/listing-manual-recovery.js",
  "app/listing-copilot.js"
]);

/**
 * A. Walk the import graph from the production entry points.
 *
 * Answers the founder's question about the world-model enumerator -- "why does
 * no request touch it?" -- for any module, before someone has to ask.
 */
export function probeReach(targets = [], { entryPoints = PRODUCTION_ENTRY_POINTS, root = ROOT } = {}) {
  const seen = new Set();
  const walk = (file) => {
    const rel = relative(root, file);
    if (seen.has(rel)) return;
    seen.add(rel);
    let src;
    try { src = readFileSync(file, "utf8"); } catch { return; }
    for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const next = resolve(dirname(file), m[1]);
      walk(existsSync(next) ? next : `${next}.mjs`);
    }
  };
  for (const entry of entryPoints) {
    const abs = resolve(root, entry);
    if (existsSync(abs)) walk(abs);
  }
  const unreached = targets.filter((t) => !seen.has(t));
  return {
    name: targets.length === 1 ? targets[0] : `${targets.length} 个改动模块`,
    modulesWalked: seen.size,
    reached: unreached.length === 0,
    consumers: unreached
  };
}

/** Wording that forbids the model from doing what we then measure it on. */
const PROHIBITION_PATTERNS = Object.freeze([
  [/do not infer[^.]*\./gi, "禁止推断"],
  [/report only what is (?:visible|printed)[^.]*\./gi, "只许报告可见/印刷内容"],
  [/never what this card usually says/gi, "禁止使用卡片通识"],
  [/only visible evidence/gi, "只许可见证据"],
  [/is a good answer/gi, "告诉模型答一半就够好"]
]);

/**
 * B. Is the limit the model's, or one we wrote down ourselves?
 *
 * The exhaustive-observation arm was told "do not infer facts from general card
 * knowledge", and its silence was then read as a capability ceiling. Any claim
 * of the form "the model cannot X" has to survive this grep first.
 */
export function probeImposedConstraint(sourceFiles = [], { root = ROOT } = {}) {
  const foundIn = [];
  for (const file of sourceFiles) {
    const abs = resolve(root, file);
    if (!existsSync(abs)) continue;
    const src = readFileSync(abs, "utf8");
    for (const [pattern, label] of PROHIBITION_PATTERNS) {
      const hits = [...src.matchAll(pattern)];
      for (const hit of hits.slice(0, 1)) {
        foundIn.push(`${file}: ${label} — “${hit[0].trim().slice(0, 88)}”`);
      }
    }
  }
  return {
    claim: "模型看不到 / 做不到",
    searchedFor: sourceFiles,
    foundIn
  };
}

/**
 * E. What did the change add, and did the gain cover it?
 *
 * Counted from the diff rather than declared, so "it is only a small change"
 * has to survive the line count.
 */
export function probeComplexity({ baseRef = "HEAD", root = ROOT, artifactPath = null } = {}) {
  let addedModules = 0, addedCalls = 0;
  try {
    const out = execFileSync("git", ["diff", "--numstat", baseRef], { cwd: root, encoding: "utf8" });
    for (const line of out.split("\n").filter(Boolean)) {
      const [, , file] = line.split("\t");
      if (!file) continue;
      if (/\.(mjs|js)$/.test(file) && !/\.test\./.test(file) && !/^scripts\/(analyze|replay|measure)/.test(file)) {
        addedModules += 1;
      }
    }
  } catch { /* not a git tree, or no diff: leave at zero */ }

  let addedLatencyMs = 0;
  if (artifactPath && existsSync(artifactPath)) {
    const rows = readFileSync(artifactPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const byArm = new Map();
    for (const r of rows) {
      if (!r.arm || !Number.isFinite(Number(r.latency_ms))) continue;
      if (!byArm.has(r.arm)) byArm.set(r.arm, []);
      byArm.get(r.arm).push(Number(r.latency_ms));
    }
    const medians = [...byArm.entries()].map(([arm, v]) => {
      const s = [...v].sort((a, b) => a - b);
      return [arm, s[Math.floor(s.length / 2)] ?? 0];
    });
    if (medians.length === 2) addedLatencyMs = Math.round(medians[1][1] - medians[0][1]);
  }
  return { addedModules, addedCalls, addedLatencyMs };
}

/**
 * G. Has this already been decided?
 *
 * Scans the recorded rejections -- the comment blocks this repository uses to
 * stop an idea being re-tried -- so a mechanism cannot be re-litigated by
 * someone who has not read them.
 */
const REJECTION_SOURCES = Object.freeze([
  "lib/listing/thin/canonical-fields.mjs",
  "lib/listing/evaluation/semantic-equivalence.mjs",
  "lib/listing/thin/finish-vocabulary-admission.mjs",
  "lib/listing/thin/canonical-composer.mjs"
]);

export function probeSettled(topic, { root = ROOT, sources = REJECTION_SOURCES } = {}) {
  const settledDecisions = [];
  // Distinctive words only. An arm name is mostly boilerplate -- thin,
  // canonical, high, low -- and matching on those reported the reasoning-effort
  // decision as a precedent for a few-shot arm. A precedent that fires on
  // everything is worse than none: it trains the reader to skip the line.
  const BOILERPLATE = new Set([
    "thin", "canonical", "high", "arm", "prompt", "eval", "test", "path", "line", "card", "cards", "with", "that", "this", "from", "measured"
  ]);
  const words = String(topic).toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !BOILERPLATE.has(w));
  if (!words.length) return { topic, settledDecisions: [] };
  for (const file of sources) {
    const abs = resolve(root, file);
    if (!existsSync(abs)) continue;
    for (const line of readFileSync(abs, "utf8").split("\n")) {
      if (!/^\s*\/\//.test(line)) continue;
      const lower = line.toLowerCase();
      // A recorded rejection carries a measurement beside it; a comment that
      // merely mentions the word is not a decision.
      if (!/-?\d\.\d{3,}|w\/\d+l|p=|measured negative|rejected|not reintroduced/i.test(lower)) continue;
      if (words.some((w) => lower.includes(w))) {
        settledDecisions.push({ topic, decided_on: file, ruling: line.replace(/^\s*\/\/\s?/, "").trim().slice(0, 120) });
      }
    }
  }
  return { topic, settledDecisions: settledDecisions.slice(0, 3) };
}

/** Files a run's arms were built from, for the B probe. */
export function promptSourcesForRun() {
  const dir = resolve(ROOT, "lib/listing/thin");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => /canonical-fields|exhaustive-observation|thin-listing-path/.test(f) && f.endsWith(".mjs"))
    .map((f) => relative(ROOT, join(dir, f)));
}
