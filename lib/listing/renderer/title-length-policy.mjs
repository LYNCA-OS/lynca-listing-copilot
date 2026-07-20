import {
  compactSubjectNames,
  containsNonEnglishTitleScript,
  normalizeComparable,
  titleCleanup
} from "./title-cleanup.mjs";
import { safeSurfaceColor } from "../parallel-policy.mjs";

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
        && [existing.key, item.key].some((key) => key === "attributes" || key === "rookie_marker" || key === "card_type" || key === "variant_parallel_rarity" || key === "search_optimization" || key === "release_variant");
      const gradingNumberPair = [existing.key, item.key].includes("grading")
        && [existing.key, item.key].some((key) => key === "serial_limit" || key === "card_number" || key === "additional_info");
      const cardNumberPair = [existing.key, item.key].includes("card_number")
        && existing.key !== item.key;
      const yearProductIdentityPair = [existing.key, item.key].includes("year")
        && [existing.key, item.key].some((key) => key === "product_identity" || key === "product_set" || key === "franchise_brand");
      const variantKeys = ["variant_parallel_rarity", "release_variant", "print_finish"];
      const productVariantPair = [existing.key, item.key].some((key) => variantKeys.includes(key))
        && [existing.key, item.key].some((key) => key === "product_identity" || key === "product_set" || key === "franchise_brand");
      const brandProductSetPair = [existing.key, item.key].includes("franchise_brand")
        && [existing.key, item.key].includes("product_set");
      if (brandProductSetPair) {
        const brandComparable = existing.key === "franchise_brand" ? existingComparable : comparable;
        const productComparable = existing.key === "product_set" ? existingComparable : comparable;
        if (brandComparable
          && productComparable
          && productComparable !== brandComparable
          && !productComparable.startsWith(`${brandComparable} `)
          && !brandComparable.endsWith(` ${productComparable}`)) return false;
      }
      if (gradingAttributePair || gradingNumberPair || cardNumberPair) return false;
      if (yearProductIdentityPair) return false;
      if (productVariantPair) return false;
      return existingComparable === comparable
        || existingComparable.includes(comparable)
        || comparable.includes(existingComparable);
    });

    if (existingIndex === -1) {
      deduped.push(item);
      return;
    }

    const existing = deduped[existingIndex];
    const existingComparable = normalizeComparable(existing.text) || existing.text;
    const exactDuplicate = existingComparable === comparable;
    const brandProductSetPair = [existing.key, item.key].includes("franchise_brand")
      && [existing.key, item.key].includes("product_set");
    const preferProductSet = brandProductSetPair && item.key === "product_set";
    const keepNew = preferProductSet
      || item.required && !existing.required
      || (existing.key === "card_type" && ["variant_parallel_rarity", "release_variant"].includes(item.key) && item.text.length > existing.text.length)
      || (exactDuplicate && item.required === existing.required && item.priority < existing.priority)
      || (item.required === existing.required && item.text.length > existing.text.length && item.priority <= existing.priority);
    if (keepNew) deduped.splice(existingIndex, 1, item);
  });

  return deduped;
}

function compactProduct(item) {
  return {
    ...item,
    text: titleCleanup(item.text)
      .replace(/\s+-\s+/g, " ")
      .replace(/\bImmaculate\s+Collection\b/gi, "Immaculate")
      .replace(/\bTopps\s+Triple\s+Threads\b/gi, "Triple Threads")
      .replace(/\bTrading\s+Cards?\b/gi, " ")
      .replace(/\bMemorabilia\b/gi, " ")
      .replace(/\bBasketball\b|\bFootball\b|\bBaseball\b|\bSoccer\b|\bHockey\b/gi, " ")
      .replace(/\bCollection\b/gi, " ")
  };
}

