import { classifyV4ResultOutcome } from "../result-outcome.mjs";

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function buildV4WriterDraft(result = {}) {
  const finalTitle = normalizeTitle(result.final_title || result.rendered_title || result.title);
  const outcome = classifyV4ResultOutcome(result);
  const failed = outcome.technical_failure;
  const reviewWithoutDraft = outcome.writer_review_required;
  return {
    title: failed || reviewWithoutDraft ? "" : finalTitle,
    display_title: failed
      ? "标题暂不可用"
      : reviewWithoutDraft
        ? "需要写手输入标题"
        : finalTitle,
    status: failed ? "FAILED" : "WRITER_REVIEW",
    confidence_score: failed || reviewWithoutDraft ? 0 : Number(result.confidence_score || result.identity_confidence || 0.72) || 0.72,
    actions: reviewWithoutDraft ? ["EDIT", "REJECT"] : ["ACCEPT", "EDIT", "REJECT"],
    writer_review_required: reviewWithoutDraft,
    user_edit_mode: "one_line_title_only",
    structured_fields_visible: false
  };
}
