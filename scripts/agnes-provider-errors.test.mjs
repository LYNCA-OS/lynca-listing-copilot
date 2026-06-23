import assert from "node:assert/strict";
import { analyzeCardEvidenceWithAgnes } from "../lib/listing/providers/agnes-provider.mjs";

const env = {
  AGNES_API_KEY: "test-agnes-key",
  AGNES_BASE_URL: "https://apihub.agnes-ai.com/v1",
  AGNES_MODEL: "agnes-2.0-flash",
  AGNES_TEMPERATURE: "0",
  AGNES_MAX_RETRIES: "0",
  AGNES_TIMEOUT_MS: "50",
  AGNES_RETRY_BASE_MS: "1",
  AGNES_RATE_LIMIT_RETRY_MS: "1",
  AGNES_MAX_RETRY_DELAY_MS: "5"
};

const oneImage = [{ url: "https://example.com/front.jpg" }];
const twoImages = [
  { url: "https://example.com/front.jpg" },
  { url: "https://example.com/back.jpg" }
];

function okChatCompletion({
  content = "{\"title\":\"Test\",\"fields\":{\"player\":\"Tester\"},\"unresolved\":[]}",
  toolCalls = null,
  model = "agnes-2.0-flash",
  finishReason = "stop",
  usage = { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 }
} = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      id: "chatcmpl_mock",
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
            ...(toolCalls ? { tool_calls: toolCalls } : {})
          },
          finish_reason: finishReason
        }
      ],
      usage
    })
  };
}

function errorResponse(status, text = "{\"error\":\"mock\"}", headers = {}) {
  return {
    ok: false,
    status,
    headers: {
      get(name) {
        return headers[String(name || "").toLowerCase()] || null;
      }
    },
    text: async () => text
  };
}

await assert.rejects(
  analyzeCardEvidenceWithAgnes({
    images: oneImage,
    prompt: "Return JSON.",
    env: {
      ...env,
      AGNES_API_KEY: ""
    },
    fetchImpl: async () => okChatCompletion()
  }),
  (error) => error.provider === "agnes" && error.code === "provider_unavailable"
);

await assert.rejects(
  analyzeCardEvidenceWithAgnes({
    images: [{ dataUrl: "data:image/jpeg;base64,AAAA" }],
    prompt: "Return JSON.",
    env,
    fetchImpl: async () => okChatCompletion()
  }),
  (error) => error.provider === "agnes" && error.code === "provider_input_unsupported"
);

let multiImageRequest;
const toolCallResult = await analyzeCardEvidenceWithAgnes({
  images: twoImages,
  prompt: "Use tool.",
  tools: [
    {
      type: "function",
      function: {
        name: "submit_card_evidence",
        parameters: {
          type: "object"
        }
      }
    }
  ],
  toolChoice: {
    type: "function",
    function: {
      name: "submit_card_evidence"
    }
  },
  env: {
    ...env,
    AGNES_ENABLE_THINKING: "true"
  },
  fetchImpl: async (url, init) => {
    multiImageRequest = { url, body: JSON.parse(init.body), headers: init.headers };
    return okChatCompletion({
      content: "",
      toolCalls: [
        {
          type: "function",
          function: {
            name: "submit_card_evidence",
            arguments: "{\"evidence\":{\"player\":{\"value\":\"Tester\"}},\"unresolved\":[]}"
          }
        }
      ],
      finishReason: "tool_calls"
    });
  }
});
assert.equal(multiImageRequest.url, "https://apihub.agnes-ai.com/v1/chat/completions");
assert.equal(multiImageRequest.headers.authorization, "Bearer test-agnes-key");
assert.equal(multiImageRequest.body.messages[0].content.length, 3);
assert.deepEqual(multiImageRequest.body.messages[0].content.slice(1).map((part) => part.type), ["image_url", "image_url"]);
assert.equal(multiImageRequest.body.tools[0].function.name, "submit_card_evidence");
assert.equal(multiImageRequest.body.tool_choice.function.name, "submit_card_evidence");
assert.deepEqual(multiImageRequest.body.chat_template_kwargs, { enable_thinking: true });
assert.equal(toolCallResult.parse_source, "tool_call");
assert.equal(toolCallResult.finish_reason, "tool_calls");
assert.equal(toolCallResult.parsed.evidence.player.value, "Tester");
assert.equal(toolCallResult.usage.image_count, 2);

await assert.rejects(
  analyzeCardEvidenceWithAgnes({
    images: oneImage,
    prompt: "Return JSON.",
    env,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => ""
    })
  }),
  (error) => error.provider === "agnes" && error.code === "empty_response"
);

await assert.rejects(
  analyzeCardEvidenceWithAgnes({
    images: oneImage,
    prompt: "Return JSON.",
    env,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => "not json"
    })
  }),
  (error) => error.provider === "agnes" && error.code === "non_json_response"
);

const statusExpectations = [
  [400, "bad_request"],
  [401, "auth_error"],
  [403, "auth_error"],
  [408, "timeout"],
  [429, "rate_limited"],
  [500, "upstream_error"],
  [502, "upstream_error"],
  [503, "upstream_error"],
  [504, "upstream_error"]
];
for (const [status, code] of statusExpectations) {
  await assert.rejects(
    analyzeCardEvidenceWithAgnes({
      images: oneImage,
      prompt: "Return JSON.",
      env,
      fetchImpl: async () => errorResponse(status, "mock status")
    }),
    (error) => error.provider === "agnes" && error.status === status && error.code === code
  );
}

let retryCalls = 0;
const retriedResult = await analyzeCardEvidenceWithAgnes({
  images: oneImage,
  prompt: "Return JSON.",
  env: {
    ...env,
    AGNES_MAX_RETRIES: "1"
  },
  fetchImpl: async () => {
    retryCalls += 1;
    if (retryCalls === 1) return errorResponse(429, "rate limited");
    return okChatCompletion();
  }
});
assert.equal(retryCalls, 2);
assert.equal(retriedResult.usage.provider_calls, 2);

let retryAfterCalls = 0;
const retryAfterResult = await analyzeCardEvidenceWithAgnes({
  images: oneImage,
  prompt: "Return JSON.",
  env: {
    ...env,
    AGNES_MAX_RETRIES: "1"
  },
  fetchImpl: async () => {
    retryAfterCalls += 1;
    if (retryAfterCalls === 1) return errorResponse(429, "rate limited", { "retry-after": "0" });
    return okChatCompletion();
  }
});
assert.equal(retryAfterCalls, 2);
assert.equal(retryAfterResult.usage.provider_calls, 2);

await assert.rejects(
  analyzeCardEvidenceWithAgnes({
    images: oneImage,
    prompt: "Return JSON.",
    env: {
      ...env,
      AGNES_TIMEOUT_MS: "1"
    },
    fetchImpl: async (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    })
  }),
  (error) => error.provider === "agnes" && error.code === "timeout"
);

const responseForUnreadableImage = await assert.rejects(
  analyzeCardEvidenceWithAgnes({
    images: oneImage,
    prompt: "Return JSON.",
    env,
    fetchImpl: async () => errorResponse(400, "image URL is not readable")
  }),
  (error) => error.provider === "agnes" && error.code === "bad_request" && /image URL/.test(error.message)
);
assert.equal(responseForUnreadableImage, undefined);

console.log("agnes provider error tests passed");
