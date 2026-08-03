#!/usr/bin/env node
// COS-42 stage 3: accuracy by grammar x bracket.
//
// Driven by the 255 writer-confirmed titles, which are real reviewed data. The
// issue is explicit that they are not the same thing as a field review -- "a
// corrected title does not prove that CSM can place the corrected facts into
// the correct canonical brackets" -- so every cell here is labelled
// TITLE_DERIVED and the projection says what it cannot see:
//
//   * A bracket whose value the writer never publishes (Card Number, and the
//     team once eBay suppresses it) reads as a miss that is really a policy.
//     Counted separately as UNPUBLISHED rather than folded into error.
//   * Right fact in the wrong bracket is invisible. The token matches either
//     way, which is precisely the question a real field review answers.
//
// Scored through the adjudicated equivalence layer, so a synonym or a season
// span does not register as a correction the writer never made.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { buildCsmResolutionView } from "../lib/listing/csm/resolution-view.mjs";
import {
  equivalenceTokens, applyUnobtainableFacts, applyHypernymRedundancy,
  applyPartialFinishCredit, applyLotFormatTolerance
} from "../lib/listing/evaluation/semantic-equivalence.mjs";

const COHORTS = [
  ["artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_pre_copyright"],
  ["artifacts/finish-alignment-105/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_effort_low"]
];

const cells = new Map();
let cards = 0;
for (const [path, arm] of COHORTS) {
  const rows = readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.arm === arm && r.reference && r.raw_title);
  for (const row of rows) {
    cards++;
    const { fields } = parseCanonicalFields(row.raw_title);
    const composed = composeFromCanonicalFields(fields);
    const view = buildCsmResolutionView({ fields, composed });
    // Through the full adjudicated layer, not equivalenceTokens alone. A first
    // version compared bracket tokens to the raw reference and reported the lot
    // bracket at 0% -- we render Lot*4 and the writer writes lotx4, which the
    // lot-format tolerance already forgives at title level. A projection that
    // disagrees with the scorer it reports alongside is measuring itself.
    const rawGot = equivalenceTokens(composed.title);
    const exempt = applyUnobtainableFacts(equivalenceTokens(row.reference), row.reference, rawGot);
    const got = applyLotFormatTolerance(exempt.wanted,
      applyHypernymRedundancy(exempt.wanted, exempt.got), row.reference);
    const want = applyPartialFinishCredit(exempt.wanted, got);
    // Tokens the tolerances removed from OUR side are ones the scorer decided
    // not to charge -- a redundant hypernym, a lot marker, a component the
    // writer declined to publish. They are forgiven, not agreed, and must not
    // be counted as either a hit or a miss.
    const forgiven = new Set([...rawGot].filter((t) => !got.has(t)));

    for (const bracket of view.brackets) {
      const key = `${view.grammar.raw}|${bracket.bracket}`;
      const cell = cells.get(key) || {
        grammar: view.grammar.raw, bracket: bracket.bracket, n: 0,
        value_agreed: 0, value_absent_from_title: 0, unpublished: 0,
        empty_but_writer_has_it: 0, absent_agreed: 0, insufficient_evidence: 0
      };
      cell.n++;
      const suppressed = bracket.composer_disposition === "SUPPRESSED_BY_PROFILE";
      if (bracket.state === "VALUE") {
        const ours = equivalenceTokens(bracket.value);
        // Did the WRITER publish what we asserted. Comparing against our own
        // token set instead would be asking whether we said what we said, and
        // an earlier version of this line did exactly that and reported every
        // bracket at 100%.
        const chargeable = [...ours].filter((t) => !forgiven.has(t));
        const agreed = ours.size && chargeable.every((t) => want.has(t));
        if (agreed) cell.value_agreed++;
        else if (suppressed) cell.unpublished++;   // policy, not error
        else cell.value_absent_from_title++;
      } else if (bracket.state === "INSUFFICIENT_EVIDENCE") {
        cell.insufficient_evidence++;
      } else {
        // We said the card has nothing here. Did the writer publish something
        // this bracket would have carried? Only checkable for brackets whose
        // vocabulary is closed enough to test.
        cell.absent_agreed++;
      }
      cells.set(key, cell);
    }
  }
}

const rank = [...cells.values()]
  .map((c) => ({
    ...c,
    // Of the times we asserted a value the writer could have published, how
    // often did they publish it.
    agreement: (c.value_agreed + c.value_absent_from_title)
      ? c.value_agreed / (c.value_agreed + c.value_absent_from_title) : null
  }))
  .filter((c) => c.value_agreed + c.value_absent_from_title >= 5)
  .sort((a, b) => a.agreement - b.agreement);

console.log(`来源: TITLE_DERIVED（写手确认标题，非字段评审）   卡数 ${cards}\n`);
console.log("grammar  bracket".padEnd(34) + "断言n   一致    未命中  档位压制  看不清");
for (const c of rank) {
  console.log(`${c.grammar.padEnd(9)}${c.bracket.padEnd(25)}`
    + String(c.value_agreed + c.value_absent_from_title).padStart(5)
    + `  ${(c.agreement * 100).toFixed(0).padStart(4)}%`
    + String(c.value_absent_from_title).padStart(8)
    + String(c.unpublished).padStart(9)
    + String(c.insufficient_evidence).padStart(8));
}
console.log(`\n这张表看不见的两件事，需要真正的字段评审才能回答：`);
console.log(`  1. 事实对但放错 bracket —— token 两边都匹配，投影分不出来`);
console.log(`  2. 写手不发布的字段（卡号、被压制的球队）—— 这里记为「档位压制」而非错误`);
