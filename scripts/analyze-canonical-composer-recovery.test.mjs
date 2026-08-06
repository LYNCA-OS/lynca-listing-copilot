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
//
// Repinned a third time, 2026-08-05, for COS-49's `LotxN`. `Lot*4` and `Lotx4`
// are the same five characters, so no budget moves and wins/losses/ties are
// byte-identical at 14/1/85 with the same p -- the SAME cards win, they just
// win by more, because `lotx4` is the spelling the writers use and `Lot*4` was
// not. +0.008430 -> +0.012349, a shift of +0.003919 that matches the isolated
// lot-marker measurement (+0.0916 on lot cards, ~4 of these 100) to the third
// decimal.
//
// COS-49's bare-colour rule landed in the same pass and contributes nothing
// here, as intended: the Composer already refused to project a bare colour, so
// moving the gate upstream changed the canonical record and no title.
// Repinned a fourth time, 2026-08-06, for COS-14's Lot Product/Set expression.
// The Lot bracket folds Manufacturer, Product and Set into one, and a set that
// extended neither -- Topps / Chrome / Update -- was dropped, against COS-14's
// own approved example. Restoring it moved the delta +0.012349 -> +0.013562 and
// turned the single loss into a win: 14/1/85 -> 15/0/85, p 0.00098 -> 0.000061.
// The baseline above is byte-identical, so the control is intact and the whole
// movement belongs to the candidate.
//
// The same pass added `special_stamp` and `description` to the TCG order.
// Neither appears here: this cohort predates the fields, so the rows carry no
// value for them and every title is unchanged on that account.
assert.ok(Math.abs(result.paired.delta_macro_f1 - 0.013561558087645031) < 1e-12);
assert.deepEqual(
  [result.paired.wins, result.paired.losses, result.paired.ties],
  [15, 0, 85]
);
assert.equal(result.paired.p_two_sided, 0.00006103515625);
// Same repin, same cause: the restored Lot set is a real token the downstream
// measure was looking for. 12 -> 13 cards, 16 -> 18 occurrences, 0.302 -> 0.340.
assert.deepEqual(result.downstream_53, {
  recovered_occurrences: 18,
  total_occurrences: 53,
  recovered_share: 18 / 53,
  recovered_cards: 13
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
// Repinned 2026-08-05 for COS-49's `LotxN`: +0.005352 -> +0.009619. Same
// +0.004 shift as the diagnostic 100 and the v3 cohort, and wins/losses/ties
// hold at 12/0/136 -- the marker is the same five characters, so no budget
// moves and no card changes side.
assert.ok(Math.abs(currentSchema.paired.delta_macro_f1 - 0.00961934545458576) < 1e-12);
assert.deepEqual(
  // The loss is gone as of the COS-41 and COS-39 decisions: 11-1 became 12-0.
  [currentSchema.paired.wins, currentSchema.paired.losses, currentSchema.paired.ties],
  [12, 0, 136]
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
// Repinned 2026-08-05, same COS-49 change: +0.004951 -> +0.009269.
assert.ok(Math.abs(priorSchema.paired.delta_macro_f1 - 0.009268500395273827) < 1e-12);
assert.deepEqual(
  [priorSchema.paired.wins, priorSchema.paired.losses, priorSchema.paired.ties],
  [12, 1, 137]
);
assert.equal(priorSchema.safety.cards_with_unbacked_new_tokens, 0,
  "nothing may be invented, whatever the budget does");
assert.equal(priorSchema.safety.critical_wrong_proxy, priorSchema.safety.cards_with_uncontracted_token_loss + priorSchema.safety.cards_with_unbacked_new_tokens);

process.stdout.write("canonical composer recovery analysis: ok\n");
