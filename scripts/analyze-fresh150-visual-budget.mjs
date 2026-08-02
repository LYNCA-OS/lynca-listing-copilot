#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const ANALYSIS_LONG_EDGE = 384;
const CARD_ASPECTS = [5 / 7, 7 / 5, 0.63, 1 / 0.63];
const MONTAGE_WIDTH = 2048;
const MONTAGE_HEIGHT = 1024;

function args(argv = process.argv.slice(2)) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

function clamp(value, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function rounded(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function quantile(values, probability) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  return ordered[Math.max(0, Math.min(ordered.length - 1, Math.ceil(probability * ordered.length) - 1))];
}

function distribution(values, digits = 3) {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return { count: 0 };
  return {
    count: usable.length,
    min: rounded(Math.min(...usable), digits),
    p10: rounded(quantile(usable, 0.10), digits),
    p25: rounded(quantile(usable, 0.25), digits),
    median: rounded(quantile(usable, 0.50), digits),
    p75: rounded(quantile(usable, 0.75), digits),
    p90: rounded(quantile(usable, 0.90), digits),
    p95: rounded(quantile(usable, 0.95), digits),
    max: rounded(Math.max(...usable), digits),
    mean: rounded(usable.reduce((sum, value) => sum + value, 0) / usable.length, digits)
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function jpegQualityEstimate(buffer) {
  const standardLuma = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99
  ];
  const standardSum = standardLuma.reduce((sum, value) => sum + value, 0);
  let cursor = 2;
  while (cursor + 4 <= buffer.length) {
    if (buffer[cursor] !== 0xff) {
      cursor += 1;
      continue;
    }
    while (buffer[cursor] === 0xff) cursor += 1;
    const marker = buffer[cursor];
    cursor += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (cursor + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(cursor);
    if (length < 2 || cursor + length > buffer.length) break;
    if (marker === 0xdb) {
      let tableCursor = cursor + 2;
      const end = cursor + length;
      while (tableCursor < end) {
        const precision = buffer[tableCursor] >> 4;
        const tableId = buffer[tableCursor] & 15;
        tableCursor += 1;
        const tableBytes = precision ? 128 : 64;
        if (tableCursor + tableBytes > end) break;
        if (tableId === 0) {
          let sum = 0;
          for (let index = 0; index < 64; index += 1) {
            sum += precision
              ? buffer.readUInt16BE(tableCursor + index * 2)
              : buffer[tableCursor + index];
          }
          const scale = 100 * sum / standardSum;
          const quality = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
          return rounded(clamp(quality, 1, 100), 1);
        }
        tableCursor += tableBytes;
      }
    }
    cursor += length;
  }
  return null;
}

function orientation(width, height) {
  if (width > height * 1.08) return "landscape";
  if (height > width * 1.08) return "portrait";
  return "square";
}

function aspectFit(width, height) {
  const ratio = width / Math.max(1, height);
  return Math.max(...CARD_ASPECTS.map((target) => Math.min(ratio / target, target / ratio)));
}

function analysisCanvas(image) {
  const scale = Math.min(1, ANALYSIS_LONG_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context, width, height, scale };
}

function median(values) {
  return quantile(values, 0.5) ?? 0;
}

function cornerBackground(data, width, height) {
  const patchWidth = Math.max(2, Math.round(width * 0.06));
  const patchHeight = Math.max(2, Math.round(height * 0.06));
  const patches = [
    [0, 0],
    [width - patchWidth, 0],
    [0, height - patchHeight],
    [width - patchWidth, height - patchHeight]
  ].map(([left, top]) => {
    const channels = [[], [], []];
    for (let y = top; y < top + patchHeight; y += 2) {
      for (let x = left; x < left + patchWidth; x += 2) {
        const index = (y * width + x) * 4;
        channels[0].push(data[index]);
        channels[1].push(data[index + 1]);
        channels[2].push(data[index + 2]);
      }
    }
    return channels.map(median);
  });
  let medoid = patches[0];
  let medoidDistance = Infinity;
  for (const candidate of patches) {
    const distance = patches.reduce((sum, other) => sum
      + Math.hypot(candidate[0] - other[0], candidate[1] - other[1], candidate[2] - other[2]), 0);
    if (distance < medoidDistance) {
      medoid = candidate;
      medoidDistance = distance;
    }
  }
  const spread = patches.reduce((sum, patch) => sum
    + Math.hypot(medoid[0] - patch[0], medoid[1] - patch[1], medoid[2] - patch[2]) / 441.673, 0) / 4;
  return { rgb: medoid, spread };
}

function otsuThreshold(values) {
  const bins = 128;
  const histogram = new Uint32Array(bins);
  for (const value of values) histogram[Math.min(bins - 1, Math.floor(clamp(value) * bins))] += 1;
  const total = values.length;
  let totalWeighted = 0;
  for (let index = 0; index < bins; index += 1) totalWeighted += index * histogram[index];
  let backgroundWeight = 0;
  let backgroundWeighted = 0;
  let bestVariance = -1;
  let best = 0;
  for (let index = 0; index < bins; index += 1) {
    backgroundWeight += histogram[index];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundWeighted += index * histogram[index];
    const backgroundMean = backgroundWeighted / backgroundWeight;
    const foregroundMean = (totalWeighted - backgroundWeighted) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = index;
    }
  }
  return (best + 0.5) / bins;
}

function dilate(mask, width, height, radius = 1) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let hit = 0;
      for (let dy = -radius; dy <= radius && !hit; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && mask[yy * width + xx]) {
            hit = 1;
            break;
          }
        }
      }
      output[y * width + x] = hit;
    }
  }
  return output;
}

