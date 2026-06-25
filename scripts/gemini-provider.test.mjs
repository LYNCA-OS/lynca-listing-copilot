import assert from "node:assert/strict";
import {
  analyzeCardEvidenceWithGemini,
  buildGeminiFormatRepairRequest,
  buildGeminiInteractionRequest,
  buildGeminiVisibleTextRequest,
  geminiConfigFromEnv,
  geminiFieldsFromVisibleText,
  geminiFormatErrorTypes,
  geminiProviderResponseSchema,
  transcribeVisibleCardTextWithGemini
} from "../lib/listing/providers/gemini-provider.mjs";
import { providerModelConfig, visionProviderIds } from "../lib/listing/providers/provider-contract.mjs";

const env = {
  GEMINI_API_KEY: "AIza-test-gemini-key",
  GEMINI_MODEL: "gemini-3.1-flash-lite",
  GEMINI_TIMEOUT_MS: "12000",
  GEMINI_MAX_OUTPUT_TOKENS: "350",
  GEMINI_TEMPERATURE: "0",
  GEMINI_INPUT_TOKEN_COST_PER_1M: "0.1",
  GEMINI_OUTPUT_TOKEN_COST_PER_1M: "0.4",
  GEMINI_IMAGE_COST_USD: "0.002"
};

const config = geminiConfigFromEnv(env);
assert.equal(config.model, "gemini-3.1-flash-lite");
assert.equal(config.modelAllowed, true);
assert.equal(config.timeoutMs, 12000);
assert.equal(config.maxOutputTokens, 350);

const defaultTokenConfig = geminiConfigFromEnv({
  GEMINI_API_KEY: "AIza-test-gemini-key",
  GEMINI_MODEL: "gemini-3.1-flash-lite"
});
assert.equal(defaultTokenConfig.maxOutputTokens, 700);
assert.equal(defaultTokenConfig.formatRepairMaxOutputTokens, 700);

const override = providerModelConfig(visionProviderIds.GEMINI, "gemini-3.1-pro");
assert.equal(override.allowed, true);
assert.equal(override.model_id, "gemini-3.1-pro");

const invalidOverride = providerModelConfig(visionProviderIds.GEMINI, "not-gemini");
assert.equal(invalidOverride.allowed, false);

const schema = geminiProviderResponseSchema();
assert.equal(schema.type, "object");
assert.equal(schema.additionalProperties, false);
assert.equal(schema.required.includes("recognition_status"), true);
assert.deepEqual(schema.properties.recognition_status.enum, ["CONFIRMED", "RESOLVED", "ABSTAIN"]);
assert.equal(schema.properties.fields.additionalProperties, false);
assert.equal(Boolean(schema.properties.fields.properties.serial_number), true);
assert.equal(Boolean(schema.properties.fields.properties.players), true);
assert.equal(Boolean(schema.properties.field_evidence), true);
assert.equal(Boolean(schema.properties.field_evidence.additionalProperties), true);
assert.equal(Boolean(schema.properties.field_evidence.additionalProperties.properties.value), true);
assert.equal(Boolean(schema.properties.field_evidence.additionalProperties.properties.support_type), true);

