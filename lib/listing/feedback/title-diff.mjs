export const TITLE_DIFF_ALGORITHM_VERSION = "whitespace-token-lcs-v1";
export const TITLE_DIFF_MAX_INPUT_CHARACTERS = 256;
export const TITLE_DIFF_MAX_TOKENS = 64;
export const TITLE_DIFF_MAX_MATRIX_CELLS = (TITLE_DIFF_MAX_TOKENS + 1) ** 2;

const whitespacePattern = /\s/u;

export class TitleDiffLimitError extends Error {
  constructor(message, { code, label, limit, actual } = {}) {
    super(message);
    this.name = "TitleDiffLimitError";
    this.code = code;
    this.statusCode = 400;
    this.label = label;
    this.limit = limit;
    this.actual = actual;
  }
}

function normalizeComparableToken(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en-US");
}

function boundedCharacterLimit(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return TITLE_DIFF_MAX_INPUT_CHARACTERS;
  return Math.min(TITLE_DIFF_MAX_INPUT_CHARACTERS, Math.max(1, Math.trunc(requested)));
}

function countTitleTokens(title) {
  let count = 0;
  let insideToken = false;
  for (const character of title) {
    if (whitespacePattern.test(character)) {
      insideToken = false;
      continue;
    }
    if (!insideToken) count += 1;
    insideToken = true;
  }
  return count;
}

export function assertTitleDiffInputWithinLimits(value = "", {
  label = "title_diff_input",
  maxCharacters = TITLE_DIFF_MAX_INPUT_CHARACTERS
} = {}) {
  const title = String(value || "");
  const characterLimit = boundedCharacterLimit(maxCharacters);
  if (title.length > characterLimit) {
    throw new TitleDiffLimitError(`${label}_exceeds_${characterLimit}_characters`, {
      code: "TITLE_DIFF_CHARACTER_LIMIT_EXCEEDED",
      label,
      limit: characterLimit,
      actual: title.length
    });
  }
  const tokenCount = countTitleTokens(title);
  if (tokenCount > TITLE_DIFF_MAX_TOKENS) {
    throw new TitleDiffLimitError(`${label}_exceeds_${TITLE_DIFF_MAX_TOKENS}_tokens`, {
      code: "TITLE_DIFF_TOKEN_LIMIT_EXCEEDED",
      label,
      limit: TITLE_DIFF_MAX_TOKENS,
      actual: tokenCount
    });
  }
  return {
    title,
    character_count: title.length,
    token_count: tokenCount
  };
}

function assertTitleDiffMatrixWithinLimits(beforeTokenCount, afterTokenCount) {
  const cells = (beforeTokenCount + 1) * (afterTokenCount + 1);
  if (cells > TITLE_DIFF_MAX_MATRIX_CELLS) {
    throw new TitleDiffLimitError(`title_diff_matrix_exceeds_${TITLE_DIFF_MAX_MATRIX_CELLS}_cells`, {
      code: "TITLE_DIFF_MATRIX_LIMIT_EXCEEDED",
      label: "title_diff_matrix",
      limit: TITLE_DIFF_MAX_MATRIX_CELLS,
      actual: cells
    });
  }
  return cells;
}

function tokenizeValidatedTitle(title) {
  return [...title.matchAll(/\S+/gu)].map((match, index) => ({
    index,
    token: match[0],
    normalized: normalizeComparableToken(match[0]),
    start: match.index,
    end: match.index + match[0].length
  }));
}

export function tokenizeTitleWithSpans(value = "") {
  const profile = assertTitleDiffInputWithinLimits(value);
  return tokenizeValidatedTitle(profile.title);
}

function lcsTable(before, after) {
  assertTitleDiffMatrixWithinLimits(before.length, after.length);
  const table = Array.from({ length: before.length + 1 }, () => (
    Array(after.length + 1).fill(0)
  ));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      table[left][right] = before[left].normalized === after[right].normalized
        ? table[left + 1][right + 1] + 1
        : Math.max(table[left + 1][right], table[left][right + 1]);
    }
  }
  return table;
}

function rawOperations(before, after) {
  const table = lcsTable(before, after);
  const operations = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (
      left < before.length
      && right < after.length
      && before[left].normalized === after[right].normalized
    ) {
      operations.push({ type: "equal", before: before[left], after: after[right] });
      left += 1;
      right += 1;
      continue;
    }
    if (right >= after.length || (left < before.length && table[left + 1][right] >= table[left][right + 1])) {
      operations.push({ type: "delete", before: before[left] });
      left += 1;
      continue;
    }
    operations.push({ type: "insert", after: after[right] });
    right += 1;
  }
  return operations;
}

function tokenRecord(value) {
  if (!value) return null;
  return {
    token: value.token,
    index: value.index,
    start: value.start,
    end: value.end
  };
}

function compactOperations(raw = []) {
  const compacted = [];
  let index = 0;
  while (index < raw.length) {
    if (raw[index].type === "equal") {
      const before = [];
      const after = [];
      while (index < raw.length && raw[index].type === "equal") {
        before.push(tokenRecord(raw[index].before));
        after.push(tokenRecord(raw[index].after));
        index += 1;
      }
      compacted.push({ type: "equal", before, after });
      continue;
    }

    const before = [];
    const after = [];
    while (index < raw.length && raw[index].type !== "equal") {
      if (raw[index].type === "delete") before.push(tokenRecord(raw[index].before));
      if (raw[index].type === "insert") after.push(tokenRecord(raw[index].after));
      index += 1;
    }
    compacted.push({
      type: before.length && after.length ? "replace" : before.length ? "delete" : "insert",
      before,
      after
    });
  }
  return compacted;
}

function changedTokens(operations, side) {
  return operations
    .filter((operation) => operation.type !== "equal")
    .flatMap((operation) => operation[side] || [])
    .map((item) => item.token);
}

export function buildTitleDiff(beforeTitle = "", afterTitle = "") {
  const beforeProfile = assertTitleDiffInputWithinLimits(beforeTitle, { label: "title_diff_before_title" });
  const afterProfile = assertTitleDiffInputWithinLimits(afterTitle, { label: "title_diff_after_title" });
  assertTitleDiffMatrixWithinLimits(beforeProfile.token_count, afterProfile.token_count);
  const before = tokenizeValidatedTitle(beforeProfile.title);
  const after = tokenizeValidatedTitle(afterProfile.title);
  const operations = compactOperations(rawOperations(before, after));
  return {
    algorithm_version: TITLE_DIFF_ALGORITHM_VERSION,
    before_title: String(beforeTitle || ""),
    after_title: String(afterTitle || ""),
    added: changedTokens(operations, "after"),
    removed: changedTokens(operations, "before"),
    replaced: operations
      .filter((operation) => operation.type === "replace")
      .map((operation) => ({
        from: operation.before.map((item) => item.token),
        to: operation.after.map((item) => item.token)
      })),
    operations
  };
}
