import assert from "node:assert/strict";
import {
  replayCandidateIdentityV1,
  replayLanguageObservationV1,
  replaySerialObservationV1,
  replaySerialObservationSingleDigitV1
} from "../lib/listing/thin/candidate-identity-replay-v1.mjs";

const fields = {
  manufacturer: "Topps", product: "Topps Chrome", set: "", subjects: ["Common Sense Cow"], card_name: "Common Sense Cow"
};
const recovered = replayCandidateIdentityV1(fields, [
  { value: "Topps Chrome", kind: "identity", basis: "exact_text", image: "image_1" },
  { value: "VeeFriends", kind: "affiliation", basis: "logo_or_symbol", image: "image_2" }
]);
assert.equal(recovered.fields.set, "VeeFriends");
assert.equal(fields.set, "");
assert.equal(recovered.changes.length, 1);

const noisy = replayCandidateIdentityV1(fields, [
  { value: "The Upper Deck Company, LLC", kind: "affiliation", basis: "exact_text", image: "image_2" },
  { value: "Metaverse Cards", kind: "identity", basis: "exact_text", image: "image_1" },
  { value: "Brian Gray", kind: "identity", basis: "exact_text", image: "image_2" }
]);
assert.equal(noisy.changes.length, 0);

const existing = replayCandidateIdentityV1({ ...fields, set: "VeeFriends" }, [
  { value: "VeeFriends", kind: "affiliation", basis: "logo_or_symbol", image: "image_2" }
]);
assert.equal(existing.changes.length, 0);

const serial = replaySerialObservationV1({ serial: "27/150" }, [
  { label: "serial_form", evidence: "027 / 150" }
]);
assert.equal(serial.fields.serial, "027/150");
assert.equal(serial.changes.length, 1);

const singleDigitSerial = replaySerialObservationSingleDigitV1({ serial: "8/25" }, [
  { label: "serial_number", evidence: "08/25" }
]);
assert.equal(singleDigitSerial.fields.serial, "08/25");
assert.equal(singleDigitSerial.changes.length, 1);
const wideNumerator = replaySerialObservationSingleDigitV1({ serial: "29/199" }, [
  { label: "serial_number", evidence: "029/199" }
]);
assert.equal(wideNumerator.fields.serial, "29/199");
assert.equal(wideNumerator.changes.length, 0);

const noSerialInference = replaySerialObservationV1({ serial: "" }, [
  { label: "serial_form", evidence: "027/150" }
]);
assert.equal(noSerialInference.fields.serial, "");
assert.equal(noSerialInference.changes.length, 0);

const language = replayLanguageObservationV1({ grammar: "tcg", language: "" }, [
  { label: "language_code", evidence: "jp" }
]);
assert.equal(language.fields.language, "JP");
assert.equal(language.changes.length, 1);
const languageDescription = replayLanguageObservationV1({ grammar: "tcg", language: "" }, [
  { label: "language", evidence: "Japanese text" }
]);
assert.equal(languageDescription.changes.length, 0);
console.log("candidate identity replay v1 tests passed");
