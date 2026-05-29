const apiCostPerRequest = 0.003;
const maxTitleLength = 80;

const state = {
  files: [],
  mode: "single",
  assets: [],
  results: [],
  resolutionMap: {}
};

const elements = {
  imageInput: document.querySelector("#imageInput"),
  dropZone: document.querySelector("#dropZone"),
  processButton: document.querySelector("#processButton"),
  resetButton: document.querySelector("#resetButton"),
  statusText: document.querySelector("#statusText"),
  previewSummary: document.querySelector("#previewSummary"),
  assetPreviewList: document.querySelector("#assetPreviewList"),
  stats: {
    images: document.querySelector("#statImages"),
    assets: document.querySelector("#statAssets"),
    processed: document.querySelector("#statProcessed"),
    high: document.querySelector("#statHigh"),
    unsure: document.querySelector("#statUnsure"),
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

function confidenceClass(confidence) {
  return {
    HIGH: "confidence-high",
    UNSURE: "confidence-unsure",
    FAILED: "confidence-failed"
  }[confidence] || "confidence-unsure";
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
  const high = state.results.filter((result) => result.confidence === "HIGH").length;
  const unsure = state.results.filter((result) => result.confidence === "UNSURE").length;
  const failed = state.results.filter((result) => result.confidence === "FAILED").length;

  elements.stats.images.textContent = state.files.length;
  elements.stats.assets.textContent = state.assets.length;
  elements.stats.processed.textContent = state.results.length;
  elements.stats.high.textContent = high;
  elements.stats.unsure.textContent = unsure;
  elements.stats.failed.textContent = failed;
  elements.stats.requests.textContent = state.assets.length;
  elements.stats.cost.textContent = formatCost(state.assets.length);
}

function renderPreviews() {
  buildAssets();
  updateStats();

  elements.processButton.disabled = !state.assets.length;

  if (!state.assets.length) {
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

function renderAssetRows() {
  if (!state.assets.length) return;

  elements.assetPreviewList.innerHTML = state.assets.map((asset) => {
    const result = resultForAsset(asset);

    return `
      <article class="asset-row-card">
        <div class="asset-source">
          <div class="preview-images ${asset.images.length === 1 ? "single" : ""}">
            ${asset.images.map((image) => `<img class="thumb" src="${image.dataUrl}" alt="${image.name}">`).join("")}
          </div>
          <div class="preview-meta">
            <h3>Card Asset ${asset.index}</h3>
            ${asset.images.map((image, imageIndex) => `
              <p class="file-name">${state.mode === "pair" && imageIndex === 0 ? "Front" : state.mode === "pair" ? "Back" : "Image"} · ${image.name}</p>
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
  const disabled = result.confidence === "FAILED" || !result.title;

  return `
    <div class="title-output ${confidenceClass(result.confidence)}">
      <div class="title-output-head">
        <span class="confidence-badge ${confidenceClass(result.confidence)}">${result.confidence}</span>
        <button class="copy-button" type="button" data-copy-title="${encodeURIComponent(result.title || "")}" ${disabled ? "disabled" : ""}>Copy</button>
      </div>
      <textarea readonly>${result.title || "Title unavailable"}</textarea>
      <p class="follow-up-advice">${result.reason || ""}</p>
      <details>
        <summary>Show Reasoning</summary>
        <div class="field-list">
          ${reasoningFields(result.fields || {}).map(([label, value]) => `
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

function reasoningFields(fields) {
  return [
    ["player / character", fields.playerOrCharacter],
    ["year", fields.year],
    ["brand / set", fields.brandSet],
    ["subset / insert", fields.subsetInsert],
    ["card number or code", fields.cardNumberCode],
    ["serial number", fields.serialNumber],
    ["auto / relic / patch / sketch / grade", fields.specialStatus],
    ["unresolved fields", Array.isArray(fields.unresolvedFields) ? fields.unresolvedFields.join(", ") : fields.unresolvedFields]
  ];
}

async function handleFiles(fileList) {
  const imageFiles = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;

  setStatus("Loading images...");
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

async function processTitles() {
  if (!state.assets.length) return;

  state.results = [];
  renderResults();
  elements.processButton.disabled = true;

  for (const asset of state.assets) {
    setStatus(`Processing ${asset.index} / ${state.assets.length}...`);

    try {
      const result = await processAsset(asset);
      state.results.push(result);
    } catch (error) {
      state.results.push({
        index: asset.index,
        thumbnail: asset.images[0].dataUrl,
        title: "",
        confidence: "FAILED",
        reason: error.message,
        fields: {
          unresolvedFields: ["request"]
        }
      });
    }

    renderResults();
  }

  elements.processButton.disabled = false;
  setStatus("Done.");
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
    const button = event.target.closest("[data-copy-title]");
    if (button) copyTitle(button);
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
