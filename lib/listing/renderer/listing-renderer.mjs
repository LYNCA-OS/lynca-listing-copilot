import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { renderGenericTitle } from "./generic-title-renderer.mjs";
import { moduleOrder, renderListingModules, rendererVersion } from "./module-renderer.mjs";
import { renderPokemonTitle } from "./pokemon-title-renderer.mjs";
import { renderSportsTitle } from "./sports-title-renderer.mjs";
import { normalizeComparable } from "./title-cleanup.mjs";

function looksLikePokemon(resolved = {}) {
  const text = normalizeComparable([
    resolved.category,
    resolved.brand,
    resolved.manufacturer,
    resolved.product,
    resolved.set
  ].filter(Boolean).join(" "));
  return /\bpokemon\b|\bpokemon tcg\b|\bpokémon\b/.test(text);
}

function looksLikeSports(resolved = {}) {
  const text = normalizeComparable([
    resolved.category,
    resolved.brand,
    resolved.manufacturer,
    resolved.product,
    resolved.team
  ].filter(Boolean).join(" "));
  if (looksLikePokemon(resolved)) return false;
  if (!text) return true;
  return /sports?|nba|nfl|mlb|nhl|wnba|ufc|topps|panini|upper deck|bowman|donruss|prizm|select|flawless|immaculate|chrome/.test(text);
}

export function selectTitleRenderer(resolved = {}) {
  if (looksLikePokemon(resolved)) return "pokemon";
  if (looksLikeSports(resolved)) return "sports";
  return "generic";
}

export function renderResolvedTitle(resolved = {}, {
  maxLength = 80
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
  maxLength = 80
} = {}) {
  const normalized = normalizeResolvedFields(resolved);
  const modules = renderListingModules({
    resolved: normalized,
    evidence
  });
  const title = renderResolvedTitle(normalized, { maxLength });

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
