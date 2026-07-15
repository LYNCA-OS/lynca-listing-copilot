import assert from "node:assert/strict";
import fs from "node:fs";
import {
  AUTH_CHANNELS,
  authDestinationValid,
  maskAuthDestination,
  normalizeAuthDestination,
  normalizeOtp,
  otpReady,
  resendSecondsRemaining
} from "../app/auth-product-flow.mjs";

assert.equal(normalizeAuthDestination(" Writer@Example.COM "), "writer@example.com");
assert.equal(authDestinationValid("writer@example.com"), true);
assert.equal(authDestinationValid("writer-at-example.com"), false);
assert.equal(authDestinationValid(".writer@example.com"), false);
assert.equal(authDestinationValid("writer..name@example.com"), false);
assert.equal(authDestinationValid("writer@example..com"), false);
assert.equal(authDestinationValid("writer@-example.com"), false);
assert.equal(maskAuthDestination("writer@example.com"), "wr••••@example.com");
assert.equal(normalizeAuthDestination("+61 (412) 345 678", AUTH_CHANNELS.PHONE), "+61412345678");
assert.equal(authDestinationValid("+61 412 345 678", AUTH_CHANNELS.PHONE), true);
assert.match(maskAuthDestination("+61 412 345 678", AUTH_CHANNELS.PHONE), /^\+61 .* 5678$/);
assert.equal(normalizeOtp("12 34a56"), "123456");
assert.equal(otpReady("123456"), true);
assert.equal(otpReady("12345"), false);
assert.equal(resendSecondsRemaining({ sentAt: 1_000, now: 1_000 }), 60);
assert.equal(resendSecondsRemaining({ sentAt: 1_000, now: 61_000 }), 0);

const html = fs.readFileSync(new URL("../app/auth-preview.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/auth-preview.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../app/auth-preview.js", import.meta.url), "utf8");
const design = fs.readFileSync(new URL("../docs/architecture/auth-productization-design-2026-07-15.md", import.meta.url), "utf8");

assert.match(html, /autocomplete="one-time-code"/);
assert.match(html, /role="status" aria-live="polite"/);
assert.match(html, /真人与环境验证/);
assert.match(html, /不做侵入式设备指纹/);
assert.match(html, /管理员预览/);
assert.match(html, /不进入真实写手统计或训练反馈/);
assert.match(html, /手机验证码会在短信服务、费用上限和防滥用配置完成后开放/);
assert.match(css, /@media \(max-width: 460px\)/);
assert.match(css, /prefers-reduced-motion/);
assert.doesNotMatch(js, /fetch\s*\(/, "the design preview must not call production auth endpoints");
assert.doesNotMatch(js, /navigator\.(?:userAgent|plugins|hardwareConcurrency)/, "the preview must not implement invasive device fingerprinting");
assert.match(js, /未验证任何真实凭据/);
assert.match(js, /verifyButton\.disabled = false/);
assert.match(js, /重新发送会进行新的风险判断/);
assert.match(design, /Track C/);
assert.match(design, /invite-only/i);
assert.match(design, /tenant_mode/);
assert.match(design, /managed challenge/i);
assert.match(design, /single-use/i);
assert.match(design, /must not be treated as a platform administrator/i);

console.log("auth product preview tests passed");