const dataUrl = "data:image/png;base64,QUJD";
const request = buildGeminiInteractionRequest({
  prompt: "Return JSON.",
  images: [
    { name: "front.png", dataUrl, side: "front" },
    { name: "back.jpg", url: "https://example.com/back.jpg", side: "back" },
    {
      name: "serial-crop.jpg",
      url: "https://example.com/serial.jpg",
      side: "front",
      derived: true,
      cropMetadata: {
        crop_id: "crop-serial",
        source_region: "serial_number"
      }
    }
  ],
  model: "gemini-3.1-flash-lite",
  temperature: 0,
  maxOutputTokens: 300
});
assert.equal(request.model, "gemini-3.1-flash-lite");
assert.equal(request.store, false);
assert.equal(request.response_mime_type, undefined);
assert.equal(request.response_format.type, "text");
assert.equal(request.response_format.mime_type, "application/json");
assert.equal(request.response_format.schema.type, "object");
assert.equal(request.generation_config.max_output_tokens, 300);
assert.equal(request.input.filter((part) => part.type === "image").length, 3);
assert.equal(request.input.find((part) => part.type === "image").mime_type, "image/png");
assert.equal(request.input.find((part) => part.uri === "https://example.com/back.jpg").mime_type, "image/jpeg");
assert.equal(request.input.find((part) => part.uri === "https://example.com/serial.jpg").resolution, "high");
assert.match(request.input[0].text, /recognition_status meaning/i);
assert.match(request.input[0].text, /Do not use ABSTAIN as a reason to omit other fields/i);
assert.match(request.input[0].text, /field_evidence\.year\.support_type/i);
assert.equal(JSON.stringify(request).includes(env.GEMINI_API_KEY), false);

const repairRequest = buildGeminiFormatRepairRequest({
  rawContent: "{\"title\":\"broken\"",
  model: "gemini-3.1-flash-lite",
  maxOutputTokens: 700
});
assert.equal(repairRequest.model, "gemini-3.1-flash-lite");
assert.equal(repairRequest.response_mime_type, undefined);
assert.equal(repairRequest.response_format.mime_type, "application/json");
assert.equal(repairRequest.input.filter((part) => part.type === "image").length, 0);
assert.match(repairRequest.input[0].text, /No images are provided/i);

const visibleTextRequest = buildGeminiVisibleTextRequest({
  prompt: "Transcribe slab.",
  images: [{ name: "front.png", dataUrl, side: "front" }],
  model: "gemini-3.1-flash-lite",
  temperature: 0,
  maxOutputTokens: 300
});
assert.equal(visibleTextRequest.response_format.mime_type, "application/json");
assert.equal(visibleTextRequest.response_format.schema.required.includes("visible_text_lines"), true);
assert.equal(visibleTextRequest.input.filter((part) => part.type === "image").length, 1);

const visibleTextFields = geminiFieldsFromVisibleText([
  "2018 TOPPS CHROME",
  "SHOHEI OHTANI",
  "1983 TOPPS",
  "#83T-6",
  "GEM MT 10",
  "PSA"
]);
assert.equal(visibleTextFields.year, "2018");
assert.equal(visibleTextFields.product, "Topps Chrome");
assert.deepEqual(visibleTextFields.players, ["Shohei Ohtani"]);
assert.equal(visibleTextFields.insert, "1983 Topps");
assert.equal(visibleTextFields.collector_number, "83T-6");
assert.equal(visibleTextFields.card_grade, "10");
assert.equal(visibleTextFields.grade_company, "PSA");

const prefixedVisibleTextFields = geminiFieldsFromVisibleText([
  "visible_text: 2018 TOPPS CHROME",
  "visible_text SHOHEI OHTANI",
  "visible_text: #83T-6"
]);
assert.equal(prefixedVisibleTextFields.product, "Topps Chrome");
assert.deepEqual(prefixedVisibleTextFields.players, ["Shohei Ohtani"]);

const visibleTextNameLineFields = geminiFieldsFromVisibleText([
  "Panini - Prizm FIFA Soccer",
  "Club Legends",
  "Lionel Messi"
]);
assert.equal(visibleTextNameLineFields.product, "Panini Prizm FIFA Soccer");
assert.deepEqual(visibleTextNameLineFields.players, ["Lionel Messi"]);
assert.notEqual(visibleTextNameLineFields.player, "Club Legends");

const visibleTextTeamLineFields = geminiFieldsFromVisibleText([
  "Panini Prizm FIFA Soccer",
  "FC Barcelona",
  "Club Legends"
]);
assert.notDeepEqual(visibleTextTeamLineFields.players, ["Fc Barcelona"]);

