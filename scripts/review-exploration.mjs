#!/usr/bin/env node
// Review one paired exploration that already finished.
//
//   node scripts/review-exploration.mjs \
//     --artifact artifacts/<run>/thin-path-gpt-5.6-luna.jsonl \
//     --control <arm> --treatment <arm> [--prereg docs/explorations/<file>.json]
//
// The harness runs this automatically at the end of every run. This entry point
// exists for runs that finished before the framework, and for re-reviewing
// after the ruler changes. It shares ONE implementation with the automatic
// path, so the two cannot drift.
import { buildReview } from "./auto-review-run.mjs";
import { formatReview } from "../lib/listing/evaluation/exploration-review.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const artifactPath = arg("artifact"), control = arg("control"), treatment = arg("treatment");
if (!artifactPath || !control || !treatment) {
  console.error("usage: --artifact <jsonl> --control <arm> --treatment <arm> [--prereg <json>]");
  process.exit(2);
}
const { result, preregistered } = buildReview({
  artifactPath, control, treatment, preregPath: arg("prereg")
});
console.log(formatReview(result));
if (!preregistered) {
  console.log("\n⚠ 无预注册：本次复盘无法判断门槛是不是看到结果之后才定的。");
  console.log("  下次先写 docs/explorations/<日期>-<名称>.json 再花钱。");
}
