#!/usr/bin/env node
import assert from "node:assert";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  admitFinishVocabulary, isBaseAppearanceColour, isNonNamingFinishFamily
} from "../lib/listing/thin/finish-vocabulary-admission.mjs";
import {
  APPROVED_PRINT_FINISH_CLAIMS,
  familiesClaiming,
  familyClaiming,
  finishRecognitionForProduct,
  PRINT_FINISH_REGISTRY_RELEASE,
  productFamilyFor
} from "../csm/registry/print-finish-taxonomy.mjs";

const deepFrozen = (value) => !value || typeof value !== "object"
  || (Object.isFrozen(value) && Object.values(value).every(deepFrozen));

// The production taxonomy consumes one immutable, reviewed release. The
// receipt is executable: source drift or a changed review count fails release.
{
  const release = PRINT_FINISH_REGISTRY_RELEASE;
  assert.equal(release.status, "FROZEN_APPROVED");
  assert.equal(release.authority.decision_id, "COS-39");
  assert.equal(release.authority.approval, "GOVERNED_REVIEW_APPROVED");
  assert.equal(release.authority.completion_authorization, "COS_COMPLETION_AUTHORIZED_2026_08_12");
  assert.equal(release.review_receipt.status, "APPROVED");
  assert.equal(release.review_receipt.reviewed_by_role, "PAI");
  assert.equal(release.review_receipt.linear_comment_id, "2160874a-fd2b-4eaa-90ea-6cf60764791b");
  assert.ok(deepFrozen(release), "the active Registry release is recursively immutable");
  assert.deepEqual(APPROVED_PRINT_FINISH_CLAIMS.map(({ term, product_family }) => (
    [term, product_family]
  )), [["refractor", "topps"]], "only governed claims receive rejection authority");

  const sourceUrl = new URL(`../${release.source_receipt.path}`, import.meta.url);
  const sourceBody = await readFile(sourceUrl, "utf8");
  const source = JSON.parse(sourceBody);
  assert.equal(createHash("sha256").update(sourceBody).digest("hex"), release.source_receipt.sha256);
  assert.equal(source.item_count, release.source_receipt.source_item_count);
  assert.equal(source.source, release.source_receipt.source_description);

  const wholeRefractor = /(?:^|[^a-z0-9])refractor(?=$|[^a-z0-9])/i;
  const reviewed = source.items.filter((item) => wholeRefractor.test(item.source_titles?.corrected_title || ""));
  const outsideOwner = reviewed.filter((item) => (
    !/(?:^|[^a-z0-9])(?:topps|bowman)(?=$|[^a-z0-9])/i.test(item.source_titles.corrected_title)
  ));
  assert.equal(reviewed.length, release.review_receipt.matching_reviewed_titles);
  assert.equal(outsideOwner.length, release.review_receipt.matching_titles_outside_owner_family);
}

// Exact boundaries and owner priority: a governed owner term wins even when a
// neutral-looking word is beside it, while substrings never acquire authority.
{
  assert.equal(familyClaiming("Holo Refractor"), "topps");
  for (const unknown of ["Superfractor", "AntiRefractor", "Scope", "Kaleidoscope", "Pulsar", "Lucky"]) {
    assert.equal(familyClaiming(unknown), "", `${unknown} has no governed owner claim`);
  }
  assert.equal(finishRecognitionForProduct("Gold Refractor", {
    manufacturer: "Topps", product: "Chrome"
  }), "RECOGNIZED");
  assert.equal(finishRecognitionForProduct("Gold Refractor", {
    manufacturer: "Panini", product: "Prizm"
  }), "FOREIGN");
  assert.equal(finishRecognitionForProduct("Gold Refractor", {
    manufacturer: "Pokémon", product: "Mega Brave"
  }), "FOREIGN");
  assert.equal(finishRecognitionForProduct("Gold Refractor", {}), "UNVERIFIED");
}

// Ambiguous product or claim ownership abstains. A future bad release cannot
// turn object iteration order into a rejection decision.
{
  assert.equal(productFamilyFor({ manufacturer: "Topps Panini" }), "");
  assert.equal(productFamilyFor({ manufacturer: "Topps", product: "Pokémon" }), "");
  assert.equal(finishRecognitionForProduct("Refractor", {
    manufacturer: "Topps Panini"
  }), "UNVERIFIED");
  assert.equal(finishRecognitionForProduct("Refractor", {
    manufacturer: "Topps", product: "Pokémon"
  }), "UNVERIFIED");
  const conflicting = [
    { term: "holo", product_family: "pokemon", status: "ACTIVE" },
    { term: "holo", product_family: "panini", status: "ACTIVE" }
  ];
  assert.deepEqual(familiesClaiming("Holo", conflicting), ["panini", "pokemon"]);
  assert.equal(familyClaiming("Holo", conflicting), "");
}

