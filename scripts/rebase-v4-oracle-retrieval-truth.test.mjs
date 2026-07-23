import assert from "node:assert/strict";
import { rebaseV4OracleRetrievalTruth } from "./rebase-v4-oracle-retrieval-truth.mjs";

const original = {
  schema_version: "v1",
  items: [{ id: "a", fixed: true, retrieval_ground_truth: { accepted_candidate_ids: ["self"] } }]
};
const truth = {
  promotion_contract: { schema_version: "trusted-catalog-sem-promotion-v2" },
  items: [{
    item_id: "a",
    retrieval_ground_truth: {
      accepted_candidate_ids: [],
      sealed_source_candidate_ids: ["self"],
      retrieval_evaluable: false
    }
  }]
};

const rebased = rebaseV4OracleRetrievalTruth(original, truth);
assert.equal(rebased.items[0].fixed, true);
assert.deepEqual(rebased.items[0].retrieval_ground_truth.accepted_candidate_ids, []);
assert.deepEqual(rebased.items[0].retrieval_ground_truth.sealed_source_candidate_ids, ["self"]);
assert.equal(rebased.retrieval_truth_rebase.retrieval_evaluable_item_count, 0);
assert.equal(rebased.retrieval_truth_rebase.retrieval_ineligible_item_count, 1);
assert.throws(
  () => rebaseV4OracleRetrievalTruth({ items: [{ id: "missing" }] }, truth),
  /retrieval truth missing/
);

console.log("V4 Oracle retrieval truth rebase tests passed");
