const apiCostPerRequest = 0.003;
const maxTitleLength = 80;
const MAX_CONCURRENT_WORKERS = 6;
const IMAGE_MAX_EDGE = 1400;
const IMAGE_MIN_EDGE = 900;
const IMAGE_INITIAL_QUALITY = 0.82;
const IMAGE_MIN_QUALITY = 0.72;
const IMAGE_EMERGENCY_MIN_QUALITY = 0.58;
const TARGET_IMAGE_DATA_URL_CHARS = 1_250_000;
const MAX_ASSET_REQUEST_BYTES = 3_400_000;
const supportedImageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const supportedImageTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const heicUnsupportedMessage = "当前浏览器暂不支持 HEIC/HEIF 预览，请先在手机相册中导出为 JPG，或使用微信/系统截图后上传。";

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
  copyAllButton: document.querySelector("#copyAllButton"),
  batchTitleList: document.querySelector("#batchTitleList"),
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
}

function isHeicFile(file) {
  const extension = fileExtension(file.name);
  return ["image/heic", "image/heif"].includes(String(file.type || "").toLowerCase())
    || extension === ".heic"
    || extension === ".heif";
}

function isSupportedImageFile(file) {
  const type = String(file.type || "").toLowerCase();
  const extension = fileExtension(file.name);
  return supportedImageTypes.includes(type) || supportedImageExtensions.includes(extension);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function canvasToDataUrl(canvas, quality) {
  return canvas.toDataURL("image/jpeg", quality);
}

function stringByteLength(value) {
  return new Blob([String(value || "")]).size;
}

async function compressImageDataUrl(originalDataUrl, maxEdge, quality) {
  const image = await loadImage(originalDataUrl);
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return {
    dataUrl: canvasToDataUrl(canvas, quality),
    width,
    height
  };
}

async function fileToAssetImage(file) {
  const originalDataUrl = await readFileAsDataUrl(file);
  let maxEdge = IMAGE_MAX_EDGE;
  let quality = IMAGE_INITIAL_QUALITY;
  let compressed;

  try {
    compressed = await compressImageDataUrl(originalDataUrl, maxEdge, quality);
  } catch (error) {
    if (isHeicFile(file)) {
      throw new Error(heicUnsupportedMessage);
    }

    throw new Error(`图片无法读取或预览：${error.message || "浏览器解码失败"}`);
  }

  while (compressed.dataUrl.length > TARGET_IMAGE_DATA_URL_CHARS && (quality > IMAGE_EMERGENCY_MIN_QUALITY || maxEdge > IMAGE_MIN_EDGE)) {
    if (quality > IMAGE_MIN_QUALITY) {
      quality = Math.max(IMAGE_MIN_QUALITY, quality - 0.05);
    } else if (quality > IMAGE_EMERGENCY_MIN_QUALITY) {
      quality = Math.max(IMAGE_EMERGENCY_MIN_QUALITY, quality - 0.08);
    } else {
      maxEdge = Math.max(IMAGE_MIN_EDGE, Math.round(maxEdge * 0.86));
    }

    compressed = await compressImageDataUrl(originalDataUrl, maxEdge, quality);
  }

  return {
    name: file.name,
    type: "image/jpeg",
    size: stringByteLength(compressed.dataUrl),
    originalSize: file.size,
    width: compressed.width,
    height: compressed.height,
    dataUrl: compressed.dataUrl
  };
}

async function recompressAssetImage(image, maxEdge, quality) {
  const compressed = await compressImageDataUrl(image.dataUrl, maxEdge, quality);

  return {
    ...image,
    type: "image/jpeg",
    size: stringByteLength(compressed.dataUrl),
    width: compressed.width,
    height: compressed.height,
    dataUrl: compressed.dataUrl
  };
}

function buildAssetRequestBody(asset) {
  return JSON.stringify({
    assetId: asset.id,
    mode: state.mode,
    maxTitleLength,
    images: asset.images,
    resolutionMap: state.resolutionMap
  });
}

async function ensureSafeAssetPayload(asset) {
  let requestBody = buildAssetRequestBody(asset);
  let requestBytes = stringByteLength(requestBody);

  if (requestBytes <= MAX_ASSET_REQUEST_BYTES) {
    return { requestBody, compressedAgain: false };
  }

  const compressionSteps = [
    { maxEdge: 1200, quality: 0.72 },
    { maxEdge: 1050, quality: 0.66 },
    { maxEdge: 900, quality: 0.58 }
  ];

  for (const step of compressionSteps) {
    asset.images = await Promise.all(asset.images.map((image) => recompressAssetImage(image, step.maxEdge, step.quality)));
    requestBody = buildAssetRequestBody(asset);
    requestBytes = stringByteLength(requestBody);

    if (requestBytes <= MAX_ASSET_REQUEST_BYTES) {
      return { requestBody, compressedAgain: true };
    }
  }

  throw new Error(`图片请求体过大，请先裁剪或压缩后重试（约 ${(requestBytes / 1_000_000).toFixed(1)}MB）`);
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

function setStatus(message) {
  elements.statusText.textContent = message;
}

function assetCountLabel(count) {
  return `${count} 张图片`;
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
    elements.assetPreviewList.innerHTML = `<div class="empty-state">上传 10 张图片后，正反面配对模式会预览为 5 个 card assets，每个资产右侧会出现一个标题输出框。</div>`;
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
  renderBatchTitles();
  renderAssetRows();
}

function resultForAsset(asset) {
  return state.results.find((result) => result.index === asset.index);
}

function assetForResult(result) {
  return state.assets.find((asset) => asset.index === result.index) || null;
}

function isBase64ImageDataUrl(value) {
  return /^data:image\/[^;,]+;base64,/i.test(String(value || ""));
}

function feedbackImagePayload(image) {
  const dataUrl = String(image?.dataUrl || "");
  if (!isBase64ImageDataUrl(dataUrl)) return null;

  return {
    name: String(image.name || ""),
    type: String(image.type || "image/jpeg"),
    dataUrl
  };
}

function feedbackImagesForAsset(asset) {
  const images = asset?.images || [];
  const front = feedbackImagePayload(images[0]);
  const back = feedbackImagePayload(images[1]);

  return {
    front,
    back,
    count: [front, back].filter(Boolean).length
  };
}

function generatedTitleResults() {
  return [...state.results]
    .filter((result) => normalizeConfidence(result.confidence) !== "FAILED" && String((result.correctedTitle ?? result.title) || "").trim())
    .sort((a, b) => a.index - b.index);
}

function renderBatchTitles() {
  const titleResults = generatedTitleResults();
  elements.copyAllButton.disabled = titleResults.length === 0;

  if (!titleResults.length) {
    elements.batchTitleList.innerHTML = `<li class="batch-empty">生成完成后，这里会按上传顺序汇总所有非空英文 eBay title。</li>`;
    return;
  }

  elements.batchTitleList.innerHTML = titleResults.map((result) => `
    <li>
      <span>资产 ${result.index}</span>
      <p>${escapeHtml(result.correctedTitle ?? result.title)}</p>
    </li>
  `).join("");
}

function imageSideLabel(imageIndex) {
  if (state.mode !== "pair") return "图片 Image";
  return imageIndex === 0 ? "正面 Front" : "背面 Back";
}

function renderAssetRows() {
  if (!state.assets.length) return;

  // Preserve upload/pairing order so writers can match titles against eBay assets.
  elements.assetPreviewList.innerHTML = state.assets.map((asset) => {
    const result = resultForAsset(asset);

    return `
      <article class="asset-row-card">
        <div class="asset-source">
          <div class="preview-images ${asset.images.length === 1 ? "single" : ""}">
            ${asset.images.map((image, imageIndex) => `
              <button class="thumb-button" type="button" data-preview-asset="${asset.index}" data-preview-image="${imageIndex}" aria-label="打开${escapeHtml(imageSideLabel(imageIndex))}预览">
                <img class="thumb" src="${image.dataUrl}" alt="${escapeHtml(image.name)}">
                <span>${imageSideLabel(imageIndex)}</span>
              </button>
            `).join("")}
          </div>
          <div class="preview-meta">
            <h3>资产 ${asset.index}</h3>
            ${asset.images.map((image, imageIndex) => `
              <p class="file-name">${imageSideLabel(imageIndex)} · ${escapeHtml(image.name)}</p>
            `).join("")}
            <span>${assetCountLabel(asset.images.length)}</span>
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
        <span class="confidence-badge confidence-pending">等待中</span>
        <span>资产 ${asset.index}</span>
      </div>
      <textarea readonly placeholder="点击开始生成后，这里会输出英文 eBay listing title。"></textarea>
      <p class="follow-up-advice">等待 Vision Engine 提取字段，再由 Resolution Engine 补全映射，最后交给 Title Engine 生成 80 字符以内标题。</p>
    </div>
  `;
}

function resultBox(result) {
  const confidence = normalizeConfidence(result.confidence);
  const disabled = confidence === "FAILED" || !result.title;
  const unresolved = Array.isArray(result.unresolved) ? result.unresolved : [];
  const generatedTitle = result.generatedTitle || result.title || "";
  const correctedTitle = result.correctedTitle ?? generatedTitle;
  const saveDisabled = disabled || result.feedbackStatus === "saving" || result.feedbackStatus === "saved";
  const saveLabel = {
    saved: "已保存",
    skipped: "未修改",
    saving: "保存中…"
  }[result.feedbackStatus] || "保存";

  return `
    <div class="title-output ${confidenceClass(confidence)}">
      <div class="title-output-head">
        <span class="confidence-badge ${confidenceClass(confidence)}">${confidence}</span>
        <div class="title-actions">
          <button class="copy-button" type="button" data-copy-title="${encodeURIComponent(correctedTitle || "")}" ${disabled ? "disabled" : ""}>复制</button>
          <button class="copy-button" type="button" data-save-title="${result.index}" ${saveDisabled ? "disabled" : ""}>${saveLabel}</button>
        </div>
      </div>
      <textarea data-title-input="${result.index}" ${disabled ? "readonly" : ""}>${escapeHtml(correctedTitle || "标题暂不可用")}</textarea>
      <p class="follow-up-advice">${result.reason || ""}</p>
      ${result.feedbackMessage ? `<p class="feedback-save-status">${escapeHtml(result.feedbackMessage)}</p>` : ""}
      <details>
        <summary>查看判断依据</summary>
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
  elements.imageModalSide.textContent = `${sideLabel}预览`;
  elements.imageModalTitle.textContent = `资产 ${asset.index}`;
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
    ["主体 Player / Character", fields.player || fields.character],
    ["画师 Artist", fields.artist],
    ["年份 Year", fields.year],
    ["品牌 Brand", fields.brand],
    ["产品 / 系列 Product / Set", [fields.product, fields.set].filter(Boolean).join(" / ")],
    ["子系列 / Insert", [fields.subset, fields.insert].filter(Boolean).join(" / ")],
    ["Parallel", fields.parallel],
    ["队伍 Team", fields.team],
    ["卡号 / 编码", fields.card_number],
    ["Serial 编号", fields.serial_number],
    ["评级 Grade", [fields.grade_company, fields.grade].filter(Boolean).join(" ")],
    ["Auto / Relic / Patch / Sketch", [
      fields.auto ? "auto" : "",
      fields.relic ? "relic" : "",
      fields.patch ? "patch" : "",
      fields.sketch ? "sketch" : "",
      fields.redemption ? "redemption" : "",
      fields.one_of_one ? "1/1" : ""
    ].filter(Boolean).join(", ")],
    ["待复核", unresolved.join(", ")]
  ];
}

async function handleFiles(fileList) {
  const candidates = [...fileList];
  const imageFiles = candidates.filter(isSupportedImageFile);
  if (!imageFiles.length) return;

  setStatus("正在优化图片…");
  closeImageModal();
  const settledImages = [];
  const failures = [];

  for (const file of imageFiles) {
    try {
      settledImages.push(await fileToAssetImage(file));
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
  }

  const ignoredFiles = candidates
    .filter((file) => !isSupportedImageFile(file))
    .map((file) => `${file.name}: 不支持的图片格式`);
  const images = settledImages;
  state.files = images;
  state.results = [];

  if (failures.length || ignoredFiles.length) {
    setStatus(`${images.length} 张图片已优化，${failures.length + ignoredFiles.length} 张未读取：${[...failures, ...ignoredFiles].join("；")}`);
  } else {
    const compressedCount = images.filter((image) => image.originalSize && image.size < image.originalSize).length;
    setStatus(compressedCount ? `${images.length} 张图片已优化，图片过大，已自动压缩用于识别。` : `${images.length} 张图片已优化。`);
  }

  renderPreviews();
  renderResults();
}

async function processAsset(asset) {
  const { requestBody, compressedAgain } = await ensureSafeAssetPayload(asset);
  if (compressedAgain) setStatus("图片过大，已自动压缩用于识别。");

  const response = await fetch("/api/listing-copilot-title", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "same-origin",
    body: requestBody
  });

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error("请求失败：413，图片请求体过大，请压缩或裁剪图片后重试。");
    }

    throw new Error(`请求失败：${response.status}`);
  }

  const payload = await response.json();

  return {
    index: asset.index,
    thumbnail: asset.images[0].dataUrl,
    feedbackImages: feedbackImagesForAsset(asset),
    generatedTitle: payload.title || "",
    correctedTitle: payload.title || "",
    feedbackStatus: "",
    feedbackMessage: "",
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
  setStatus("图片已优化，开始识别…");

  const queue = [...state.assets];
  const workerCount = Math.min(MAX_CONCURRENT_WORKERS, queue.length);
  let startedCount = 0;

  async function worker() {
    while (queue.length) {
      const asset = queue.shift();
      startedCount += 1;
      setStatus(`正在处理 ${startedCount} / ${state.assets.length}...`);

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
  setStatus("已完成，结果保持上传顺序。");
}

async function copyTitle(button) {
  const title = decodeURIComponent(button.dataset.copyTitle || "");
  if (!title) return;

  await navigator.clipboard.writeText(title);
  const original = button.textContent;
  button.textContent = "已复制";
  setTimeout(() => {
    button.textContent = original;
  }, 1100);
}

function updateCorrectedTitle(input) {
  const result = state.results.find((item) => item.index === Number(input.dataset.titleInput));
  if (!result) return;

  result.correctedTitle = input.value;
  result.feedbackStatus = "";
  result.feedbackMessage = "";
  renderBatchTitles();
}

async function saveTitleFeedback(button) {
  const result = state.results.find((item) => item.index === Number(button.dataset.saveTitle));
  if (!result) return;

  const generatedTitle = String(result.generatedTitle || result.title || "").trim();
  const correctedTitle = String(result.correctedTitle ?? generatedTitle).trim();

  if (!generatedTitle || !correctedTitle) return;

  if (generatedTitle === correctedTitle) {
    result.feedbackStatus = "skipped";
    result.feedbackMessage = "标题未修改，未写入记忆。";
    renderResults();
    return;
  }

  const asset = assetForResult(result);
  const feedbackImages = result.feedbackImages?.front
    ? result.feedbackImages
    : feedbackImagesForAsset(asset);
  result.feedbackStatus = "saving";
  result.feedbackMessage = "正在保存记忆…";
  renderResults();

  try {
    const response = await fetch("/api/listing-title-feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        generated_title: generatedTitle,
        corrected_title: correctedTitle,
        front_image: feedbackImages.front || null,
        back_image: feedbackImages.back || null,
        image_count: feedbackImages.count || 0
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `保存失败：${response.status}`);
    }

    result.feedbackStatus = payload.skipped ? "skipped" : "saved";
    result.feedbackMessage = payload.skipped ? "标题未修改，未写入记忆。" : "已保存到 V2.0 Memory Layer。";
  } catch (error) {
    result.feedbackStatus = "";
    result.feedbackMessage = error.message || "记忆保存失败。";
  }

  renderResults();
}

async function copyAllTitles() {
  const titles = generatedTitleResults().map((result) => String(result.correctedTitle ?? result.title).trim());
  if (!titles.length) return;

  await navigator.clipboard.writeText(titles.join("\n"));
  const original = elements.copyAllButton.textContent;
  elements.copyAllButton.textContent = "已复制全部";
  setTimeout(() => {
    elements.copyAllButton.textContent = original;
  }, 1200);
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
  elements.copyAllButton.addEventListener("click", copyAllTitles);

  elements.assetPreviewList.addEventListener("click", (event) => {
    const previewButton = event.target.closest("[data-preview-asset]");
    if (previewButton) {
      openImageModal(Number(previewButton.dataset.previewAsset), Number(previewButton.dataset.previewImage));
      return;
    }

    const button = event.target.closest("[data-copy-title]");
    if (button) {
      copyTitle(button);
      return;
    }

    const saveButton = event.target.closest("[data-save-title]");
    if (saveButton) saveTitleFeedback(saveButton);
  });

  elements.assetPreviewList.addEventListener("input", (event) => {
    const input = event.target.closest("[data-title-input]");
    if (input) updateCorrectedTitle(input);
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
