"""ADC-authenticated Google Vision OCR with explicit unit accounting."""

from __future__ import annotations

import base64
import io
import json
import time
from typing import TYPE_CHECKING, Any, Callable
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    import numpy as np

MAX_SYNC_IMAGES = 16
_DEFAULT_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate"
_PROCESS_VISION_CLIENT: Any | None = None


def google_vision_configured(config: Any) -> bool:
    return vision_auth_mode(config) != "unconfigured"


def vision_auth_mode(config: Any) -> str:
    """Return the single transport authority for this worker revision.

    `VISION_USE_ADC=true` deliberately does not fall through to the API-key
    transport.  A silent fallback would make `/readyz` claim ADC while the
    request uses a different credential boundary.  API-key serving remains
    available by setting `VISION_USE_ADC=false` with `VISION_API_KEY`.
    """
    if bool(getattr(config, "vision_use_adc", False)):
        return "adc"
    if str(getattr(config, "vision_api_key", "") or "").strip():
        return "api_key"
    return "unconfigured"


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


def get_google_vision_client(config: Any, *, client_factory: Callable[[Any], Any] | None = None) -> Any:
    """Get one reusable ADC SDK client for the lifetime of this process.

    Cloud Run's ADC credentials are discovered when the client is constructed.
    We cache only successful construction so a transient startup failure does
    not permanently poison the worker process.  A factory stays injectable for
    focused tests and isolated callers.
    """
    if client_factory is not None:
        return client_factory(config)
    global _PROCESS_VISION_CLIENT
    if _PROCESS_VISION_CLIENT is None:
        _PROCESS_VISION_CLIENT = _default_client(config)
    return _PROCESS_VISION_CLIENT


def reset_google_vision_client_for_tests() -> None:
    """Clear the process client only for focused unit tests."""
    global _PROCESS_VISION_CLIENT
    _PROCESS_VISION_CLIENT = None


def google_vision_readiness(config: Any) -> dict[str, Any]:
    """Check only that the selected auth transport can be constructed locally.

    This intentionally does not perform an OCR request or bill Vision.  For
    ADC, successful SDK construction verifies that the serving process can
    resolve a credential source; for API-key mode, possession of the key is the
    equivalent local preflight available without calling the external service.
    It does *not* prove Vision API reachability, IAM permission, or launch
    readiness; those belong to a separately authorized functional canary.
    """
    auth_mode = vision_auth_mode(config)
    base = {
        "auth_mode": auth_mode,
        "readiness_scope": "credential_source_only",
        "external_vision_verified": False,
        "functional_canary_required": True,
    }
    if auth_mode == "api_key":
        return {"ready": True, **base}
    if auth_mode != "adc":
        return {"ready": False, "reason": "vision_auth_not_configured", **base}
    try:
        get_google_vision_client(config)
    except Exception as error:  # noqa: BLE001 - readiness must fail closed.
        return {
            "ready": False,
            "reason": f"adc_client_unavailable:{type(error).__name__}",
            **base,
        }
    return {"ready": True, **base}


