import assert from "node:assert/strict";
import { verifyRetrievalCandidates } from "../lib/listing/orchestration/candidate-verifier.mjs";
import { createCompletionState } from "../lib/listing/orchestration/completion-state.mjs";
import { completeEvidence } from "../lib/listing/orchestration/evidence-completion-orchestrator.mjs";
import { completionActions, chooseNextBestAction } from "../lib/listing/orchestration/next-best-action.mjs";
import { createResolutionBudget } from "../lib/listing/orchestration/resolution-budget.mjs";
import { createEvidenceField } from "../lib/listing/evidence/evidence-schema.mjs";
import { retrievalProviderIds } from "../lib/listing/retrieval/retrieval-contract.mjs";

const baseResolved = {
  year: "2025",
  brand: "Topps",
  product: "Topps Chrome",
  players: ["Cooper Flagg"],
  checklist_code: "TCAR-CF",
  collector_number: "136"
};

const weakInitialState = createCompletionState({
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.62, status: "REVIEW" })
  },
  unresolved: ["product identity needs verification"]
});
const initialDecision = chooseNextBestAction({
  state: weakInitialState,
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"]
  },
  budget: createResolutionBudget()
});
assert.equal(initialDecision.action, completionActions.SEARCH_INTERNAL_APPROVED_HISTORY);
assert.notEqual(initialDecision.action, completionActions.ROUTE_TO_MANUAL);

const noDuplicateState = createCompletionState({
  resolved: baseResolved,
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.7, status: "REVIEW" })
  },
  unresolved: ["parallel requires review"],
  attemptedActions: [
    { action: completionActions.SEARCH_INTERNAL_APPROVED_HISTORY, status: "no_information" }
  ]
});
const duplicateDecision = chooseNextBestAction({
  state: noDuplicateState,
  resolved: baseResolved,
  budget: createResolutionBudget()
});
assert.equal(duplicateDecision.action, completionActions.SEARCH_INTERNAL_REGISTRY);

const occludedSerialState = createCompletionState({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {},
  unresolved: ["serial number unreadable"],
  captureQuality: {
    critical_region_occlusion: {
      serial_number: {
        status: "OCCLUDED",
        glare_score: 0.82,
        readability_score: 0.04
      }
    }
  }
});
const occlusionDecision = chooseNextBestAction({
  state: occludedSerialState,
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  budget: createResolutionBudget()
});
assert.equal(occlusionDecision.action, completionActions.CROP_AND_READ_SERIAL);

const recoveredSerialState = createCompletionState({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {},
  unresolved: ["serial number unreadable"],
  captureQuality: {
    route: "GLARE_RECOVERED",
    glare_route: "GLARE_RECOVERED",
    recovered_regions: ["serial_number"],
    unresolved_regions: [],
    critical_region_occlusion: {
      serial_number: {
        status: "CLEAR",
        recovered: true,
        recovery_method: "alternate_view"
      }
    },
    images: [
      {
        critical_region_occlusion: {
          serial_number: {
            status: "OCCLUDED",
            glare_score: 0.82,
            readability_score: 0.04
          }
        }
      }
    ]
  }
});
assert.deepEqual(recoveredSerialState.critical_region_occlusion, []);

const occlusionAfterCropState = createCompletionState({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", status: "CONFIRMED", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], status: "CONFIRMED", confidence: 0.9 })
  },
  unresolved: ["serial number unreadable"],
  captureQuality: {
    critical_region_occlusion: {
      serial_number: {
        status: "OCCLUDED",
        glare_score: 0.82,
        readability_score: 0.04
      }
    }
  },
  attemptedActions: [
    { action: completionActions.CROP_AND_READ_SERIAL, status: "no_information" }
  ]
});
const occlusionAfterCropDecision = chooseNextBestAction({
  state: occlusionAfterCropState,
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  budget: createResolutionBudget()
});
assert.equal(occlusionAfterCropDecision.action, completionActions.SEARCH_INTERNAL_APPROVED_HISTORY);
assert.notEqual(occlusionAfterCropDecision.action, completionActions.REQUEST_TARGETED_RESCAN);

const exhaustedOcclusionState = createCompletionState({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    collector_number: "136",
    checklist_code: "TCAR-CF"
  },
  evidence: {
    year: createEvidenceField({ value: "2025", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", status: "CONFIRMED", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], status: "CONFIRMED", confidence: 0.9 }),
    collector_number: createEvidenceField({ value: "136", status: "CONFIRMED", confidence: 0.9 }),
    checklist_code: createEvidenceField({ value: "TCAR-CF", status: "CONFIRMED", confidence: 0.9 })
  },
  unresolved: ["serial number unreadable"],
  captureQuality: {
    critical_region_occlusion: {
      serial_number: {
        status: "OCCLUDED",
        glare_score: 0.82,
        readability_score: 0.04
      }
    }
  },
  attemptedActions: [
    { action: completionActions.CROP_AND_READ_SERIAL, status: "no_information" },
    { action: completionActions.SEARCH_INTERNAL_APPROVED_HISTORY, status: "no_information" },
    { action: completionActions.SEARCH_INTERNAL_REGISTRY, status: "no_information" },
    { action: completionActions.SEARCH_EXACT_CHECKLIST_CODE, status: "no_information" },
    { action: completionActions.SEARCH_PLAYER_AND_COLLECTOR_NUMBER, status: "no_information" },
    { action: completionActions.SEARCH_OFFICIAL_SOURCES, status: "no_information" },
    { action: completionActions.SEARCH_BRAVE, status: "no_information" },
    { action: completionActions.SEARCH_EBAY, status: "no_information" },
    { action: completionActions.SEARCH_OWS_FALLBACK, status: "no_information" },
    { action: completionActions.AGNES_FOCUSED_RECHECK, status: "no_information" }
  ]
});
const exhaustedOcclusionDecision = chooseNextBestAction({
  state: exhaustedOcclusionState,
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    collector_number: "136",
    checklist_code: "TCAR-CF"
  },
  budget: createResolutionBudget()
});
assert.equal(exhaustedOcclusionDecision.action, completionActions.REQUEST_TARGETED_RESCAN);

