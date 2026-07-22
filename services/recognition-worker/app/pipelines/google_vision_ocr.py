"""ADC-authenticated Google Vision OCR with explicit unit accounting."""

from __future__ import annotations

import io
import time
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    import numpy as np

MAX_SYNC_IMAGES = 16


def google_vision_configured(config: Any) -> bool:
    return bool(getattr(config, "vision_use_adc", True))


def vision_unavailable(reason: str, *, latency_ms: int = 0) -> dict[str, Any]:
    return {
        "status": "UNAVAILABLE",
        "reason": reason,
        "candidates": [],
        "raw_text": "",
        "confidence": 0,
        "latency_ms": latency_ms,
        "cost_estimate": 0.0,
        "vision_unit_count": 0,
        "backend": "google_vision",
    }


def _array_to_png_bytes(array: "np.ndarray") -> bytes:
    import numpy as np
    from PIL import Image

    prepared = array
    if prepared.dtype != np.uint8:
        prepared = np.clip(prepared, 0, 255).astype(np.uint8)
    image = Image.fromarray(prepared if prepared.ndim == 2 else prepared[:, :, :3])
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _page_confidence(full_text: dict[str, Any]) -> float:
    pages = full_text.get("pages") if isinstance(full_text, dict) else None
    values = [
        float(page.get("confidence"))
        for page in (pages or [])
        if isinstance(page, dict) and page.get("confidence") is not None
    ]
    return round(sum(values) / len(values), 4) if values else 0.9


def _word_text(word: dict[str, Any]) -> str:
    return "".join(str(symbol.get("text", "")) for symbol in (word.get("symbols") or []))


def _word_ends_line(word: dict[str, Any]) -> bool:
    symbols = word.get("symbols") or []
    if not symbols:
        return False
    break_type = (((symbols[-1].get("property") or {}).get("detectedBreak") or {}).get("type") or "")
    return break_type in {"LINE_BREAK", "EOL_SURE_SPACE"}


def _vision_candidates(full_text: dict[str, Any]) -> list[dict[str, Any]]:
    pages = full_text.get("pages") if isinstance(full_text, dict) else None
    if not isinstance(pages, list):
        return []
    words: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []
    line_words: list[str] = []
    line_confidences: list[float] = []

    def flush_line() -> None:
        nonlocal line_words, line_confidences
        text = " ".join(line_words).strip()
        if text and line_confidences:
            lines.append({"text": text, "confidence": round(min(line_confidences), 4), "box": None})
        line_words = []
        line_confidences = []

    for page in pages:
        for block in (page.get("blocks") or []) if isinstance(page, dict) else []:
            for paragraph in (block.get("paragraphs") or []) if isinstance(block, dict) else []:
                for word in (paragraph.get("words") or []) if isinstance(paragraph, dict) else []:
                    text = _word_text(word).strip()
                    if not text:
                        continue
                    confidence = word.get("confidence")
                    confidence = float(confidence) if confidence is not None else None
                    if confidence is not None:
                        words.append({"text": text, "confidence": round(confidence, 4), "box": word.get("boundingBox")})
                        line_confidences.append(confidence)
                    line_words.append(text)
                    if _word_ends_line(word):
                        flush_line()
                flush_line()
    return lines + words


def _payload_from_response(response: Any) -> dict[str, Any]:
    if isinstance(response, dict):
        return response
    protobuf = getattr(response, "_pb", None)
    if protobuf is None:
        raise ValueError("vision_response_has_no_protobuf_payload")
    from google.protobuf.json_format import MessageToDict

    return MessageToDict(protobuf, preserving_proto_field_name=False)


def _default_client(config: Any) -> Any:
    from google.cloud import vision

    endpoint = str(getattr(config, "vision_endpoint", "") or "").strip()
    options = {"api_endpoint": endpoint} if endpoint else None
    return vision.ImageAnnotatorClient(client_options=options)


