import { createHash } from "node:crypto";

import { semTcgIpLabel } from "../csm/sem-definition.mjs";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const CAPTURED_E1AE_FINISH_TAXONOMY_SHA256 =
  "585b74b83e95fa77066fff51b1bc7b921ab14b925ba3dcc5502c5bb19ab5bf1c";
export const CAPTURED_E1AE_FINISH_TAXONOMY = deepFreeze({
  families: {
    topps: ["refractor", "xfractor", "raywave", "superfractor", "sapphire", "pulsar"],
    panini: ["prizm", "hyper", "lucky", "shock", "cracked ice", "disco", "velocity", "scope"],
    pokemon: ["master ball reverse holo", "poke ball reverse holo"],
    "yu-gi-oh!": ["ghost rare", "starlight rare", "collector rare"]
  },
  domain_neutral: [
    "holo", "reverse holo", "foil", "wave", "shimmer", "sparkle",
    "geometric", "mojo", "prismatic", "marble", "lucky"
  ]
});

if (createHash("sha256").update(JSON.stringify(CAPTURED_E1AE_FINISH_TAXONOMY))
  .digest("hex") !== CAPTURED_E1AE_FINISH_TAXONOMY_SHA256) {
  throw new Error("captured_e1ae_finish_taxonomy_hash_mismatch");
}

const fold = (value) => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();

export function capturedE1aeProductFamilyFor(fields = {}) {
  const ip = fold(semTcgIpLabel({
    manufacturer: fields.manufacturer,
    product: fields.product,
    set: fields.set || fields.product,
    card_name: fields.card_name,
    ip: fields.ip
  }));
  if (ip && ip in CAPTURED_E1AE_FINISH_TAXONOMY.families) return ip;
  if (ip) return ip;
  const text = fold([
    fields.manufacturer, fields.product, fields.set, fields.ip
  ].filter(Boolean).join(" "));
  if (!text) return "";
  for (const family of Object.keys(CAPTURED_E1AE_FINISH_TAXONOMY.families)) {
    if (new RegExp(`(?:^|\\s)${family}(?:\\s|$)`).test(text)) return family;
  }
  return "";
}

export function capturedE1aeFamilyClaiming(term) {
  const text = fold(term);
  if (!text || CAPTURED_E1AE_FINISH_TAXONOMY.domain_neutral.some(
    (neutral) => text.includes(neutral)
  )) return "";
  for (const [family, terms] of Object.entries(CAPTURED_E1AE_FINISH_TAXONOMY.families)) {
    if (terms.some((claimed) => text.includes(claimed))) return family;
  }
  return "";
}

export function capturedE1aeFinishRecognitionForProduct(term, fields = {}) {
  const claiming = capturedE1aeFamilyClaiming(term);
  if (!claiming) return "UNVERIFIED";
  const family = capturedE1aeProductFamilyFor(fields);
  if (!family) return "UNVERIFIED";
  return family === claiming ? "RECOGNIZED" : "FOREIGN";
}
