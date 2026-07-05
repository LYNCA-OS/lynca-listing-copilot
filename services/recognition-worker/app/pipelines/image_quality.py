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


def _gray(rgb: np.ndarray) -> np.ndarray:
    return 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]


def _laplacian_variance(gray: np.ndarray) -> float:
    padded = np.pad(gray, 1, mode="edge")
    lap = (
        -4 * padded[1:-1, 1:-1]
        + padded[:-2, 1:-1]
        + padded[2:, 1:-1]
        + padded[1:-1, :-2]
        + padded[1:-1, 2:]
    )
    return float(np.var(lap))


def _tenengrad(gray: np.ndarray) -> float:
    gx = np.zeros_like(gray)
    gy = np.zeros_like(gray)
    gx[:, 1:-1] = gray[:, 2:] - gray[:, :-2]
    gy[1:-1, :] = gray[2:, :] - gray[:-2, :]
    return float(np.mean(gx * gx + gy * gy))


def _edge_density(gray: np.ndarray) -> float:
    gx = np.abs(np.diff(gray, axis=1))
    gy = np.abs(np.diff(gray, axis=0))
    if gx.size == 0 or gy.size == 0:
        return 0.0
    threshold = max(8.0, float(gray.std() * 0.35))
    return float(((gx > threshold).mean() + (gy > threshold).mean()) / 2)


def _score_from_focus(laplacian_var: float, tenengrad: float, edge_density: float) -> float:
    lap_score = min(1.0, laplacian_var / 900.0)
    ten_score = min(1.0, tenengrad / 1800.0)
    edge_score = min(1.0, edge_density / 0.18)
    return max(0.0, min(1.0, (lap_score * 0.4) + (ten_score * 0.35) + (edge_score * 0.25)))


def measure_image_quality_from_array(
    image: Any,
    image_id: str = "image",
    rectification: dict[str, Any] | None = None,
    glare: dict[str, Any] | None = None,
) -> dict[str, Any]:
    rgb = _as_rgb_array(image)
    height, width = rgb.shape[:2]
    gray = _gray(rgb)
    lap_var = _laplacian_variance(gray)
    ten = _tenengrad(gray)
    edges = _edge_density(gray)
    blur_score = 1.0 - _score_from_focus(lap_var, ten, edges)
    resolution_sufficient = width >= 700 and height >= 900
    rect_conf = float((rectification or {}).get("rectification_confidence") or 0)
    perspective_score = rect_conf if rectification else None
    glare_score = float((glare or {}).get("glare_score") or 0)
    text_readability_score = max(0.0, min(1.0, (1.0 - blur_score) * 0.72 + min(1.0, gray.std() / 72.0) * 0.28))
    degraded = (
        blur_score > 0.62
        or glare_score > 0.18
        or not resolution_sufficient
        or (perspective_score is not None and perspective_score < 0.35)
    )

    return {
        "image_id": image_id,
        "blur_score": round(float(blur_score), 4),
        "focus_features": {
            "laplacian_variance": round(lap_var, 4),
            "tenengrad": round(ten, 4),
            "edge_density": round(edges, 4),
        },
        "glare_score": round(glare_score, 4),
        "crop_complete": rect_conf >= 0.35 if rectification else None,
        "perspective_score": round(perspective_score, 4) if perspective_score is not None else None,
        "text_readability_score": round(float(text_readability_score), 4),
        "resolution_sufficient": resolution_sufficient,
        "critical_region_occlusion": {},
        "image_quality_degraded": degraded,
        "algorithm": "numpy_quality_gate_r2",
        "status": "OK",
    }


def quality_unavailable(image_id: str, reason: str = "image_bytes_not_loaded") -> dict[str, Any]:
    return {
        "image_id": image_id,
        "blur_score": None,
        "focus_features": {},
        "glare_score": None,
        "crop_complete": None,
        "perspective_score": None,
        "text_readability_score": None,
        "resolution_sufficient": None,
        "critical_region_occlusion": {},
        "image_quality_degraded": True,
        "algorithm": "r2_unavailable_no_image_download",
        "status": "UNAVAILABLE",
        "reason": reason,
    }


def quality_placeholder(image_id: str) -> dict[str, Any]:
    return quality_unavailable(image_id)
