const apiCostPerRequest = 0.003;
const maxTitleLength = 80;
const MAX_CONCURRENT_WORKERS = 6;

const state = {
  files: [],
  mode: "single",
  assets: [],
  results: [],
  modal: null,
  resolutionMap: {}
};

const elements = {
  imageInput: document.querySelector("#imageInput"),
  dropZone: document.querySelector("#dropZone"),
  processButton: document.querySelector("#processButton"),
  resetButton: document.querySelector("#resetButton"),
  imageModal: document.querySelector("#imageModal"),
  imageModalClose: document.querySelector("#imageModalClose"),
  imageModalImage: document.querySelector("#imageModalImage"),
  imageModalSide: document.querySelector("#imageModalSide"),
  imageModalTitle: document.querySelector("#imageModalTitle"),
  imageModalFileName: document.querySelector("#imageModalFileName"),
  imageModalSwitcher: document.querySelector("#imageModalSwitcher"),
  statusText: document.querySelector("#statusText"),
  previewSummary: document.querySelector("#previewSummary"),
  assetPreviewList: document.querySelector("#assetPreviewList"),
  stats: {
    images: document.querySelector("#statImages"),
    assets: document.querySelector("#statAssets"),
    processed: document.querySelector("#statProcessed"),
    high: document.querySelector("#statHigh"),
    medium: document.querySelector("#statMedium"),
    low: document.querySelector("#statLow"),
    failed: document.querySelector("#statFailed"),
    requests: document.querySelector("#statRequests"),
    cost: document.querySelector("#statCost")
  }
};

function fileToAssetImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: reader.result
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatCost(requests) {
  return `$${(requests * apiCostPerRequest).toFixed(3)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function confidenceClass(confidence) {
  const normalized = normalizeConfidence(confidence);
  return {
    HIGH: "confidence-high",
    MEDIUM: "confidence-medium",
    LOW: "confidence-low",
    FAILED: "confidence-failed"
  }[normalized] || "confidence-medium";
}

function normalizeConfidence(confidence) {
  return {
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    UNSURE: "MEDIUM",
    LOW: "LOW",
    FAILED: "FAILED"
  }[String(confidence || "").toUpperCase()] || "MEDIUM";
}

function confidenceRank(confidence) {
  return {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2,
    FAILED: 3
  }[normalizeConfidence(confidence)] ?? 1;
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function buildAssets() {
  const assets = [];

  if (state.mode === "single") {
    state.files.forEach((image, index) => {
      assets.push({
        id: `asset-${index + 1}`,
        index: index + 1,
        images: [image]
      });
    });
  } else {
    for (let index = 0; index < state.files.length; index += 2) {
      assets.push({
        id: `asset-${Math.floor(index / 2) + 1}`,
        index: Math.floor(index / 2) + 1,
        images: state.files.slice(index, index + 2)
      });
    }
  }

  state.assets = assets;
}

function updateStats() {
  const high = state.results.filter((result) => normalizeConfidence(result.confidence) === "HIGH").length;
  const medium = state.results.filter((result) => normalizeConfidence(result.confidence) === "MEDIUM").length;
  const low = state.results.filter((result) => normalizeConfidence(result.confidence) === "LOW").length;
  const failed = state.results.filter((result) => normalizeConfidence(result.confidence) === "FAILED").length;

  elements.stats.images.textContent = state.files.length;
  elements.stats.assets.textContent = state.assets.length;
  elements.stats.processed.textContent = state.results.length;
  elements.stats.high.textContent = high;
  elements.stats.medium.textContent = medium;
  elements.stats.low.textContent = low;
  elements.stats.failed.textContent = failed;
  elements.stats.requests.textContent = state.assets.length;
  elements.stats.cost.textContent = formatCost(state.assets.length);
}

function renderPreviews() {
  buildAssets();
  updateStats();

  elements.processButton.disabled = !state.assets.length;

  if (!state.assets.length) {
    closeImageModal();
    elements.previewSummary.textContent = "等待上传图片。";
    elements.assetPreviewList.innerHTML = `<div class="empty-state">上传 10 张图片后，Front / Back Pair 模式会预览为 5 个 card assets，每个资产右侧会出现一个标题输出框。</div>`;
    return;
  }

  const orphanNote = state.mode === "pair" && state.files.length % 2 === 1
    ? "最后 1 张图会作为缺少背面的资产处理。"
    : "";

  elements.previewSummary.textContent = `${state.files.length} 张图片，${state.assets.length} 个 card asset。${orphanNote}`;
  renderAssetRows();
}

function renderResults() {
  updateStats();
  renderAssetRows();
}

function resultForAsset(asset) {
  return state.results.find((result) => result.index === asset.index);
}

function sortedAssetsForDisplay() {
  if (state.results.length !== state.assets.length) {
    return state.assets;
  }

  return [...state.assets].sort((left, right) => {
    const leftResult = resultForAsset(left);
    const rightResult = resultForAsset(right);

    if (!leftResult && !rightResult) return left.index - right.index;
    if (!leftResult) return 1;
    if (!rightResult) return -1;

    return confidenceRank(leftResult.confidence) - confidenceRank(rightResult.confidence)
      || left.index - right.index;
  });
}

function imageSideLabel(imageIndex) {
  if (state.mode !== "pair") return "Image";
  return imageIndex === 0 ? "Front" : "Back";
}

function renderAssetRows() {
  if (!state.assets.length) return;

  elements.assetPreviewList.innerHTML = sortedAssetsForDisplay().map((asset) => {
    const result = resultForAsset(asset);

    return `
      <article class="asset-row-card">
        <div class="asset-source">
          <div class="preview-images ${asset.images.length === 1 ? "single" : ""}">
            ${asset.images.map((image, imageIndex) => `
              <button class="thumb-button" type="button" data-preview-asset="${asset.index}" data-preview-image="${imageIndex}" aria-label="Open ${escapeHtml(imageSideLabel(imageIndex))} image preview">
                <img class="thumb" src="${image.dataUrl}" alt="${escapeHtml(image.name)}">
              </button>
            `).join("")}
          </div>
          <div class="preview-meta">
            <h3>Card Asset ${asset.index}</h3>
            ${asset.images.map((image, imageIndex) => `
              <p class="file-name">${imageSideLabel(imageIndex)} · ${escapeHtml(image.name)}</p>
            `).join("")}
            <span>${asset.images.length} image${asset.images.length > 1 ? "s" : ""}</span>
          </div>
        </div>
        ${result ? resultBox(result) : pendingBox(asset)}
      </article>
    `;
  }).join("");
}

function pendingBox(asset) {
  return `
    <div class="title-output title-output-pending">
      <div class="title-output-head">
        <span class="confidence-badge confidence-pending">PENDING</span>
        <span>Asset ${asset.index}</span>
      </div>
      <textarea readonly placeholder="点击开始生成后，这里会输出 eBay-ready title。"></textarea>
      <p class="follow-up-advice">等待 Vision Engine 提取字段，再由 Resolution Engine 补全映射，最后交给 Title Engine 生成 80 字符以内标题。</p>
    </div>
  `;
}

function resultBox(result) {
  const confidence = normalizeConfidence(result.confidence);
  const disabled = confidence === "FAILED" || !result.title;
  const unresolved = Array.isArray(result.unresolved) ? result.unresolved : [];

  return `
    <div class="title-output ${confidenceClass(confidence)}">
      <div class="title-output-head">
        <span class="confidence-badge ${confidenceClass(confidence)}">${confidence}</span>
        <button class="copy-button" type="button" data-copy-title="${encodeURIComponent(result.title || "")}" ${disabled ? "disabled" : ""}>Copy</button>
      </div>
      <textarea readonly>${result.title || "Title unavailable"}</textarea>
      <p class="follow-up-advice">${result.reason || ""}</p>
      <details>
        <summary>Show Reasoning</summary>
        <div class="field-list">
          ${reasoningFields(result.fields || {}, unresolved).map(([label, value]) => `
            <div>
              <span>${label}</span>
              <strong>${value || "-"}</strong>
            </div>
          `).join("")}
        </div>
      </details>
    </div>
  `;
}

function currentModalAsset() {
  if (!state.modal) return null;
  return state.assets.find((asset) => asset.index === state.modal.assetIndex) || null;
}

function renderImageModal() {
  const asset = currentModalAsset();
  if (!asset) {
    closeImageModal();
    return;
  }

  const imageIndex = Math.min(state.modal.imageIndex, asset.images.length - 1);
  const image = asset.images[imageIndex];
  const sideLabel = imageSideLabel(imageIndex);

  elements.imageModalImage.src = image.dataUrl;
  elements.imageModalImage.alt = image.name;
  elements.imageModalSide.textContent = `${sideLabel.toUpperCase()} PREVIEW`;
  elements.imageModalTitle.textContent = `Card Asset ${asset.index}`;
  elements.imageModalFileName.textContent = image.name;
  elements.imageModalSwitcher.innerHTML = asset.images.map((assetImage, index) => `
    <button class="modal-side-button ${index === imageIndex ? "active" : ""}" type="button" data-modal-image="${index}">
      ${imageSideLabel(index)}
    </button>
  `).join("");
}

function openImageModal(assetIndex, imageIndex) {
  state.modal = { assetIndex, imageIndex };
  renderImageModal();
  elements.imageModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  elements.imageModalClose.focus();
}

function closeImageModal() {
  if (!state.modal) return;
  state.modal = null;
  elements.imageModal.setAttribute("aria-hidden", "true");
  elements.imageModalImage.removeAttribute("src");
  document.body.classList.remove("modal-open");
}

function switchModalImage(imageIndex) {
  if (!state.modal) return;
  state.modal.imageIndex = imageIndex;
  renderImageModal();
}

function reasoningFields(fields, unresolved = []) {
  return [
    ["player / character", fields.player || fields.character],
    ["artist", fields.artist],
    ["year", fields.year],
    ["brand", fields.brand],
    ["product / set", [fields.product, fields.set].filter(Boolean).join(" / ")],
    ["subset / insert", [fields.subset, fields.insert].filter(Boolean).join(" / ")],
    ["parallel", fields.parallel],
    ["team", fields.team],
    ["card number or code", fields.card_number],
    ["serial number", fields.serial_number],
    ["grade", [fields.grade_company, fields.grade].filter(Boolean).join(" ")],
    ["auto / relic / patch / sketch", [
      fields.auto ? "auto" : "",
      fields.relic ? "relic" : "",
      fields.patch ? "patch" : "",
      fields.sketch ? "sketch" : "",
      fields.redemption ? "redemption" : "",
      fields.one_of_one ? "1/1" : ""
    ].filter(Boolean).join(", ")],
    ["unresolved", unresolved.join(", ")]
  ];
}

async function handleFiles(fileList) {
  const imageFiles = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;

  setStatus("Loading images...");
  closeImageModal();
  const images = await Promise.all(imageFiles.map(fileToAssetImage));
  state.files = images;
  state.results = [];
  setStatus(`${images.length} images ready.`);
  renderPreviews();
  renderResults();
}

async function processAsset(asset) {
  const response = await fetch("/api/listing-copilot-title", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "same-origin",
    body: JSON.stringify({
      assetId: asset.id,
      mode: state.mode,
      maxTitleLength,
      images: asset.images,
      resolutionMap: state.resolutionMap
    })
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const payload = await response.json();

  return {
    index: asset.index,
    thumbnail: asset.images[0].dataUrl,
    ...payload
  };
}

function failedResult(asset, error) {
  return {
    index: asset.index,
    thumbnail: asset.images[0].dataUrl,
    title: "",
    confidence: "FAILED",
    reason: error.message,
    fields: {},
    unresolved: ["request"]
  };
}

async function processTitles() {
  if (!state.assets.length) return;

  state.results = [];
  renderResults();
  elements.processButton.disabled = true;

  const queue = [...state.assets];
  const workerCount = Math.min(MAX_CONCURRENT_WORKERS, queue.length);
  let startedCount = 0;

  async function worker() {
    while (queue.length) {
      const asset = queue.shift();
      startedCount += 1;
      setStatus(`Processing ${startedCount} / ${state.assets.length}...`);

      try {
        const result = await processAsset(asset);
        state.results.push(result);
      } catch (error) {
        state.results.push(failedResult(asset, error));
      }

      state.results.sort((a, b) => a.index - b.index);
      renderResults();
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  renderResults();

  elements.processButton.disabled = false;
  setStatus("Done. Results sorted by confidence.");
}

async function copyTitle(button) {
  const title = decodeURIComponent(button.dataset.copyTitle || "");
  if (!title) return;

  await navigator.clipboard.writeText(title);
  const original = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => {
    button.textContent = original;
  }, 1100);
}

function resetTool() {
  state.files = [];
  state.assets = [];
  state.results = [];
  closeImageModal();
  elements.imageInput.value = "";
  setStatus("");
  renderPreviews();
  renderResults();
}

function bindEvents() {
  elements.imageInput.addEventListener("change", (event) => {
    handleFiles(event.target.files);
  });

  document.querySelectorAll("input[name='assetMode']").forEach((input) => {
    input.addEventListener("change", () => {
      state.mode = input.value;
      state.results = [];
      closeImageModal();
      renderPreviews();
      renderResults();
    });
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  });

  elements.dropZone.addEventListener("drop", (event) => {
    handleFiles(event.dataTransfer.files);
  });

  elements.processButton.addEventListener("click", processTitles);
  elements.resetButton.addEventListener("click", resetTool);

  elements.assetPreviewList.addEventListener("click", (event) => {
    const previewButton = event.target.closest("[data-preview-asset]");
    if (previewButton) {
      openImageModal(Number(previewButton.dataset.previewAsset), Number(previewButton.dataset.previewImage));
      return;
    }

    const button = event.target.closest("[data-copy-title]");
    if (button) copyTitle(button);
  });

  elements.imageModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) {
      closeImageModal();
      return;
    }

    const sideButton = event.target.closest("[data-modal-image]");
    if (sideButton) switchModalImage(Number(sideButton.dataset.modalImage));
  });

  elements.imageModalClose.addEventListener("click", closeImageModal);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeImageModal();
  });
}

async function loadResolutionMap() {
  try {
    const response = await fetch("/app/resolution.json");
    state.resolutionMap = await response.json();
  } catch {
    state.resolutionMap = {};
  }
}

await loadResolutionMap();
bindEvents();
renderPreviews();
renderResults();