const budgetStopped = await completeEvidence({
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"]
  },
  evidence: {},
  unresolved: ["product identity missing"],
  budgetOverrides: {
    maxRounds: 0
  }
});
assert.equal(budgetStopped.state.resolution_state, "BUDGET_EXHAUSTED");
assert.equal(budgetStopped.route, "NON_STANDARD_MANUAL");

const internalRunsWithoutExternalBudget = await completeEvidence({
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"]
  },
  evidence: {},
  unresolved: ["product identity missing"],
  budgetOverrides: {
    maxRounds: 1,
    maxExternalQueries: 0
  }
});
assert.equal(internalRunsWithoutExternalBudget.state.attempted_actions[0].action, completionActions.SEARCH_INTERNAL_APPROVED_HISTORY);
assert.equal(internalRunsWithoutExternalBudget.budget.used.external_queries, 0);

const unavailableRegistry = {
  get(providerId) {
    if (providerId !== retrievalProviderIds.BRAVE_SEARCH) return null;
    return {
      id: retrievalProviderIds.BRAVE_SEARCH,
      configured: false,
      enabled: true,
      async search() {
        return {
          provider_id: retrievalProviderIds.BRAVE_SEARCH,
          unavailable: true,
          reason: "BRAVE_SEARCH_API_KEY is not configured",
          candidates: []
        };
      }
    };
  }
};
const unavailableRetrieval = await completeEvidence({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.65, status: "REVIEW" })
  },
  unresolved: ["parallel requires review"],
  attemptedActions: [
    { action: completionActions.SEARCH_INTERNAL_APPROVED_HISTORY, status: "no_information" },
    { action: completionActions.SEARCH_INTERNAL_REGISTRY, status: "no_information" }
  ],
  providerRegistry: unavailableRegistry,
  budgetOverrides: {
    maxRounds: 1
  }
});
assert.ok(unavailableRetrieval.retrieval.unavailable.some((item) => item.provider_id === retrievalProviderIds.BRAVE_SEARCH));
assert.equal(unavailableRetrieval.route, "NON_STANDARD_MANUAL");
assert.deepEqual(unavailableRetrieval.technical_failures, []);
assert.ok(unavailableRetrieval.resolution_trace.every((entry) => !/GPT|openai_legacy/i.test(JSON.stringify(entry))));
assert.ok(unavailableRetrieval.state.attempted_actions.every((item) => !/GPT|openai_legacy/i.test(item.action)));

const thrownRetrievalFailure = await completeEvidence({
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.65, status: "REVIEW" })
  },
  unresolved: ["product identity missing"],
  budgetOverrides: {
    maxRounds: 1
  },
  runRetrievalImpl: async () => {
    const error = new Error("Brave provider failed with 503");
    error.code = "brave_server_error";
    throw error;
  }
});
assert.equal(thrownRetrievalFailure.route, "FAILED_TECHNICAL");
assert.match(thrownRetrievalFailure.route_reason, /technical failure/i);
assert.equal(thrownRetrievalFailure.resolution_trace[0].status, "error");
assert.equal(thrownRetrievalFailure.resolution_trace[0].output.technical_failure, true);
assert.equal(thrownRetrievalFailure.technical_failures[0].action, completionActions.SEARCH_INTERNAL_APPROVED_HISTORY);
assert.match(thrownRetrievalFailure.technical_failures[0].reason, /brave_server_error/);

const tracedRetrievalFailure = await completeEvidence({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.65, status: "REVIEW" })
  },
  unresolved: ["parallel requires review"],
  attemptedActions: [
    { action: completionActions.SEARCH_INTERNAL_APPROVED_HISTORY, status: "no_information" },
    { action: completionActions.SEARCH_INTERNAL_REGISTRY, status: "no_information" }
  ],
  budgetOverrides: {
    maxRounds: 1
  },
  runRetrievalImpl: async ({ allowedFamilies }) => ({
    mode: "AUTO",
    providers_used: [],
    queries: allowedFamilies.map((family) => ({ query_id: `technical_${family}`, provider_id: retrievalProviderIds.BRAVE_SEARCH })),
    sources: [],
    selected_candidate: null,
    candidate_margin: 0,
    conflicts: [],
    unavailable: [
      {
        provider_id: retrievalProviderIds.BRAVE_SEARCH,
        reason: "brave_timeout"
      }
    ],
    trace: [
      {
        provider_id: retrievalProviderIds.BRAVE_SEARCH,
        query_id: "technical_brave",
        status: "error",
        reason: "brave_timeout"
      }
    ]
  })
});
assert.equal(tracedRetrievalFailure.route, "FAILED_TECHNICAL");
assert.equal(tracedRetrievalFailure.resolution_trace[0].status, "error");
assert.equal(tracedRetrievalFailure.resolution_trace[0].output.technical_failures[0].reason, "brave_timeout");

