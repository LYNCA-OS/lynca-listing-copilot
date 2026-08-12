// Read-only validator for the future durable Lot terminal receipt. It contains
// no Composer or persistence entry point, so adding it cannot produce v3 rows.

export const LOT_PUBLICATION_FAILURE = Object.freeze({
  QUANTITY_UNRESOLVED: "LOT_QUANTITY_UNRESOLVED",
  SINGLE_CARD: "LOT_SINGLE_CARD"
});

export const LOT_COUNT_MAX = 9999;
export const LOT_COUNT_TEXT_PATTERN = /^(?:[1-9]|[1-9]\d{1,2}|[1-9]\d{3})$/;

export function canonicalLotCountText(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return LOT_COUNT_TEXT_PATTERN.test(text) && Number(text) <= LOT_COUNT_MAX ? text : "";
}

export const LOT_TERMINAL_KEYS = Object.freeze([
  "failure_code", "lot_quantity_unresolved", "lot_single_card",
  "lot_unshared_attributes", "publishable"
]);

export const LOT_UNSHARED_ATTRIBUTE_FIELDS = Object.freeze([
  "card_name", "card_number", "components", "descriptive_rarity", "grade",
  "manufacturer", "parallel_exact", "parallel_family", "print_finish",
  "product", "release_variant", "serial", "set", "surface_color", "team",
  "year"
]);

export function lotPublicationFailureCode({ quantityUnresolved, singleCard } = {}) {
  return quantityUnresolved
    ? LOT_PUBLICATION_FAILURE.QUANTITY_UNRESOLVED
    : singleCard ? LOT_PUBLICATION_FAILURE.SINGLE_CARD : null;
}

export function validateLotTerminalReceipt(receipt, { lotCount } = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(LOT_TERMINAL_KEYS)
      || typeof receipt.lot_quantity_unresolved !== "boolean"
      || typeof receipt.lot_single_card !== "boolean"
      || typeof receipt.publishable !== "boolean"
      || !Array.isArray(receipt.lot_unshared_attributes)
      || (receipt.failure_code !== null && typeof receipt.failure_code !== "string")) {
    throw new TypeError("lot_terminal_receipt_shape_invalid");
  }
  const allowed = new Set(LOT_UNSHARED_ATTRIBUTE_FIELDS);
  const attributes = receipt.lot_unshared_attributes;
  if (attributes.some((field) => typeof field !== "string" || !allowed.has(field))
      || new Set(attributes).size !== attributes.length
      || JSON.stringify([...attributes].sort()) !== JSON.stringify(attributes)) {
    throw new TypeError("lot_terminal_unshared_attributes_invalid");
  }
  const count = canonicalLotCountText(lotCount);
  const quantityUnresolved = !count;
  const singleCard = count === "1";
  const failureCode = lotPublicationFailureCode({ quantityUnresolved, singleCard });
  if (receipt.lot_quantity_unresolved !== quantityUnresolved
      || receipt.lot_single_card !== singleCard
      || receipt.publishable !== (failureCode == null)
      || receipt.failure_code !== failureCode) {
    throw new TypeError("lot_terminal_receipt_state_invalid");
  }
  return receipt;
}