function erode(mask, width, height, radius = 1) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let keep = 1;
      for (let dy = -radius; dy <= radius && keep; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          keep = 0;
          break;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || !mask[yy * width + xx]) {
            keep = 0;
            break;
          }
        }
      }
      output[y * width + x] = keep;
    }
  }
  return output;
}

function largestComponent(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  let best = null;
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;
    let count = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (head < tail) {
      const position = queue[head];
      head += 1;
      count += 1;
      const x = position % width;
      const y = Math.floor(position / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const neighbours = [position - 1, position + 1, position - width, position + width];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= mask.length || visited[neighbour] || !mask[neighbour]) continue;
        const nx = neighbour % width;
        const ny = Math.floor(neighbour / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        visited[neighbour] = 1;
        queue[tail] = neighbour;
        tail += 1;
      }
    }
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const boxArea = boxWidth * boxHeight;
    const centerX = (minX + maxX + 1) / 2 / width;
    const centerY = (minY + maxY + 1) / 2 / height;
    const centerDistance = Math.hypot(centerX - 0.5, centerY - 0.5) / Math.SQRT1_2;
    const score = count * (1 - 0.35 * centerDistance);
    const component = {
      count,
      minX,
      minY,
      maxX,
      maxY,
      boxWidth,
      boxHeight,
      boxArea,
      fill: count / boxArea,
      centerDistance,
      score
    };
    if (!best || component.score > best.score) best = component;
  }
  return best;
}