let focusedRereadCalls = 0;
const focusedRereadCompletion = await completeEvidence({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    manufacturer: createEvidenceField({ value: "Topps", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.9 })
  },
  unresolved: ["serial number unreadable"],
  captureQuality: {
    critical_region_occlusion: {
      serial_number: {
        status: "OCCLUDED",
        glare_score: 0.82,
        readability_score: 0.04
      }
    }
  },
  budgetOverrides: {
    maxRounds: 1,
    maxAgnesCalls: 1
  },
  runFocusedVisionImpl: async ({ action, focusFields }) => {
    focusedRereadCalls += 1;
    assert.equal(action, completionActions.CROP_AND_READ_SERIAL);
    assert.deepEqual(focusFields, ["serial_number"]);

    return {
      provider_id: "agnes",
      model_id: "agnes-2.0-flash",
      resolved: {
        serial_number: "31/50"
      },
      evidence: {
        serial_number: createEvidenceField({
          value: "31/50",
          status: "CONFIRMED",
          confidence: 0.91,
          sources: [
            {
              source_type: "VISION_MODEL",
              image_id: "front-serial-crop",
              side: "front",
              capture_role: "focused_reread",
              region: "serial_number",
              observed_text: "31/50",
              glare_occlusion: 0.04,
              blur_score: 0.02,
              trust_tier: 2
            }
          ]
        })
      },
      usage: {
        estimated_cost_usd: 0.003
      }
    };
  }
});
assert.equal(focusedRereadCalls, 1);
assert.equal(focusedRereadCompletion.resolved.serial_number, "31/50");
assert.equal(focusedRereadCompletion.evidence.serial_number.status, "CONFIRMED");
assert.equal(focusedRereadCompletion.usage.provider_calls, 1);
assert.equal(focusedRereadCompletion.budget.used.agnes_calls, 1);
assert.equal(focusedRereadCompletion.route, "AI_COMPLETE_REVIEW");
const focusedRereadTrace = focusedRereadCompletion.resolution_trace.find((entry) => entry.output?.focused_vision?.updated_fields?.includes("serial_number"));
assert.equal(focusedRereadTrace.status, "executed");
assert.equal(focusedRereadCompletion.convergence_report.loop, "detect_conflict_retrieve_reevaluate_converge");
assert.ok(focusedRereadCompletion.convergence_report.iterations >= 1);
assert.equal(focusedRereadCompletion.convergence_report.converged, true);
assert.deepEqual(focusedRereadTrace.output.convergence.phases.map((phase) => phase.phase), [
  "detect_conflict",
  "retrieve_or_reread",
  "re_evaluate",
  "converge"
]);
assert.equal(focusedRereadTrace.output.convergence.action_kind, "reread");
assert.deepEqual(focusedRereadTrace.output.convergence.phases[1].focused_fields, ["serial_number"]);
assert.equal(focusedRereadCompletion.resolution_trace[0].action, completionActions.SEARCH_INTERNAL_APPROVED_HISTORY);
assert.ok(focusedRereadCompletion.resolution_trace.every((entry) => !/GPT|openai_legacy/i.test(JSON.stringify(entry))));

const invalidFocusedSerialCompletion = await completeEvidence({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.9 })
  },
  unresolved: ["serial number unreadable"],
  captureQuality: {
    critical_region_occlusion: {
      serial_number: {
        status: "OCCLUDED",
        glare_score: 0.82,
        readability_score: 0.04
      }
    }
  },
  budgetOverrides: {
    maxRounds: 1,
    maxAgnesCalls: 1
  },
  runFocusedVisionImpl: async () => ({
    provider_id: "agnes",
    model_id: "agnes-2.0-flash",
    resolved: {
      serial_number: "not visible"
    },
    evidence: {
      serial_number: createEvidenceField({
        value: "not visible",
        status: "REVIEW",
        confidence: 0.8
      })
    }
  })
});
const invalidFocusedSerialTrace = invalidFocusedSerialCompletion.resolution_trace
  .find((entry) => entry.action === completionActions.CROP_AND_READ_SERIAL);
assert.equal(invalidFocusedSerialTrace.status, "no_information");
assert.equal(invalidFocusedSerialCompletion.resolved.serial_number, null);
assert.equal(invalidFocusedSerialCompletion.evidence.serial_number, undefined);
assert.deepEqual(invalidFocusedSerialTrace.output.focused_vision.updated_fields, []);
assert.equal(invalidFocusedSerialTrace.output.focused_vision.rejected_fields[0].field, "serial_number");

let parallelInFlight = 0;
let parallelMaxInFlight = 0;
const parallelFocusedCompletion = await completeEvidence({
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"],
    parallel: "Gold"
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.62, status: "REVIEW" }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.61, status: "REVIEW" }),
    parallel: createEvidenceField({ value: "Gold", confidence: 0.58, status: "REVIEW" })
  },
  unresolved: ["product identity missing", "parallel requires review"],
  budgetOverrides: {
    maxRounds: 3,
    maxAgnesCalls: 3,
    maxExternalQueries: 0
  },
  runFocusedVisionImpl: async ({ action }) => {
    parallelInFlight += 1;
    parallelMaxInFlight = Math.max(parallelMaxInFlight, parallelInFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    parallelInFlight -= 1;

    if (action === completionActions.CROP_AND_READ_YEAR_PRODUCT) {
      return {
        provider_id: "agnes",
        model_id: "agnes-2.0-flash",
        resolved: {
          year: "2025",
          brand: "Topps",
          product: "Topps Chrome"
        },
        evidence: {
          year: createEvidenceField({ value: "2025", status: "CONFIRMED", confidence: 0.92 }),
          brand: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.92 }),
          product: createEvidenceField({ value: "Topps Chrome", status: "CONFIRMED", confidence: 0.92 })
        },
        usage: { estimated_cost_usd: 0.003 }
      };
    }

    if (action === completionActions.CROP_AND_READ_SUBJECT) {
      return {
        provider_id: "agnes",
        model_id: "agnes-2.0-flash",
        resolved: {
          players: ["Cooper Flagg"]
        },
        evidence: {
          players: createEvidenceField({ value: ["Cooper Flagg"], status: "CONFIRMED", confidence: 0.92 })
        },
        usage: { estimated_cost_usd: 0.003 }
      };
    }

    if (action === completionActions.CROP_AND_READ_PARALLEL) {
      return {
        provider_id: "agnes",
        model_id: "agnes-2.0-flash",
        resolved: {
          parallel: "Gold Wave"
        },
        evidence: {
          parallel: createEvidenceField({ value: "Gold Wave", status: "CONFIRMED", confidence: 0.9 })
        },
        usage: { estimated_cost_usd: 0.003 }
      };
    }

    return {
      provider_id: "agnes",
      model_id: "agnes-2.0-flash",
      resolved: {},
      evidence: {}
    };
  }
});
assert.ok(parallelMaxInFlight > 1);
assert.deepEqual(parallelFocusedCompletion.resolution_trace
  .map((entry) => entry.action)
  .filter((action) => [
    completionActions.CROP_AND_READ_YEAR_PRODUCT,
    completionActions.CROP_AND_READ_SUBJECT,
    completionActions.CROP_AND_READ_PARALLEL
  ].includes(action)), [
  completionActions.CROP_AND_READ_PARALLEL,
  completionActions.CROP_AND_READ_YEAR_PRODUCT,
  completionActions.CROP_AND_READ_SUBJECT
]);
assert.equal(parallelFocusedCompletion.resolved.product, "Topps Chrome");
assert.deepEqual(parallelFocusedCompletion.resolved.players, ["Cooper Flagg"]);
assert.equal(parallelFocusedCompletion.resolved.parallel, "Gold");
assert.equal(parallelFocusedCompletion.resolved.surface_color, "Gold");
assert.equal(parallelFocusedCompletion.resolved.parallel_family, "Wave");
assert.ok(parallelFocusedCompletion.evidence.surface_color.sources.some((source) => {
  return source.capture_role === "focused_reread"
    && source.region === completionActions.CROP_AND_READ_PARALLEL;
}));
assert.equal(parallelFocusedCompletion.budget.used.agnes_calls, 3);
assert.equal(parallelFocusedCompletion.usage.provider_calls, 3);