function compactLanguage(item) {
  const language = titleCleanup(item.text);
  const compacted = /^(?:Japanese|JPN|JA)$/i.test(language)
    ? "JP"
    : /^(?:Chinese|ZH)$/i.test(language)
      ? "CN"
      : /^(?:Korean|KOR|KO)$/i.test(language)
        ? "KR"
        : language;
  return {
    ...item,
    text: compacted
  };
}

function compactSubject(item) {
  if (!String(item.text || "").includes("/")) return item;
  return {
    ...item,
    text: compactSubjectNames(item.text)
  };
}

function compactSubjectSeparators(item) {
  if (!String(item.text || "").includes("/")) return item;
  return {
    ...item,
    text: titleCleanup(item.text.replace(/\s*\/\s*/g, " "))
  };
}

function compactVariantDescriptor(item) {
  let compacted = titleCleanup(item.text)
    .replace(/\bProspect\s+Autographs\b/gi, "Auto")
    .replace(/\bProspect\s+Autograph\b/gi, "Auto")
    .replace(/\bProspect\s+Auto\b/gi, "Auto");
  if (item.key === "print_finish") {
    compacted = safeSurfaceColor(compacted) || compacted;
  }
  return {
    ...item,
    text: compacted
  };
}

function removeOptionalItems(items, maxLength, trace) {
  const current = removeDuplicateItems(items.filter((item) => item.required));
  const optional = items
    .filter((item) => !item.required)
    .sort((a, b) => a.priority - b.priority || a.originalIndex - b.originalIndex);

  for (const item of optional) {
    const candidate = removeDuplicateItems([...current, item]).sort((a, b) => a.originalIndex - b.originalIndex);
    if (renderItems(candidate).length <= maxLength) {
      current.splice(0, current.length, ...candidate);
    } else {
      const canNarrowSafely = ["card_variant", "variant_parallel_rarity", "release_variant", "print_finish"].includes(item.key)
        && item.compactable;
      const compacted = canNarrowSafely ? compactVariantDescriptor(item) : item;
      const compactedCandidate = compacted.text && compacted.text !== item.text
        ? removeDuplicateItems([...current, compacted]).sort((a, b) => a.originalIndex - b.originalIndex)
        : null;
      if (compactedCandidate && renderItems(compactedCandidate).length <= maxLength) {
        trace.compacted_terms.push(`${item.text} -> ${compacted.text}`);
        current.splice(0, current.length, ...compactedCandidate);
        continue;
      }
      trace.removed_terms.push(item.text);
    }
  }

  return current.sort((a, b) => a.originalIndex - b.originalIndex);
}

function compactProductItems(items, maxLength, trace) {
  let current = items.map((item) => ({ ...item }));
  if (renderItems(current).length <= maxLength) return current;

  current = current.map((item) => {
    if (!["product_identity", "product_set", "franchise_brand"].includes(item.key) || !item.compactable) return item;
    const compacted = compactProduct(item);
    if (compacted.text !== item.text) trace.compacted_terms.push(`${item.text} -> ${compacted.text}`);
    return compacted;
  });

  return removeDuplicateItems(current);
}

function compactSubjectItems(items, maxLength, trace) {
  let current = items.map((item) => ({ ...item }));
  if (renderItems(current).length <= maxLength) return current;

  const separatorCompacted = current.map((item) => (
    item.key === "subject" && item.compactable ? compactSubjectSeparators(item) : item
  ));
  if (renderItems(separatorCompacted).length <= maxLength) {
    separatorCompacted.forEach((item, index) => {
      if (item.text !== current[index].text) trace.compacted_terms.push(`${current[index].text} -> ${item.text}`);
    });
    return separatorCompacted;
  }

  current = current.map((item) => {
    if (item.key !== "subject" || !item.compactable) return item;
    const compacted = compactSubject(item);
    if (compacted.text && compacted.text !== item.text) trace.compacted_terms.push(`${item.text} -> ${compacted.text}`);
    return compacted.text ? compacted : item;
  });

  return current;
}

