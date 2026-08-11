// Release-verifier-only facts for the frozen low-reasoning Standard source.
// This module is never imported by materialization or recognition runtime code.

export const PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT = Object.freeze({
  source_asset_id: "asset_6fb25b62-0498-8b3a-91a6-30ad4d62f5ef",
  expected_title:
    "2025-26 Topps Chrome Basketball Cooper Flagg Gold Refractor RC #251 50/50",
  expected_card_number: "251",
  rendered_card_number: "#251",
  expected_serial: "50/50"
});

const exactObject = (value) => Boolean(value)
  && typeof value === "object" && !Array.isArray(value);

export function standardP0TitleIdentityExact(title) {
  return String(title || "").trim()
    === PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title;
}

export function productionStandardP0ResolutionProof(resolutionView) {
  const brackets = Array.isArray(resolutionView?.brackets) ? resolutionView.brackets : [];
  const cardNumbers = brackets.filter((entry) => entry?.bracket === "card_number");
  const serials = brackets.filter((entry) => entry?.bracket === "numerical_rarity");
  const cardNumber = cardNumbers[0];
  const serial = serials[0];
  const cardNumberSelectedExact = cardNumbers.length === 1
    && cardNumber?.canonical_field === "card_number"
    && cardNumber?.value === PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_card_number
    && cardNumber?.selected_candidate
      === PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_card_number
    && cardNumber?.rendered_text
      === PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.rendered_card_number;
  const serialSelectedExact = serials.length === 1
    && serial?.canonical_field === "serial"
    && serial?.value === PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_serial
    && serial?.selected_candidate === PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_serial
    && serial?.rendered_text === PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_serial;
  return Object.freeze({
    card_number_selected_exact: cardNumberSelectedExact,
    serial_selected_exact: serialSelectedExact,
    selected_brackets_exact: cardNumberSelectedExact && serialSelectedExact,
    recomposed_title_exact: standardP0TitleIdentityExact(resolutionView?.composer?.title),
    stored_title_exact: standardP0TitleIdentityExact(resolutionView?.composer?.stored_title)
  });
}

export function productionStandardP0ResolutionProofValid(value) {
  return exactObject(value)
    && Object.keys(value).sort().join("\0") === [
      "card_number_selected_exact",
      "recomposed_title_exact",
      "selected_brackets_exact",
      "serial_selected_exact",
      "stored_title_exact"
    ].sort().join("\0")
    && Object.values(value).every((entry) => entry === true);
}

export function productionStandardP0EvidenceProofValid(value) {
  return exactObject(value)
    && Object.keys(value).sort().join("\0") === [
      "card_number_selected_exact",
      "recognition_title_exact",
      "recomposed_title_exact",
      "selected_brackets_exact",
      "serial_selected_exact",
      "stored_title_exact",
      "ui_title_exact"
    ].sort().join("\0")
    && Object.values(value).every((entry) => entry === true);
}
