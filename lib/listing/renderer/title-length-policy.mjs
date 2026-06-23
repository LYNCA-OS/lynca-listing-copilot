import {
  compactSubjectNames,
  containsNonEnglishTitleScript,
  normalizeComparable,
  titleCleanup
} from "./title-cleanup.mjs";

export const defaultTitleMaxLength = 80;

function renderItems(items) {
  return titleCleanup(items.map((item) => item.text).filter(Boolean).join(" "));
}

function cloneItems(items, trace) {
  return items
    .map((item, index) => ({
      key: item.key || `item_${index}`,
      text: titleCleanup(item.text),
      required: item.required === true,
      priority: Number.isFinite(item.priority) ? item.priority : 50,
      compactable: item.compactable !== false
    }))
    .filter((item) => {
      if (!item.text) return false;
      if (!containsNonEnglishTitleScript(item.text)) return true;

      const blocked = {
        key: item.key,
        text: item.text,
        reason: "non_english_title_text"
      };
      if (item.required) trace.blocked_required_terms.push(blocked);
      else trace.blocked_terms.push(blocked);
      return false;
    });
}

function removeDuplicateItems(items) {
  const deduped = [];

  items.forEach((item) => {
    const comparable = normalizeComparable(item.text) || item.text;
    if (!comparable) return;

    const existingIndex = deduped.findIndex((existing) => {
      const existingComparable = normalizeComparable(existing.text) || existing.text;
      const gradingAttributePair = [existing.key, item.key].includes("grading")
        && [existing.key, item.key].some((key) => key === "attributes" || key === "rookie_marker");
      if (gradingAttributePair) return false;
      return existingComparable === comparable
        || existingComparable.includes(comparable)
        || comparable.includes(existingComparable);
    });

    if (existingIndex === -1) {
      deduped.push(item);
      return;
    }

    const existing = deduped[existingIndex];
    const keepNew = item.required && !existing.required
      || item.text.length > existing.text.length && item.priority <= existing.priority;
    if (keepNew) deduped.splice(existingIndex, 1, item);
  });

  return deduped;
}

function compactProduct(item) {
  return {
    ...item,
    text: titleCleanup(item.text)
      .replace(/\bImmaculate\s+Collection\b/gi, "Immaculate")
      .replace(/\bTrading\s+Cards?\b/gi, " ")
      .replace(/\bBasketball\b|\bFootball\b|\bBaseball\b|\bSoccer\b|\bHockey\b/gi, " ")
      .replace(/\bCollection\b/gi, " ")
  };
}

function compactSubject(item) {
  return {
    ...item,
    text: compactSubjectNames(item.text)
  };
}

function removeOptionalItems(items, maxLength, trace) {
  const current = [...items];

  while (renderItems(current).length > maxLength) {
    const removable = current
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.required)
      .sort((a, b) => b.item.priority - a.item.priority || b.index - a.index)[0];

    if (!removable) break;
    current.splice(removable.index, 1);
    trace.removed_terms.push(removable.item.text);
  }

  return current;
}

function compactItems(items, maxLength, trace) {
  let current = items.map((item) => ({ ...item }));
  if (renderItems(current).length <= maxLength) return current;

  current = current.map((item) => {
    if (item.key !== "product_identity" || !item.compactable) return item;
    const compacted = compactProduct(item);
    if (compacted.text !== item.text) trace.compacted_terms.push(`${item.text} -> ${compacted.text}`);
    return compacted;
  });
  if (renderItems(current).length <= maxLength) return current;

  current = current.map((item) => {
    if (item.key !== "subject" || !item.compactable) return item;
    const compacted = compactSubject(item);
    if (compacted.text && compacted.text !== item.text) trace.compacted_terms.push(`${item.text} -> ${compacted.text}`);
    return compacted.text ? compacted : item;
  });

  return current;
}

function greedyRequiredTitle(items, maxLength) {
  const required = items.filter((item) => item.required);
  const optional = items
    .filter((item) => !item.required)
    .sort((a, b) => a.priority - b.priority);
  const current = [...required];

  for (const item of optional) {
    const candidate = [...current, item].sort((a, b) => a.originalIndex - b.originalIndex);
    if (renderItems(candidate).length <= maxLength) current.push(item);
  }

  return renderItems(current.sort((a, b) => a.originalIndex - b.originalIndex));
}

export function fitTitleItems(items, {
  maxLength = defaultTitleMaxLength
} = {}) {
  const trace = {
    max_length: maxLength,
    removed_terms: [],
    compacted_terms: [],
    blocked_terms: [],
    blocked_required_terms: [],
    retained_required_terms: [],
    exceeded: false,
    length: 0
  };
  let current = removeDuplicateItems(cloneItems(items, trace).map((item, originalIndex) => ({
    ...item,
    originalIndex
  })));

  current = compactItems(current, maxLength, trace);
  current = removeOptionalItems(current, maxLength, trace);

  let title = renderItems(current);
  if (title.length > maxLength) {
    title = greedyRequiredTitle(current, maxLength);
  }

  trace.length = title.length;
  trace.exceeded = title.length > maxLength;
  trace.retained_required_terms = current
    .filter((item) => item.required)
    .map((item) => item.text);

  return {
    title,
    policy: trace
  };
}
