from __future__ import annotations

from typing import Any

import numpy as np


def _as_rgb_array(image: Any) -> np.ndarray:
    array = np.asarray(image)
    if array.ndim == 2:
        array = np.stack([array, array, array], axis=2)
    if array.ndim != 3 or array.shape[2] < 3:
        raise ValueError("image must be grayscale or RGB-like array")
    return array[:, :, :3].astype(np.float32, copy=False)


def _regions_from_mask(mask: np.ndarray, max_regions: int = 8) -> list[dict[str, Any]]:
    if mask.size == 0 or not mask.any():
        return []
    ys, xs = np.where(mask)
    # Lightweight connected-region approximation by coarse grid. It is deterministic
    # and sufficient for a first-pass occlusion signal without OpenCV.
    height, width = mask.shape
    cell_h = max(1, height // 8)
    cell_w = max(1, width // 8)
    regions = []
    for row in range(8):
        for col in range(8):
            y1 = row * cell_h
            x1 = col * cell_w
            y2 = height if row == 7 else min(height, y1 + cell_h)
            x2 = width if col == 7 else min(width, x1 + cell_w)
            cell = mask[y1:y2, x1:x2]
            if cell.size and float(cell.mean()) >= 0.08:
                regions.append({
                    "polygon": [[x1, y1], [x2 - 1, y1], [x2 - 1, y2 - 1], [x1, y2 - 1]],
                    "area_ratio": round(float(cell.sum()) / float(mask.size), 4),
                    "local_glare_ratio": round(float(cell.mean()), 4),
                })
    if not regions:
        regions.append({
            "polygon": [[int(xs.min()), int(ys.min())], [int(xs.max()), int(ys.min())], [int(xs.max()), int(ys.max())], [int(xs.min()), int(ys.max())]],
            "area_ratio": round(float(mask.mean()), 4),
            "local_glare_ratio": round(float(mask.mean()), 4),
        })
    return sorted(regions, key=lambda item: item["area_ratio"], reverse=True)[:max_regions]


def detect_glare_from_array(image: Any, image_id: str = "image") -> dict[str, Any]:
    rgb = _as_rgb_array(image)
    channel_max = rgb.max(axis=2)
    channel_min = rgb.min(axis=2)
    channel_spread = channel_max - channel_min
    overexposed = (channel_max >= 245) & (channel_min >= 220)
    saturated_highlight = (channel_max >= 250) & (channel_spread <= 18)
    mask = overexposed | saturated_highlight
    glare_score = float(mask.mean())

    return {
        "image_id": image_id,
        "glare_mask": {
            "encoding": "binary_summary",
            "height": int(mask.shape[0]),
            "width": int(mask.shape[1]),
            "positive_pixel_ratio": round(glare_score, 4),
        },
        "glare_score": round(glare_score, 4),
        "glare_regions": _regions_from_mask(mask),
        "algorithm": "numpy_highlight_mask_r2",
        "generative_reconstruction_used": False,
        "status": "OK",
    }


def glare_unavailable(image_id: str, reason: str = "image_bytes_not_loaded") -> dict[str, Any]:
    return {
        "image_id": image_id,
        "glare_mask": None,
        "glare_score": None,
        "glare_regions": [],
        "algorithm": "r2_unavailable_no_image_download",
        "generative_reconstruction_used": False,
        "status": "UNAVAILABLE",
        "reason": reason,
    }


def glare_placeholder(image_id: str) -> dict[str, Any]:
    return glare_unavailable(image_id)