for (const badPlayerLine of ["Autos", "Canvas Creations Autos", "Topps Certified", "topps finest", "Historic Ties Triple"]) {
  const fields = geminiFieldsFromVisibleText([badPlayerLine]);
  assert.deepEqual(fields.players || [], [], `${badPlayerLine} should not become a player`);
}

const visibleTextMaterialWords = geminiFieldsFromVisibleText([
  "2021 PANINI IMPECCABLE",
  "CRISTIANO RONALDO",
  "#7",
  "NM-MT",
  "GAME-USED"
]);
assert.equal(visibleTextMaterialWords.collector_number, "7");
assert.notEqual(visibleTextMaterialWords.checklist_code, "NM-MT");
assert.notEqual(visibleTextMaterialWords.checklist_code, "GAME-USED");

await assert.rejects(
  analyzeCardEvidenceWithGemini({
    images: [{ url: "https://example.com/front.jpg" }],
    prompt: "Return JSON.",
    env: { ...env, GEMINI_API_KEY: "" },
    clientFactory: () => {
      throw new Error("should not create client without key");
    }
  }),
  (error) => error.provider === "gemini" && error.code === "provider_unavailable"
);

await assert.rejects(
  analyzeCardEvidenceWithGemini({
    images: Array.from({ length: 9 }, (_, index) => ({ url: `https://example.com/${index}.jpg` })),
    prompt: "Return JSON.",
    env,
    clientFactory: () => {
      throw new Error("should not create client for invalid images");
    }
  }),
  (error) => error.provider === "gemini" && error.code === "provider_input_unsupported"
);

let capturedApiKey = "";
let capturedRequest = null;
let capturedOptions = null;
const result = await analyzeCardEvidenceWithGemini({
  images: [
    { url: "https://example.com/front.jpg", side: "front" },
    { url: "https://example.com/back.jpg", side: "back" }
  ],
  prompt: "Return JSON.",
  env,
  clientFactory: ({ apiKey }) => {
    capturedApiKey = apiKey;
    return {
      interactions: {
        create: async (params, options) => {
          capturedRequest = params;
          capturedOptions = options;
          return {
            id: "interaction_test",
            status: "completed",
            model: { id: "gemini-3.1-flash-lite" },
            output_text: JSON.stringify({
              title: "",
              confidence: "HIGH",
              recognition_status: "CONFIRMED",
              fields: {
                year: "2025",
                product: "Topps Chrome",
                players: ["Cooper Flagg"],
                serial_number: "31/50",
                rc: true
              },
              field_evidence: {
                year: {
                  value: "2025",
                  support_type: "CARD_FRONT_PRINTED_TEXT",
                  evidence_kind: "YEAR_TEXT",
                  visible_text: "2025",
                  confidence: 0.9,
                  review_required: false
                },
                rc: {
                  value: true,
                  support_type: "CARD_FRONT_PRINTED_TEXT",
                  evidence_kind: "RC_LOGO",
                  visible_text: "RC",
                  visible_marker: true,
                  confidence: 0.9,
                  review_required: false
                }
              },
              unresolved: []
            }),
            usage: {
              total_input_tokens: 100,
              total_output_tokens: 28,
              total_tokens: 128
            }
          };
        }
      }
    };
  }
});
assert.equal(capturedApiKey, env.GEMINI_API_KEY);
assert.equal(capturedRequest.model, "gemini-3.1-flash-lite");
assert.equal(capturedRequest.input.filter((part) => part.type === "image").length, 2);
assert.match(capturedRequest.input[0].text, /Gemini extraction guide/);
assert.match(capturedRequest.input[0].text, /recognition_status meaning/);
assert.match(capturedRequest.input[0].text, /Missing serial, grade, or exact parallel must not erase visible year, product, set, or players/);
assert.match(capturedRequest.input[0].text, /If a slab label is visible, read the slab label first/i);
assert.match(capturedRequest.input[0].text, /Never return only a year when a slab label also contains product/i);
assert.match(capturedRequest.input[0].text, /2018 TOPPS CHROME/);
assert.equal(capturedOptions.timeout_ms, 12000);
assert.equal(capturedOptions.retry_codes.length, 0);
assert.equal(result.provider, "gemini");
assert.equal(result.model_id, "gemini-3.1-flash-lite");
assert.equal(result.response_id, "interaction_test");
assert.equal(result.recognition_status, "CONFIRMED");
assert.equal(result.parsed.fields.serial_number, "31/50");
assert.equal(result.parsed.field_evidence.year.support_type, "CARD_FRONT_PRINTED_TEXT");
assert.equal(result.parsed.field_evidence.rc.visible_marker, true);
assert.equal(result.usage.provider_calls, 1);
assert.equal(result.usage.input_tokens, 100);
assert.equal(result.usage.output_tokens, 28);
assert.equal(result.usage.prompt_tokens, 100);
assert.equal(result.usage.completion_tokens, 28);
assert.equal(result.usage.total_tokens, 128);
assert.equal(result.usage.image_count, 2);
assert.equal(result.usage.cost_configured, true);
assert.equal(result.usage.estimated_cost_usd, 0.004021);
assert.equal(JSON.stringify(result).includes(env.GEMINI_API_KEY), false);