let lowConfidenceFocusedParallelAction = null;
const lowConfidenceFocusedParallelCompletion = await completeEvidence({
  resolved: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025-26", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", status: "CONFIRMED", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], status: "CONFIRMED", confidence: 0.9 })
  },
  unresolved: ["parallel requires review"],
  env: {
    MAX_PARALLEL_FOCUSED_REREADS: "1"
  },
  budgetOverrides: {
    maxRounds: 2,
    maxAgnesCalls: 1,
    maxExternalQueries: 0
  },
  runRetrievalImpl: async () => ({
    mode: "AUTO",
    providers_used: [],
    queries: [],
    sources: [],
    unavailable: [],
    trace: []
  }),
  runFocusedVisionImpl: async ({ action }) => {
    lowConfidenceFocusedParallelAction = action;
    return {
      provider_id: "agnes",
      model_id: "agnes-2.0-flash",
      resolved: {
        parallel: "Purple"
      },
      evidence: {
        parallel: createEvidenceField({ value: "Purple", status: "REVIEW", confidence: 0.35 })
      },
      unresolved: []
    };
  }
});
assert.equal(lowConfidenceFocusedParallelAction, completionActions.CROP_AND_READ_PARALLEL);
assert.equal(lowConfidenceFocusedParallelCompletion.resolved.surface_color, "Purple");
assert.equal(lowConfidenceFocusedParallelCompletion.resolved.parallel, null);
assert.equal(lowConfidenceFocusedParallelCompletion.evidence.surface_color.status, "REVIEW");
assert.equal(lowConfidenceFocusedParallelCompletion.evidence.surface_color.confidence, 0.35);

const blockedFocusedParallelCompletion = await completeEvidence({
  resolved: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025-26", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", status: "CONFIRMED", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], status: "CONFIRMED", confidence: 0.9 })
  },
  unresolved: ["parallel requires review"],
  env: {
    MAX_PARALLEL_FOCUSED_REREADS: "1"
  },
  budgetOverrides: {
    maxRounds: 2,
    maxAgnesCalls: 1,
    maxExternalQueries: 0
  },
  runRetrievalImpl: async () => ({
    mode: "AUTO",
    providers_used: [],
    queries: [],
    sources: [],
    unavailable: [],
    trace: []
  }),
  runFocusedVisionImpl: async () => ({
    provider_id: "agnes",
    model_id: "agnes-2.0-flash",
    resolved: {
      parallel: "Purple"
    },
    evidence: {
      parallel: createEvidenceField({
        value: "Purple",
        status: "REVIEW",
        confidence: 0.35,
        unresolvedReason: "operator_review_requested"
      })
    },
    unresolved: ["visual-only parallel requires operator review"]
  })
});
assert.equal(blockedFocusedParallelCompletion.resolved.surface_color, "Purple");
assert.equal(blockedFocusedParallelCompletion.resolved.parallel, null);
assert.equal(blockedFocusedParallelCompletion.evidence.surface_color.status, "REVIEW");
assert.equal(blockedFocusedParallelCompletion.evidence.surface_color.confidence, 0.35);

