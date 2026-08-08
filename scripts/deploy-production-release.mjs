#!/usr/bin/env node

// Production has one release transaction: the protected GitHub workflow runs
// the complete offline gates, database pre/postflight, exact-SHA health check,
// and the real Writer Journey. A local `vercel --prod` command cannot preserve
// that transaction, so this legacy entry point intentionally fails closed.
process.stderr.write(`${JSON.stringify({
  ok: false,
  code: "DIRECT_PRODUCTION_DEPLOY_RETIRED",
  message: "Use the protected GitHub deploy-production workflow from current main.",
  workflow: ".github/workflows/deploy-production.yml"
})}\n`);
process.exitCode = 1;
