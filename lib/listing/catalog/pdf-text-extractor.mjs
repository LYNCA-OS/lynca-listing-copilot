function normalizeItemText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function itemPosition(item = {}) {
  const transform = Array.isArray(item.transform) ? item.transform : [];
  return {
    text: normalizeItemText(item.str),
    x: Number(transform[4] || 0),
    y: Number(transform[5] || 0)
  };
}

export function pdfTextLinesFromItems(items = [], { yTolerance = 1.5 } = {}) {
  const positioned = (Array.isArray(items) ? items : [])
    .map(itemPosition)
    .filter((item) => item.text)
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const rows = [];

  for (const item of positioned) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= yTolerance);
    if (row) {
      row.items.push(item);
      row.y = (row.y * (row.items.length - 1) + item.y) / row.items.length;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => row.items
      .sort((left, right) => left.x - right.x)
      .map((item) => item.text)
      .join("\t"))
    .filter(Boolean);
}

export async function extractPdfText(payload, { minimumTextLength = 20 } = {}) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("official_pdf_magic_invalid");
  }

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true
  });
  let document = null;
  try {
    document = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = pdfTextLinesFromItems(content.items);
      if (lines.length) pages.push(lines.join("\n"));
      page.cleanup();
    }
    const text = pages.join("\n").trim();
    if (text.length < minimumTextLength) throw new Error("official_pdf_text_extraction_empty");
    return {
      text,
      page_count: document.numPages
    };
  } finally {
    if (document) await document.destroy();
    else await loadingTask.destroy();
  }
}