const stepsOnlyResult = await analyzeCardEvidenceWithGemini({
  images: [{ dataUrl, side: "front" }],
  prompt: "Return JSON.",
  env,
  clientFactory: () => ({
    interactions: {
      create: async () => ({
        id: "interaction_steps_only",
        status: "completed",
        model: { id: "gemini-3.1-flash-lite" },
        steps: [
          {
            type: "user_input",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  title: "",
                  confidence: "LOW",
                  recognition_status: "ABSTAIN",
                  fields: { year: "1900", product: "Wrong Prompt Product", players: ["Wrong Prompt Player"] },
                  unresolved: []
                })
              }
            ]
          },
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  title: "",
                  confidence: "HIGH",
                  recognition_status: "CONFIRMED",
                  fields: { year: "2018", product: "Topps Chrome", players: ["Shohei Ohtani"] },
                  unresolved: []
                })
              }
            ]
          }
        ],
        usage: {}
      })
    }
  })
});
assert.equal(stepsOnlyResult.parsed.fields.year, "2018");
assert.equal(stepsOnlyResult.parsed.fields.product, "Topps Chrome");
assert.deepEqual(stepsOnlyResult.parsed.fields.players, ["Shohei Ohtani"]);

const visibleTextResult = await transcribeVisibleCardTextWithGemini({
  images: [{ dataUrl, side: "front" }],
  prompt: "Transcribe slab.",
  env,
  clientFactory: () => ({
    interactions: {
      create: async () => ({
        id: "interaction_visible_text",
        status: "completed",
        model: { id: "gemini-3.1-flash-lite" },
        output_text: JSON.stringify({
          confidence: "HIGH",
          visible_text_lines: [
            "2018 TOPPS CHROME",
            "SHOHEI OHTANI",
            "1983 TOPPS",
            "#83T-6",
            "GEM MT 10",
            "PSA"
          ],
          unresolved: []
        }),
        usage: {}
      })
    }
  })
});
assert.equal(visibleTextResult.parse_source, "visible_text");
assert.equal(visibleTextResult.parsed.fields.product, "Topps Chrome");
assert.deepEqual(visibleTextResult.parsed.fields.players, ["Shohei Ohtani"]);