let retryFocusedParallelAttempts = 0;
const retryFocusedParallelCompletion = await completeEvidence({
  resolved: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Victor Wembanyama"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025-26", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", status: "CONFIRMED", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Victor Wembanyama"], status: "CONFIRMED", confidence: 0.9 })
  },
  unresolved: ["parallel requires review"],
  env: {
    MAX_PARALLEL_FOCUSED_REREADS: "1",
    AGNES_FOCUSED_VISION_RETRIES: "1"
  },
  budgetOverrides: {
    maxRounds: 2,
    maxAgnesCalls: 2,
    maxExternalQueries: 0
  },
  runRetrievalImpl: async () => ({
    mode: "AUTO",
    providers_used: [],
    queries: [],
    sources: [],
    unavailable: [],
    trace: []
  }),
  runFocusedVisionImpl: async () => {
    retryFocusedParallelAttempts += 1;
    if (retryFocusedParallelAttempts === 1) {
      const error = new Error("timeout");
      error.code = "timeout";
      throw error;
    }
    return {
      provider_id: "agnes",
      model_id: "agnes-2.0-flash",
      resolved: {
        parallel: "Gold"
      },
      evidence: {
        parallel: createEvidenceField({ value: "Gold", status: "REVIEW", confidence: 0.35 })
      },
      unresolved: []
    };
  }
});
const retryFocusedTrace = retryFocusedParallelCompletion.resolution_trace.find((entry) => {
  return entry.action === completionActions.CROP_AND_READ_PARALLEL
    && entry.output?.focused_vision?.updated_fields?.includes("surface_color");
});
assert.equal(retryFocusedParallelAttempts, 2);
assert.equal(retryFocusedParallelCompletion.resolved.surface_color, "Gold");
assert.equal(retryFocusedParallelCompletion.resolved.parallel, null);
assert.equal(retryFocusedParallelCompletion.budget.used.agnes_calls, 2);
assert.equal(retryFocusedTrace.output.transient_retry_attempts, 1);

const compatibleFocusedParallelCompletion = await completeEvidence({
  resolved: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    parallel: "Refractor"
  },
  evidence: {
    year: createEvidenceField({ value: "2025-26", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", status: "CONFIRMED", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], status: "CONFIRMED", confidence: 0.9 }),
    parallel: createEvidenceField({ value: "Refractor", status: "CONFIRMED", confidence: 0.9 })
  },
  env: {
    ENABLE_PROACTIVE_AGNES_FOCUSED_REREADS: "1",
    MAX_PARALLEL_FOCUSED_REREADS: "2"
  },
  budgetOverrides: {
    maxRounds: 2,
    maxAgnesCalls: 2,
    maxExternalQueries: 0
  },
  runFocusedVisionImpl: async ({ action }) => {
    if (action !== completionActions.CROP_AND_READ_PARALLEL) {
      return {
        provider_id: "agnes",
        model_id: "agnes-2.0-flash",
        resolved: {},
        evidence: {}
      };
    }
    return {
      provider_id: "agnes",
      model_id: "agnes-2.0-flash",
      resolved: {
        parallel: "Purple Refractor"
      },
      evidence: {
        parallel: createEvidenceField({ value: "Purple Refractor", status: "REVIEW", confidence: 0.35 })
      },
      unresolved: []
    };
  }
});
assert.equal(compatibleFocusedParallelCompletion.resolved.parallel, "Refractor");
assert.equal(compatibleFocusedParallelCompletion.resolved.surface_color, "Purple");
assert.equal(compatibleFocusedParallelCompletion.resolved.parallel_family, "Refractor");
assert.equal(compatibleFocusedParallelCompletion.evidence.surface_color.status, "REVIEW");
assert.ok(compatibleFocusedParallelCompletion.resolution_trace.some((entry) => {
  return entry.action === completionActions.CROP_AND_READ_PARALLEL
    && entry.output?.focused_vision?.updated_fields?.includes("surface_color")
    && entry.output.focused_vision.field_values?.surface_color === "Purple";
}));

const proactiveFocusedActions = [];
const proactiveFocusedCompletion = await completeEvidence({
  resolved: {
    year: "2022",
    manufacturer: "Panini",
    brand: "Panini",
    product: "Gold Standard",
    players: ["Hunter Renfrow"],
    serial_number: "196/299"
  },
  evidence: {
    year: createEvidenceField({ value: "2022", status: "CONFIRMED", confidence: 0.9 }),
    manufacturer: createEvidenceField({ value: "Panini", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Panini", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({ value: "Gold Standard", status: "CONFIRMED", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Hunter Renfrow"], status: "CONFIRMED", confidence: 0.9 }),
    serial_number: createEvidenceField({ value: "196/299", status: "CONFIRMED", confidence: 0.9 })
  },
  env: {
    ENABLE_PROACTIVE_AGNES_FOCUSED_REREADS: "1",
    MAX_PARALLEL_FOCUSED_REREADS: "3"
  },
  budgetOverrides: {
    maxRounds: 3,
    maxAgnesCalls: 3,
    maxExternalQueries: 0
  },
  runFocusedVisionImpl: async ({ action }) => {
    proactiveFocusedActions.push(action);
    return {
      provider_id: "agnes",
      model_id: "agnes-2.0-flash",
      resolved: {},
      evidence: {}
    };
  }
});
assert.equal(proactiveFocusedCompletion.resolution_trace[0].action, completionActions.CROP_AND_READ_SERIAL);
assert.deepEqual(proactiveFocusedActions.slice(0, 3), [
  completionActions.CROP_AND_READ_SERIAL,
  completionActions.CROP_AND_READ_PARALLEL,
  completionActions.CROP_AND_READ_YEAR_PRODUCT
]);

const proactiveSerialOnlyActions = [];
const proactiveSerialOnlyCompletion = await completeEvidence({
  resolved: {
    year: "2022",
    manufacturer: "Panini",
    brand: "Panini",
    product: "Gold Standard",
    players: ["Hunter Renfrow"],
    serial_number: "196/299"
  },
  evidence: {
    year: createEvidenceField({ value: "2022", status: "CONFIRMED", confidence: 0.9 }),
    manufacturer: createEvidenceField({ value: "Panini", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Panini", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({ value: "Gold Standard", status: "CONFIRMED", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Hunter Renfrow"], status: "CONFIRMED", confidence: 0.9 }),
    serial_number: createEvidenceField({ value: "196/299", status: "CONFIRMED", confidence: 0.9 })
  },
  env: {
    ENABLE_PROACTIVE_AGNES_FOCUSED_REREADS: "1",
    ENABLE_PROACTIVE_AGNES_SERIAL_ONLY: "1",
    MAX_PARALLEL_FOCUSED_REREADS: "3"
  },
  budgetOverrides: {
    maxRounds: 3,
    maxAgnesCalls: 3,
    maxExternalQueries: 0
  },
  runFocusedVisionImpl: async ({ action }) => {
    proactiveSerialOnlyActions.push(action);
    return {
      provider_id: "agnes",
      model_id: "agnes-2.0-flash",
      resolved: {},
      evidence: {}
    };
  }
});
assert.deepEqual(proactiveSerialOnlyActions, [completionActions.CROP_AND_READ_SERIAL]);
assert.equal(proactiveSerialOnlyCompletion.resolution_trace[0].action, completionActions.CROP_AND_READ_SERIAL);

