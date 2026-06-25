export const fingerprintPurposes = Object.freeze([
  "duplicate_detection",
  "near_duplicate_grouping",
  "self_exclusion",
  "evaluation_leakage_prevention"
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function hammingDistance(left = "", right = "") {
  const a = cleanText(left).toLowerCase();
  const b = cleanText(right).toLowerCase();
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) distance += a[index] === b[index] ? 0 : 1;
  }
  return distance;
}

export function normalizeColorMomentHash(value = "") {
  const text = cleanText(value).toLowerCase();
  if (!text) return "";
  return text.replace(/[^a-z0-9:._|-]+/g, "");
}

export function colorMomentHashFromMoments(moments = {}) {
  if (Array.isArray(moments)) {
    return normalizeColorMomentHash(
      moments
        .map((value, index) => {
          const number = finiteNumber(value, null);
          return number === null ? "" : `v${index}${Number(number).toFixed(3)}`;
        })
        .filter(Boolean)
        .join("|")
    );
  }
  const channels = ["r", "g", "b"];
  const metricKeys = {
    mean: "m",
    std: "d",
    skew: "k"
  };
  const parts = [];
  channels.forEach((channel) => {
    ["mean", "std", "skew"].forEach((metric) => {
      const value = finiteNumber(moments?.[channel]?.[metric], null);
      if (value !== null) parts.push(`${channel}${metricKeys[metric]}${Number(value).toFixed(3)}`);
    });
  });
  return normalizeColorMomentHash(parts.join("|"));
}

export function colorMomentDistance(left = "", right = "") {
  const parse = (value) => {
    const parsed = new Map();
    normalizeColorMomentHash(value).split("|").filter(Boolean).forEach((part) => {
      const match = part.match(/^((?:[rgb][mdk])|(?:v\d+))(-?\d+(?:\.\d+)?)$/);
      if (match) parsed.set(match[1], Number(match[2]));
    });
    return parsed;
  };
  const a = parse(left);
  const b = parse(right);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  if (!keys.length || keys.some((key) => !a.has(key) || !b.has(key))) return Number.POSITIVE_INFINITY;
  const squared = keys.reduce((sum, key) => sum + ((a.get(key) - b.get(key)) ** 2), 0);
  return Math.sqrt(squared / keys.length);
}

export function normalizeVisualFingerprint(input = {}) {
  return {
    content_sha256: cleanText(input.content_sha256 || input.contentSha256).toLowerCase(),
    perceptual_hash: cleanText(input.perceptual_hash || input.phash || input.p_hash).toLowerCase(),
    color_moment_hash: normalizeColorMomentHash(input.color_moment_hash || input.colorMomentHash),
    image_id: cleanText(input.image_id || input.imageId),
    image_role: cleanText(input.image_role || input.embedding_role || input.role)
  };
}

export function fingerprintsLikelySameImage(left = {}, right = {}, {
  phashMaxDistance = 4,
  colorMomentMaxDistance = 0.08
} = {}) {
  const a = normalizeVisualFingerprint(left);
  const b = normalizeVisualFingerprint(right);
  if (a.content_sha256 && b.content_sha256 && a.content_sha256 === b.content_sha256) {
    return { match: true, reason: "same_content_sha256" };
  }
  if (a.perceptual_hash && b.perceptual_hash) {
    const distance = hammingDistance(a.perceptual_hash, b.perceptual_hash);
    if (distance <= phashMaxDistance) return { match: true, reason: "near_duplicate_phash", phash_distance: distance };
  }
  if (a.color_moment_hash && b.color_moment_hash) {
    const distance = colorMomentDistance(a.color_moment_hash, b.color_moment_hash);
    if (distance <= colorMomentMaxDistance) return { match: true, reason: "near_duplicate_color_moment", color_moment_distance: distance };
  }
  return { match: false, reason: "fingerprint_not_matched" };
}

export function geometricSupportScore({
  keypoint_match_count = 0,
  inlier_count = 0,
  inlier_ratio = null,
  homography_valid = false
} = {}) {
  const matches = Math.max(0, finiteNumber(keypoint_match_count, 0) || 0);
  const inliers = Math.max(0, finiteNumber(inlier_count, 0) || 0);
  const ratio = Math.max(0, Math.min(1, finiteNumber(inlier_ratio, matches ? inliers / matches : 0) || 0));
  const matchScore = Math.min(1, matches / 80);
  const inlierScore = Math.min(1, inliers / 35);
  const geometryScore = homography_valid ? 0.2 : 0;
  return Number(Math.min(1, matchScore * 0.25 + inlierScore * 0.35 + ratio * 0.2 + geometryScore).toFixed(4));
}