const pollutedFieldsResult = await analyzeCardEvidenceWithGemini({
  images: [{ dataUrl, side: "front" }],
  prompt: "Return JSON.",
  env,
  clientFactory: () => ({
    interactions: {
      create: async () => ({
        id: "interaction_polluted_fields",
        status: "completed",
        model: { id: "gemini-3.1-flash-lite" },
        output_text: JSON.stringify({
          title: "2025-26 Panini Prizm FIFA Soccer Lionel Messi Club Legends RC Auto 029/199 CL-LM",
          confidence: "HIGH",
          recognition_status: "CONFIRMED",
          fields: {
            year: "2025-26, 2025 Panini Prizm FIFA Soccer (back copyright 2025, season 2025-26 stated on back). Note: The card back states 2025-26 Panini - Prizm FIFA Soccer and 2025 Panini America, Inc. copyright. The card is a 2025-26 release based on the back text provided on the card itself. The card is a 2025-26 release based on the back text provided on the card itself.",
            product: "",
            players: ["Lionel Messi"],
            serial_number: "029 / 199",
            checklist_code: "CL-LM",
            rc: true
          },
          unresolved: ["Exact parallel is not printed; leave exact parallel empty."]
        }),
        usage: {}
      })
    }
  })
});
assert.equal(pollutedFieldsResult.parsed.title, "");
assert.equal(pollutedFieldsResult.parsed.model_title_suggestion, "");
assert.equal(pollutedFieldsResult.parsed.fields.year, "2025-26");
assert.equal(pollutedFieldsResult.parsed.fields.product, "Panini Prizm FIFA Soccer");
assert.deepEqual(pollutedFieldsResult.parsed.fields.players, ["Lionel Messi"]);
assert.equal(pollutedFieldsResult.parsed.fields.serial_number, "029/199");
assert.equal(pollutedFieldsResult.parsed.fields.checklist_code, "CL-LM");
assert.equal(pollutedFieldsResult.parsed.fields.rc, false);
assert.doesNotMatch(JSON.stringify(pollutedFieldsResult.parsed.fields), /Note:|release based|copyright/i);

const slabVisibleTextResult = await analyzeCardEvidenceWithGemini({
  images: [{ dataUrl, side: "front" }],
  prompt: "Return JSON.",
  env,
  clientFactory: () => ({
    interactions: {
      create: async () => ({
        id: "interaction_slab_visible_text",
        status: "completed",
        output_text: JSON.stringify({
          title: "2018-19",
          confidence: "LOW",
          recognition_status: "RESOLVED",
          fields: {
            players: []
          },
          unresolved: [
            "visible_text: PSA label reads 2018 TOPPS CHROME / SHOHEI OHTANI / 1983 TOPPS / #83T-6 / GEM MT 10"
          ]
        }),
        usage: {}
      })
    }
  })
});
assert.equal(slabVisibleTextResult.parsed.fields.year, "2018");
assert.equal(slabVisibleTextResult.parsed.fields.product, "Topps Chrome");
assert.deepEqual(slabVisibleTextResult.parsed.fields.players, ["Shohei Ohtani"]);
assert.equal(slabVisibleTextResult.parsed.fields.collector_number, "83T-6");
assert.equal(slabVisibleTextResult.parsed.fields.card_number, "83T-6");
assert.equal(slabVisibleTextResult.parsed.fields.grade_company, "PSA");
assert.equal(slabVisibleTextResult.parsed.fields.card_grade, "10");
assert.equal(slabVisibleTextResult.parsed.fields.grade_type, "CARD_ONLY");
assert.equal(slabVisibleTextResult.parsed.fields.insert, "1983 Topps");

const descriptorPollutionResult = await analyzeCardEvidenceWithGemini({
  images: [{ dataUrl, side: "front" }],
  prompt: "Return JSON.",
  env,
  clientFactory: () => ({
    interactions: {
      create: async () => ({
        id: "interaction_descriptor_pollution",
        status: "completed",
        output_text: JSON.stringify({
          title: "",
          confidence: "MEDIUM",
          recognition_status: "RESOLVED",
          fields: {
            product: "Panini Impeccable Canvas Creations Auto Cristiano Ronaldo 91/99 BGS 8.5",
            players: [
              "Basketball, Cooper Flagg, Next Stop Signatures",
              "Shohei Ohtani Gold",
              "Gusto Shohei Ohtani"
            ],
            serial_number: "91/99"
          },
          unresolved: []
        }),
        usage: {}
      })
    }
  })
});
assert.equal(descriptorPollutionResult.parsed.fields.product, "Panini Impeccable");
assert.deepEqual(descriptorPollutionResult.parsed.fields.players, ["Cooper Flagg", "Shohei Ohtani"]);
assert.equal(descriptorPollutionResult.parsed.fields.serial_number, "91/99");

