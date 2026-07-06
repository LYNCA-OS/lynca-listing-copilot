function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function buildV4WriterDraft(result = {}) {
  const finalTitle = normalizeTitle(result.final_title || result.rendered_title || result.title);
  const confidence = String(result.confidence || "").toUpperCase();
  const failed = confidence === "FAILED" || !finalTitle;
  return {
    title: failed ? "" : finalTitle,
    display_title: failed ? "标题暂不可用" : finalTitle,
    status: failed ? "FAILED" : "WRITER_REVIEW",
    confidence_score: failed ? 0 : Number(result.confidence_score || result.identity_confidence || 0.72) || 0.72,
    actions: ["ACCEPT", "EDIT", "REJECT"],
    user_edit_mode: "one_line_title_only",
    structured_fields_visible: false
  };
}
