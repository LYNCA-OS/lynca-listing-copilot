#!/usr/bin/env node

export { checkCsmDeploymentEnvironment } from "../lib/listing/thin/csm-deployment-environment.mjs";
import { checkCsmDeploymentEnvironment } from "../lib/listing/thin/csm-deployment-environment.mjs";

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = checkCsmDeploymentEnvironment();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || "csm_deployment_environment_invalid",
      failures: error.failures || []
    })}\n`);
    process.exitCode = 1;
  }
}
