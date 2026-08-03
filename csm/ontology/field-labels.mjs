function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fallbackLabel(field = "") {
  return cleanText(field)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean))];
}

export const csmFieldLabels = Object.freeze({
  year: "Year",
  season_year: "Season Year",
  product_year: "Product Year",
  copyright_year: "Copyright Year",
  slab_year: "Slab Year",
  event_year: "Event Year",
  display_year: "Display Year",
  brand: "Brand",
  manufacturer: "Manufacturer",
  product: "Product",
  product_or_set: "Product / Set",
  set: "Set",
  subset: "Subset",
  ip: "IP",
  language: "Language",
  subject: "Subject",
  subjects: "Subject",
  player: "Player",
  players: "Subject",
  character: "Subject",
  card_type: "Card Type",
  official_card_type: "Card Type",
  card_name: "Card Name",
  insert: "Card Name",
  release_variant: "Release Variant",
  design_variation: "Design Variation",
  variant: "Variant",
  variation: "Variant",
  product_finish: "Product Finish",
  print_finish: "Print Finish",
  surface_color: "Color",
  parallel_family: "Parallel Family",
  parallel_exact: "Exact Parallel",
  variant_or_parallel: "Variant / Parallel",
  parallel: "Parallel",
  descriptive_rarity: "Descriptive Rarity",
  numerical_rarity: "Numbered / Print Run / 数字限编",
  print_run_number: "Numbered / Print Run / 数字限编",
  print_run_numerator: "Print Run Numerator",
  print_run_denominator: "Numbered To",
  numbered_to: "Numbered To",
  serial_denominator: "Numbered To (Legacy)",
  serial_number: "Numbered / Print Run / 数字限编 (Legacy)",
  card_number: "Card Number",
  collector_number: "Card Number",
  checklist_code: "Checklist Code",
  grade_company: "Grade Company",
  card_grade: "Card Grade",
  auto_grade: "Auto Grade",
  grade_type: "Grade Type",
  grade: "Grade",
  rc: "RC",
  first_bowman: "1st Bowman",
  ssp: "SSP",
  case_hit: "Case Hit",
  auto: "Auto",
  patch: "Patch",
  relic: "Relic",
  sketch: "Sketch",
  redemption: "Redemption",
  special_stamp: "Special Stamp",
  search_optimization: "Search Optimization",
  team: "Team",
  teams: "Team",
  lot_quantity: "Lot Quantity",
  lot_type: "Lot Type",
  observable_components: "Visible Components",
  cert_number: "Cert Number",
  one_of_one: "1/1"
});

export function labelForCsmField(field, fallback = "") {
  const key = cleanText(field);
  if (!key && fallback) return cleanText(fallback);
  return csmFieldLabels[key] || fallbackLabel(fallback || key) || "Field";
}

export function labelsForCsmFields(fields = []) {
  return unique(fields).map((field) => labelForCsmField(field));
}