function foregroundBounds(imageData, width, height) {
  const { rgb, spread } = cornerBackground(imageData.data, width, height);
  const distances = new Float32Array(width * height);
  for (let index = 0; index < distances.length; index += 1) {
    const offset = index * 4;
    distances[index] = Math.hypot(
      imageData.data[offset] - rgb[0],
      imageData.data[offset + 1] - rgb[1],
      imageData.data[offset + 2] - rgb[2]
    ) / 441.673;
  }
  const threshold = clamp(otsuThreshold(distances), 0.075, 0.32);
  let mask = Uint8Array.from(distances, (value) => value >= threshold ? 1 : 0);
  mask = erode(dilate(mask, width, height, 2), width, height, 1);
  const component = largestComponent(mask, width, height);
  if (!component) return { confidence: 0, use_crop: false, reason: "no_foreground_component" };
  const marginX = Math.round(component.boxWidth * 0.035);
  const marginY = Math.round(component.boxHeight * 0.035);
  const left = Math.max(0, component.minX - marginX);
  const top = Math.max(0, component.minY - marginY);
  const right = Math.min(width, component.maxX + 1 + marginX);
  const bottom = Math.min(height, component.maxY + 1 + marginY);
  const cropWidth = right - left;
  const cropHeight = bottom - top;
  const boxFraction = cropWidth * cropHeight / (width * height);
  const fit = aspectFit(cropWidth, cropHeight);
  const sizeScore = clamp((component.count / (width * height) - 0.08) / 0.32);
  const fillScore = clamp((component.fill - 0.18) / 0.48);
  const fitScore = clamp((fit - 0.58) / 0.34);
  const centerScore = clamp(1 - component.centerDistance / 0.48);
  const cornerScore = clamp(1 - spread / 0.34);
  const confidence = 0.24 * sizeScore + 0.24 * fillScore + 0.20 * fitScore
    + 0.20 * centerScore + 0.12 * cornerScore;
  const useCrop = confidence >= 0.62 && boxFraction >= 0.28 && boxFraction <= 0.97;
  return {
    confidence,
    use_crop: useCrop,
    reason: useCrop ? "foreground_rectangle_confident" : "fail_closed_full_frame",
    threshold,
    background_spread: spread,
    component_fill: component.fill,
    component_fraction: component.count / (width * height),
    box_fraction: boxFraction,
    aspect_fit: fit,
    normalized: {
      x: left / width,
      y: top / height,
      width: cropWidth / width,
      height: cropHeight / height
    }
  };
}

function fineDetailMetrics(imageData, width, height, sourceScale) {
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = (0.2126 * imageData.data[offset]
      + 0.7152 * imageData.data[offset + 1]
      + 0.0722 * imageData.data[offset + 2]) / 255;
  }
  const gradients = [];
  const laplacians = [];
  const edgePairs = [];
  const strongThreshold = 0.11;
  for (let y = 1; y < height - 1; y += 1) {
    const inEvidenceBand = y <= height * 0.36 || y >= height * 0.58;
    let priorEdge = null;
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = gray[index + 1] - gray[index - 1];
      const gy = gray[index + width] - gray[index - width];
      const magnitude = Math.hypot(gx, gy);
      gradients.push(magnitude);
      laplacians.push(Math.abs(4 * gray[index] - gray[index - 1] - gray[index + 1]
        - gray[index - width] - gray[index + width]));
      if (inEvidenceBand && Math.abs(gx) >= strongThreshold) {
        if (priorEdge !== null) {
          const distance = x - priorEdge;
          if (distance >= 1 && distance <= 18) edgePairs.push(distance / sourceScale);
        }
        priorEdge = x;
      }
    }
  }
  const strongEdges = gradients.filter((value) => value >= strongThreshold).length;
  const finePairs = edgePairs.filter((value) => value <= 12).length;
  return {
    gradient_mean: gradients.reduce((sum, value) => sum + value, 0) / gradients.length,
    laplacian_mean: laplacians.reduce((sum, value) => sum + value, 0) / laplacians.length,
    strong_edge_density: strongEdges / gradients.length,
    evidence_edge_pair_spacing_px_p25: quantile(edgePairs, 0.25),
    evidence_edge_pair_spacing_px_p50: quantile(edgePairs, 0.50),
    evidence_edge_pairs_under_12px_fraction: edgePairs.length ? finePairs / edgePairs.length : 0
  };
}

function genericHighDetailProxy(width, height) {
  let scale = Math.min(1, 2048 / Math.max(width, height));
  let resizedWidth = width * scale;
  let resizedHeight = height * scale;
  const shortest = Math.min(resizedWidth, resizedHeight);
  if (shortest > 0) {
    const shortScale = 768 / shortest;
    resizedWidth *= shortScale;
    resizedHeight *= shortScale;
    scale *= shortScale;
  }
  const tiles = Math.ceil(resizedWidth / 512) * Math.ceil(resizedHeight / 512);
  return {
    scale,
    width: Math.round(resizedWidth),
    height: Math.round(resizedHeight),
    tiles
  };
}

