import assert from "node:assert/strict";
import { collectEbayImageCandidates, formatCollectionSummary } from "./collect-ebay-image-candidates.mjs";

const skipped = await collectEbayImageCandidates({
  env: {},
  providerImpl: {
    configured: false,
    search: async () => {
      throw new Error("should not search without credentials");
    }
  },
  now: () => new Date("2026-06-22T13:30:00.000Z")
});

assert.equal(skipped.status, "skipped");
assert.equal(skipped.collected_count, 0);
assert.match(skipped.blocked_reason, /EBAY_CLIENT_ID/);

const searchedQueries = [];
const report = await collectEbayImageCandidates({
  targetCount: 3,
  queries: ["test cards"],
  perQueryLimit: 2,
  maxPagesPerQuery: 3,
  providerImpl: {
    configured: true,
    search: async ({ query }) => {
      searchedQueries.push(query);
      if (query.offset === 0) {
        return {
          provider_id: "ebay_browse",
          unavailable: false,
          marketplace_id: "EBAY_US",
          more_results_available: true,
          candidates: [
            {
              source_url: "https://www.ebay.com/itm/1",
              title: "Seller says perfect rookie card",
              fields: {
                marketplace_item_id: "itm-1",
                marketplace_id: "EBAY_US",
                marketplace_image_url: "https://i.ebayimg.com/images/1.jpg",
                marketplace_image_urls: ["https://i.ebayimg.com/images/1.jpg"]
              }
            },
            {
              source_url: "https://www.ebay.com/itm/2",
              title: "No image candidate",
              fields: {
                marketplace_item_id: "itm-2"
              }
            }
          ]
        };
      }

      return {
        provider_id: "ebay_browse",
        unavailable: false,
        marketplace_id: "EBAY_US",
        more_results_available: false,
        candidates: [
          {
            source_url: "https://www.ebay.com/itm/1",
            title: "Duplicate item",
            fields: {
              marketplace_item_id: "itm-1",
              marketplace_id: "EBAY_US",
              marketplace_image_url: "https://i.ebayimg.com/images/1-duplicate.jpg"
            }
          },
          {
            source_url: "https://www.ebay.com/itm/3",
            title: "Third card",
            fields: {
              marketplace_item_id: "itm-3",
              marketplace_id: "EBAY_US",
              marketplace_image_url: "https://i.ebayimg.com/images/3.jpg",
              marketplace_image_urls: [
                "https://i.ebayimg.com/images/3.jpg",
                "https://i.ebayimg.com/images/3-back.jpg",
                "http://not-secure.example/ignored.jpg"
              ]
            }
          },
          {
            source_url: "https://www.ebay.com/itm/4",
            title: "Fourth card",
            fields: {
              marketplace_item_id: "itm-4",
              marketplace_id: "EBAY_US",
              marketplace_image_url: "https://i.ebayimg.com/images/4.jpg"
            }
          }
        ]
      };
    }
  },
  now: () => new Date("2026-06-22T13:31:00.000Z")
});

assert.equal(report.status, "collected");
assert.equal(report.target_count, 3);
assert.equal(report.collected_count, 3);
assert.equal(report.items.length, 3);
assert.equal(searchedQueries.length, 2);
assert.deepEqual(report.items.map((item) => item.marketplace_item_id), ["itm-1", "itm-3", "itm-4"]);
assert.equal(report.items[0].seller_title_is_ground_truth, false);
assert.equal(report.items[0].ground_truth_status, "unlabeled");
assert.equal(report.items[0].accuracy_eval_eligible, false);
assert.equal(report.items[0].required_next_step, "operator_or_official_ground_truth_labeling");
assert.deepEqual(report.items[1].image_urls, [
  "https://i.ebayimg.com/images/3.jpg",
  "https://i.ebayimg.com/images/3-back.jpg"
]);

const summary = formatCollectionSummary(report);
assert.match(summary, /eBay image candidate collection collected/);
assert.match(summary, /collected_count: 3/);
assert.match(summary, /accuracy_eval_eligible: false/);
assert.match(summary, /seller titles are market reference only/);

console.log("eBay image candidate collection tests passed");
