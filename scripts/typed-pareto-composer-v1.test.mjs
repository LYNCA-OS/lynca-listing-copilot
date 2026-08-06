import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

const source = await readFile(new URL("../experiments/accuracy/typed-pareto-composer-v1.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /\breference\s*[,)=]|\.\s*reference\b|\[\s*["']reference/i,
  "the deployable selector must never inspect reviewed labels");

process.stdout.write("typed Pareto Composer v1 tests passed\n");