const noInfoOcclusionCompletion = await completeEvidence({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", status: "CONFIRMED", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], status: "CONFIRMED", confidence: 0.9 })
  },
  unresolved: ["serial number unreadable"],
  captureQuality: {
    critical_region_occlusion: {
      serial_number: {
        status: "OCCLUDED",
        glare_score: 0.82,
        readability_score: 0.04
      }
    }
  },
  budgetOverrides: {
    maxRounds: 9,
    maxExternalQueries: 6,
    maxAgnesCalls: 2
  },
  runFocusedVisionImpl: async () => ({
    provider_id: "agnes",
    model_id: "agnes-2.0-flash",
    resolved: {},
    evidence: {},
    usage: {
      estimated_cost_usd: 0.001
    }
  }),
  runRetrievalImpl: async ({ allowedFamilies }) => ({
    mode: "AUTO",
    providers_used: [],
    queries: allowedFamilies.map((family) => ({
      query_id: `no_info_${family}`,
      provider_id: family
    })),
    sources: [],
    selected_candidate: null,
    candidate_margin: 0,
    conflicts: [],
    unavailable: [],
    trace: []
  })
});
const noInfoOcclusionActions = noInfoOcclusionCompletion.resolution_trace.map((entry) => entry.action);
assert.deepEqual(noInfoOcclusionActions, [
  completionActions.SEARCH_INTERNAL_APPROVED_HISTORY,
  completionActions.CROP_AND_READ_SERIAL,
  completionActions.SEARCH_INTERNAL_REGISTRY,
  completionActions.SEARCH_BRAVE,
  completionActions.SEARCH_EBAY,
  completionActions.SEARCH_OWS_FALLBACK,
  completionActions.AGNES_FOCUSED_RECHECK,
  completionActions.REQUEST_TARGETED_RESCAN
]);
assert.equal(noInfoOcclusionCompletion.route, "TARGETED_RESCAN_REQUIRED");
assert.equal(noInfoOcclusionCompletion.state.resolution_state, "TARGETED_RESCAN_REQUIRED");
assert.equal(noInfoOcclusionCompletion.convergence_report.terminal_state, "TARGETED_RESCAN_REQUIRED");
assert.ok(noInfoOcclusionCompletion.convergence_report.final_open_fields.includes("serial_number"));

const officialCandidate = {
  candidate_id: "official_tcar_cf",
  source_url: "https://www.topps.com/cards/tcar-cf",
  domain: "topps.com",
  source_type: "OFFICIAL_PRODUCT_PAGE",
  trust_tier: 2,
  title: "2025 Topps Chrome Cooper Flagg TCAR-CF",
  evidence_excerpt: "Official product page confirms Topps Chrome TCAR-CF Cooper Flagg.",
  match_score: 0.91,
  fields: {
    brand: "Topps",
    product: "Topps Chrome",
    checklist_code: "TCAR-CF"
  }
};
const officialVerification = verifyRetrievalCandidates({
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.9 })
  },
  retrieval: {
    selected_candidate: officialCandidate,
    sources: [officialCandidate]
  }
});
assert.equal(officialVerification.resolved.product, "Topps Chrome");
assert.equal(officialVerification.resolved.checklist_code, "TCAR-CF");
assert.equal(officialVerification.evidence.product.status, "CONFIRMED");
assert.equal(officialVerification.evidence.grade_type, undefined);
assert.ok(officialVerification.summary.verified_fields.includes("product"));

const internalHistoryCandidate = {
  candidate_id: "internal_history_tcar_cf",
  source_url: "internal://approved-history/card-1",
  domain: "internal-approved-history",
  source_type: "INTERNAL_APPROVED_HISTORY",
  trust_tier: 3,
  title: "Approved history TCAR-CF",
  evidence_excerpt: "Approved listing history confirms Topps Chrome TCAR-CF.",
  match_score: 0.8,
  fields: {
    product: "Topps Chrome",
    checklist_code: "TCAR-CF"
  }
};
const independentClosure = verifyRetrievalCandidates({
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.9 })
  },
  retrieval: {
    selected_candidate: null,
    sources: [officialCandidate, internalHistoryCandidate]
  }
});
assert.equal(independentClosure.resolved.product, "Topps Chrome");
assert.equal(independentClosure.resolved.checklist_code, "TCAR-CF");
assert.equal(independentClosure.evidence.product.status, "CONFIRMED");
assert.equal(independentClosure.evidence.product.sources.length, 2);
assert.ok(independentClosure.summary.independent_closure_fields.includes("product"));

const independentConflict = verifyRetrievalCandidates({
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"]
  },
  evidence: {},
  retrieval: {
    selected_candidate: null,
    sources: [
      officialCandidate,
      internalHistoryCandidate,
      {
        ...officialCandidate,
        candidate_id: "official_bowman_1",
        domain: "beckett.com",
        source_type: "STRUCTURED_DATABASE",
        trust_tier: 4,
        fields: {
          product: "Bowman Chrome"
        }
      },
      {
        ...officialCandidate,
        candidate_id: "official_bowman_2",
        domain: "psacard.com",
        source_type: "OFFICIAL_GRADING_DATA",
        trust_tier: 2,
        fields: {
          product: "Bowman Chrome"
        }
      }
    ]
  }
});
assert.equal(independentConflict.resolved.product, null);
assert.equal(independentConflict.evidence.product.status, "CONFLICT");
assert.ok(independentConflict.summary.conflicting_fields.includes("product"));

