export function isGpt5ResponsesModel(model) {
  return /^gpt-5(?:$|-)/i.test(String(model || "").trim());
}

function configuredGpt5ReasoningEffort(env = process.env) {
  const raw = String(env.OPENAI_GPT5_REASONING_EFFORT || "medium").trim().toLowerCase();
  return ["minimal", "low", "medium", "high"].includes(raw) ? raw : "medium";
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

export function openAiResponsesTextOptions({ model, name, schema, strict = true, env = process.env }) {
  const text = {
    format: {
      type: "json_schema",
      name,
      strict,
      schema
    }
  };
  if (isGpt5ResponsesModel(model)) {
    text.verbosity = configuredGpt5TextVerbosity(env);
  }
  return text;
}
