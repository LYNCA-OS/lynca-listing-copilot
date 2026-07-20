function normalizeSubjectText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function foldLatinDiacritics(value) {
  return normalizeSubjectText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function canonicalSubjectComparable(value) {
  return foldLatinDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function canonicalSubjectTokens(value) {
  return canonicalSubjectComparable(value).split(/\s+/).filter(Boolean);
}

const cardDescriptorTokens = new Set([
  "auto", "autograph", "blue", "gold", "green", "orange", "parallel",
  "pink", "prizm", "purple", "raywave", "refractor", "red", "rookie",
  "silver", "shimmer", "sparkle", "ssp", "variation", "wave", "white", "yellow"
]);

function isDescriptorExtendedIdentity(shorter, longer) {
  const shorterTokens = canonicalSubjectTokens(shorter);
  const longerTokens = canonicalSubjectTokens(longer);
  if (shorterTokens.length < 2 || longerTokens.length <= shorterTokens.length) return false;
  if (!shorterTokens.every((token, index) => token === longerTokens[index])) return false;
  return longerTokens.slice(shorterTokens.length).every((token) => cardDescriptorTokens.has(token));
}

export function collapseDescriptorExtendedSubjectIdentities(values = []) {
  const collapsed = [];
  values.map(normalizeSubjectText).filter(Boolean).forEach((value) => {
    const exactIndex = collapsed.findIndex(
      (existing) => canonicalSubjectComparable(existing) === canonicalSubjectComparable(value)
    );
    if (exactIndex >= 0) return;
    const shorterExistingIndex = collapsed.findIndex((existing) => isDescriptorExtendedIdentity(existing, value));
    if (shorterExistingIndex >= 0) return;
    const longerExistingIndex = collapsed.findIndex((existing) => isDescriptorExtendedIdentity(value, existing));
    if (longerExistingIndex >= 0) {
      collapsed[longerExistingIndex] = value;
      return;
    }
    collapsed.push(value);
  });
  return collapsed;
}

export function relatedSubjectIdentity(left, right) {
  const leftTokens = canonicalSubjectTokens(left);
  const rightTokens = canonicalSubjectTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const leftText = leftTokens.join(" ");
  const rightText = rightTokens.join(" ");
  if (leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText)) return true;
  return leftTokens.length >= 2
    && rightTokens.length >= 2
    && leftTokens[0] === rightTokens[0]
    && leftTokens.at(-1) === rightTokens.at(-1);
}

export function collapseRelatedSubjectIdentities(values = []) {
  const collapsed = [];
  values.map(normalizeSubjectText).filter(Boolean).forEach((value) => {
    const relatedIndex = collapsed.findIndex((existing) => relatedSubjectIdentity(existing, value));
    if (relatedIndex < 0) {
      collapsed.push(value);
      return;
    }
    const existingTokens = canonicalSubjectTokens(collapsed[relatedIndex]);
    const nextTokens = canonicalSubjectTokens(value);
    if (isDescriptorExtendedIdentity(collapsed[relatedIndex], value)) return;
    if (isDescriptorExtendedIdentity(value, collapsed[relatedIndex])) {
      collapsed[relatedIndex] = value;
      return;
    }
    if (nextTokens.length > existingTokens.length
      || (nextTokens.length === existingTokens.length && value.length > collapsed[relatedIndex].length)) {
      collapsed[relatedIndex] = value;
    }
  });
  return collapsed;
}
