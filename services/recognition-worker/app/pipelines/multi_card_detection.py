from __future__ import annotations

from collections import deque
from typing import Any

import numpy as np


CARD_ASPECT_RATIO = 3.5 / 2.5


def _bbox_iou(left: list[int], right: list[int]) -> float:
    left_x1, left_y1, left_x2, left_y2 = left
    right_x1, right_y1, right_x2, right_y2 = right
    intersection_width = max(0, min(left_x2, right_x2) - max(left_x1, right_x1) + 1)
    intersection_height = max(0, min(left_y2, right_y2) - max(left_y1, right_y1) + 1)
    intersection = intersection_width * intersection_height
    if intersection <= 0:
        return 0.0
    left_area = max(1, (left_x2 - left_x1 + 1) * (left_y2 - left_y1 + 1))
    right_area = max(1, (right_x2 - right_x1 + 1) * (right_y2 - right_y1 + 1))
    return intersection / max(1, left_area + right_area - intersection)


def _dedupe_nested_candidates(candidates: list[dict[str, Any]], limit: int = 12) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: (item["area_ratio"], item["confidence"]), reverse=True):
        if any(_bbox_iou(candidate["bbox"], existing["bbox"]) >= 0.48 for existing in selected):
            continue
        selected.append(candidate)
        if len(selected) >= limit:
            break
    return selected


def _opencv_contour_candidates(rgb: np.ndarray) -> tuple[list[dict[str, Any]], str | None]:
    try:
        import cv2
    except (ImportError, OSError) as error:
        return [], f"opencv_unavailable:{type(error).__name__}"

    height, width = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 35, 120)
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, close_kernel, iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    image_area = max(1, width * height)
    candidates: list[dict[str, Any]] = []

    for contour in contours:
        x, y, bbox_width, bbox_height = cv2.boundingRect(contour)
        if bbox_width <= 0 or bbox_height <= 0:
            continue
        bbox_area = bbox_width * bbox_height
        area_ratio = bbox_area / image_area
        aspect = max(bbox_width, bbox_height) / max(1, min(bbox_width, bbox_height))
        contour_area = float(cv2.contourArea(contour))
        rectangularity = contour_area / max(1, bbox_area)
        perimeter = float(cv2.arcLength(contour, True))
        corner_count = len(cv2.approxPolyDP(contour, 0.02 * perimeter, True)) if perimeter > 0 else 0
        if (
            area_ratio < 0.018
            or area_ratio > 0.45
            or aspect < 1.08
            or aspect > 1.95
            or rectangularity < 0.55
            or corner_count < 4
            or corner_count > 12
        ):
            continue

        aspect_score = max(0.0, 1.0 - abs(aspect - CARD_ASPECT_RATIO) / 0.75)
        confidence = max(0.0, min(1.0, (rectangularity * 0.55) + (aspect_score * 0.35) + 0.1))
        candidates.append({
            "bbox": [int(x), int(y), int(x + bbox_width - 1), int(y + bbox_height - 1)],
            "area_ratio": round(float(area_ratio), 4),
            "fill_ratio": round(float(rectangularity), 4),
            "aspect_ratio": round(float(aspect), 4),
            "confidence": round(float(confidence), 4),
            "corner_count": int(corner_count),
            "detector": "opencv_contour",
        })

    return _dedupe_nested_candidates(candidates), None


def _independent_card_pair_count(candidates: list[dict[str, Any]]) -> int:
    independent: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: item.get("confidence", 0), reverse=True):
        if any(_bbox_iou(candidate["bbox"], existing["bbox"]) > 0.12 for existing in independent):
            continue
        independent.append(candidate)
    return len(independent)


def _as_rgb_array(image: Any) -> np.ndarray:
    array = np.asarray(image)
    if array.ndim == 2:
        array = np.stack([array, array, array], axis=2)
    if array.ndim != 3 or array.shape[2] < 3:
        raise ValueError("image must be grayscale or RGB-like array")
    return array[:, :, :3].astype(np.uint8, copy=False)


def _gray(rgb: np.ndarray) -> np.ndarray:
    return (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]).astype(np.float32)