function compactIdentityContextForHighPriorityItems(items, maxLength, trace) {
  const highestPriorityCeiling = 34;
  const highPriorityItems = () => removeDuplicateItems(items.filter((item) => (
    item.required || item.priority <= highestPriorityCeiling
  )));
  if (renderItems(highPriorityItems()).length <= maxLength) return items;

  let current = items.map((item) => ({ ...item }));
  current = current.map((item) => {
    if (!["product_identity", "product_set", "franchise_brand"].includes(item.key) || !item.compactable) return item;
    const compacted = compactProduct(item);
    if (compacted.text !== item.text) trace.compacted_terms.push(`${item.text} -> ${compacted.text}`);
    return compacted;
  });

  const compactedHighPriority = removeDuplicateItems(current.filter((item) => (
    item.required || item.priority <= highestPriorityCeiling
  )));
  if (renderItems(compactedHighPriority).length <= maxLength) return removeDuplicateItems(current);

  current = current.map((item) => {
    if (item.key !== "language" || !item.compactable) return item;
    const compacted = compactLanguage(item);
    if (compacted.text !== item.text) trace.compacted_terms.push(`${item.text} -> ${compacted.text}`);
    return compacted;
  });

  const languageCompactedHighPriority = removeDuplicateItems(current.filter((item) => (
    item.required || item.priority <= highestPriorityCeiling
  )));
  if (renderItems(languageCompactedHighPriority).length <= maxLength) return removeDuplicateItems(current);

  const separatorCompacted = current.map((item) => (
    item.key === "subject" && item.compactable ? compactSubjectSeparators(item) : item
  ));
  const separatorCompactedHighPriority = removeDuplicateItems(separatorCompacted.filter((item) => (
    item.required || item.priority <= highestPriorityCeiling
  )));
  if (renderItems(separatorCompactedHighPriority).length <= maxLength) {
    separatorCompacted.forEach((item, index) => {
      if (item.text !== current[index].text) trace.compacted_terms.push(`${current[index].text} -> ${item.text}`);
    });
    return removeDuplicateItems(separatorCompacted);
  }

  current = current.map((item) => {
    if (item.key !== "subject" || !item.compactable) return item;
    const compacted = compactSubject(item);
    if (compacted.text && compacted.text !== item.text) trace.compacted_terms.push(`${item.text} -> ${compacted.text}`);
    return compacted.text ? compacted : item;
  });

  return removeDuplicateItems(current);
}

function compactVariantItems(items, maxLength, trace) {
  let current = items.map((item) => ({ ...item }));
  if (renderItems(current).length <= maxLength) return current;

  current = current.map((item) => {
    if (!["card_variant", "variant_parallel_rarity", "release_variant", "print_finish"].includes(item.key) || !item.compactable) return item;
    const compacted = compactVariantDescriptor(item);
    if (compacted.text && compacted.text !== item.text) trace.compacted_terms.push(`${item.text} -> ${compacted.text}`);
    return compacted.text ? compacted : item;
  });

  return current;
}

function compactCardTypeItems(items, maxLength, trace) {
  let current = items.map((item) => ({ ...item }));
  if (renderItems(current).length <= maxLength) return current;

  current = current.map((item) => {
    if (item.key !== "card_type" || !/^Auto\s+Relic$/i.test(item.text)) return item;
    const compacted = {
      ...item,
      text: "Auto"
    };
    trace.compacted_terms.push(`${item.text} -> ${compacted.text}`);
    return compacted;
  });

  return removeDuplicateItems(current);
}