// Terms removed from the ungoverned seed table are admitted unchanged. In
// particular, `scope` must not reject `Kaleidoscope` through substring match.
for (const term of ["Pulsar", "Lucky", "Scope", "Kaleidoscope"]) {
  const out = admitFinishVocabulary({
    manufacturer: "Topps", product: "Chrome", parallel_exact: term, print_finish: term
  });
  assert.equal(out.parallel_exact, term);
  assert.deepEqual(out.withheld, []);
}

// An adjacent neutral term does not hide the governed owner claim.
{
  const out = admitFinishVocabulary({
    manufacturer: "Pokémon", product: "Mega Brave",
    parallel_exact: "Holo Refractor", print_finish: "Holo Refractor"
  });
  assert.equal(out.print_finish, "");
  assert.equal(out.withheld[0].reason, "FINISH_NOT_MARKET_RECOGNIZED_FOR_PRODUCT");
}

// A printed name is never touched: it is the one rung of the ladder that is an
// observation rather than an inference, at 0.750 token precision against 0.313.
{
  const out = admitFinishVocabulary({
    parallel_exact: "Rainbow Foil", surface_color: "Rainbow", parallel_family: "Foil"
  });
  assert.equal(out.parallel_exact, "Rainbow Foil");
  assert.equal(out.surface_color, "Rainbow");
  assert.deepEqual(out.withheld, []);
}

// Base appearance withheld, family survives: "Rainbow Refractor" -> "Refractor".
{
  const out = admitFinishVocabulary({ surface_color: "Rainbow", parallel_family: "Refractor" });
  assert.equal(out.surface_color, "");
  assert.equal(out.print_finish, "Refractor");
  assert.equal(out.withheld[0].reason, "BASE_APPEARANCE_NOT_PARALLEL");
}

// Non-naming family withheld -- and that leaves the colour bare, which COS-49
// withholds in turn. "Red" is a real parallel colour, but with "Prismatic" gone
// nothing on the card or in the taxonomy names it as a finish by itself, so it
// stays Recognition evidence. Both rejections are recorded, so a Registry that
// later confirms either term can readmit it.
{
  const out = admitFinishVocabulary({ surface_color: "Red", parallel_family: "Prismatic" });
  assert.equal(out.parallel_family, "");
  assert.equal(out.surface_color, "");
  assert.equal(out.print_finish, "");
  assert.deepEqual(out.withheld.map((entry) => entry.reason), [
    "DESCRIBES_SURFACE_NOT_PARALLEL",
    "BARE_COLOUR_NOT_TAXONOMY_CONFIRMED"
  ]);
}

// COS-49's bare-colour rule, and the three ways out of it.
{
  const bare = admitFinishVocabulary({ surface_color: "Gold", parallel_family: "", print_finish: "Gold" });
  assert.equal(bare.print_finish, "", "a bare colour is evidence, not canonical Print Finish");
  assert.equal(bare.withheld[0].reason, "BARE_COLOUR_NOT_TAXONOMY_CONFIRMED");
  assert.equal(bare.withheld[0].value, "Gold", "the rejected term is preserved, so it is reversible");

  const named = admitFinishVocabulary({ surface_color: "Gold", parallel_exact: "Gold Vinyl" });
  assert.deepEqual(named.withheld, [], "a name printed on the card is explicit and never touched");

  const withFamily = admitFinishVocabulary({ surface_color: "Gold", parallel_family: "Refractor" });
  assert.deepEqual(withFamily.withheld, [], "colour + family is not a bare colour");

  const confirmed = admitFinishVocabulary(
    { surface_color: "Gold", parallel_family: "", print_finish: "Gold" },
    { taxonomyConfirmsColour: (colour) => colour === "Gold" }
  );
  assert.equal(confirmed.print_finish, "Gold", "verified taxonomy admits the colour alone");
  assert.deepEqual(confirmed.withheld, []);
}

// A real parallel colour with a real family is untouched.
{
  const out = admitFinishVocabulary({ surface_color: "Gold", parallel_family: "Refractor" });
  assert.equal(out.print_finish, undefined, "unchanged input keeps its own print_finish");
  assert.deepEqual(out.withheld, []);
}

// `purple` and `green` measured poorly on this cohort (2/6 and 3/16) and a
// split-half fit picked them up on one side only. They are real parallel
// colours and must NOT be withheld -- that would be scoring the sample.
for (const colour of ["Purple", "Green", "Gold", "Blue", "Red", "Orange"]) {
  assert.equal(isBaseAppearanceColour(colour), false, `${colour} is a real parallel colour`);
}
assert.ok(isBaseAppearanceColour("rainbow") && isBaseAppearanceColour("Silver"));
assert.ok(isNonNamingFinishFamily("Cracked Ice") && isNonNamingFinishFamily("foil"));
assert.equal(isNonNamingFinishFamily("Refractor"), false);
assert.equal(isNonNamingFinishFamily("Prizm"), false);

// Both layers withheld leaves nothing to claim rather than a partial guess.
{
  const out = admitFinishVocabulary({ surface_color: "Silver", parallel_family: "Sparkle" });
  assert.equal(out.print_finish, "");
  assert.equal(out.withheld.length, 2);
}
console.log("finish-vocabulary-admission: ok");
