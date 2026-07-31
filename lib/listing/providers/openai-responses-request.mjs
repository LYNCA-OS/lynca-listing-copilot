// Every gpt-5 model, including the dotted minor versions.
//
// The separator class has to admit "." as well as "-". Written as `gpt-5(?:$|-)`
// this matched gpt-5 and gpt-5-mini but not gpt-5.6-luna, which then took the
// pre-gpt-5 branch and was sent `temperature: 0`. OpenAI rejects that outright:
//   400 Unsupported parameter: 'temperature' is not supported with this model.
// So the whole provider call failed -- zero tokens, zero score -- and the cause
// was a regex that silently classified a gpt-5 model as a legacy one.
export function isGpt5ResponsesModel(model) {
  return /^gpt-5(?:$|[-.])/i.test(String(model || "").trim());
}

// The main path is literal hard-evidence transcription rendered by code, not
// prose. "minimal" effort is the closest match to the GPT-4.1-mini extraction
// behavior this path was tuned on and avoids spending output tokens on
// reasoning instead of field fidelity. Verbosity stays at the model-default
// "medium": "low" makes string field values terse enough to drop qualifiers
// that are load-bearing in titles (e.g. "Gold Shimmer" → "Gold").
// Which effort names a model actually accepts.
//
// This is not uniform across the gpt-5 family and the API rejects the request
// rather than ignoring an unknown value:
//   400 Unsupported value: 'minimal' is not supported with the 'gpt-5.6-luna'
//       model. Supported values are: 'none', 'low', 'medium', 'high', 'xhigh',
//       and 'max'.
// gpt-5 / gpt-5-mini take "minimal" and have no "none"; the dotted minor
// versions dropped "minimal" and added "none", "xhigh" and "max".
const gpt5LegacyEfforts = Object.freeze(["minimal", "low", "medium", "high"]);
const gpt5DottedEfforts = Object.freeze(["none", "low", "medium", "high", "xhigh", "max"]);

function isDottedGpt5Model(model) {
  return /^gpt-5\./i.test(String(model || "").trim());
}

export function supportedReasoningEfforts(model) {
  return isDottedGpt5Model(model) ? gpt5DottedEfforts : gpt5LegacyEfforts;
}

// "minimal" and "none" are the same intent -- spend nothing on reasoning, which
// is what this extraction path wants -- under two different names. Translating
// between them keeps OPENAI_GPT5_REASONING_EFFORT meaningful across models
// instead of making the variable model-specific.
const effortAliases = Object.freeze({ minimal: "none", none: "minimal" });

function configuredGpt5ReasoningEffort(env = process.env, model = "", effortOverride = "") {
  const supported = supportedReasoningEfforts(model);
  const override = String(effortOverride || "").trim().toLowerCase();
  const raw = override || String(env.OPENAI_GPT5_REASONING_EFFORT || "").trim().toLowerCase();
  const requested = raw || (isDottedGpt5Model(model) ? "none" : "minimal");
  if (supported.includes(requested)) return requested;
  const alias = effortAliases[requested];
  if (alias && supported.includes(alias)) return alias;
  // An unrecognised value falls back to the cheapest this model offers rather
  // than to a name it would reject.
  return supported[0];
}

function configuredGpt5TextVerbosity(env = process.env) {
  const raw = String(env.OPENAI_GPT5_TEXT_VERBOSITY || "medium").trim().toLowerCase();
  return ["low", "medium", "high"].includes(raw) ? raw : "medium";
}

export function openAiResponsesModelControls(model, { env = process.env, effortOverride = "" } = {}) {
  if (isGpt5ResponsesModel(model)) {
    return {
      reasoning: {
        // A per-request override exists so effort can be swept without one
        // deployment per value. Sweeping across deployments would put each
        // effort in its own time window, and the arms would then differ by
        // whatever else moved -- the same confound paired evaluation exists to
        // remove. It clamps through the same table, so an override the model
        // would reject can never reach the API.
        effort: configuredGpt5ReasoningEffort(env, model, effortOverride)
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
