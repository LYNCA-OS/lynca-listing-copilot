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
} from "../prototypes/auth-productization/auth-product-flow.mjs";

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
assert.equal(otpReady("1234567"), false);
assert.equal(otpReady("12a3456"), false);
assert.equal(resendSecondsRemaining({ sentAt: 1_000, now: 1_000 }), 60);
assert.equal(resendSecondsRemaining({ sentAt: 1_000, now: 61_000 }), 0);

const html = fs.readFileSync(new URL("../prototypes/auth-productization/auth-preview.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../prototypes/auth-productization/auth-preview.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../prototypes/auth-productization/auth-preview.js", import.meta.url), "utf8");
const design = fs.readFileSync(new URL("../docs/architecture/auth-productization-design-2026-07-15.md", import.meta.url), "utf8");
const vercelIgnore = fs.readFileSync(new URL("../.vercelignore", import.meta.url), "utf8");
const ci = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

assert.match(html, /autocomplete="one-time-code"/);
assert.match(html, /role="status" aria-live="polite"/);
assert.match(html, /真人与环境验证/);
assert.match(html, /不做侵入式设备指纹/);
assert.match(html, /管理员预览/);
assert.match(html, /首次验证成功会接受邀请并开通工作区/);
assert.match(html, /预览租户 Owner · 无平台运维权限/);
assert.match(html, /不进入真实写手统计或训练反馈/);
assert.match(html, /href="\.\/auth-preview\.css"/);
assert.match(html, /src="\.\/auth-preview\.js"/);
assert.match(html, /手机验证码会在短信服务、费用上限和防滥用配置完成后开放/);
assert.match(css, /@media \(max-width: 460px\)/);
assert.match(css, /prefers-reduced-motion/);
assert.doesNotMatch(js, /fetch\s*\(/, "the design preview must not call production auth endpoints");
assert.doesNotMatch(js, /navigator\.(?:userAgent|plugins|hardwareConcurrency)/, "the preview must not implement invasive device fingerprinting");
assert.match(js, /未验证任何真实凭据/);
assert.match(js, /verifyButton\.disabled = false/);
assert.match(js, /if \(requestPending\) return/);
assert.match(js, /requestButton\.disabled = true/);
assert.match(js, /重新发送会进行新的风险判断/);
assert.match(design, /Track C/);
assert.match(design, /invite-only/i);
assert.match(design, /tenant_mode/);
assert.match(design, /managed challenge/i);
assert.match(design, /single-use/i);
assert.match(design, /must not be treated as a platform administrator/i);
assert.match(design, /shouldCreateUser:\s*false/);
assert.match(design, /SameSite=Lax/);
assert.match(design, /HMAC/);
assert.match(design, /tenant_invitations/);
assert.match(design, /PROVISIONING \| PENDING \| ACCEPTED \| REVOKED \| EXPIRED \| FAILED/);
assert.match(design, /must not create an active Track C profile or tenant membership/);
assert.match(design, /fail-closed sequence/);
assert.match(design, /ACTIVE` user with at least one `ACTIVE` membership/);
assert.match(design, /returning `ACTIVE` user/);
assert.match(design, /destination_hmac_key_version/);
assert.match(design, /no `Domain` attribute/);
assert.match(vercelIgnore, /^prototypes\/\*\*$/m);
assert.match(ci, /scripts\/\*\.test\.mjs/);
assert.equal(fs.existsSync(new URL("../app/auth-preview.html", import.meta.url)), false);

console.log("auth product preview tests passed");
