export const providerTerminalPathActions = Object.freeze({
  RETURN_ASSIST_SHADOW: "RETURN_ASSIST_SHADOW",
  CONTINUE_RESOLUTION: "CONTINUE_RESOLUTION"
});

export const providerTerminalPathPolicy = Object.freeze({
  policy_id: "provider-terminal-path-policy",
  policy_version: "2026-07-19.1"
});

// This policy owns only the control boundary after the initial provider call.
// The pipeline still owns I/O, candidate application, rendering, and persistence.
export function planProviderTerminalPath({
  assistShadowOnly = false,
  forceRetrievalApplicationResolution = false
} = {}) {
  const returnAssistShadow = assistShadowOnly === true
    && forceRetrievalApplicationResolution !== true;
  return Object.freeze({
    schema_version: "provider-terminal-path-decision-v1",
    policy_id: providerTerminalPathPolicy.policy_id,
    policy_version: providerTerminalPathPolicy.policy_version,
    action: returnAssistShadow
      ? providerTerminalPathActions.RETURN_ASSIST_SHADOW
      : providerTerminalPathActions.CONTINUE_RESOLUTION,
    reason_codes: Object.freeze(returnAssistShadow
      ? ["ASSIST_ENABLED_WITHOUT_INITIAL_PROMPT_SAFE_CANDIDATE"]
      : forceRetrievalApplicationResolution === true
        ? ["FORCED_RETRIEVAL_APPLICATION_RESOLUTION"]
        : ["INITIAL_PROVIDER_PATH_CAN_CONTINUE"])
  });
}
