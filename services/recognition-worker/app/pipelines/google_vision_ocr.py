"""Google Cloud Vision OCR backend adapter.

Vision's DOCUMENT_TEXT_DETECTION reads the printed hard keys on trading cards
(serial numbers like 7/10, card codes like CPA-VG, printed years) that the
lightweight PaddleOCR path misses on foil / dense small print. This adapter
renders a crop to base64, calls images:annotate, and returns candidates in the
exact PaddleOCR shape ({"text","confidence","box"}) so the rest of the OCR
pipeline, evidence fusion, and contract are reused unchanged.

Only stdlib networking (urllib) is used; numpy/PIL stay lazy so the pure
request/parsing logic imports without the image stack. urlopen is injectable
for tests.
"""

from __future__ import annotations

import base64
import io
import json
import time
from typing import TYPE_CHECKING, Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

if TYPE_CHECKING:  # numpy is a worker runtime dep; kept lazy.
    import numpy as np

_DEFAULT_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate"


def google_vision_configured(config: Any) -> bool:
    return bool(getattr(config, "vision_api_key", "").strip())


def vision_unavailable(reason: str, *, latency_ms: int = 0) -> dict[str, Any]:
    return {
        "status": "UNAVAILABLE",
        "reason": reason,
        "candidates": [],
        "raw_text": "",
        "confidence": 0,
        "latency_ms": latency_ms,
        "cost_estimate": 0.0,
        "backend": "google_vision",
    }


def _array_to_base64_png(array: "np.ndarray") -> str:
    import numpy as np
    from PIL import Image

    prepared = array
    if prepared.dtype != np.uint8:
        prepared = np.clip(prepared, 0, 255).astype(np.uint8)
    if prepared.ndim == 2:
        image = Image.fromarray(prepared, mode="L")
    else:
        image = Image.fromarray(prepared[:, :, :3], mode="RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _endpoint(config: Any) -> str:
    return (getattr(config, "vision_endpoint", "") or _DEFAULT_ENDPOINT).strip() or _DEFAULT_ENDPOINT


def _page_confidence(full_text: dict[str, Any]) -> float:
    pages = full_text.get("pages") if isinstance(full_text, dict) else None
    if isinstance(pages, list) and pages:
        confidences = [float(p.get("confidence")) for p in pages if isinstance(p, dict) and p.get("confidence") is not None]
        if confidences:
            return round(sum(confidences) / len(confidences), 4)
    return 0.9


def run_google_vision_ocr(
    array: "np.ndarray",
    *,
    crop_type: str,
    config: Any,
    urlopen_impl: Callable[[Request, int], Any] | None = None,
) -> dict[str, Any]:
    """Return {status, candidates, raw_text, confidence, latency_ms, cost_estimate, backend}."""
    started = time.time()
    if not google_vision_configured(config):
        return vision_unavailable("vision_api_key_not_configured")
    if array is None:
        return vision_unavailable("image_bytes_not_loaded")

    try:
        image_b64 = _array_to_base64_png(array)
    except Exception as error:  # noqa: BLE001
        return vision_unavailable(f"image_encode_failed:{str(error)[:120]}")

    feature_type = getattr(config, "vision_feature_type", "DOCUMENT_TEXT_DETECTION") or "DOCUMENT_TEXT_DETECTION"
    body = json.dumps({
        "requests": [
            {
                "image": {"content": image_b64},
                "features": [{"type": feature_type}],
                # English-first hint improves dense small-print serial/code reads
                # without excluding other Latin text.
                "imageContext": {"languageHints": ["en"]},
            }
        ]
    }).encode("utf-8")

    url = f"{_endpoint(config)}?key={config.vision_api_key}"
    request = Request(url, data=body, headers={"content-type": "application/json"}, method="POST")
    opener = urlopen_impl or (lambda req, timeout: urlopen(req, timeout=timeout))
    timeout_seconds = int(getattr(config, "vision_timeout_seconds", 30))

    try:
        response = opener(request, timeout_seconds)
        raw = response.read()
        payload = json.loads(raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw)
    except HTTPError as error:  # noqa: PERF203
        return vision_unavailable(f"http_{error.code}", latency_ms=int((time.time() - started) * 1000))
    except (URLError, TimeoutError) as error:
        return vision_unavailable(f"request_failed:{str(error)[:120]}", latency_ms=int((time.time() - started) * 1000))
    except (ValueError, json.JSONDecodeError) as error:
        return vision_unavailable(f"invalid_response:{str(error)[:120]}", latency_ms=int((time.time() - started) * 1000))

    latency_ms = int((time.time() - started) * 1000)
    responses = payload.get("responses") if isinstance(payload, dict) else None
    first = (responses or [{}])[0] if isinstance(responses, list) else {}
    if isinstance(first, dict) and first.get("error"):
        return vision_unavailable(f"vision_error:{str(first['error'].get('message',''))[:120]}", latency_ms=latency_ms)

    full_text = first.get("fullTextAnnotation") if isinstance(first, dict) else None
    text = (full_text or {}).get("text", "").strip() if isinstance(full_text, dict) else ""
    if not text:
        annotations = first.get("textAnnotations") if isinstance(first, dict) else None
        if isinstance(annotations, list) and annotations:
            text = str(annotations[0].get("description", "")).strip()

    confidence = _page_confidence(full_text or {}) if text else 0
    # Vision bills per image "unit"; DOCUMENT_TEXT_DETECTION is one unit/image.
    cost_estimate = round(float(getattr(config, "vision_cost_per_image", 0.0)), 6)

    candidates = [{"text": text, "confidence": confidence, "box": None}] if text else []
    return {
        "status": "OK" if candidates else "NO_TEXT",
        "candidates": candidates,
        "raw_text": text,
        "confidence": confidence,
        "latency_ms": latency_ms,
        "cost_estimate": cost_estimate,
        "backend": "google_vision",
    }