def _rest_batch_request(
    arrays: list["np.ndarray"],
    *,
    config: Any,
    urlopen_impl: Callable[[Request, int], Any] | None = None,
) -> dict[str, Any]:
    feature_type = str(getattr(config, "vision_feature_type", "DOCUMENT_TEXT_DETECTION") or "DOCUMENT_TEXT_DETECTION")
    requests = [
        {
            "image": {"content": base64.b64encode(_array_to_png_bytes(array)).decode("ascii")},
            "features": [{"type": feature_type}],
            "imageContext": {"languageHints": ["en"]},
        }
        for array in arrays
    ]
    endpoint = str(getattr(config, "vision_endpoint", "") or _DEFAULT_ENDPOINT).strip() or _DEFAULT_ENDPOINT
    query = urlencode({"key": str(getattr(config, "vision_api_key", "") or "")})
    request = Request(
        f"{endpoint}?{query}",
        data=json.dumps({"requests": requests}).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    opener = urlopen_impl or (lambda req, timeout: urlopen(req, timeout=timeout))
    response = opener(request, int(getattr(config, "vision_timeout_seconds", 30)))
    raw = response.read()
    return json.loads(raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw)


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
    urlopen_impl: Callable[[Request, int], Any] | None = None,
) -> dict[str, Any]:
    started = time.time()
    auth_mode = vision_auth_mode(config)
    telemetry = {
        "auth_mode": auth_mode,
        "vision_http_attempt_count": 0,
        "google_annotate_request_count": 0,
        "attempted_vision_unit_count": 0,
        "confirmed_vision_unit_count": 0,
        "billing_unknown": False,
    }
    if not google_vision_configured(config):
        return {
            "status": "UNAVAILABLE",
            "reason": "vision_auth_not_configured",
            "results": [],
            "vision_unit_count": 0,
            "cost_estimate": 0.0,
            **telemetry,
        }
    if not arrays or len(arrays) != len(crop_types):
        return {
            "status": "UNAVAILABLE",
            "reason": "invalid_vision_batch",
            "results": [],
            "vision_unit_count": 0,
            "cost_estimate": 0.0,
            **telemetry,
        }
    if len(arrays) > MAX_SYNC_IMAGES:
        return {
            "status": "UNAVAILABLE",
            "reason": "vision_batch_limit_exceeded",
            "results": [],
            "vision_unit_count": 0,
            "cost_estimate": 0.0,
            **telemetry,
        }

    try:
        if auth_mode == "adc":
            requests = [
                {
                    "image": {"content": _array_to_png_bytes(array)},
                    "features": [{"type_": str(getattr(config, "vision_feature_type", "DOCUMENT_TEXT_DETECTION"))}],
                    "image_context": {"language_hints": ["en"]},
                }
                for array in arrays
            ]
            active_client = client or get_google_vision_client(config, client_factory=client_factory)
            telemetry["vision_http_attempt_count"] = 1
            telemetry["google_annotate_request_count"] = 1
            telemetry["attempted_vision_unit_count"] = len(arrays)
            telemetry["billing_unknown"] = True
            response = active_client.batch_annotate_images(
                request={"requests": requests},
                timeout=int(getattr(config, "vision_timeout_seconds", 30)),
            )
            payload = _payload_from_response(response)
        else:
            # API-key transport stays supported as an explicitly selected
            # serving lane; it never masquerades as ADC in readiness/telemetry.
            telemetry["vision_http_attempt_count"] = 1
            telemetry["google_annotate_request_count"] = 1
            telemetry["attempted_vision_unit_count"] = len(arrays)
            telemetry["billing_unknown"] = True
            payload = _rest_batch_request(arrays, config=config, urlopen_impl=urlopen_impl)
    except HTTPError as error:
        error = RuntimeError(f"http_{error.code}")
        latency_ms = int((time.time() - started) * 1000)
        return {
            "status": "UNAVAILABLE",
            "reason": f"request_failed:{str(error)[:120]}",
            "results": [vision_unavailable("batch_request_failed", latency_ms=latency_ms) for _ in arrays],
            "latency_ms": latency_ms,
            "vision_unit_count": 0,
            "cost_estimate": None,
            **telemetry,
        }
    except Exception as error:  # noqa: BLE001
        latency_ms = int((time.time() - started) * 1000)
        return {
            "status": "UNAVAILABLE",
            "reason": f"request_failed:{str(error)[:120]}",
            "results": [vision_unavailable("batch_request_failed", latency_ms=latency_ms) for _ in arrays],
            "latency_ms": latency_ms,
            "vision_unit_count": 0,
            "cost_estimate": None,
            **telemetry,
        }

    latency_ms = int((time.time() - started) * 1000)
    responses = payload.get("responses") if isinstance(payload, dict) else None
    if not isinstance(responses, list) or len(responses) != len(arrays):
        telemetry["confirmed_vision_unit_count"] = min(len(responses), len(arrays)) if isinstance(responses, list) else 0
        return {
            "status": "UNAVAILABLE",
            "reason": "vision_response_count_mismatch",
            "results": [vision_unavailable("vision_response_count_mismatch", latency_ms=latency_ms) for _ in arrays],
            "latency_ms": latency_ms,
            "vision_unit_count": 0,
            "cost_estimate": None,
            **telemetry,
        }
    results = [_parsed_result(item or {}, latency_ms=latency_ms, config=config) for item in responses]
    telemetry["confirmed_vision_unit_count"] = len(arrays)
    telemetry["billing_unknown"] = False
    return {
        "status": "OK" if any(item["status"] == "OK" for item in results) else "NO_TEXT",
        "results": results,
        "latency_ms": latency_ms,
        "vision_unit_count": len(arrays),
        "cost_estimate": round(len(arrays) * float(getattr(config, "vision_cost_per_image", 0.0)), 6),
        **telemetry,
    }


def run_google_vision_ocr(
    array: "np.ndarray",
    *,
    crop_type: str,
    config: Any,
    client: Any | None = None,
    client_factory: Callable[[Any], Any] | None = None,
    urlopen_impl: Callable[[Request, int], Any] | None = None,
) -> dict[str, Any]:
    batch = run_google_vision_ocr_batch(
        [array],
        crop_types=[crop_type],
        config=config,
        client=client,
        client_factory=client_factory,
        urlopen_impl=urlopen_impl,
    )
    if batch.get("results"):
        return {
            **batch["results"][0],
            "auth_mode": batch.get("auth_mode"),
            "vision_http_attempt_count": int(batch.get("vision_http_attempt_count") or 0),
            "google_annotate_request_count": int(batch.get("google_annotate_request_count") or 0),
            "attempted_vision_unit_count": int(batch.get("attempted_vision_unit_count") or 0),
            "confirmed_vision_unit_count": int(batch.get("confirmed_vision_unit_count") or 0),
            "billing_unknown": bool(batch.get("billing_unknown")),
        }
    return {
        **vision_unavailable(str(batch.get("reason") or "vision_batch_unavailable"), latency_ms=int(batch.get("latency_ms") or 0)),
        "auth_mode": batch.get("auth_mode"),
        "vision_http_attempt_count": int(batch.get("vision_http_attempt_count") or 0),
        "google_annotate_request_count": int(batch.get("google_annotate_request_count") or 0),
        "attempted_vision_unit_count": int(batch.get("attempted_vision_unit_count") or 0),
        "confirmed_vision_unit_count": int(batch.get("confirmed_vision_unit_count") or 0),
        "billing_unknown": bool(batch.get("billing_unknown")),
    }
