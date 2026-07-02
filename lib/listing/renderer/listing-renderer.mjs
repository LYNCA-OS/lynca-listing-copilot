import { normalizeResolvedFields, serialNumeratorDirectProvenance } from "../evidence/evidence-schema.mjs";
import { renderGenericTitle } from "./generic-title-renderer.mjs";
import { moduleOrder, renderListingModules, rendererVersion } from "./module-renderer.mjs";
import { renderPokemonTitle } from "./pokemon-title-renderer.mjs";
import { renderSportsTitle } from "./sports-title-renderer.mjs";
import { normalizeComparable, serialDenominatorOnlyText } from "./title-cleanup.mjs";

function looksLikeTcg(resolved = {}) {
  const text = normalizeComparable([
    resolved.category,
    resolved.brand,
    resolved.manufacturer,
    resolved.product,
    resolved.set
  ].filter(Boolean).join(" "));
  return /\bpokemon\b|\bpokemon tcg\b|\bpokémon\b|\bone piece\b|\byu gi oh\b|\byugioh\b|\byu-gi-oh\b|\bdragon ball\b|\bdragonball\b|\btcg\b/.test(text);
}

function looksLikeSports(resolved = {}) {
  const text = normalizeComparable([
    resolved.category,
    resolved.brand,
    resolved.manufacturer,
    resolved.product,
    resolved.team
  ].filter(Boolean).join(" "));
  if (looksLikeTcg(resolved)) return false;
  if (!text) return true;
  return /sports?|nba|nfl|mlb|nhl|wnba|ufc|topps|panini|upper deck|bowman|donruss|prizm|select|flawless|immaculate|chrome/.test(text);
}

export function selectTitleRenderer(resolved = {}) {
  if (looksLikeTcg(resolved)) return "pokemon";
  if (looksLikeSports(resolved)) return "sports";
  return "generic";
}

export function renderResolvedTitle(resolved = {}, {
  maxLength = 85
} = {}) {
  const normalized = normalizeResolvedFields(resolved);
  const renderer = selectTitleRenderer(normalized);
  const result = renderer === "pokemon"
    ? renderPokemonTitle(normalized, { maxLength })
    : renderer === "sports"
      ? renderSportsTitle(normalized, { maxLength })
      : renderGenericTitle(normalized, { maxLength });

  return {
    renderer,
    rendered_title: result.title,
    title_length_policy: result.policy
  };
}

export function renderListingPresentation({
  resolved = {},
  evidence = {},
  maxLength = 85,
  serialNumeratorVerified = null
} = {}) {
  const normalized = normalizeResolvedFields(resolved);
  // The numerator identifies the physical copy. The resolver keeps it as an
  // entity field, while the title renders only the numerical rarity.
  const serialEvidence = evidence?.serial_number;
  const numeratorAllowed = serialNumeratorVerified === true
    || !serialEvidence
    || serialNumeratorDirectProvenance(serialEvidence);
  const presentationResolved = numeratorAllowed
    ? normalized
    : { ...normalized, serial_number: serialDenominatorOnlyText(normalized.serial_number) };
  const modules = renderListingModules({
    resolved: presentationResolved,
    evidence
  });
  const title = renderResolvedTitle(presentationResolved, { maxLength });

  return {
    renderer_version: rendererVersion,
    renderer: title.renderer,
    module_order: moduleOrder,
    modules,
    rendered_title: title.rendered_title,
    final_title: title.rendered_title,
    title_length_policy: title.title_length_policy
  };
}
