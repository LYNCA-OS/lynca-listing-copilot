import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import handler from "../api/listing-render-title.js";
import { applyWriterModuleEdit } from "../lib/listing/writer/module-edit.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";

function sign(value) {
  return crypto.createHmac("sha256", process.env.METAVERSE_AUTH_SECRET).update(value).digest("hex");
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000 })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload)}`;
}

async function callRenderApi(body) {
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
  req.emit("data", JSON.stringify(body));
  req.emit("end");
  await promise;

  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body)
  };
}

const numberingEdit = applyWriterModuleEdit({
  resolved: {
    year: "2024",
    brand: "Topps Chrome",
    players: ["Shohei Ohtani"],
    serial_number: "37/50"
  },
  moduleKey: "numbering",
  moduleText: "31/50 · #136 · UV-16"
});
assert.equal(numberingEdit.corrected_resolved.serial_number, "31/50");
assert.equal(numberingEdit.corrected_resolved.collector_number, "136");
assert.equal(numberingEdit.corrected_resolved.checklist_code, "UV-16");
assert.match(numberingEdit.final_title, /\/50/);
assert.doesNotMatch(numberingEdit.final_title, /31\/50/);
assert.doesNotMatch(numberingEdit.final_title, /37\/50/);
assert.ok(numberingEdit.field_changes.some((change) => change.field === "serial_number"));
assert.equal(numberingEdit.corrected_evidence.serial_number.status, "MANUAL_CONFIRMED");
assert.equal(numberingEdit.corrected_evidence.serial_number.sources[0].source_type, "OPERATOR");

const attributesEdit = applyWriterModuleEdit({
  resolved: {
    year: "2025",
    brand: "Bowman Chrome",
    players: ["Test Player"]
  },
  moduleKey: "attributes",
  moduleText: "RC Auto Patch 1/1"
});
assert.equal(attributesEdit.corrected_resolved.rc, true);
assert.equal(attributesEdit.corrected_resolved.auto, true);
assert.equal(attributesEdit.corrected_resolved.patch, true);
assert.equal(attributesEdit.corrected_resolved.one_of_one, true);

const gradingEdit = applyWriterModuleEdit({
  resolved: {
    year: "2025",
    brand: "Topps Chrome",
    players: ["Cooper Flagg"],
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  moduleKey: "grading",
  moduleText: "PSA 9/10"
});
assert.equal(gradingEdit.corrected_resolved.grade_company, "PSA");
assert.equal(gradingEdit.corrected_resolved.card_grade, "9");
assert.equal(gradingEdit.corrected_resolved.auto_grade, "10");
assert.equal(gradingEdit.corrected_resolved.grade_type, "CARD_AND_AUTO");
assert.match(gradingEdit.final_title, /PSA 9\/10$/);

const newModuleIdentityEdit = applyWriterModuleEdit({
  resolved: {
    year: "2023",
    brand: "Panini",
    product: "Prizm",
    players: ["Victor Wembanyama"]
  },
  moduleKey: "product_set",
  moduleText: "Prizm Basketball"
});
assert.equal(newModuleIdentityEdit.corrected_resolved.product, "Prizm Basketball");
assert.equal(newModuleIdentityEdit.corrected_resolved.set, null);
assert.match(newModuleIdentityEdit.final_title, /2023 Panini Prizm Basketball Victor Wembanyama/);

const newModuleVariantEdit = applyWriterModuleEdit({
  resolved: {
    year: "2025",
    brand: "Topps Chrome",
    players: ["Cooper Flagg"],
    auto: true
  },
  moduleKey: "variant_parallel_rarity",
  moduleText: "Gold Refractor RC 1/1"
});
assert.equal(newModuleVariantEdit.corrected_resolved.parallel, "Gold Refractor");
assert.equal(newModuleVariantEdit.corrected_resolved.rc, true);
assert.equal(newModuleVariantEdit.corrected_resolved.one_of_one, true);
assert.equal(newModuleVariantEdit.corrected_resolved.auto, true);
assert.match(newModuleVariantEdit.final_title, /Gold Refractor 1\/1 RC/);
assert.match(newModuleVariantEdit.final_title, /\bAuto\b/);

const newModuleNumberGradeEdit = applyWriterModuleEdit({
  resolved: {
    year: "2024",
    brand: "Topps Chrome",
    players: ["Shohei Ohtani"],
    serial_number: "37/50"
  },
  moduleKey: "number_serial_grade",
  moduleText: "31/50 · #136 · UV-16 · PSA 9/10"
});
assert.equal(newModuleNumberGradeEdit.corrected_resolved.serial_number, "31/50");
assert.equal(newModuleNumberGradeEdit.corrected_resolved.collector_number, "136");
assert.equal(newModuleNumberGradeEdit.corrected_resolved.checklist_code, "UV-16");
assert.equal(newModuleNumberGradeEdit.corrected_resolved.grade_company, "PSA");
assert.equal(newModuleNumberGradeEdit.corrected_resolved.card_grade, "9");
assert.equal(newModuleNumberGradeEdit.corrected_resolved.auto_grade, "10");
assert.equal(newModuleNumberGradeEdit.corrected_resolved.grade_type, "CARD_AND_AUTO");

const scgProductIdentityEdit = applyWriterModuleEdit({
  resolved: {
    year: "1997-98",
    product: "Bowman's Best",
    players: ["Michael Jordan"]
  },
  moduleKey: "product_identity",
  moduleText: "Bowman's Best"
});
assert.equal(scgProductIdentityEdit.corrected_resolved.product, "Bowman's Best");
assert.match(scgProductIdentityEdit.final_title, /1997-98 Bowman's Best Michael Jordan/);

const scgNumericalRarityEdit = applyWriterModuleEdit({
  resolved: {
    year: "2025",
    brand: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  moduleKey: "numerical_rarity",
  moduleText: "/50"
});
assert.equal(scgNumericalRarityEdit.corrected_resolved.serial_number, "/50");
assert.match(scgNumericalRarityEdit.final_title, /\/50/);

const scgCardNumberEdit = applyWriterModuleEdit({
  resolved: {
    year: "1997-98",
    product: "Bowman's Best",
    players: ["Michael Jordan"]
  },
  moduleKey: "card_number",
  moduleText: "#96"
});
assert.equal(scgCardNumberEdit.corrected_resolved.collector_number, "96");
assert.match(scgCardNumberEdit.final_title, /#96/);

const apiEdit = await callRenderApi({
  resolved: {
    year: "2024",
    brand: "Panini Prizm",
    players: ["Victor Wembanyama"],
    serial_number: "37/50"
  },
  evidence: {},
  module_edit: {
    module_key: "numbering",
    module_text: "31/50"
  }
});
assert.equal(apiEdit.statusCode, 200);
assert.equal(apiEdit.body.ok, true);
assert.equal(apiEdit.body.corrected_resolved.serial_number, "31/50");
assert.match(apiEdit.body.final_title, /\/50/);
assert.doesNotMatch(apiEdit.body.final_title, /31\/50/);

const apiOverrideOnly = await callRenderApi({
  resolved: {
    year: "2024",
    brand: "Panini Prizm",
    players: ["Victor Wembanyama"],
    serial_number: "31/50"
  },
  title_override: "Custom human title"
});
assert.equal(apiOverrideOnly.statusCode, 200);
assert.equal(apiOverrideOnly.body.ok, true);
assert.equal(apiOverrideOnly.body.title_override, "Custom human title");
assert.match(apiOverrideOnly.body.final_title, /\/50/);
assert.doesNotMatch(apiOverrideOnly.body.final_title, /31\/50/);
assert.notEqual(apiOverrideOnly.body.final_title, "Custom human title");

console.log("writer module edit tests passed");