def _parsed_result(response: dict[str, Any], *, latency_ms: int, config: Any) -> dict[str, Any]:
    if response.get("error"):
        message = str((response.get("error") or {}).get("message") or "")[:120]
        return vision_unavailable(f"vision_error:{message}", latency_ms=latency_ms)
    full_text = response.get("fullTextAnnotation") if isinstance(response, dict) else None
    text = (full_text or {}).get("text", "").strip() if isinstance(full_text, dict) else ""
    if not text:
        annotations = response.get("textAnnotations") if isinstance(response, dict) else None
        if isinstance(annotations, list) and annotations:
            text = str(annotations[0].get("description", "")).strip()
    candidates = _vision_candidates(full_text or {}) if text else []
    if not candidates and text:
        candidates = [{"text": text, "confidence": _page_confidence(full_text or {}), "box": None}]
    confidence = max((float(candidate.get("confidence") or 0) for candidate in candidates), default=0.0)
    return {
        "status": "OK" if candidates else "NO_TEXT",
        "candidates": candidates,
        "raw_text": text,
        "confidence": round(confidence, 4),
        "latency_ms": latency_ms,
        "cost_estimate": round(float(getattr(config, "vision_cost_per_image", 0.0)), 6),
        "vision_unit_count": 1,
        "backend": "google_vision",
    }


def run_google_vision_ocr_batch(
    arrays: list["np.ndarray"],
    *,
    crop_types: list[str],
    config: Any,
    client: Any | None = None,
    client_factory: Callable[[Any], Any] | None = None,
) -> dict[str, Any]:
    started = time.time()
    if not google_vision_configured(config):
        return {"status": "UNAVAILABLE", "reason": "vision_adc_disabled", "results": [], "vision_unit_count": 0}
    if not arrays or len(arrays) != len(crop_types):
        return {"status": "UNAVAILABLE", "reason": "invalid_vision_batch", "results": [], "vision_unit_count": 0}
    if len(arrays) > MAX_SYNC_IMAGES:
        return {"status": "UNAVAILABLE", "reason": "vision_batch_limit_exceeded", "results": [], "vision_unit_count": 0}

    try:
        requests = [
            {
                "image": {"content": _array_to_png_bytes(array)},
                # The protobuf constructor accepts ``type_`` as a Python
                # keyword, but dict-to-protobuf request coercion expects the
                # public JSON/proto field name ``type``.  Sending ``type_``
                # silently produced an empty feature and therefore NO_TEXT.
                "features": [{"type": str(getattr(config, "vision_feature_type", "DOCUMENT_TEXT_DETECTION"))}],
                "image_context": {"language_hints": ["en"]},
            }
            for array in arrays
        ]
        active_client = client or (client_factory or _default_client)(config)
        response = active_client.batch_annotate_images(
            request={"requests": requests},
            timeout=int(getattr(config, "vision_timeout_seconds", 30)),
        )
        payload = _payload_from_response(response)
    except Exception as error:  # noqa: BLE001
        latency_ms = int((time.time() - started) * 1000)
        return {
            "status": "UNAVAILABLE",
            "reason": f"request_failed:{str(error)[:120]}",
            "results": [vision_unavailable("batch_request_failed", latency_ms=latency_ms) for _ in arrays],
            "latency_ms": latency_ms,
            "vision_unit_count": 0,
        }

    latency_ms = int((time.time() - started) * 1000)
    responses = payload.get("responses") if isinstance(payload, dict) else None
    if not isinstance(responses, list) or len(responses) != len(arrays):
        return {
            "status": "UNAVAILABLE",
            "reason": "vision_response_count_mismatch",
            "results": [vision_unavailable("vision_response_count_mismatch", latency_ms=latency_ms) for _ in arrays],
            "latency_ms": latency_ms,
            "vision_unit_count": 0,
        }
    results = [_parsed_result(item or {}, latency_ms=latency_ms, config=config) for item in responses]
    return {
        "status": "OK" if any(item["status"] == "OK" for item in results) else "NO_TEXT",
        "results": results,
        "latency_ms": latency_ms,
        "vision_unit_count": len(arrays),
        "cost_estimate": round(len(arrays) * float(getattr(config, "vision_cost_per_image", 0.0)), 6),
    }


def run_google_vision_ocr(
    array: "np.ndarray",
    *,
    crop_type: str,
    config: Any,
    client: Any | None = None,
    client_factory: Callable[[Any], Any] | None = None,
) -> dict[str, Any]:
    batch = run_google_vision_ocr_batch(
        [array],
        crop_types=[crop_type],
        config=config,
        client=client,
        client_factory=client_factory,
    )
    if batch.get("results"):
        return batch["results"][0]
    return vision_unavailable(str(batch.get("reason") or "vision_batch_unavailable"), latency_ms=int(batch.get("latency_ms") or 0))
