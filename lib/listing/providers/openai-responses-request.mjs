export function isGpt5ResponsesModel(model) {
  return /^gpt-5(?:$|-)/i.test(String(model || "").trim());
}

export function openAiResponsesModelControls(model) {
  if (isGpt5ResponsesModel(model)) {
    return {
      reasoning: {
        effort: "low"
      }
    };
  }
  return {
    temperature: 0
  };
}

export function openAiResponsesTextOptions({ model, name, schema, strict = true }) {
  const text = {
    format: {
      type: "json_schema",
      name,
      strict,
      schema
    }
  };
  if (isGpt5ResponsesModel(model)) {
    text.verbosity = "low";
  }
  return text;
}
