import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { composeTypedParetoV1 } from "../experiments/accuracy/typed-pareto-composer-v1.mjs";

const base = {
  year: "2001",
  manufacturer: "Donruss",
  product: "Donruss Elite",
  set: "",
  subjects: ["B. Bonds", "W. Mays"],
  card_name: "Passing the Torch",
  release_variant: "",
  surface_color: "",
  parallel_family: "",
  parallel_exact: "",
  print_finish: "",
  descriptive_rarity: "",
  card_number: "",
  serial: "22/50",
  components: ["Auto"],
  grade: "PSA Authentic; Auto 9",
  grammar: "standard",
  lot_count: "",
  team: ""
};

const replay = composeTypedParetoV1(base);
assert.equal(replay.candidate.title,
  "2001 Donruss Elite B. Bonds W. Mays Passing the Torch 22/50 Auto PSA AUTH/9");
// COS-41 (Fei, 2026-08-04) REJECTED `observable_components` as a canonical
// bracket: Auto, RC, Patch and Relic stay under [Search Optimization], and the
// grouping is "an implementation-level grouping, not approved semantic truth".
// The composer follows the decision; this assertion was written before it.
assert.deepEqual(replay.candidate.restored_vs_baseline, ["product", "search_optimization"]);
assert.deepEqual(replay.candidate.displaced_vs_baseline, []);
assert.ok(replay.candidate.normalizations.includes("grading_info:auth_auto_slash"));
assert.ok(replay.candidate.length <= 80);
assert.ok(replay.candidate.drop_ledger.every((row) => row.reason === "character_budget"));
assert.equal(replay.candidate.preserves_numeric_semantics, true);
assert.deepEqual(replay.candidate.mechanisms, ["grading_auth_auto"]);
assert.deepEqual(replay.candidate.reason_ledger.slice(0, 2).map((row) => row.action), [
  "semantic_compaction",
  "restore_bracket"
], "semantic-preserving compaction must precede whole-bracket budget drops");
assert.equal(replay.candidate.reason_ledger[0].before, "PSA Authentic; Auto 9");
assert.equal(replay.candidate.reason_ledger[0].after, "PSA AUTH/9");
assert.ok(replay.safe_frontier.length > 0);
assert.ok(replay.safe_frontier.every((candidate) => (
  candidate.preserves_baseline_tokens
  && candidate.preserves_baseline_brackets
  && candidate.preserves_numeric_semantics
)), "label-reading diagnostics must only inspect the safe frontier");

const noCompaction = composeTypedParetoV1(base, { enabledMechanisms: [] });
assert.equal(noCompaction.candidate.title, noCompaction.baseline.title);
assert.deepEqual(noCompaction.candidate.restored_vs_baseline, []);

const exactChecklist = composeTypedParetoV1({
  ...base,
  grammar: "tcg",
  ip: "Pokémon",
  language: "EN",
  card_number: "TG22/TG30-AKA",
  grade: "",
  components: [],
  serial: "027/150"
});
assert.match(exactChecklist.candidate.title, /#TG22\/TG30-AKA\b/,
  "a visible checklist suffix is stronger than a guessed subject abbreviation");
assert.match(exactChecklist.candidate.title, /027\/150\b/,
  "critical numeric formatting must remain exact");
assert.equal(exactChecklist.candidate.preserves_numeric_semantics, true);

const repeated = composeTypedParetoV1({
  ...base,
  manufacturer: "Topps",
  product: "Topps Chrome",
  subjects: ["Charizard ex"],
  card_name: "Charizard ex",
  grade: "",
  serial: "",
  components: []
});
assert.equal((repeated.candidate.title.match(/Charizard ex/gi) || []).length, 1,
  "CSM exact-prefix de-duplication must remain active");

const nonEquivalentGrade = composeTypedParetoV1({
  ...base,
  grade: "PSA Authentic; Card 9"
});
assert.doesNotMatch(nonEquivalentGrade.candidate.normalizations.join(" "), /auth_auto_slash/,
  "a different graded object must not be coerced into the compact auto notation");
assert.equal(nonEquivalentGrade.candidate.length <= 80, true);

const source = await readFile(new URL("../experiments/accuracy/typed-pareto-composer-v1.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /\breference\s*[,)=]|\.\s*reference\b|\[\s*["']reference/i,
  "the deployable selector must never inspect reviewed labels");
assert.doesNotMatch(source, /subject_suffix_removed/,
  "a checklist suffix must not be weakened from a guessed subject abbreviation");

const evidenceManifest = JSON.parse(await readFile(new URL(
  "../docs/evaluation/typed-pareto-composer-v1-evidence-manifest-2026-08-08.json",
  import.meta.url
), "utf8"));
assert.equal(evidenceManifest.schema_version, "typed-pareto-composer-v1-evidence-v1");
assert.equal(evidenceManifest.count, 150);
assert.equal(evidenceManifest.arm, "thin_canonical_high");
assert.match(evidenceManifest.sha256, /^[a-f0-9]{64}$/);
assert.equal(evidenceManifest.source_checkout_env, "LYNCA_TYPED_PARETO_SOURCE_CHECKOUT");
assert.equal(evidenceManifest.source_checkout_sibling, "lynca-thin-path");
assert.ok(!JSON.stringify(evidenceManifest).includes("/Users/"),
  "tracked evidence manifests must not depend on one developer's absolute path");

const replayScript = fileURLToPath(new URL("./replay-typed-pareto-composer-v1.mjs", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "typed-pareto-contract-"));
try {
  const runFailure = (args, pattern) => {
    const child = spawnSync(process.execPath, [replayScript, ...args], { encoding: "utf8" });
    assert.notEqual(child.status, 0);
    assert.match(`${child.stdout}\n${child.stderr}`, pattern);
  };
  runFailure(["--arm", "different_arm", "--out", join(scratch, "arm.json")],
    /typed_pareto_arm_must_match_manifest/);
  runFailure(["--count", "149", "--out", join(scratch, "count.json")],
    /typed_pareto_replay_count_must_match_manifest/);
  runFailure([
    "--input", join(scratch, "missing.jsonl"), "--sha256", "a".repeat(64),
    "--out", join(scratch, "missing-out.json")
  ], /typed_pareto_evidence_missing/);
  const wrongHashInput = join(scratch, "wrong-hash.jsonl");
  await writeFile(wrongHashInput, "{}\n", "utf8");
  runFailure([
    "--input", wrongHashInput, "--sha256", "b".repeat(64),
    "--out", join(scratch, "hash-out.json")
  ], /typed_pareto_input_sha256_mismatch/);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

process.stdout.write("typed Pareto Composer v1 tests passed\n");