let locationRetryCalls = 0;
const retryAfterLocationUnavailable = await analyzeCardEvidenceWithGemini({
  images: [{ dataUrl, side: "front" }],
  prompt: "Return JSON.",
  env: {
    ...env,
    GEMINI_MAX_RETRIES: "1",
    GEMINI_RETRY_BASE_DELAY_MS: "1"
  },
  clientFactory: () => ({
    interactions: {
      create: async () => {
        locationRetryCalls += 1;
        if (locationRetryCalls === 1) {
          const error = new Error("400 This API is not available in your current location.");
          error.status = 400;
          error.body = JSON.stringify({
            error: {
              code: 400,
              message: "This API is not available in your current location. See https://ai.google.dev/gemini-api/docs/available-regions."
            }
          });
          throw error;
        }
        return {
          id: "interaction_retry_location",
          status: "completed",
          output_text: JSON.stringify({
            title: "",
            confidence: "MEDIUM",
            recognition_status: "RESOLVED",
            fields: {
              year: "2024",
              product: "Topps Chrome",
              players: ["Retry Player"]
            },
            unresolved: []
          }),
          usage: {
            total_input_tokens: 10,
            total_output_tokens: 8,
            total_tokens: 18
          }
        };
      }
    }
  })
});
assert.equal(locationRetryCalls, 2);
assert.equal(retryAfterLocationUnavailable.retry_attempts, 1);
assert.equal(retryAfterLocationUnavailable.recognition_status, "RESOLVED");

const abstainResult = await analyzeCardEvidenceWithGemini({
  images: [{ dataUrl, side: "front" }],
  prompt: "Return JSON.",
  env,
  clientFactory: () => ({
    interactions: {
      create: async () => ({
        id: "interaction_abstain",
        status: "completed",
        output_text: JSON.stringify({
          title: "",
          confidence: "HIGH",
          recognition_status: "ABSTAIN",
          error_type: "UNCERTAIN_FIELD",
          fields: {
            year: null,
            players: []
          },
          unresolved: []
        }),
        usage: {
          total_input_tokens: 10,
          total_output_tokens: 6,
          total_tokens: 16
        }
      })
    }
  })
});
assert.equal(abstainResult.recognition_status, "ABSTAIN");
assert.equal(abstainResult.error_type, "UNCERTAIN_FIELD");
assert.equal(abstainResult.parsed.confidence, "LOW");
assert.match(abstainResult.parsed.unresolved[0], /abstained/i);

let malformedCallCount = 0;
const repairedLocally = await analyzeCardEvidenceWithGemini({
  images: [{ dataUrl, side: "front" }],
  prompt: "Return JSON.",
  env,
  clientFactory: () => ({
    interactions: {
      create: async () => {
        malformedCallCount += 1;
        return {
          id: "interaction_malformed",
          status: "completed",
          output_text: `{"title":"","confidence":"HIGH","recognition_status":"CONFIRMED","fields":{"year":"2024","players":["Shohei Ohtani"],}, "unresolved":[]}`,
          usage: {
            total_input_tokens: 20,
            total_output_tokens: 10,
            total_tokens: 30
          }
        };
      }
    }
  })
});
assert.equal(malformedCallCount, 1);
assert.equal(repairedLocally.format_error_type, geminiFormatErrorTypes.JSON_SYNTAX_INVALID);
assert.equal(repairedLocally.format_repair_attempted, true);
assert.equal(repairedLocally.local_json_repair_success, true);
assert.equal(repairedLocally.text_repair_success, false);
assert.equal(repairedLocally.parse_source, "jsonrepair");
assert.equal(repairedLocally.parsed.fields.year, "2024");

