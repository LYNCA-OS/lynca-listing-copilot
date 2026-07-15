export const AUTH_CHANNELS = Object.freeze({
  EMAIL: "email",
  PHONE: "phone"
});

const emailLocalPattern = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i;
const domainLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const e164Pattern = /^\+[1-9]\d{7,14}$/;

function cleanText(value, maxLength = 320) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function normalizeAuthDestination(value, channel = AUTH_CHANNELS.EMAIL) {
  const normalized = cleanText(value);
  if (channel === AUTH_CHANNELS.PHONE) return normalized.replace(/[\s()-]/g, "");
  return normalized.toLowerCase();
}

export function authDestinationValid(value, channel = AUTH_CHANNELS.EMAIL) {
  const normalized = normalizeAuthDestination(value, channel);
  if (channel === AUTH_CHANNELS.PHONE) return e164Pattern.test(normalized);
  if (normalized.length > 254) return false;

  const parts = normalized.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !domain || domain.length > 253) return false;
  if (!emailLocalPattern.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;

  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => domainLabelPattern.test(label));
}

export function maskAuthDestination(value, channel = AUTH_CHANNELS.EMAIL) {
  const normalized = normalizeAuthDestination(value, channel);
  if (channel === AUTH_CHANNELS.PHONE) {
    if (!e164Pattern.test(normalized)) return "";
    return `${normalized.slice(0, 3)} ${"•".repeat(Math.max(3, normalized.length - 7))} ${normalized.slice(-4)}`;
  }

  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function normalizeOtp(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 6);
}

export function otpReady(value) {
  return normalizeOtp(value).length === 6;
}

export function resendSecondsRemaining({ sentAt, now = Date.now(), cooldownMs = 60_000 } = {}) {
  const remaining = Number(sentAt) + Math.max(0, Number(cooldownMs) || 0) - Number(now);
  return Math.max(0, Math.ceil(remaining / 1_000));
}
