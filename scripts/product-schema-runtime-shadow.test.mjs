import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createProductSchemaRuntimeAdapter,
  loadProductSchemaRuntimeAdapter,
  productSchemaRuntimeAdapterVersion,
  supportedProductSchemaDocumentVersion
} from "../lib/listing/catalog/product-schema-runtime-adapter.mjs";
import {
  attachProductSchemaShadowEvaluation,
  evaluateProductSchemaShadow,
  extractProductSchemaShadowIdentity,
  productSchemaShadowEvaluationEnabled,
  productSchemaShadowTraceVersion,
  productSchemaShadowVerdicts
} from "../lib/listing/catalog/product-schema-shadow-evaluator.mjs";

const fixture = {
  schema_version: supportedProductSchemaDocumentVersion,
  generated_at: "2026-07-28T00:00:00.000Z",
  source: "panini checklist harvest",
  product_year_count: 2,
  set_name_count: 2,
  discriminating_set_count: 1,
  schemas: [
    {
      season_year: "2025",
      product: "Panini Phoenix",
      sport: "football",
      set_count: 2,
      card_number_count: 2,
      sets: ["Fire Fabrics", "Base"],
      card_numbers: ["24", "25"]
    },
    {
      season_year: "2025",
      product: "Panini Prizm",
      sport: "football",
      set_count: 1,
      card_number_count: 1,
      sets: ["Base"],
      card_numbers: ["1"]
    }
  ],
  set_to_products: {
    "fire fabrics": ["2025|Panini Phoenix"],
    "base": ["2025|Panini Phoenix", "2025|Panini Prizm"]
  }
};

const adapter = createProductSchemaRuntimeAdapter(fixture);