function greedyRequiredTitle(items, maxLength, trace) {
  const required = items.filter((item) => item.required);
  const optional = items
    .filter((item) => !item.required)
    .sort((a, b) => a.priority - b.priority);
  const current = [...required];

  for (const item of optional) {
    const candidate = [...current, item].sort((a, b) => a.originalIndex - b.originalIndex);
    if (renderItems(candidate).length <= maxLength) current.push(item);
  }

  while (renderItems(current).length > maxLength) {
    const removable = current
      .map((item, index) => ({ item, index }))
      .sort((a, b) => b.item.priority - a.item.priority || b.item.text.length - a.item.text.length)[0];
    if (!removable) break;
    current.splice(removable.index, 1);
    trace.removed_terms.push(removable.item.text);
  }

  const selectedItems = current.sort((a, b) => a.originalIndex - b.originalIndex);
  return {
    title: renderItems(selectedItems),
    items: selectedItems
  };
}

function refillFreedTitleBudget(selected, overflowItems, originalItems, rawItems, maxLength, trace) {
  let current = selected.map((item) => ({ ...item }));
  const originalByIndex = new Map(originalItems.map((item) => [item.originalIndex, item]));

  // Compaction happens before the final required-item overflow pass. If that
  // pass later removes a long module, restore compacted identity text whenever
  // the newly freed budget permits it.
  for (const item of [...current].sort((a, b) => a.priority - b.priority || a.originalIndex - b.originalIndex)) {
    const original = originalByIndex.get(item.originalIndex);
    if (!original || original.text === item.text || item.key !== "subject") continue;
    const candidate = current.map((entry) => entry.originalIndex === item.originalIndex ? { ...original } : entry);
    if (renderItems(candidate).length > maxLength) continue;
    trace.restored_terms.push(`${item.text} -> ${original.text}`);
    current = candidate;
  }

  // A required overflow may also have removed whole modules. Reconsider every
  // omitted original module against the actual remaining budget, in priority
  // order, instead of leaving a materially under-filled title.
  const criticalSearchItems = rawItems.filter((item) => (
    item.key === "search_optimization"
    && /^(?:RC|1st Bowman|Auto|Patch|Relic|Jersey)$/i.test(item.text)
  ));
  const refillItems = [...new Map([...overflowItems, ...criticalSearchItems]
    .map((item) => [item.originalIndex, item])).values()];
  for (const item of refillItems.sort((a, b) => a.priority - b.priority || a.originalIndex - b.originalIndex)) {
    if (current.some((selectedItem) => selectedItem.originalIndex === item.originalIndex)) continue;
    const candidate = removeDuplicateItems([...current, item]).sort((a, b) => a.originalIndex - b.originalIndex);
    if (renderItems(candidate).length > maxLength) continue;
    trace.restored_terms.push(item.text);
    current = candidate;
  }

  return current.sort((a, b) => a.originalIndex - b.originalIndex);
}

export function fitTitleItems(items, {
  maxLength = defaultTitleMaxLength
} = {}) {
  const trace = {
    max_length: maxLength,
    removed_terms: [],
    compacted_terms: [],
    restored_terms: [],
    blocked_terms: [],
    blocked_required_terms: [],
    retained_required_terms: [],
    exceeded: false,
    length: 0
  };
  const rawItems = cloneItems(items, trace).map((item, originalIndex) => ({
    ...item,
    originalIndex
  }));
  const originalItems = removeDuplicateItems(rawItems);
  let current = originalItems.map((item) => ({ ...item }));

  // Compact identity context only when required and high-priority modules do
  // not fit together. Low-priority modules must never force exact finish loss.
  current = compactIdentityContextForHighPriorityItems(current, maxLength, trace);
  current = removeOptionalItems(current, maxLength, trace);
  current = compactProductItems(current, maxLength, trace);
  current = compactSubjectItems(current, maxLength, trace);
  current = compactVariantItems(current, maxLength, trace);
  current = compactCardTypeItems(current, maxLength, trace);

  let title = renderItems(current);
  if (title.length > maxLength) {
    const overflowItems = current.map((item) => ({ ...item }));
    const requiredFit = greedyRequiredTitle(current, maxLength, trace);
    current = refillFreedTitleBudget(requiredFit.items, overflowItems, originalItems, rawItems, maxLength, trace);
    title = renderItems(current);
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