function sourceBounds(imageMetric) {
  const normalized = imageMetric.foreground.use_crop
    ? imageMetric.foreground.normalized
    : { x: 0, y: 0, width: 1, height: 1 };
  return {
    left: Math.round(normalized.x * imageMetric.width),
    top: Math.round(normalized.y * imageMetric.height),
    width: Math.max(1, Math.round(normalized.width * imageMetric.width)),
    height: Math.max(1, Math.round(normalized.height * imageMetric.height))
  };
}

function renderNormalized(image, imageMetric) {
  const bounds = sourceBounds(imageMetric);
  const longEdge = Math.max(imageMetric.width, imageMetric.height);
  const scale = longEdge / Math.max(bounds.width, bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#808080";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, bounds.left, bounds.top, bounds.width, bounds.height, 0, 0, width, height);
  return { canvas, bounds, source_to_output_scale: scale };
}

function drawContained(context, image, source, target) {
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const left = Math.round(target.left + (target.width - width) / 2);
  const top = Math.round(target.top + (target.height - height) / 2);
  context.drawImage(image, source.left, source.top, source.width, source.height, left, top, width, height);
  return { scale, width, height, left, top };
}

function relativeCrop(bounds, region) {
  return {
    left: Math.round(bounds.left + bounds.width * region.x),
    top: Math.round(bounds.top + bounds.height * region.y),
    width: Math.max(1, Math.round(bounds.width * region.width)),
    height: Math.max(1, Math.round(bounds.height * region.height))
  };
}

function renderEvidenceSheet(front, back, frontMetric, backMetric) {
  const canvas = createCanvas(MONTAGE_WIDTH, MONTAGE_HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#777777";
  context.fillRect(0, 0, MONTAGE_WIDTH, MONTAGE_HEIGHT);
  const views = [];
  const sides = [
    { name: "front", image: front, metric: frontMetric, offset: 0 },
    { name: "back", image: back, metric: backMetric, offset: 1024 }
  ];
  for (const side of sides) {
    const bounds = sourceBounds(side.metric);
    const topSource = relativeCrop(bounds, { x: 0, y: 0, width: 1, height: 0.34 });
    const bottomLeftSource = relativeCrop(bounds, { x: 0, y: 0.58, width: 0.56, height: 0.42 });
    const bottomRightSource = relativeCrop(bounds, { x: 0.44, y: 0.58, width: 0.56, height: 0.42 });
    views.push({
      side: side.name,
      region: "top_band",
      source: topSource,
      rendered: drawContained(context, side.image, topSource, {
        left: side.offset + 4,
        top: 4,
        width: 1016,
        height: 504
      })
    });
    views.push({
      side: side.name,
      region: "bottom_left",
      source: bottomLeftSource,
      rendered: drawContained(context, side.image, bottomLeftSource, {
        left: side.offset + 4,
        top: 516,
        width: 504,
        height: 504
      })
    });
    views.push({
      side: side.name,
      region: "bottom_right",
      source: bottomRightSource,
      rendered: drawContained(context, side.image, bottomRightSource, {
        left: side.offset + 516,
        top: 516,
        width: 504,
        height: 504
      })
    });
  }
  return { canvas, views };
}

function renderTwoBottomBandSheet(front, back, frontMetric, backMetric) {
  const bandFor = (metric) => ({
    left: 0,
    top: Math.round(metric.height * 0.65),
    width: metric.width,
    height: Math.max(1, metric.height - Math.round(metric.height * 0.65))
  });
  const frontBand = bandFor(frontMetric);
  const backBand = bandFor(backMetric);
  const width = Math.max(frontBand.width, backBand.width);
  const height = frontBand.height + backBand.height;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#777777";
  context.fillRect(0, 0, width, height);
  context.drawImage(
    front,
    frontBand.left,
    frontBand.top,
    frontBand.width,
    frontBand.height,
    Math.round((width - frontBand.width) / 2),
    0,
    frontBand.width,
    frontBand.height
  );
  context.drawImage(
    back,
    backBand.left,
    backBand.top,
    backBand.width,
    backBand.height,
    Math.round((width - backBand.width) / 2),
    frontBand.height,
    backBand.width,
    backBand.height
  );
  return { canvas, bands: [{ side: "front", source: frontBand }, { side: "back", source: backBand }] };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function summarize(images, assets, arms, elapsedMs) {
  const confident = images.filter((image) => image.foreground.use_crop);
  const pairs = assets.filter((asset) => asset.front && asset.back);
  return {
    images: images.length,
    assets: assets.length,
    complete_front_back_pairs: pairs.length,
    elapsed_ms: elapsedMs,
    source: {
      orientation: countBy(images.map((image) => image.orientation)),
      front_back_orientation_mismatch_assets: pairs.filter((asset) => asset.front.orientation !== asset.back.orientation).length,
      long_edge_px: distribution(images.map((image) => Math.max(image.width, image.height)), 0),
      short_edge_px: distribution(images.map((image) => Math.min(image.width, image.height)), 0),
      pixels: distribution(images.map((image) => image.width * image.height), 0),
      bytes: distribution(images.map((image) => image.bytes), 0),
      jpeg_quality_ijg_equivalent: distribution(images.map((image) => image.jpeg_quality), 1),
      whole_frame_aspect_fit: distribution(images.map((image) => image.aspect_fit), 3)
    },
    foreground_normalization: {
      confident_images: confident.length,
      fail_closed_images: images.length - confident.length,
      confident_assets_both_sides: pairs.filter((asset) => asset.front.foreground.use_crop && asset.back.foreground.use_crop).length,
      estimated_foreground_box_fraction: distribution(confident.map((image) => image.foreground.box_fraction), 3),
      estimated_background_fraction: distribution(confident.map((image) => 1 - image.foreground.box_fraction), 3),
      linear_detail_gain_if_refit: distribution(confident.map((image) => 1 / Math.sqrt(image.foreground.box_fraction)), 3),
      confidence: distribution(images.map((image) => image.foreground.confidence), 3)
    },
    detail_quality: {
      gradient_mean: distribution(images.map((image) => image.detail.gradient_mean), 4),
      laplacian_mean: distribution(images.map((image) => image.detail.laplacian_mean), 4),
      strong_edge_density: distribution(images.map((image) => image.detail.strong_edge_density), 4),
      evidence_edge_pair_spacing_px_p25: distribution(images.map((image) => image.detail.evidence_edge_pair_spacing_px_p25), 2),
      evidence_edge_pair_spacing_px_p50: distribution(images.map((image) => image.detail.evidence_edge_pair_spacing_px_p50), 2),
      evidence_edge_pairs_under_12px_fraction: distribution(images.map((image) => image.detail.evidence_edge_pairs_under_12px_fraction), 3)
    },
    arm_proxies: arms
  };
}

async function main() {
  const options = args();
  const cacheDir = resolve(String(options["cache-dir"] || ""));
  if (!cacheDir || !existsSync(cacheDir)) throw new Error("--cache-dir must contain the read-only image cache");
  const manifestPath = resolve(String(options.manifest || join(cacheDir, "manifest.json")));
  const outDir = options["out-dir"] ? resolve(String(options["out-dir"])) : null;
  const outputPath = options.output ? resolve(String(options.output)) : null;
  const sampleLimit = Number(options["sample-assets"] || 12);
  if (outDir) mkdirSync(outDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const startedAt = Date.now();
  const imageMetrics = [];
  const decoded = new Map();

  for (const reference of manifest.images || []) {
    const filePath = join(cacheDir, basename(reference.file));
    const buffer = readFileSync(filePath);
    const image = await loadImage(buffer);
    const analysis = analysisCanvas(image);
    const imageData = analysis.context.getImageData(0, 0, analysis.width, analysis.height);
    const foreground = foregroundBounds(imageData, analysis.width, analysis.height);
    const detail = fineDetailMetrics(imageData, analysis.width, analysis.height, analysis.scale);
    const metric = {
      asset_id: reference.asset_id,
      role: reference.role,
      file: reference.file,
      bytes: statSync(filePath).size,
      sha256: reference.sha256 || sha256(buffer),
      width: image.width,
      height: image.height,
      orientation: orientation(image.width, image.height),
      aspect_fit: aspectFit(image.width, image.height),
      jpeg_quality: jpegQualityEstimate(buffer),
      foreground: {
        ...foreground,
        confidence: rounded(foreground.confidence, 4),
        threshold: rounded(foreground.threshold, 4),
        background_spread: rounded(foreground.background_spread, 4),
        component_fill: rounded(foreground.component_fill, 4),
        component_fraction: rounded(foreground.component_fraction, 4),
        box_fraction: rounded(foreground.box_fraction, 4),
        aspect_fit: rounded(foreground.aspect_fit, 4)
      },
      detail: Object.fromEntries(Object.entries(detail).map(([key, value]) => [key, rounded(value, 5)])),
      generic_high_detail_proxy: genericHighDetailProxy(image.width, image.height)
    };
    imageMetrics.push(metric);
    decoded.set(`${reference.asset_id}:${reference.role}`, image);
  }

  const byAsset = new Map();
  for (const image of imageMetrics) {
    if (!byAsset.has(image.asset_id)) byAsset.set(image.asset_id, { asset_id: image.asset_id });
    const side = String(image.role).startsWith("front") ? "front" : "back";
    byAsset.get(image.asset_id)[side] = image;
  }
  const assets = [...byAsset.values()].sort((left, right) => left.asset_id.localeCompare(right.asset_id));
  let sourceBytes = 0;
  let sourcePixels = 0;
  let sourceTiles = 0;
  let normalizedBytes = 0;
  let normalizedPixels = 0;
  let normalizedTiles = 0;
  let montageBytes = 0;
  let montageTiles = 0;
  let bottomBandBytes = 0;
  let bottomBandTiles = 0;
  let twoBandSheetBytes = 0;
  let twoBandSheetTiles = 0;
  const normalizedLinearGains = [];
  const montageRegionScaleGains = [];
  const bottomBandLinearGains = [];
  const twoBandSheetLinearGains = [];
  let montageAssets = 0;
  let transformElapsedMs = 0;

  for (let assetIndex = 0; assetIndex < assets.length; assetIndex += 1) {
    const asset = assets[assetIndex];
    if (!asset.front || !asset.back) continue;
    const frontImage = decoded.get(`${asset.asset_id}:${asset.front.role}`);
    const backImage = decoded.get(`${asset.asset_id}:${asset.back.role}`);
    const transformStartedAt = Date.now();
    const normalized = [];
    for (const [side, image, metric] of [
      ["front", frontImage, asset.front],
      ["back", backImage, asset.back]
    ]) {
      sourceBytes += metric.bytes;
      sourcePixels += metric.width * metric.height;
      sourceTiles += metric.generic_high_detail_proxy.tiles;
      const result = renderNormalized(image, metric);
      const buffer = result.canvas.toBuffer("image/jpeg", 90);
      normalizedBytes += buffer.length;
      normalizedPixels += result.canvas.width * result.canvas.height;
      const normalizedProxy = genericHighDetailProxy(result.canvas.width, result.canvas.height);
      normalizedTiles += normalizedProxy.tiles;
      const sourceProxy = metric.generic_high_detail_proxy;
      normalizedLinearGains.push(result.source_to_output_scale * normalizedProxy.scale / sourceProxy.scale);
      if (outDir && assetIndex < sampleLimit) {
        writeFileSync(join(outDir, `${asset.asset_id}__${side}__normalized.jpg`), buffer);
      }

      const bottomSource = {
        left: 0,
        top: Math.round(metric.height * 0.58),
        width: metric.width,
        height: Math.max(1, metric.height - Math.round(metric.height * 0.58))
      };
      const bottomCanvas = createCanvas(bottomSource.width, bottomSource.height);
      const bottomContext = bottomCanvas.getContext("2d");
      bottomContext.drawImage(
        image,
        bottomSource.left,
        bottomSource.top,
        bottomSource.width,
        bottomSource.height,
        0,
        0,
        bottomSource.width,
        bottomSource.height
      );
      const bottomBuffer = bottomCanvas.toBuffer("image/jpeg", 90);
      const bottomProxy = genericHighDetailProxy(bottomCanvas.width, bottomCanvas.height);
      bottomBandBytes += bottomBuffer.length;
      bottomBandTiles += bottomProxy.tiles;
      bottomBandLinearGains.push(bottomProxy.scale / sourceProxy.scale);
      if (outDir && assetIndex < sampleLimit) {
        writeFileSync(join(outDir, `${asset.asset_id}__${side}__bottom-band.jpg`), bottomBuffer);
      }
    }
    const sheet = renderEvidenceSheet(frontImage, backImage, asset.front, asset.back);
    const sheetBuffer = sheet.canvas.toBuffer("image/jpeg", 90);
    montageBytes += sheetBuffer.length;
    montageTiles += genericHighDetailProxy(sheet.canvas.width, sheet.canvas.height).tiles;
    montageAssets += 1;
    const sheetProxy = genericHighDetailProxy(sheet.canvas.width, sheet.canvas.height);
    for (const view of sheet.views) {
      const metric = view.side === "front" ? asset.front : asset.back;
      montageRegionScaleGains.push(view.rendered.scale * sheetProxy.scale / metric.generic_high_detail_proxy.scale);
    }
    if (outDir && assetIndex < sampleLimit) {
      writeFileSync(join(outDir, `${asset.asset_id}__evidence-sheet.jpg`), sheetBuffer);
    }
    const twoBandSheet = renderTwoBottomBandSheet(frontImage, backImage, asset.front, asset.back);
    const twoBandSheetBuffer = twoBandSheet.canvas.toBuffer("image/jpeg", 90);
    const twoBandProxy = genericHighDetailProxy(twoBandSheet.canvas.width, twoBandSheet.canvas.height);
    twoBandSheetBytes += twoBandSheetBuffer.length;
    twoBandSheetTiles += twoBandProxy.tiles;
    for (const band of twoBandSheet.bands) {
      const metric = band.side === "front" ? asset.front : asset.back;
      twoBandSheetLinearGains.push(twoBandProxy.scale / metric.generic_high_detail_proxy.scale);
    }
    if (outDir && assetIndex < sampleLimit) {
      writeFileSync(join(outDir, `${asset.asset_id}__two-bottom-band-sheet.jpg`), twoBandSheetBuffer);
    }
    transformElapsedMs += Date.now() - transformStartedAt;
  }

  const completeAssets = assets.filter((asset) => asset.front && asset.back).length;
  const armProxies = {
    control_two_originals_high: {
      assets: completeAssets,
      images_per_asset: 2,
      total_source_bytes: sourceBytes,
      total_source_pixels: sourcePixels,
      generic_512_tile_proxy_total: sourceTiles
    },
    foreground_normalized_replacement_high: {
      assets: completeAssets,
      images_per_asset: 2,
      generated_jpeg_quality: 90,
      total_bytes: normalizedBytes,
      total_pixels: normalizedPixels,
      byte_ratio_vs_control: rounded(normalizedBytes / sourceBytes, 3),
      pixel_ratio_vs_control: rounded(normalizedPixels / sourcePixels, 3),
      generic_512_tile_proxy_total: normalizedTiles,
      tile_ratio_vs_control: rounded(normalizedTiles / sourceTiles, 3),
      target_linear_scale_gain_vs_control: distribution(normalizedLinearGains, 3)
    },
    originals_plus_one_evidence_sheet_high: {
      assets: montageAssets,
      images_per_asset: 3,
      generated_jpeg_quality: 90,
      evidence_sheet_dimensions: `${MONTAGE_WIDTH}x${MONTAGE_HEIGHT}`,
      additional_sheet_bytes: montageBytes,
      additional_bytes_per_asset: rounded(montageBytes / Math.max(1, montageAssets), 0),
      total_bytes_ratio_vs_control: rounded((sourceBytes + montageBytes) / sourceBytes, 3),
      generic_512_tile_proxy_total: sourceTiles + montageTiles,
      tile_ratio_vs_control: rounded((sourceTiles + montageTiles) / sourceTiles, 3),
      evidence_region_linear_scale_gain_vs_control: distribution(montageRegionScaleGains, 3)
    },
    originals_plus_two_bottom_band_crops_high: {
      assets: completeAssets,
      images_per_asset: 4,
      generated_jpeg_quality: 90,
      crop_definition: "front/back full-width y=0.58..1.00",
      additional_crop_bytes: bottomBandBytes,
      additional_bytes_per_asset: rounded(bottomBandBytes / Math.max(1, completeAssets), 0),
      total_bytes_ratio_vs_control: rounded((sourceBytes + bottomBandBytes) / sourceBytes, 3),
      generic_512_tile_proxy_total: sourceTiles + bottomBandTiles,
      tile_ratio_vs_control: rounded((sourceTiles + bottomBandTiles) / sourceTiles, 3),
      bottom_band_linear_scale_gain_vs_control: distribution(bottomBandLinearGains, 3)
    },
    originals_plus_one_two_bottom_band_sheet_high: {
      assets: completeAssets,
      images_per_asset: 3,
      generated_jpeg_quality: 90,
      crop_definition: "front/back full-width y=0.65..1.00 stacked vertically at native pixels",
      additional_sheet_bytes: twoBandSheetBytes,
      additional_bytes_per_asset: rounded(twoBandSheetBytes / Math.max(1, completeAssets), 0),
      total_bytes_ratio_vs_control: rounded((sourceBytes + twoBandSheetBytes) / sourceBytes, 3),
      generic_512_tile_proxy_total: sourceTiles + twoBandSheetTiles,
      tile_ratio_vs_control: rounded((sourceTiles + twoBandSheetTiles) / sourceTiles, 3),
      bottom_band_linear_scale_gain_vs_control: distribution(twoBandSheetLinearGains, 3)
    },
    offline_transform_benchmark: {
      assets: completeAssets,
      transforms_per_asset: "2 normalized replacements + 2 bottom bands + 1 evidence sheet + 1 two-bottom-band sheet",
      total_ms: transformElapsedMs,
      mean_ms_per_asset: rounded(transformElapsedMs / Math.max(1, completeAssets), 1),
      warning: "Local decoded-image canvas benchmark only; excludes network, Storage signing and provider latency."
    }
  };
  const report = {
    schema_version: "fresh150-visual-information-budget-v1",
    authority: "offline_diagnostic_only",
    provider_calls: 0,
    runtime_changed: false,
    inputs: {
      manifest: manifestPath,
      manifest_sha256: sha256(readFileSync(manifestPath)),
      cache_directory: cacheDir,
      image_count: imageMetrics.length
    },
    metric_notes: {
      foreground_bounds: "Color-distance connected-component heuristic; only confidence >=0.62 crops. Lower-confidence rows fail closed to the full frame.",
      jpeg_quality: "IJG-equivalent estimate from the luminance quantization-table sum; custom tables can differ.",
      edge_pair_spacing: "Strong horizontal edge-pair spacing in top/bottom evidence bands; a texture-scale proxy, not OCR or a glyph-height claim.",
      tile_proxy: "Provider-agnostic 512px high-detail geometry proxy; it is not Luna billing and must be replaced by measured tokens in a no-score cloud preflight."
    },
    summary: summarize(imageMetrics, assets, armProxies, Date.now() - startedAt),
    images: imageMetrics,
    assets
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) writeFileSync(outputPath, serialized);
  else process.stdout.write(serialized);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
