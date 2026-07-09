// Env / provider-option flag parsing — extracted from the v2 monolith
// (docs/REFORM_PLAN.md R1). Copied verbatim; behavior must stay bit-identical.

export function envFlag(env, key, fallback = true) {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}

export function optionFlag(options, key, fallback) {
  if (!Object.prototype.hasOwnProperty.call(options, key)) return fallback;
  const raw = options[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}
