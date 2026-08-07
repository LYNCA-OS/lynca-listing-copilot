// COS-53: which stored asset Recognition reads.
//
// The selector is given inputs whose answers are arithmetic, including the one
// the decision exists to prevent: a "downscale" that is LARGER than the
// original it came from (a 237KB webp re-encoded to 1600px JPEG produced
// 478KB). Resolution is not the rule; bytes are.
import assert from "node:assert/strict";

import { selectRecognitionImages } from "../lib/listing/storage/canonical-image-references.mjs";

const original = (slot, size) => ({
  image_id: `img_${slot}`,
  storageRole: slot === 0 ? "image_1_original" : "image_2_original",
  storage_role: slot === 0 ? "image_1_original" : "image_2_original",
  size,
  derived: false
});
const downscale = (sourceId, size, id = `${sourceId}_small`) => ({
  image_id: id,
  storageRole: "readability_derived",
  storage_role: "readability_derived",
  source_image_id: sourceId,
  size,
  derived: true
});

// Smaller derived image wins, and the run states what it read.
{
  const { images, read } = selectRecognitionImages([
    original(0, 7_444_587), downscale("img_0", 745_000)
  ]);
  assert.equal(images.length, 1);
  assert.equal(images[0].image_id, "img_0_small");
  assert.deepEqual(read, [{
    image_role: "front_original",
    read: "readability_derived",
    bytes: 745_000,
    original_bytes: 7_444_587,
    derived_available: true,
    derived_bytes: 745_000
  }]);
}

// The measured counter-case: derived exists and is BIGGER. Original is read,
// and "available but not used" is recorded distinctly from "absent".
{
  const { images, read } = selectRecognitionImages([
    original(0, 237_000), downscale("img_0", 478_000)
  ]);
  assert.equal(images[0].image_id, "img_0");
  assert.equal(read[0].read, "original");
  assert.equal(read[0].derived_available, true);
  assert.equal(read[0].derived_bytes, 478_000);
}

// Equal bytes is not smaller.
{
  const { images } = selectRecognitionImages([original(0, 500_000), downscale("img_0", 500_000)]);
  assert.equal(images[0].image_id, "img_0");
}

// A downscale of the OTHER original may not stand in for this one.
{
  const { images } = selectRecognitionImages([
    original(0, 9_000_000), original(1, 9_000_000), downscale("img_1", 800_000)
  ]);
  assert.deepEqual(images.map((image) => image.image_id), ["img_0", "img_1_small"]);
}

// A derived image with no source lineage is never selected: it cannot be shown
// to be a downscale OF anything.
{
  const orphan = downscale("", 100, "orphan");
  const { images, read } = selectRecognitionImages([original(0, 9_000_000), orphan]);
  assert.equal(images[0].image_id, "img_0");
  assert.equal(read[0].derived_available, false);
}

// A crop is not a recognition input, however small.
{
  const crop = {
    image_id: "crop_1", storageRole: "serial_crop", storage_role: "serial_crop",
    source_image_id: "img_0", size: 4_000, derived: true
  };
  const { images } = selectRecognitionImages([original(0, 9_000_000), crop]);
  assert.equal(images[0].image_id, "img_0");
}

// No originals in, no images out — the endpoint's own
// `canonical_original_image_missing` stays the guard, not this selector.
assert.deepEqual(selectRecognitionImages([]).images, []);
assert.deepEqual(selectRecognitionImages([downscale("img_0", 10)]).images, []);

// Originals stay the system of record: the selector never returns more images
// than there are originals, whatever derived assets exist.
{
  const { images } = selectRecognitionImages([
    original(0, 9_000_000),
    downscale("img_0", 800_000, "a"),
    downscale("img_0", 700_000, "b")
  ]);
  assert.equal(images.length, 1);
}

console.log("COS-53 recognition derived input tests passed");
