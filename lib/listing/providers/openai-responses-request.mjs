export function isGpt5ResponsesModel(model) {
  return /^gpt-5(?:$|-)/i.test(String(model || "").trim());
}

// The main path is literal hard-evidence transcription rendered by code, not
// prose. "minimal" effort is the closest match to the GPT-4.1-mini extraction
// behavior this path was tuned on and avoids spending output tokens on
// reasoning instead of field fidelity. Verbosity stays at the model-default
// "medium": "low" makes string field values terse enough to drop qualifiers
// that are load-bearing in titles (e.g. "Gold Shimmer" → "Gold").
function configuredGpt5ReasoningEffort(env = process.env) {
  const raw = String(env.OPENAI_GPT5_REASONING_EFFORT || "minimal").trim().toLowerCase();
  return ["minimal", "low", "medium", "high"].includes(raw) ? raw : "minimal";
}

function configuredGpt5TextVerbosity(env = process.env) {
  const raw = String(env.OPENAI_GPT5_TEXT_VERBOSITY || "medium").trim().toLowerCase();
  return ["low", "medium", "high"].includes(raw) ? raw : "medium";
}

export function openAiResponsesModelControls(model, { env = process.env } = {}) {
  if (isGpt5ResponsesModel(model)) {
    return {
      reasoning: {
        effort: configuredGpt5ReasoningEffort(env)
      }
    };
  }
  return {
    temperature: 0
  };
}

export function openAiResponsesTextOptions({ model, name, schema, strict = true, env = process.env, verbosity = null }) {
  const text = {
    format: {
      type: "json_schema",
      name,
      strict,
      schema
    }
  };
  if (isGpt5ResponsesModel(model)) {
    const requestedVerbosity = String(verbosity || "").trim().toLowerCase();
    text.verbosity = ["low", "medium", "high"].includes(requestedVerbosity)
      ? requestedVerbosity
      : configuredGpt5TextVerbosity(env);
  }
  return text;
}
