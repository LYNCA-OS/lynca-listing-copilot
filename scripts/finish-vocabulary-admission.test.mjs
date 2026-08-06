#!/usr/bin/env node
import assert from "node:assert";
import {
  admitFinishVocabulary, isBaseAppearanceColour, isNonNamingFinishFamily
} from "../lib/listing/thin/finish-vocabulary-admission.mjs";

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