def _downsample_mask(mask: np.ndarray, max_side: int = 280) -> tuple[np.ndarray, int]:
    height, width = mask.shape[:2]
    scale = max(1, int(np.ceil(max(height, width) / max_side)))
    if scale <= 1:
        return mask.astype(bool, copy=False), 1

    trimmed_height = height - (height % scale)
    trimmed_width = width - (width % scale)
    trimmed = mask[:trimmed_height, :trimmed_width]
    pooled = trimmed.reshape(trimmed_height // scale, scale, trimmed_width // scale, scale).mean(axis=(1, 3))
    return pooled >= 0.35, scale


def _card_candidate_confidence(
    *,
    bbox_width: int,
    bbox_height: int,
    image_width: int,
    image_height: int,
    area_ratio: float,
    fill_ratio: float,
) -> float:
    if bbox_width <= 0 or bbox_height <= 0 or image_width <= 0 or image_height <= 0:
        return 0.0

    aspect = max(bbox_width, bbox_height) / max(1, min(bbox_width, bbox_height))
    aspect_score = max(0.0, 1.0 - abs(aspect - CARD_ASPECT_RATIO) / 0.65)
    area_score = min(1.0, area_ratio / 0.18)
    fill_score = max(0.0, min(1.0, fill_ratio / 0.72))
    return max(0.0, min(1.0, (aspect_score * 0.55) + (area_score * 0.25) + (fill_score * 0.2)))


def _component_candidates(mask: np.ndarray, scale: int, image_width: int, image_height: int) -> list[dict[str, Any]]:
    height, width = mask.shape[:2]
    visited = np.zeros(mask.shape, dtype=bool)
    candidates: list[dict[str, Any]] = []

    for start_y in range(height):
        for start_x in range(width):
            if visited[start_y, start_x] or not mask[start_y, start_x]:
                continue

            queue: deque[tuple[int, int]] = deque([(start_y, start_x)])
            visited[start_y, start_x] = True
            count = 0
            min_x = max_x = start_x
            min_y = max_y = start_y

            while queue:
                y, x = queue.popleft()
                count += 1
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)

                for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if next_y < 0 or next_y >= height or next_x < 0 or next_x >= width:
                        continue
                    if visited[next_y, next_x] or not mask[next_y, next_x]:
                        continue
                    visited[next_y, next_x] = True
                    queue.append((next_y, next_x))

            x1 = int(min_x * scale)
            y1 = int(min_y * scale)
            x2 = int(min(image_width - 1, (max_x + 1) * scale - 1))
            y2 = int(min(image_height - 1, (max_y + 1) * scale - 1))
            bbox_width = x2 - x1 + 1
            bbox_height = y2 - y1 + 1
            bbox_area = max(1, bbox_width * bbox_height)
            component_area = count * scale * scale
            area_ratio = component_area / max(1, image_width * image_height)
            fill_ratio = component_area / bbox_area
            aspect = max(bbox_width, bbox_height) / max(1, min(bbox_width, bbox_height))
            confidence = _card_candidate_confidence(
                bbox_width=bbox_width,
                bbox_height=bbox_height,
                image_width=image_width,
                image_height=image_height,
                area_ratio=area_ratio,
                fill_ratio=fill_ratio,
            )

            if (
                area_ratio < 0.035
                or fill_ratio < 0.38
                or aspect < 1.05
                or aspect > 2.25
                or confidence < 0.28
            ):
                continue

            candidates.append({
                "bbox": [x1, y1, x2, y2],
                "area_ratio": round(float(area_ratio), 4),
                "fill_ratio": round(float(fill_ratio), 4),
                "aspect_ratio": round(float(aspect), 4),
                "confidence": round(float(confidence), 4),
            })

    return sorted(candidates, key=lambda item: (item["confidence"], item["area_ratio"]), reverse=True)


def detect_multi_card_from_array(image: Any, image_id: str = "image", role: str | None = None) -> dict[str, Any]:
    rgb = _as_rgb_array(image)
    height, width = rgb.shape[:2]
    gray = _gray(rgb)
    threshold = max(24.0, min(245.0, float(gray.mean() + gray.std() * 0.22)))
    mask, scale = _downsample_mask(gray >= threshold)
    numpy_candidates = _component_candidates(mask, scale, width, height)[:8]
    opencv_candidates, opencv_error = _opencv_contour_candidates(rgb)
    numpy_count = _independent_card_pair_count(numpy_candidates)
    opencv_count = _independent_card_pair_count(opencv_candidates)
    card_count = max(numpy_count, opencv_count)
    multi_card = card_count > 1
    candidates = opencv_candidates if opencv_count >= numpy_count else numpy_candidates
    confidence = max([candidate["confidence"] for candidate in candidates], default=0.0)
    if multi_card:
        confidence = min(1.0, max(confidence, 0.72 + min(0.18, (card_count - 2) * 0.06)))

    # Rectangle detectors are deliberately allowed to prove plurality without
    # pretending they know the exact lot size. Touching/overlapping cards can
    # merge into one contour, so card_count_estimate is diagnostic until a
    # separate text/model observation confirms the quantity.
    card_count_confirmed = False

    return {
        "image_id": image_id,
        "role": role,
        "status": "OK",
        "multi_card": multi_card,
        "card_count_estimate": card_count if card_count else None,
        "card_count_confirmed": card_count_confirmed,
        "confidence": round(float(confidence), 4),
        "candidates": candidates[:12],
        "detectors": {
            "numpy_component": {
                "candidate_count": numpy_count,
                "candidates": numpy_candidates[:8],
            },
            "opencv_contour": {
                "status": "UNAVAILABLE" if opencv_error else "OK",
                "candidate_count": opencv_count,
                "candidates": opencv_candidates[:12],
                "reason": opencv_error,
            },
        },
        "algorithm": "redundant_numpy_opencv_card_count_r2",
    }


def detect_multi_card_from_loaded_images(image_loads: list[Any]) -> dict[str, Any]:
    per_image = [
        detect_multi_card_from_array(
            loaded.array,
            image_id=getattr(loaded, "image_id", "image"),
            role=getattr(loaded, "role", None),
        )
        for loaded in image_loads
    ]
    count = max([int(item.get("card_count_estimate") or 0) for item in per_image], default=0)
    multi_card = any(item.get("multi_card") is True for item in per_image)
    confidence = max([float(item.get("confidence") or 0) for item in per_image], default=0.0)
    strongest = max(per_image, key=lambda item: float(item.get("confidence") or 0), default={})

    return {
        "status": "OK",
        "multi_card": multi_card,
        "card_count_estimate": count if count else None,
        "card_count_confirmed": any(item.get("card_count_confirmed") is True for item in per_image),
        "confidence": round(float(confidence), 4),
        "image_id": strongest.get("image_id"),
        "role": strongest.get("role"),
        "images": per_image,
        "algorithm": "redundant_numpy_opencv_card_count_r2",
    }


def multi_card_detection_unavailable(reason: str = "image_bytes_not_loaded") -> dict[str, Any]:
    return {
        "status": "UNAVAILABLE",
        "multi_card": False,
        "card_count_estimate": None,
        "card_count_confirmed": False,
        "confidence": 0.0,
        "images": [],
        "algorithm": "redundant_numpy_opencv_card_count_r2",
        "reason": reason,
    }
