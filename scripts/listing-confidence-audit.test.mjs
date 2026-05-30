import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import handler from "../api/listing-copilot-title.js";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.OPENAI_API_KEY = "test-key";
process.env.OPENAI_LISTING_MODEL = "test-model";

function sign(value) {
  return crypto.createHmac("sha256", process.env.METAVERSE_AUTH_SECRET).update(value).digest("hex");
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000 })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload)}`;
}

async function callApi(openAiResult) {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify(openAiResult) })
  });

  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { cookie: sessionCookie() };

  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    }
  };

  const promise = handler(req, res);
  req.emit("data", JSON.stringify({
    assetId: "asset-test",
    mode: "single",
    images: [{ name: "card.webp", dataUrl: "data:image/webp;base64,AAAA" }],
    resolutionMap: {},
    maxTitleLength: 80
  }));
  req.emit("end");
  await promise;

  return JSON.parse(res.body);
}

const serialVisibleUncertainParallel = await callApi({
  title: "2025 Topps Chrome Quinshon Judkins RC Purple 130/175",
  confidence: "HIGH",
  reason: "Serial visible and preserved; exact parallel requires operator review from visual foil.",
  fields: {
    year: "2025",
    brand: "Topps Chrome",
    player: "Quinshon Judkins",
    subset: "RC",
    parallel: "Purple Wave Refractor",
    serial_number: "130/175"
  },
  unresolved: ["exact parallel requires operator review"]
});

assert.equal(serialVisibleUncertainParallel.confidence, "MEDIUM");
assert.match(serialVisibleUncertainParallel.title, /130\/175/);

const backgroundIgnored = await callApi({
  title: "Metaverse Cards 2024 Topps Chrome Shohei Ohtani",
  confidence: "HIGH",
  reason: "Metaverse Cards surface text appears above the card; card text supports player.",
  fields: {
    year: "2024",
    brand: "Metaverse Cards",
    player: "Shohei Ohtani",
    product: "Topps Chrome"
  },
  unresolved: []
});

assert.doesNotMatch(backgroundIgnored.title, /Metaverse Cards/i);
assert.notEqual(backgroundIgnored.fields.brand, "Metaverse Cards");
assert.doesNotMatch(backgroundIgnored.reason, /Metaverse Cards/i);
assert.match(backgroundIgnored.reason, /Background branding ignored/i);

const clearPsaLabel = await callApi({
  title: "PSA 10 2024 Topps Chrome Shohei Ohtani",
  confidence: "HIGH",
  reason: "PSA label explicitly supports player, year, product, and grade.",
  fields: {
    year: "2024",
    brand: "Topps Chrome",
    player: "Shohei Ohtani",
    grade_company: "PSA",
    grade: "Gem Mint 10"
  },
  unresolved: []
});

assert.equal(clearPsaLabel.confidence, "HIGH");
assert.equal(clearPsaLabel.title, "2024 Topps Chrome Shohei Ohtani PSA 10");

const visuallyGuessedParallel = await callApi({
  title: "2025 Bowman Chrome Test Player Fuchsia Wave Auto 137/199",
  confidence: "HIGH",
  reason: "Player and serial are visible; Fuchsia Wave is visually guessed from foil alone.",
  fields: {
    year: "2025",
    brand: "Bowman Chrome",
    player: "Test Player",
    parallel: "Fuchsia Wave",
    auto: true,
    serial_number: "137/199"
  },
  unresolved: []
});

assert.equal(visuallyGuessedParallel.confidence, "MEDIUM");

const missingVisibleSerial = await callApi({
  title: "2025 Bowman Chrome Test Player Fuchsia Wave Auto",
  confidence: "HIGH",
  reason: "Card text explicitly supports player and auto; serial is visible.",
  fields: {
    year: "2025",
    brand: "Bowman Chrome",
    player: "Test Player",
    parallel: "Fuchsia Wave",
    auto: true,
    serial_number: "137/199"
  },
  unresolved: []
});

assert.equal(missingVisibleSerial.confidence, "LOW");
assert.match(missingVisibleSerial.unresolved.join(" "), /title missing serial/);

const localizedTrainerIllustrator = await callApi({
  title: "2026 Pokemon Scarlet Violet 257/208 SAR En Morikura Trainer Card",
  confidence: "HIGH",
  reason: "Chinese Pokemon Trainer card; Illus. En Morikura is visible.",
  fields: {
    brand: "Pokemon TCG",
    product: "Pokemon Scarlet Violet",
    character: "琉琪亚的展现",
    set: "SV9C",
    subset: "SAR",
    card_number: "257/208",
    artist: "En Morikura"
  },
  unresolved: ["localized trainer identity requires operator review"]
});

assert.doesNotMatch(localizedTrainerIllustrator.title, /En Morikura/i);
assert.match(localizedTrainerIllustrator.title, /琉琪亚的展现/);
assert.match(localizedTrainerIllustrator.title, /257\/208/);
assert.match(localizedTrainerIllustrator.title, /SAR/);
assert.match(localizedTrainerIllustrator.title, /SV9C/);
assert.equal(localizedTrainerIllustrator.confidence, "MEDIUM");
assert.match(localizedTrainerIllustrator.reason, /Illustrator is metadata only/i);

const visibleKaboomPreserved = await callApi({
  title: "2023 Panini Prizm Victor Wembanyama Kaboom RC",
  confidence: "MEDIUM",
  reason: "Card text explicitly shows Kaboom insert; title preserves the high-value insert name.",
  fields: {
    year: "2023",
    brand: "Panini Prizm",
    player: "Victor Wembanyama",
    subset: "RC",
    insert: "Kaboom"
  },
  unresolved: ["exact checklist taxonomy requires operator review"]
});

assert.match(visibleKaboomPreserved.title, /Kaboom/i);
assert.equal(visibleKaboomPreserved.fields.insert, "Kaboom");

const visibleUltravioletPreserved = await callApi({
  title: "2024 Panini Select Caitlin Clark Ultraviolet RC",
  confidence: "MEDIUM",
  reason: "Back text explicitly supports Ultraviolet insert; title preserves the insert.",
  fields: {
    year: "2024",
    brand: "Panini Select",
    player: "Caitlin Clark",
    subset: "RC",
    insert: "Ultraviolet"
  },
  unresolved: []
});

assert.match(visibleUltravioletPreserved.title, /Ultraviolet/i);
assert.equal(visibleUltravioletPreserved.fields.insert, "Ultraviolet");

const missingHighValueInsert = await callApi({
  title: "2024 Panini Donruss Anthony Edwards",
  confidence: "HIGH",
  reason: "Card text explicitly shows Downtown insert.",
  fields: {
    year: "2024",
    brand: "Panini Donruss",
    player: "Anthony Edwards",
    insert: "Downtown"
  },
  unresolved: []
});

assert.equal(missingHighValueInsert.confidence, "MEDIUM");
assert.match(missingHighValueInsert.title, /Downtown/i);
assert.match(missingHighValueInsert.unresolved.join(" "), /title repaired missing insert/);

const insertNotParallel = await callApi({
  title: "2023 Panini Prizm Lionel Messi Kaboom",
  confidence: "HIGH",
  reason: "Card text explicitly supports Kaboom insert.",
  fields: {
    year: "2023",
    brand: "Panini Prizm",
    player: "Lionel Messi",
    parallel: "Kaboom"
  },
  unresolved: []
});

assert.equal(insertNotParallel.fields.insert, "Kaboom");
assert.equal(insertNotParallel.fields.parallel, null);

console.log("listing confidence audit mock tests passed");
