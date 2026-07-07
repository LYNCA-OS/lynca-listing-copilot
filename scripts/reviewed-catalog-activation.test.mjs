import assert from "node:assert/strict";
import {
  buildReviewedCatalogActivationReport,
  catalogCardActivationDecision,
  catalogGapPromotionReadiness
} from "../lib/listing/catalog/reviewed-catalog-activation.mjs";
import {
  activateReviewedCatalogForPrompt
} from "./activate-reviewed-catalog-for-prompt.mjs";

const reviewedCard = {
  id: "card-reviewed-1",
  source_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
  review_status: "REVIEW_REQUIRED",
  metadata: {
    prompt_safe_internal_writer_title: true,
    title_derived_fields_are_ground_truth: false
  }
};
const decision = catalogCardActivationDecision(reviewedCard);
assert.equal(decision.eligible, true);
assert.equal(decision.needs_update, true);
assert.equal(decision.target_review_status, "REVIEWED_INTERNAL");

const marketplaceCard = {
  id: "card-marketplace-1",
  source_type: "MARKETPLACE_REFERENCE",
  source_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
  review_status: "REVIEW_REQUIRED",
  metadata: {
    prompt_safe_internal_writer_title: true,
    marketplace_title_used_as_truth: true
  }
};
assert.equal(catalogCardActivationDecision(marketplaceCard).eligible, false);

const aiOnlyGap = catalogGapPromotionReadiness({
  gap_id: "gap-ai-only",
  ai_draft_title: "AI guessed title",
  status: "PENDING",
  promotion_status: "pending"
});
assert.equal(aiOnlyGap.can_promote, false);
assert.equal(aiOnlyGap.reason, "writer_review_missing_ai_draft_only");
assert.equal(aiOnlyGap.ai_draft_used_as_truth, false);

const writerGap = catalogGapPromotionReadiness({
  gap_id: "gap-writer",
  ai_draft_title: "AI guessed title",
  writer_final_title: "Writer confirmed title",
  writer_confirmed_fields: { year: "2025", product: "Topps Chrome" },
  status: "PENDING",
  promotion_status: "pending"
});
assert.equal(writerGap.can_promote, true);
assert.equal(writerGap.promotion_title, "Writer confirmed title");
assert.equal(writerGap.writer_confirmed_field_count, 2);

const supersededGap = catalogGapPromotionReadiness({
  gap_id: "gap-superseded",
  ai_draft_title: "AI old title",
  writer_final_title: "Writer corrected title",
  status: "promoted",
  promotion_status: "promoted",
  metadata: {
    ai_draft_title_at_promotion: "AI old title"
  }
});
assert.equal(supersededGap.can_promote, true);
assert.equal(supersededGap.supersedes_previous_promotion, true);
assert.equal(supersededGap.previous_promotion_title, "AI old title");
assert.equal(supersededGap.reason, "writer_final_title_supersedes_previous_promotion");

const report = buildReviewedCatalogActivationReport({
  catalogCards: [reviewedCard, marketplaceCard],
  gapRows: [
    { gap_id: "gap-ai-only", ai_draft_title: "AI guessed title" },
    { gap_id: "gap-writer", writer_final_title: "Writer confirmed title" },
    {
      gap_id: "gap-superseded",
      ai_draft_title: "AI old title",
      writer_final_title: "Writer corrected title",
      status: "promoted",
      promotion_status: "promoted",
      metadata: { ai_draft_title_at_promotion: "AI old title" }
    }
  ],
  now: new Date("2026-07-07T00:00:00.000Z")
});
assert.equal(report.catalog.eligible_count, 1);
assert.equal(report.catalog.needs_update_count, 1);
assert.equal(report.gaps.promotable_count, 2);
assert.equal(report.gaps.ai_draft_only_blocked_count, 1);
assert.equal(report.gaps.writer_supersede_count, 1);

const calls = [];
const fetchImpl = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  const parsed = new URL(String(url));
  if (parsed.pathname.endsWith("/catalog_cards") && options.method === "PATCH") {
    assert.match(parsed.search, /metadata-%3E%3Eprompt_safe_internal_writer_title|metadata->>prompt_safe_internal_writer_title/);
    assert.equal(JSON.parse(options.body).review_status, "REVIEWED_INTERNAL");
    return new Response(null, { status: 204 });
  }
  if (parsed.pathname.endsWith("/catalog_cards")) {
    const afterPatch = calls.some((call) => call.options.method === "PATCH");
    return new Response(JSON.stringify(afterPatch ? [] : [reviewedCard]), { status: 200 });
  }
  if (parsed.pathname.endsWith("/catalog_gap_queue")) {
    return new Response(JSON.stringify([
      { gap_id: "gap-ai-only", ai_draft_title: "AI guessed title" },
      { gap_id: "gap-writer", writer_final_title: "Writer confirmed title" }
    ]), { status: 200 });
  }
  return new Response("not found", { status: 404 });
};

const activation = await activateReviewedCatalogForPrompt({
  argv: ["--apply", "--no-env-file", "--out", "/tmp/lynca-reviewed-catalog-activation-test.json"],
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  fetchImpl,
  now: new Date("2026-07-07T00:00:00.000Z")
});
assert.equal(activation.applied, true);
assert.equal(activation.before.catalog_needs_update_count, 1);
assert.equal(calls.some((call) => call.options.method === "PATCH"), true);

console.log("reviewed catalog activation tests passed");
