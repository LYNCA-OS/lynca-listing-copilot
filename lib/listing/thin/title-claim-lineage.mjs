// Which canonical claim produced which span of the title.
//
// The evaluation ruler scores claims, not tokens, and it needs to know for each
// piece of the emitted title WHICH canonical claim it came from. Matching by
// field name alone is not sufficient and the cohort shows why: in the
// bare/canonical ledger the token `1st` is attributed to `card_name`,
// `descriptive_rarity` AND `search_optimization` on the same card, `signature`
// to both `set` and `card_name`, `fleer` to both `manufacturer` and `product`.
// A title containing `1st` cannot be traced to a claim by its name, and
// `title_policy` is decided PER CLAIM -- get the ownership wrong and the
// publication verdict is wrong.
//
// The good news is that nothing has to be inferred. The composer already builds
// the title as an ordered list of `{ bracket, text }` and joins it with single
// spaces, so spans are ARITHMETIC, not a search. That matters precisely where a
// search would fail: 16 of 148 composed titles repeat a word ("Panini Prizm
// ... Prizm Mojo"), and `indexOf` would attribute both occurrences to the first
// bracket. Accumulating lengths attributes them correctly by construction.
//
// What this does not do is invent a concept vocabulary. Whether `Auto` and
// `Autograph` are the same concept is a CSM question (COS-43), not something
// this layer may decide. It reports the field and the canonical value it came
// from; resolving those to concepts is the registry's job.

/**
 * Which canonical fields feed each bracket, mirroring `renderBracket`.
 *
 * The values are read from the canonical object rather than parsed back out of
 * the rendered text, because rendering is lossy in both directions: it adds
 * ("#" before a card number, "Card Lot" around a count) and it removes (category
 * filler, a prefix already used by an earlier bracket).
 */
function sourceClaims(bracket, fields) {
  const claim = (field) => {
    const value = fields[field];
    const text = Array.isArray(value) ? value.join(" ") : String(value ?? "").trim();
    return text ? [{ field, value: text }] : [];
  };
  switch (bracket) {
    case "lot":
      return claim("lot_count");
    case "manufacturer_product":
      return [...claim("manufacturer"), ...claim("product")];
    // One claim per subject: three players on a card are three facts, and a
    // single joined claim could not be individually REQUIRED or FORBIDDEN.
    case "subject":
      return (fields.subjects || []).filter(Boolean).map((value) => ({ field: "subjects", value }));
    case "card_number":
      return claim("card_number");
    case "numerical_rarity":
      return claim("serial");
    case "grading_info":
      return claim("grade");
    case "observable_components":
      return (fields.components || []).filter(Boolean).map((value) => ({ field: "components", value }));
    // The team and the components share one bracket in SEM, so both are cited.
    case "search_optimization":
      return [...claim("team"), ...(fields.components || []).filter(Boolean)
        .map((value) => ({ field: "components", value }))];
    // [Print Finish] is a ladder over three layers. The claim is whichever layer
    // actually produced the value -- citing all three would make a title that
    // says "Refractor" look like it asserted a colour it never emitted.
    case "print_finish": {
      if (String(fields.parallel_exact || "").trim()) return claim("parallel_exact");
      const colour = String(fields.surface_color || "").trim();
      const family = String(fields.parallel_family || "").trim();
      if (colour && family) return [...claim("surface_color"), ...claim("parallel_family")];
      return colour ? claim("surface_color") : claim("parallel_family");
    }
    default:
      return claim(bracket);
  }
}

const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);

/**
 * Title spans with the canonical claims that produced them.
 *
 * @param fields the canonical object the composer was given
 * @param composed the composer's return value
 * @returns { claims, title, verified, problems }
 */
