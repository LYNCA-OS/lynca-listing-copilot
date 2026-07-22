import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handler from "../api/listing-render-title.js";
import { createListingSessionToken } from "../lib/listing-session.mjs";
import { applyWriterModuleEdit } from "../lib/listing/writer/module-edit.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

globalThis.fetch = async (url) => {
  const parsed = new URL(String(url));
  if (parsed.pathname.endsWith("/tenant_members")) {
    return {
      ok: true,
      status: 200,
      json: async () => [{
        tenant_id: "tenant_alpha",
        user_id: "user_alpha",
        role: "WRITER",
        status: "ACTIVE",
        disabled_at: null,
        user: {
          id: "user_alpha",
          email: "writer@example.test",
          status: "ACTIVE",
          session_version: 1,
          disabled_at: null,
          auth_user_id: "auth_alpha"
        },
        tenant: {
          id: "tenant_alpha",
          name: "Tenant Alpha",
          plan: "pilot",
          status: "ACTIVE",
          disabled_at: null
        }
      }],
      text: async () => "[]"
    };
  }
  return { ok: true, status: 201, json: async () => [], text: async () => "[]" };
};

function sessionCookie() {
  const token = createListingSessionToken({
    user_id: "user_alpha",
    tenant_id: "tenant_alpha",
    email: "writer@example.test",
    session_version: 1
  }, process.env.METAVERSE_AUTH_SECRET);
  return `lynca_metaverse_session=${token}`;
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
  setImmediate(() => {
    req.emit("data", JSON.stringify(body));
    req.emit("end");
  });
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
assert.match(numberingEdit.final_title, /31\/50/);
assert.doesNotMatch(numberingEdit.final_title, /#\/50/);
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
assert.equal(newModuleIdentityEdit.corrected_resolved.product, "Panini Prizm");
assert.equal(newModuleIdentityEdit.corrected_resolved.set, null);
assert.match(newModuleIdentityEdit.final_title, /2023 Panini Prizm Victor Wembanyama/);

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
assert.equal(scgNumericalRarityEdit.corrected_resolved.print_run_number, "#/50");
assert.equal(scgNumericalRarityEdit.corrected_resolved.print_run_numerator, null);
assert.equal(scgNumericalRarityEdit.corrected_resolved.print_run_denominator, "50");
assert.equal(scgNumericalRarityEdit.corrected_resolved.serial_number, "#/50");
assert.equal(scgNumericalRarityEdit.corrected_resolved.numerical_rarity, "#/50");
assert.match(scgNumericalRarityEdit.final_title, /#\/50/);

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
assert.doesNotMatch(scgCardNumberEdit.final_title, /#96/);

const printFinishEditDoesNotPolluteReleaseVariant = applyWriterModuleEdit({
  resolved: {
    year: "2024",
    brand: "Topps Chrome",
    players: ["Victor Wembanyama"]
  },
  moduleKey: "print_finish",
  moduleText: "Gold Refractor"
});
assert.equal(printFinishEditDoesNotPolluteReleaseVariant.corrected_resolved.surface_color, "Gold");
assert.equal(printFinishEditDoesNotPolluteReleaseVariant.corrected_resolved.parallel_family, "Refractor");
assert.equal(printFinishEditDoesNotPolluteReleaseVariant.corrected_resolved.parallel_exact, "Gold Refractor");
assert.equal(printFinishEditDoesNotPolluteReleaseVariant.corrected_resolved.insert, null);
assert.match(printFinishEditDoesNotPolluteReleaseVariant.final_title, /Gold Refractor/);

const releaseVariantEditDoesNotCaptureFinish = applyWriterModuleEdit({
  resolved: {
    year: "2024",
    brand: "Topps Chrome",
    players: ["Victor Wembanyama"],
    surface_color: "Gold"
  },
  moduleKey: "release_variant",
  moduleText: "Variation"
});
assert.equal(releaseVariantEditDoesNotCaptureFinish.corrected_resolved.variation, "Variation");
assert.equal(releaseVariantEditDoesNotCaptureFinish.corrected_resolved.surface_color, "Gold");
assert.equal(releaseVariantEditDoesNotCaptureFinish.corrected_resolved.parallel_exact, null);

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
assert.equal(apiEdit.statusCode, 410);
assert.equal(apiEdit.body.ok, false);
assert.equal(apiEdit.body.code, "tenant_title_route_required");

const apiOverrideOnly = await callRenderApi({
  resolved: {
    year: "2024",
    brand: "Panini Prizm",
    players: ["Victor Wembanyama"],
    serial_number: "31/50"
  },
  title_override: "Custom human title"
});
assert.equal(apiOverrideOnly.statusCode, 410);
assert.equal(apiOverrideOnly.body.code, "tenant_title_route_required");

console.log("writer module edit tests passed");