test("runtime adapter exposes only the three relations present in the artifact", () => {
  assert.equal(adapter.status, "READY");
  assert.equal(adapter.adapter_version, productSchemaRuntimeAdapterVersion);
  assert.deepEqual(adapter.supported_relations, ["sets", "card_numbers", "set_to_products"]);
  assert.deepEqual(adapter.source, {
    source_id: "panini-checklist-harvest",
    source_name: "panini checklist harvest",
    source_locator: "in-memory:product-schema-document",
    source_version: "product-schemas-v1",
    source_content_sha256: adapter.source.source_content_sha256,
    generated_at: "2026-07-28T00:00:00.000Z",
    covered_manufacturers: ["panini"],
    absence_is_authoritative: false
  });
  assert.match(adapter.source.source_content_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(adapter.counts, {
    declared_product_year_count: 2,
    declared_set_name_count: 2,
    declared_discriminating_set_count: 1,
    product_schema_record_count: 2,
    set_name_count: 2,
    discriminating_set_count: 1,
    set_ownership_link_count: 3,
    set_membership_count: 3,
    card_number_membership_count: 3,
    invalid_schema_record_count: 0,
    invalid_set_owner_count: 0
  });
  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(Object.isFrozen(adapter.counts), true);
  assert.equal("productSchemas" in adapter, false);
  assert.equal("registryRecords" in adapter, false);
});

test("adapter preserves set ownership and card-number membership without semantic promotion", () => {
  const schemas = adapter.findSchemas({ season_year: "2025", product: "panini phoenix" });
  assert.equal(schemas.length, 1);
  assert.equal(schemas[0].set_count, 2);
  assert.equal(schemas[0].card_number_count, 2);
  assert.equal(adapter.schemaHasSet(schemas[0].schema_key, "Fire Fabrics"), true);
  assert.equal(adapter.schemaHasCardNumber(schemas[0].schema_key, "#24"), true);
  assert.equal(adapter.schemaHasCardNumber(schemas[0].schema_key, "999"), false);

  const ownership = adapter.setOwnershipForSet("Base", {
    season_year: "2025",
    product: "Panini Phoenix"
  });
  assert.equal(ownership.owner_count, 2);
  assert.equal(ownership.agreeing_owner_count, 1);
  assert.equal(ownership.owner_sample_limit, 3);
  assert.deepEqual(
    ownership.owner_sample.map((owner) => owner.product),
    ["Panini Phoenix", "Panini Prizm"]
  );
  assert.match(ownership.owner_identity_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(ownership), true);
  assert.equal(Object.isFrozen(ownership.owner_sample), true);
  assert.equal(Object.isFrozen(ownership.owner_sample[0]), true);
});

test("set ownership output is bounded and stable across source ordering", () => {
  const sourceOwners = [
    "2025|Panini Zenith",
    "2025|Panini Phoenix",
    "2025|Panini Select",
    "2025|Panini Mosaic",
    "2025|Panini Prizm"
  ];
  const buildAdapter = (owners) => createProductSchemaRuntimeAdapter({
    ...fixture,
    set_to_products: {
      ...fixture.set_to_products,
      base: owners
    }
  });
  const forward = buildAdapter(sourceOwners).setOwnershipForSet("Base");
  const reverse = buildAdapter([...sourceOwners].reverse()).setOwnershipForSet("Base");
  assert.equal(forward.owner_count, 5);
  assert.equal(forward.owner_sample_limit, 3);
  assert.equal(forward.owner_sample.length, 3);
  assert.deepEqual(forward.owner_sample, reverse.owner_sample);
  assert.equal(forward.owner_identity_hash, reverse.owner_identity_hash);
  assert.match(forward.owner_identity_hash, /^sha256:[a-f0-9]{64}$/);
});

test("matching terminal fields generate a source-versioned read-only agreement trace", () => {
  const result = {
    title: "2025 Panini Phoenix Fire Fabrics Player #24",
    final_title: "2025 Panini Phoenix Fire Fabrics Player #24",
    resolved_fields: {
      manufacturer: "Panini",
      year: "2025",
      product: "Panini Phoenix",
      set_or_insert: "Fire Fabrics",
      card_number: "#24"
    }
  };
  const trace = evaluateProductSchemaShadow({ result, adapter });
  assert.equal(trace.trace_version, productSchemaShadowTraceVersion);
  assert.equal(trace.mode, "SHADOW_READ_ONLY");
  assert.equal(trace.verdict, productSchemaShadowVerdicts.AGREEMENT);
  assert.equal(trace.source.source_version, "product-schemas-v1");
  assert.equal(trace.adapter.version, productSchemaRuntimeAdapterVersion);
  assert.equal(trace.counts.source.product_schema_record_count, 2);
  assert.equal(trace.counts.checked_field_count, 4);
  assert.equal(trace.counts.agreement_count, 4);
  assert.equal(trace.field_trace.product.status, "AGREEMENT");
  assert.equal(trace.field_trace.product_year.status, "AGREEMENT");
  assert.equal(trace.field_trace.set_to_products.status, "AGREEMENT");
  assert.equal(trace.field_trace.card_numbers.status, "AGREEMENT");
  assert.deepEqual(trace.effects, {
    candidate_filtering: false,
    candidate_ranking: false,
    candidate_application: false,
    resolver: false,
    renderer: false,
    production_title: false
  });
  assert.equal(Object.isFrozen(trace), true);
  assert.equal(Object.isFrozen(trace.field_trace.card_numbers), true);
});

test("non-authoritative absence never creates a conflict or changes terminal fields", () => {
  const original = {
    title: "2024 Panini Phoenix Fire Fabrics Player #999",
    final_title: "2024 Panini Phoenix Fire Fabrics Player #999",
    resolved_fields: {
      manufacturer: "Panini",
      year: "2024",
      product: "Panini Phoenix",
      set_or_insert: "Fire Fabrics",
      card_number: "999"
    }
  };
  const snapshot = structuredClone(original);
  const attached = attachProductSchemaShadowEvaluation(original, { adapter, enabled: true });
  assert.deepEqual(original, snapshot);
  assert.equal(attached.title, original.title);
  assert.equal(attached.final_title, original.final_title);
  assert.deepEqual(attached.resolved_fields, original.resolved_fields);
  assert.equal(attached.product_schema_shadow.verdict, productSchemaShadowVerdicts.AGREEMENT);
  assert.equal(attached.product_schema_shadow.counts.conflict_count, 0);
  assert.equal(attached.product_schema_shadow.field_trace.set_to_products.status, "UNCHECKED");
  assert.equal(
    attached.product_schema_shadow.field_trace.set_to_products.reason,
    "SET_OWNER_NO_AGREEMENT_NONAUTHORITATIVE"
  );
  assert.equal("owners" in attached.product_schema_shadow.field_trace.set_to_products, false);
  assert.equal(attached.product_schema_shadow.field_trace.set_to_products.owner_count, 1);
  assert.match(
    attached.product_schema_shadow.field_trace.set_to_products.owner_identity_hash,
    /^sha256:[a-f0-9]{64}$/
  );
  assert.equal(attached.product_schema_shadow.effects.production_title, false);
  assert.equal(attached.product_schema_shadow.effects.candidate_application, false);
});

test("default production boundary is a no-op and does not load the artifact", () => {
  const original = {
    title: "2025 Panini Phoenix Fire Fabrics Player #24",
    resolved_fields: {
      manufacturer: "Panini",
      year: "2025",
      product: "Panini Phoenix",
      set_or_insert: "Fire Fabrics",
      card_number: "24"
    }
  };
  let loadCalls = 0;
  const startedAt = performance.now();
  const attached = attachProductSchemaShadowEvaluation(original, {
    payload: {},
    env: {},
    loadAdapter: () => {
      loadCalls += 1;
      throw new Error("disabled boundary must not load the artifact");
    }
  });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(attached, original);
  assert.equal("product_schema_shadow" in attached, false);
  assert.equal(attached.title, original.title);
  assert.equal(loadCalls, 0);
  // This is not a latency SLA; it catches accidental synchronous parsing of
  // the 4.1 MB artifact in the disabled path.
  assert.ok(elapsedMs < 100, `disabled shadow boundary unexpectedly took ${elapsedMs.toFixed(1)}ms`);
});

test("only explicit Product Schema opt-ins enable runtime evaluation", () => {
  assert.equal(productSchemaShadowEvaluationEnabled({ payload: {}, env: {} }), false);
  assert.equal(productSchemaShadowEvaluationEnabled({
    payload: { product_schema_shadow_profile: "shadow" },
    env: {}
  }), true);
  assert.equal(productSchemaShadowEvaluationEnabled({
    payload: {
      provider_options: {
        recognition_benchmark_profile: "cold_algorithm_benchmark",
        trace_level: "evaluation"
      }
    },
    env: {}
  }), false);
  assert.equal(productSchemaShadowEvaluationEnabled({
    payload: {
      provider_options: {
        recognition_benchmark_profile: "cold_algorithm_benchmark",
        trace_level: "evaluation",
        enable_product_schema_shadow: true
      }
    },
    env: {}
  }), true);
  assert.equal(productSchemaShadowEvaluationEnabled({
    payload: { product_schema_shadow_enabled: false, product_schema_shadow_profile: "shadow" },
    env: { ENABLE_PRODUCT_SCHEMA_SHADOW: "true" }
  }), false);
});

test("explicit evaluation records bounded timing telemetry", () => {
  const clock = [10, 14, 21];
  const attached = attachProductSchemaShadowEvaluation({
    resolved_fields: {
      manufacturer: "Panini",
      year: "2025",
      product: "Panini Phoenix"
    }
  }, {
    adapter,
    enabled: true,
    now: () => clock.shift()
  });
  assert.deepEqual(attached.product_schema_shadow.timing, {
    adapter_access_ms: 4,
    evaluation_ms: 7,
    total_ms: 11
  });
  assert.equal(Object.isFrozen(attached.product_schema_shadow.timing), true);
});

test("observed runtime aliases remain provenance-labelled and compare only as card numbers", () => {
  const identity = extractProductSchemaShadowIdentity({
    resolved_fields: {
      brand: "Panini",
      category: "football",
      year: "2025",
      product: "Panini Phoenix",
      set: "Fire Fabrics",
      checklist_code: "24"
    }
  });
  assert.equal(identity.manufacturer, "Panini");
  assert.equal(identity.sport, "football");
  assert.equal(identity.card_number, "24");
  assert.equal(identity.source_fields.manufacturer, "brand");
  assert.equal(identity.source_fields.sport, "category");
  assert.equal(identity.source_fields.card_number, "checklist_code");

  const trace = evaluateProductSchemaShadow({
    result: { resolved_fields: {
      brand: "Panini",
      category: "football",
      year: "2025",
      product: "Panini Phoenix",
      set: "Fire Fabrics",
      checklist_code: "24"
    } },
    adapter
  });
  assert.equal(trace.field_trace.card_numbers.status, "AGREEMENT");
  assert.equal("checklist_codes" in trace.field_trace, false);
});

test("identity extraction safely fills missing fields by container precedence", () => {
  const identity = extractProductSchemaShadowIdentity({
    resolved_fields: {
      manufacturer: "Panini",
      product: ""
    },
    rendered_fields: {
      fields: {
        year: "2025",
        product: "Panini Phoenix"
      }
    },
    raw_provider_fields: {
      product: "Provider Product Must Not Override",
      collector_number: "24"
    }
  });
  assert.equal(identity.field_container, "precedence_merge");
  assert.equal(identity.manufacturer, "Panini");
  assert.equal(identity.product, "Panini Phoenix");
  assert.equal(identity.card_number, "24");
  assert.equal(identity.source_containers.manufacturer, "resolved_fields");
  assert.equal(identity.source_containers.product, "rendered_fields.fields");
  assert.equal(identity.source_containers.card_number, "raw_provider_fields");
  assert.equal(identity.source_fields.product, "product");
});

test("shadow identity and schema-key diagnostics remain bounded", () => {
  const identity = extractProductSchemaShadowIdentity({
    resolved_fields: {
      manufacturer: "Panini".repeat(200),
      product: Array.from({ length: 30 }, (_, index) => `Product-${index}-${"x".repeat(80)}`)
    }
  });
  assert.ok(identity.manufacturer.length <= 240);
  assert.ok(identity.product.length <= 240);

  const manySchemas = createProductSchemaRuntimeAdapter({
    ...fixture,
    product_year_count: 20,
    schemas: Array.from({ length: 20 }, (_, index) => ({
      season_year: String(2000 + index),
      product: "Panini Repeated Product",
      sport: "football",
      sets: ["Base"],
      card_numbers: [String(index + 1)]
    }))
  });
  const trace = evaluateProductSchemaShadow({
    result: { resolved_fields: {
      manufacturer: "Panini",
      product: "Panini Repeated Product"
    } },
    adapter: manySchemas
  });
  assert.equal(trace.field_trace.product.matched_schema_key_count, 20);
  assert.equal(trace.field_trace.product.matched_schema_key_sample.length, 8);
  assert.equal(trace.field_trace.product.matched_schema_key_truncated_count, 12);
  assert.match(trace.field_trace.product.matched_schema_key_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal("matched_schema_keys" in trace.field_trace.product, false);
});

test("ambiguous set ownership stays ambiguous when no product context exists", () => {
  const trace = evaluateProductSchemaShadow({
    result: {
      resolved_fields: {
        manufacturer: "Panini",
        set_or_insert: "Base"
      }
    },
    adapter
  });
  assert.equal(trace.verdict, productSchemaShadowVerdicts.AMBIGUOUS);
  assert.equal(trace.field_trace.set_to_products.status, "AMBIGUOUS");
  assert.equal(trace.field_trace.set_to_products.owner_count, 2);
  assert.equal(trace.field_trace.set_to_products.agreeing_owner_count, 0);
  assert.equal(trace.field_trace.set_to_products.owner_sample.length, 2);
  assert.equal("owners" in trace.field_trace.set_to_products, false);
});

test("uncovered manufacturers and absent product context remain unchecked", () => {
  const trace = evaluateProductSchemaShadow({
    result: {
      resolved_fields: {
        manufacturer: "Topps",
        year: "2025",
        product: "Topps Chrome",
        set_or_insert: "Base"
      }
    },
    adapter
  });
  assert.equal(trace.verdict, productSchemaShadowVerdicts.UNCHECKED);
  assert.deepEqual(trace.reason_codes, ["PRODUCT_SCHEMA_MANUFACTURER_NOT_COVERED"]);
  assert.deepEqual(trace.field_trace, {});
});

test("absence inside a harvested manufacturer snapshot never becomes negative evidence", () => {
  const trace = evaluateProductSchemaShadow({
    result: {
      resolved_fields: {
        manufacturer: "Panini",
        year: "2099",
        product: "Panini Unknown",
        set_or_insert: "Unknown Set",
        collector_number: "999"
      }
    },
    adapter
  });
  assert.equal(trace.verdict, productSchemaShadowVerdicts.UNCHECKED);
  assert.equal(trace.field_trace.product.status, "UNCHECKED");
  assert.equal(trace.field_trace.product_year.status, "UNCHECKED");
  assert.equal(trace.field_trace.set_to_products.status, "UNCHECKED");
  assert.equal(trace.field_trace.card_numbers.status, "UNCHECKED");
  assert.equal(trace.counts.conflict_count, 0);
});

test("unsupported and unreadable artifacts fail closed to UNCHECKED", () => {
  const unsupported = createProductSchemaRuntimeAdapter({
    ...fixture,
    schema_version: "product-schemas-v999"
  });
  assert.equal(unsupported.status, "UNAVAILABLE");
  assert.deepEqual(unsupported.reason_codes, ["PRODUCT_SCHEMA_VERSION_UNSUPPORTED"]);

  const unreadable = loadProductSchemaRuntimeAdapter({
    path: "/tmp/lynca-product-schema-does-not-exist.json",
    reload: true
  });
  const trace = evaluateProductSchemaShadow({
    result: { resolved_fields: { manufacturer: "Panini", product: "Panini Phoenix" } },
    adapter: unreadable
  });
  assert.equal(trace.verdict, productSchemaShadowVerdicts.UNCHECKED);
  assert.deepEqual(trace.reason_codes, ["PRODUCT_SCHEMA_ARTIFACT_READ_FAILED"]);
});

test("the committed artifact satisfies the adapter contract with actual counts", () => {
  const runtime = loadProductSchemaRuntimeAdapter({ reload: true });
  assert.equal(runtime.status, "READY");
  assert.equal(runtime.source.source_name, "panini checklist harvest");
  assert.equal(runtime.source.source_version, "product-schemas-v1");
  assert.equal(runtime.counts.product_schema_record_count, 185);
  assert.equal(runtime.counts.set_name_count, 30006);
  assert.equal(runtime.counts.discriminating_set_count, 17963);
  assert.equal(runtime.counts.card_number_membership_count, 40266);
  assert.deepEqual(runtime.reason_codes, ["PRODUCT_SCHEMA_RUNTIME_READY"]);
});

test("Product Schema remains offline-only and cannot enter the production Native Core bundle", () => {
  const source = readFileSync(
    new URL("../lib/listing/v4/pipeline/native-recognition-core.mjs", import.meta.url),
    "utf8"
  );
  assert.equal((source.match(/attachProductSchemaShadowEvaluation\(/g) || []).length, 0);
  assert.doesNotMatch(source, /product-schema-(?:runtime-adapter|shadow-evaluator)/);
});