const marketplaceCandidate = {
  candidate_id: "market_gold_wave",
  source_url: "https://www.ebay.com/itm/1",
  domain: "ebay.com",
  source_type: "MARKETPLACE",
  trust_tier: 8,
  title: "Seller title says Gold Wave",
  evidence_excerpt: "Marketplace reference only.",
  match_score: 0.95,
  fields: {
    parallel: "Gold Wave"
  }
};
const marketplaceVerification = verifyRetrievalCandidates({
  resolved: baseResolved,
  evidence: {},
  retrieval: {
    selected_candidate: marketplaceCandidate,
    sources: [marketplaceCandidate]
  }
});
assert.equal(marketplaceVerification.resolved.parallel, null);
assert.equal(marketplaceVerification.evidence.parallel, undefined);
assert.equal(marketplaceVerification.summary.market_reference_fields.parallel[0].value, "Gold Wave");
assert.equal(marketplaceVerification.summary.ignored_candidates[0].reason, "candidate_source_is_reference_only");

const conflictingVerification = verifyRetrievalCandidates({
  resolved: {
    ...baseResolved,
    product: "Topps Chrome"
  },
  evidence: {
    product: createEvidenceField({ value: "Topps Chrome", confidence: 0.9 })
  },
  retrieval: {
    selected_candidate: {
      ...officialCandidate,
      candidate_id: "official_conflict",
      fields: {
        product: "Bowman Chrome"
      }
    },
    sources: []
  }
});
assert.equal(conflictingVerification.resolved.product, "Topps Chrome");
assert.equal(conflictingVerification.evidence.product.status, "CONFLICT");
assert.ok(conflictingVerification.summary.conflicting_fields.includes("product"));

const conflictThenRetrievalConverges = await completeEvidence({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", status: "CONFIRMED", confidence: 0.9 }),
    manufacturer: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({
      value: "Topps Chrome",
      status: "CONFLICT",
      confidence: 0.5,
      conflicts: [
        {
          field: "product",
          existing_value: "Topps Chrome",
          candidate_value: "Bowman Chrome",
          reason: "initial_ocr_registry_conflict"
        }
      ]
    }),
    players: createEvidenceField({ value: ["Cooper Flagg"], status: "CONFIRMED", confidence: 0.9 })
  },
  budgetOverrides: {
    maxRounds: 2
  },
  runRetrievalImpl: async () => ({
    mode: "AUTO",
    providers_used: [retrievalProviderIds.INTERNAL_MEMORY],
    queries: [{ query_id: "approved_history_conflict_resolution", provider_id: retrievalProviderIds.INTERNAL_MEMORY }],
    sources: [internalHistoryCandidate],
    selected_candidate: internalHistoryCandidate,
    candidate_margin: 0.8,
    conflicts: [],
    unavailable: [],
    trace: []
  })
});
assert.equal(conflictThenRetrievalConverges.resolved.product, "Topps Chrome");
assert.equal(conflictThenRetrievalConverges.evidence.product.status, "CONFIRMED");
assert.equal(conflictThenRetrievalConverges.route, "AI_COMPLETE_REVIEW");
assert.ok(conflictThenRetrievalConverges.resolution_trace[0].output.convergence.before.conflicting_fields.includes("product"));
assert.ok(conflictThenRetrievalConverges.resolution_trace[0].output.convergence.resolved_conflicts.includes("product"));
assert.equal(conflictThenRetrievalConverges.resolution_trace[0].output.convergence.converged, true);

let conflictRetrievalCalls = 0;
const conflictingCandidate = {
  ...officialCandidate,
  candidate_id: "official_bowman_conflict",
  domain: "beckett.com",
  source_type: "STRUCTURED_DATABASE",
  trust_tier: 4,
  match_score: 0.9,
  fields: {
    year: "2025",
    player: "Cooper Flagg",
    product: "Bowman Chrome"
  }
};
const verifyCandidateLoop = await completeEvidence({
  resolved: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", status: "CONFIRMED", confidence: 0.9 }),
    manufacturer: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    brand: createEvidenceField({ value: "Topps", status: "CONFIRMED", confidence: 0.9 }),
    product: createEvidenceField({
      value: "Topps Chrome",
      status: "CONFLICT",
      confidence: 0.5,
      conflicts: [
        {
          field: "product",
          existing_value: "Topps Chrome",
          candidate_value: "Bowman Chrome",
          reason: "candidate_conflicts_with_current_identity"
        }
      ]
    }),
    players: createEvidenceField({ value: ["Cooper Flagg"], status: "CONFIRMED", confidence: 0.9 })
  },
  budgetOverrides: {
    maxRounds: 1
  },
  runRetrievalImpl: async () => {
    conflictRetrievalCalls += 1;
    return {
      mode: "AUTO",
      providers_used: [retrievalProviderIds.BRAVE_SEARCH],
      queries: [{ query_id: "conflicting_candidate_query", provider_id: retrievalProviderIds.BRAVE_SEARCH }],
      sources: [conflictingCandidate],
      selected_candidate: conflictingCandidate,
      candidate_margin: 0.9,
      conflicts: [],
      unavailable: [],
      trace: []
    };
  }
});
assert.equal(conflictRetrievalCalls, 1);
assert.deepEqual(verifyCandidateLoop.resolution_trace.map((entry) => entry.action), [
  completionActions.SEARCH_INTERNAL_APPROVED_HISTORY,
  completionActions.VERIFY_CANDIDATE
]);
const verifyCandidateTrace = verifyCandidateLoop.resolution_trace.find((entry) => entry.action === completionActions.VERIFY_CANDIDATE);
assert.equal(verifyCandidateTrace.status, "executed");
assert.ok(verifyCandidateTrace.input.conflicting_fields.includes("product"));
assert.equal(verifyCandidateTrace.output.candidate_count, 1);
assert.equal(verifyCandidateTrace.output.convergence.loop, "detect_conflict_retrieve_reevaluate_converge");
assert.equal(verifyCandidateLoop.retrieval.selected_candidate, null);
assert.equal(verifyCandidateLoop.retrieval.sources[0].rejection_reason, "candidate_has_conflicting_fields");

