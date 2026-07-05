from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


CARD_ASPECT_RATIO = 3.5 / 2.5


@dataclass(frozen=True)
class RectificationResult:
    image_id: str
    card_polygon: list[list[int]]
    homography: list[list[float]]
    rectified_size: list[int]
    rectification_confidence: float
    fallback_used: bool
    algorithm: str
    status: str = "OK"
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "image_id": self.image_id,
            "card_polygon": self.card_polygon,
            "homography": self.homography,
            "rectified_size": self.rectified_size,
            "rectification_confidence": round(float(self.rectification_confidence), 4),
            "fallback_used": self.fallback_used,
            "algorithm": self.algorithm,
            "status": self.status,
            "reason": self.reason,
        }


def _as_rgb_array(image: Any) -> np.ndarray:
    array = np.asarray(image)
    if array.ndim == 2:
        array = np.stack([array, array, array], axis=2)
    if array.ndim != 3 or array.shape[2] < 3:
        raise ValueError("image must be grayscale or RGB-like array")
    return array[:, :, :3].astype(np.uint8, copy=False)


def _luminance(rgb: np.ndarray) -> np.ndarray:
    return (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]).astype(np.float32)


def _polygon_area(points: list[list[int]]) -> float:
    if len(points) < 3:
        return 0.0
    total = 0.0
    for index, point in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        total += point[0] * next_point[1] - next_point[0] * point[1]
    return abs(total) / 2.0


def _order_points(points: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).reshape(-1)
    rect[0] = points[np.argmin(sums)]
    rect[2] = points[np.argmax(sums)]
    rect[1] = points[np.argmin(diffs)]
    rect[3] = points[np.argmax(diffs)]
    return rect


def _bbox_from_mask(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(mask)
    if len(xs) == 0 or len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def _confidence_for_bbox(width: int, height: int, image_width: int, image_height: int, mask_ratio: float) -> float:
    if width <= 0 or height <= 0 or image_width <= 0 or image_height <= 0:
        return 0.0
    aspect = max(width, height) / max(1, min(width, height))
    aspect_score = max(0.0, 1.0 - abs(aspect - CARD_ASPECT_RATIO) / 0.55)
    area_score = min(1.0, (width * height) / max(1, image_width * image_height) / 0.82)
    fill_score = max(0.0, min(1.0, mask_ratio))
    return max(0.0, min(1.0, (aspect_score * 0.55) + (area_score * 0.25) + (fill_score * 0.2)))


def _rectify_card_with_opencv(rgb: np.ndarray, image_id: str) -> dict[str, Any]:
    import cv2  # Imported lazily because local desktop cv2 import can be slow or unavailable.

    height, width = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = sorted(contours, key=cv2.contourArea, reverse=True)[:8]

    for contour in candidates:
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) != 4:
            continue
        points = approx.reshape(4, 2).astype("float32")
        ordered = _order_points(points)
        area = cv2.contourArea(ordered)
        if area < width * height * 0.05:
            continue
        box_width = int(max(np.linalg.norm(ordered[2] - ordered[3]), np.linalg.norm(ordered[1] - ordered[0])))
        box_height = int(max(np.linalg.norm(ordered[1] - ordered[2]), np.linalg.norm(ordered[0] - ordered[3])))
        if box_width <= 0 or box_height <= 0:
            continue
        confidence = _confidence_for_bbox(box_width, box_height, width, height, 1.0)
        if confidence < 0.2:
            continue
        destination = np.array(
            [[0, 0], [box_width - 1, 0], [box_width - 1, box_height - 1], [0, box_height - 1]],
            dtype="float32",
        )
        homography = cv2.getPerspectiveTransform(ordered, destination)
        return RectificationResult(
            image_id=image_id,
            card_polygon=np.round(ordered).astype(int).tolist(),
            homography=np.round(homography, 6).astype(float).tolist(),
            rectified_size=[box_width, box_height],
            rectification_confidence=confidence,
            fallback_used=False,
            algorithm="opencv_contour_homography_r2",
        ).to_dict()

    return rectification_unavailable(image_id, "opencv_card_candidate_not_found")


def rectify_card_from_array(image: Any, image_id: str = "image", prefer_opencv: bool = False) -> dict[str, Any]:
    """Detect an axis-aligned card candidate without downloading or mutating source images.

    This is the R2 CPU-safe baseline. It intentionally avoids generative repair and does
    not claim perspective correction when only a bounding box is available.
    """
    rgb = _as_rgb_array(image)
    if prefer_opencv:
        return _rectify_card_with_opencv(rgb, image_id)

    height, width = rgb.shape[:2]
    gray = _luminance(rgb)
    dynamic_threshold = max(24.0, float(gray.mean() + gray.std() * 0.25))
    bright_mask = gray >= dynamic_threshold

    bbox = _bbox_from_mask(bright_mask)
    if bbox is None:
        return rectification_unavailable(image_id, "no_card_like_region_detected")

    x1, y1, x2, y2 = bbox
    box_width = x2 - x1 + 1
    box_height = y2 - y1 + 1
    mask_ratio = float(bright_mask[y1 : y2 + 1, x1 : x2 + 1].mean())
    confidence = _confidence_for_bbox(box_width, box_height, width, height, mask_ratio)
    polygon = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
    if confidence < 0.2 or _polygon_area(polygon) < width * height * 0.05:
        return rectification_unavailable(image_id, "card_candidate_failed_shape_constraints")

    return RectificationResult(
        image_id=image_id,
        card_polygon=polygon,
        homography=[[1.0, 0.0, float(-x1)], [0.0, 1.0, float(-y1)], [0.0, 0.0, 1.0]],
        rectified_size=[box_width, box_height],
        rectification_confidence=confidence,
        fallback_used=False,
        algorithm="numpy_luminance_bbox_r2",
    ).to_dict()


def rectification_unavailable(image_id: str, reason: str = "image_bytes_not_loaded") -> dict[str, Any]:
    return RectificationResult(
        image_id=image_id,
        card_polygon=[],
        homography=[],
        rectified_size=[0, 0],
        rectification_confidence=0.0,
        fallback_used=True,
        algorithm="r2_unavailable_no_image_download",
        status="UNAVAILABLE",
        reason=reason,
    ).to_dict()


def rectify_card_placeholder(image_id: str) -> dict[str, Any]:
    return rectification_unavailable(image_id)
