export const TITLE_DIFF_ALGORITHM_VERSION = "whitespace-token-lcs-v1";

function normalizeComparableToken(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en-US");
}

export function tokenizeTitleWithSpans(value = "") {
  const title = String(value || "");
  return [...title.matchAll(/\S+/gu)].map((match, index) => ({
    index,
    token: match[0],
    normalized: normalizeComparableToken(match[0]),
    start: match.index,
    end: match.index + match[0].length
  }));
}

function lcsTable(before, after) {
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
  const before = tokenizeTitleWithSpans(beforeTitle);
  const after = tokenizeTitleWithSpans(afterTitle);
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