const lowMarginConflict = {
  type: "LOW_MARGIN_CANDIDATE_CONFLICT",
  reason: "candidate_margin_below_selection_threshold",
  candidate_margin: 0.07,
  threshold: 0.12,
  conflicting_fields: ["product"],
  candidate_ids: ["topps_candidate", "bowman_candidate"]
};
const lowMarginCompletion = await completeEvidence({
  resolved: {
    year: "2025",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    product: createEvidenceField({ value: "Topps Chrome", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.7, status: "REVIEW" })
  },
  unresolved: ["parallel requires review"],
  attemptedActions: [
    { action: completionActions.SEARCH_INTERNAL_APPROVED_HISTORY, status: "no_information" },
    { action: completionActions.SEARCH_INTERNAL_REGISTRY, status: "no_information" }
  ],
  budgetOverrides: {
    maxRounds: 1
  },
  runRetrievalImpl: async () => ({
    mode: "AUTO",
    providers_used: [retrievalProviderIds.BRAVE_SEARCH],
    queries: [{ query_id: "low_margin_brave", provider_id: retrievalProviderIds.BRAVE_SEARCH }],
    sources: [
      {
        candidate_id: "topps_candidate",
        domain: "structured.example",
        source_type: "STRUCTURED_DATABASE",
        source_url: "https://structured.example/topps",
        trust_tier: 4,
        match_score: 0.51,
        rejection_reason: "candidate_margin_below_selection_threshold",
        fields: {
          year: "2025",
          player: "Cooper Flagg",
          product: "Topps Chrome"
        }
      },
      {
        candidate_id: "bowman_candidate",
        domain: "structured.example",
        source_type: "STRUCTURED_DATABASE",
        source_url: "https://structured.example/bowman",
        trust_tier: 2,
        match_score: 0.44,
        rejection_reason: "lower_match_score",
        fields: {
          year: "2025",
          player: "Cooper Flagg",
          product: "Bowman Chrome"
        }
      }
    ],
    selected_candidate: null,
    candidate_margin: 0.07,
    candidate_selection_threshold: 0.12,
    low_margin_conflict: lowMarginConflict,
    conflicts: [lowMarginConflict],
    unavailable: [],
    trace: []
  })
});
assert.equal(lowMarginCompletion.resolved.product, "Topps Chrome");
assert.equal(lowMarginCompletion.retrieval.selected_candidate, null);
assert.equal(lowMarginCompletion.retrieval.low_margin_conflict.reason, "candidate_margin_below_selection_threshold");
assert.equal(lowMarginCompletion.resolution_trace[0].output.low_margin_conflict.reason, "candidate_margin_below_selection_threshold");
assert.equal(lowMarginCompletion.resolution_trace[0].output.candidate_verification.low_margin_conflict.reason, "candidate_margin_below_selection_threshold");
assert.equal(lowMarginCompletion.resolution_trace[0].output.candidate_verification.ranking_conflicts.length, 1);

const completionWithTrustedRetrieval = await completeEvidence({
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"]
  },
  evidence: {
    year: createEvidenceField({ value: "2025", confidence: 0.9 }),
    players: createEvidenceField({ value: ["Cooper Flagg"], confidence: 0.9 })
  },
  unresolved: ["product identity missing"],
  budgetOverrides: {
    maxRounds: 1
  },
  runRetrievalImpl: async () => ({
    mode: "AUTO",
    providers_used: [retrievalProviderIds.BRAVE_SEARCH],
    queries: [{ query_id: "official_query_1", provider_id: retrievalProviderIds.BRAVE_SEARCH }],
    sources: [officialCandidate],
    selected_candidate: officialCandidate,
    candidate_margin: 0.91,
    conflicts: [],
    unavailable: [],
    trace: []
  })
});
assert.equal(completionWithTrustedRetrieval.resolved.product, "Topps Chrome");
assert.equal(completionWithTrustedRetrieval.evidence.product.status, "CONFIRMED");
assert.equal(completionWithTrustedRetrieval.route, "AI_COMPLETE_REVIEW");
assert.ok(completionWithTrustedRetrieval.resolution_trace[0].output.candidate_verification.verified_fields.includes("product"));
assert.equal(completionWithTrustedRetrieval.resolution_trace[0].output.convergence.loop, "detect_conflict_retrieve_reevaluate_converge");
assert.equal(completionWithTrustedRetrieval.resolution_trace[0].output.convergence.after.resolution_state, "EVIDENCE_CLOSED");
assert.equal(completionWithTrustedRetrieval.resolution_trace[0].output.convergence.converged, true);

const completion = await completeEvidence({
  resolved: {
    year: "2025",
    players: ["Cooper Flagg"]
  },
  evidence: {},
  unresolved: ["product identity missing"],
  budgetOverrides: {
    maxRounds: 2
  }
});
assert.ok(completion.state.attempted_actions.every((item) => !/GPT|openai_legacy/i.test(item.action)));
assert.ok(completion.resolution_trace.length >= 1);

console.log("orchestration tests passed");
