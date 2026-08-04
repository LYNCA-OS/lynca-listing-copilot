import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { analyzeCanonicalComposerRecovery } from "./analyze-canonical-composer-recovery.mjs";

const rows = readFileSync(
  "artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl",
  "utf8"
).split("\n").filter(Boolean).map(JSON.parse);
const diagnosis = JSON.parse(readFileSync(
  "artifacts/extreme-observation-2026-08-01/diagnosis-high-100.json",
  "utf8"
));

const result = analyzeCanonicalComposerRecovery(rows, diagnosis);

assert.equal(result.population, 100);
assert.ok(Math.abs(result.baseline.macro_f1 - 0.7698022907754876) < 1e-12,
  "the stored control must reproduce before candidate scoring is trusted");
// Repinned twice at the founder's direction: 2026-08-03 for the lot bracket
// wording, and 2026-08-04 for COS-41 removing the Visible Components bracket.
// Only the delta moved on the second pass -- baseline, wins, losses, ties and
// every safety count are identical, which is what a change of ownership rather
// than of output should look like. The control still reproduces exactly
// (the assertion above is untouched), so the movement is the candidate's.
//
// The shorter marker frees four characters, and the composer spends them: the
// one new loss is a card where the reclaimed budget went to two more subject
// names and pushed "Rainbow Refractor" out. That is COS-8 behaving as written
// -- Subject is a `*` bracket and Print Finish is `**` -- not a defect.
assert.ok(Math.abs(result.paired.delta_macro_f1 - 0.008430486260921022) < 1e-12);
assert.deepEqual(
  [result.paired.wins, result.paired.losses, result.paired.ties],
  [14, 1, 85]
);
assert.equal(result.paired.p_two_sided, 0.0009765625);
assert.deepEqual(result.downstream_53, {
  recovered_occurrences: 16,
  total_occurrences: 53,
  recovered_share: 16 / 53,
  recovered_cards: 12
});
// The one lost reference token is "Refractor" on a lot card, displaced by two
// subject names the reclaimed budget made room for -- COS-8 ranks Subject
// above Print Finish, so the composer chose correctly. Nothing was invented,
// and that is asserted on its own line so a future change cannot trade a
// fabricated token for a budget explanation.
assert.equal(result.safety.cards_with_unbacked_new_tokens, 0,
  "nothing may be invented, whatever the budget does");
assert.deepEqual(result.safety, {
  over_80_characters: 0,
  cards_with_lost_reference_tokens: 1,
  cards_with_uncontracted_token_loss: 1,
  cards_with_unbacked_new_tokens: 0,
  critical_wrong_proxy: 1
});
// FLIPPED by the lot-format change, and left flipped deliberately.
//
// The gate requires zero lost reference tokens. After "Lot*n" freed four
// characters, one lot card spends them on two more subjects and drops
// "Refractor", so leaf recovery -- a DIFFERENT mechanism -- no longer passes
// its own gate on this cohort.
//
// The gate is stricter than the contract it serves: COS-8 ranks Subject `*`
// above Print Finish `**`, so that displacement is the drop order working. But
// redefining someone else's promotion gate to keep a green light is how a gate
// stops meaning anything, so the assertion records the truth and the decision
// goes to whoever owns that mechanism.
// Still false, and for a reason the gate cannot be taught without becoming
// wrong in another direction.
//
// The gate now defers to CSM: a reference token dropped because the priority
// order preferred a higher bracket is the contract working, not a defect. That
// is not what happened here. The lost token is `card`, from the writer's "Card
// Shop Promo" -- a shop name we never identified. The old wording "2 Card Lot"
// matched it by pure coincidence, and Lot*n removed the accident.
//
// So this is a third category: not a contract-sanctioned drop, not a
// fabrication, but the loss of a match we never earned. Teaching the gate to
// forgive it would mean forgiving every coincidental match, which is how a
// safety signal becomes decoration. Recorded, and the owner of leaf recovery
// decides.
assert.equal(result.promotion_gate.default_eligible, false,
  "one card loses a token it only ever matched by coincidence; not a contract drop, so the gate holds");

const baselineCommit = "d8bc6590bc542ab7be0a0395e41d9a1bac344240";
const replay = (path) => JSON.parse(execFileSync(process.execPath, [
  "scripts/analyze-canonical-composer-recovery.mjs",
  "--rows", path,
  "--diagnosis", "none",
  "--arm", "thin_canonical",
  "--baseline-commit", baselineCommit
], { encoding: "utf8" }));

// These are not independent holdouts (the card identities overlap), but they
// make schema/version regressions visible instead of treating the diagnostic
// 100 as the only surface on which the rule must work.
const currentSchema = replay("artifacts/canonical-v4/thin-path-gpt-5.6-luna.jsonl");
assert.equal(currentSchema.population, 148);
assert.ok(Math.abs(currentSchema.paired.delta_macro_f1 - 0.004033250554989709) < 1e-12);
assert.deepEqual(
  [currentSchema.paired.wins, currentSchema.paired.losses, currentSchema.paired.ties],
  [11, 1, 136]
);
// critical_wrong_proxy sums lost reference tokens and unbacked new ones, and
// only the first moved. FABRICATION IS STILL ZERO, which is the half that
// makes this a safety gate; asserted separately below so a future change
// cannot hide an invented token behind a budget reallocation.
assert.equal(currentSchema.safety.cards_with_unbacked_new_tokens, 0,
  "nothing may be invented, whatever the budget does");
assert.equal(currentSchema.safety.critical_wrong_proxy, currentSchema.safety.cards_with_uncontracted_token_loss + currentSchema.safety.cards_with_unbacked_new_tokens);
// Both are explainable. One card loses "Refractor" because the freed budget
// went to two more subjects, which COS-8 ranks higher. The other loses "card",
// a token we never actually recognised -- the reference says "Card Shop" and
// the old "2 Card Lot" wording matched it by coincidence.

const priorSchema = replay("artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl");
assert.equal(priorSchema.population, 150);
assert.ok(Math.abs(priorSchema.paired.delta_macro_f1 - 0.004451679077766002) < 1e-12);
assert.deepEqual(
  [priorSchema.paired.wins, priorSchema.paired.losses, priorSchema.paired.ties],
  [12, 1, 137]
);
assert.equal(priorSchema.safety.cards_with_unbacked_new_tokens, 0,
  "nothing may be invented, whatever the budget does");
assert.equal(priorSchema.safety.critical_wrong_proxy, priorSchema.safety.cards_with_uncontracted_token_loss + priorSchema.safety.cards_with_unbacked_new_tokens);

process.stdout.write("canonical composer recovery analysis: ok\n");