const schemaScaffolded = await analyzeCardEvidenceWithGemini({
  images: [{ dataUrl, side: "front" }],
  prompt: "Return JSON.",
  env,
  clientFactory: () => ({
    interactions: {
      create: async () => ({
        id: "interaction_schema_scaffold",
        status: "completed",
        output_text: JSON.stringify({
          recognition_status: "confirmed",
          fields: {
            year: 2024,
            players: "Shohei Ohtani",
            insert: "Rookie Ticket",
            rc: "true"
          },
          unresolved: ["visible_text: RC logo visible"]
        }),
        usage: {
          total_input_tokens: 20,
          total_output_tokens: 10,
          total_tokens: 30
        }
      })
    }
  })
});
assert.equal(schemaScaffolded.format_error_type, geminiFormatErrorTypes.SCHEMA_INVALID);
assert.equal(schemaScaffolded.local_json_repair_success, true);
assert.equal(schemaScaffolded.parsed.recognition_status, "CONFIRMED");
assert.deepEqual(schemaScaffolded.parsed.fields.players, ["Shohei Ohtani"]);
assert.equal(schemaScaffolded.parsed.fields.rc, true);

let textRepairCallCount = 0;
let textRepairSecondRequest = null;
const repairedByTextOnly = await analyzeCardEvidenceWithGemini({
  images: [{ dataUrl, side: "front" }],
  prompt: "Return JSON.",
  env,
  clientFactory: () => ({
    interactions: {
      create: async (params) => {
        textRepairCallCount += 1;
        if (textRepairCallCount === 1) {
          return {
            id: "interaction_needs_text_repair",
            status: "completed",
            output_text: "title: '', confidence: HIGH, recognition_status: CONFIRMED, fields: year 2024 player Cooper Flagg",
            usage: {
              total_input_tokens: 30,
              total_output_tokens: 10,
              total_tokens: 40
            }
          };
        }
        textRepairSecondRequest = params;
        return {
          id: "interaction_text_repair",
          status: "completed",
          output_text: JSON.stringify({
            title: "",
            confidence: "HIGH",
            recognition_status: "CONFIRMED",
            fields: {
              year: "2024",
              players: ["Cooper Flagg"]
            },
            unresolved: []
          }),
          usage: {
            total_input_tokens: 15,
            total_output_tokens: 8,
            total_tokens: 23
          }
        };
      }
    }
  })
});
assert.equal(textRepairCallCount, 2);
assert.equal(textRepairSecondRequest.input.filter((part) => part.type === "image").length, 0);
assert.equal(repairedByTextOnly.format_error_type, geminiFormatErrorTypes.JSON_SYNTAX_INVALID);
assert.equal(repairedByTextOnly.local_json_repair_success, false);
assert.equal(repairedByTextOnly.text_repair_success, true);
assert.equal(repairedByTextOnly.usage.provider_calls, 2);
assert.equal(repairedByTextOnly.usage.image_count, 1);
assert.deepEqual(repairedByTextOnly.parsed.fields.players, ["Cooper Flagg"]);

let introducingRepairCallCount = 0;
await assert.rejects(
  analyzeCardEvidenceWithGemini({
    images: [{ dataUrl, side: "front" }],
    prompt: "Return JSON.",
    env,
    clientFactory: () => ({
      interactions: {
        create: async () => {
          introducingRepairCallCount += 1;
          if (introducingRepairCallCount === 1) {
            return {
              id: "interaction_bad_source",
              status: "completed",
              output_text: "fields: year 2024",
              usage: {}
            };
          }
          return {
            id: "interaction_bad_text_repair",
            status: "completed",
            output_text: JSON.stringify({
              title: "",
              confidence: "HIGH",
              recognition_status: "CONFIRMED",
              fields: {
                year: "2024",
                players: ["Invented Player"]
              },
              unresolved: []
            }),
            usage: {}
          };
        }
      }
    })
  }),
  (error) => {
    assert.equal(error.provider, "gemini");
    assert.equal(error.code, "response_format_invalid");
    assert.equal(error.details.format_error_type, geminiFormatErrorTypes.SCHEMA_INVALID);
    return true;
  }
);