export function buildTitleClaims(fields, composed) {
  const entries = composed.bracket_text || [];
  const title = composed.title || "";
  const claims = [];
  let cursor = 0;

  // The composer records its own rewrites as `field:reason`, and they are the
  // difference between a claim we cannot trace and one we can.
  //
  // On 15 of 150 cards the canonical card_name is "Autograph" and the title
  // says "Auto" -- underivable by surface form, and it would stay underivable
  // until CSM ships a concept registry (COS-43) that knows the two are one
  // concept. But the composer applied that rewrite itself and logged
  // `card_name:autograph_to_auto`, so the derivation is already evidenced
  // locally and needs no ontology at all.
  //
  // This matters for scoping COS-43: the registry is required for synonyms the
  // MODEL chose, not for the ones the composer applied. Citing the recorded
  // step is honest; silently accepting any mismatch would not be, so it is
  // flagged separately rather than folded into a surface match.
  const rewrites = new Map();
  for (const reason of composed.normalization_reasons || []) {
    const [field, ...rest] = String(reason).split(":");
    if (!rest.length) continue;
    if (!rewrites.has(field)) rewrites.set(field, []);
    rewrites.get(field).push(rest.join(":"));
  }

  for (const entry of entries) {
    const start = cursor;
    const end = start + entry.text.length;
    cursor = end + 1; // the single space the composer joins with
    const sources = sourceClaims(entry.bracket, fields);
    // The rendered text is not always the canonical value: filler stripping and
    // prefix de-duplication remove words, and some brackets add them. Recording
    // both is what makes the link auditable rather than assumed.
    const emitted = normalize(entry.text);
    const offered = new Set(sources.flatMap((source) => normalize(source.value)));
    const rewrittenBy = rewrites.get(entry.bracket) || [];
    const surfaceDerivable = emitted.every((word) => offered.has(word) || word === "card" || word === "lot");
    claims.push({
      bracket: entry.bracket,
      text: entry.text,
      span: [start, Math.min(end, title.length)],
      sources,
      // Every word in the title came from a canonical value on THIS card,
      // either verbatim or through a rewrite the composer recorded. A false
      // here is the composer emitting something the canonical object does not
      // contain and cannot account for -- exactly what the ruler must never
      // score as a supported claim.
      derivable: surfaceDerivable || rewrittenBy.length > 0,
      // Kept apart from the surface match so a reviewer can see WHY a claim is
      // considered derivable. Collapsing the two would let any recorded
      // normalization launder an unrelated mismatch.
      derived_via: surfaceDerivable ? "verbatim" : rewrittenBy.length ? "composer_normalization" : null,
      normalizations: rewrittenBy,
      // Words the canonical value carried that this bracket did not emit.
      withheld_words: [...offered].filter((word) => !emitted.includes(word)),
      truncated: end > title.length
    });
  }

  const problems = [];
  for (const item of claims) {
    // The span must literally be the text. If the composer ever stops joining
    // with single spaces, or a transform runs after assembly, this catches it
    // rather than letting every downstream claim be silently misaligned.
    const slice = title.slice(item.span[0], item.span[1]);
    if (!item.truncated && slice !== item.text) {
      problems.push({ kind: "span_mismatch", bracket: item.bracket, expected: item.text, found: slice });
    }
    if (!item.sources.length) problems.push({ kind: "no_source_claim", bracket: item.bracket, text: item.text });
    if (!item.derivable) {
      problems.push({ kind: "not_derivable_from_canonical", bracket: item.bracket, text: item.text });
    }
  }

  return { claims, title, verified: problems.length === 0, problems };
}

/**
 * Every canonical field carrying a value, and whether the title emitted it.
 *
 * Ownership answers "where did this title span come from"; this answers the
 * other direction -- "what did the canonical object know that never reached the
 * title" -- which is what separates a Composer loss from a recognition loss.
 */
export function canonicalClaimCoverage(fields, composed) {
  const emitted = new Map();
  for (const item of buildTitleClaims(fields, composed).claims) {
    for (const source of item.sources) {
      if (!emitted.has(source.field)) emitted.set(source.field, new Set());
      emitted.get(source.field).add(source.value);
    }
  }
  const coverage = [];
  for (const [field, value] of Object.entries(fields)) {
    if (["grammar", "unreadable", "low_confidence", "attributes", "withheld_finish_terms",
      "observed_surface_color", "observed_parallel_family"].includes(field)) continue;
    const values = Array.isArray(value) ? value.filter(Boolean) : (String(value ?? "").trim() ? [String(value).trim()] : []);
    for (const one of values) {
      coverage.push({ field, value: one, in_title: emitted.get(field)?.has(one) ?? false });
    }
  }
  return coverage;
}