let emptyCallCount = 0;
await assert.rejects(
  analyzeCardEvidenceWithGemini({
    images: [{ dataUrl, side: "front" }],
    prompt: "Return JSON.",
    env,
    clientFactory: () => ({
      interactions: {
        create: async () => {
          emptyCallCount += 1;
          return {
            id: "interaction_empty",
            status: "blocked",
            output_text: "",
            usage: {}
          };
        }
      }
    })
  }),
  (error) => {
    assert.equal(error.provider, "gemini");
    assert.equal(error.code, "response_format_invalid");
    assert.equal(error.details.format_error_type, geminiFormatErrorTypes.EMPTY_OR_BLOCKED);
    assert.equal(error.details.format_repair_attempted, false);
    assert.equal(emptyCallCount, 1);
    return true;
  }
);

await assert.rejects(
  analyzeCardEvidenceWithGemini({
    images: [{ url: "https://example.com/front.jpg" }],
    prompt: "Return JSON.",
    env,
    clientFactory: () => ({
      interactions: {
        create: async () => {
          const error = new Error(`401 invalid key ${env.GEMINI_API_KEY}`);
          error.status = 401;
          throw error;
        }
      }
    })
  }),
  (error) => {
    assert.equal(error.provider, "gemini");
    assert.equal(error.code, "auth_error");
    assert.equal(error.status, 401);
    assert.equal(error.message.includes(env.GEMINI_API_KEY), false);
    return true;
  }
);

await assert.rejects(
  analyzeCardEvidenceWithGemini({
    images: [{ url: "https://example.com/front.jpg" }],
    prompt: "Return JSON.",
    env,
    clientFactory: () => ({
      interactions: {
        create: async () => {
          const error = new Error("400 API error occurred");
          error.status = 400;
          error.body = JSON.stringify({
            error: {
              code: 400,
              message: `API key not valid. ${env.GEMINI_API_KEY}`,
              status: "INVALID_ARGUMENT",
              details: [{ reason: "API_KEY_INVALID" }]
            }
          });
          throw error;
        }
      }
    })
  }),
  (error) => {
    assert.equal(error.provider, "gemini");
    assert.equal(error.code, "auth_error");
    assert.equal(error.status, 400);
    assert.equal(error.message.includes(env.GEMINI_API_KEY), false);
    return true;
  }
);

await assert.rejects(
  analyzeCardEvidenceWithGemini({
    images: [{ url: "https://example.com/front.jpg" }],
    prompt: "Return JSON.",
    env,
    clientFactory: () => ({
      interactions: {
        create: async () => {
          const error = new Error("quota exhausted");
          error.status = 429;
          throw error;
        }
      }
    })
  }),
  (error) => error.provider === "gemini" && error.code === "rate_limited" && error.retryable === true
);

await assert.rejects(
  analyzeCardEvidenceWithGemini({
    images: [{ url: "https://example.com/front.jpg" }],
    prompt: "Return JSON.",
    env,
    clientFactory: () => ({
      interactions: {
        create: async () => {
          throw new Error("request timeout while waiting");
        }
      }
    })
  }),
  (error) => error.provider === "gemini" && error.code === "timeout" && error.retryable === true
);

const hardTimeoutStartedAt = Date.now();
await assert.rejects(
  analyzeCardEvidenceWithGemini({
    images: [{ url: "https://example.com/front.jpg" }],
    prompt: "Return JSON.",
    env: {
      ...env,
      GEMINI_TIMEOUT_MS: "20",
      GEMINI_MAX_RETRIES: "0"
    },
    clientFactory: () => ({
      interactions: {
        create: async () => new Promise(() => {})
      }
    })
  }),
  (error) => error.provider === "gemini" && error.code === "timeout" && error.retryable === true
);
assert.equal(Date.now() - hardTimeoutStartedAt < 1000, true);

console.log("gemini provider tests passed");
