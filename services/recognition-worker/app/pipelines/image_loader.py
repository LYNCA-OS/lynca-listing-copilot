from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import ssl
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

import numpy as np
from PIL import Image, UnidentifiedImageError

from ..security import SecurityError, UrlPolicy, redact_url, validate_image_url


class ImageLoadError(ValueError):
    pass


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N802 - urllib API name.
        raise ImageLoadError("image URL redirects are not allowed")


@dataclass(frozen=True)
class LoadedImage:
    image_id: str
    role: str
    url: str
    content_type: str
    size_bytes: int
    width: int
    height: int
    array: np.ndarray

    def metadata(self) -> dict[str, Any]:
        return {
            "image_id": self.image_id,
            "role": self.role,
            "url": redact_url(self.url),
            "content_type": self.content_type,
            "size_bytes": self.size_bytes,
            "width": self.width,
            "height": self.height,
        }


def _default_urlopen(request: Request, timeout: int):
    handlers = [_NoRedirectHandler]
    try:
        import certifi

        handlers.append(HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())))
    except Exception:
        handlers.append(HTTPSHandler(context=ssl.create_default_context()))
    opener = build_opener(*handlers)
    return opener.open(request, timeout=timeout)


def _content_type(headers: Any) -> str:
    if hasattr(headers, "get_content_type"):
        return headers.get_content_type()
    value = headers.get("content-type") if hasattr(headers, "get") else ""
    return str(value or "").split(";")[0].strip().lower()


def _content_length(headers: Any) -> int | None:
    value = headers.get("content-length") if hasattr(headers, "get") else None
    try:
        parsed = int(value)
        return parsed if parsed >= 0 else None
    except (TypeError, ValueError):
        return None


def _read_bounded(response: Any, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(min(64 * 1024, max_bytes + 1 - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > max_bytes:
            raise ImageLoadError("image exceeds max byte limit")
    return b"".join(chunks)


def _decode_image(data: bytes, max_total_pixels: int) -> tuple[np.ndarray, int, int, str | None]:
    try:
        with Image.open(BytesIO(data)) as image:
            width, height = image.size
            image_format = image.format
            if width <= 0 or height <= 0:
                raise ImageLoadError("image dimensions are invalid")
            if width * height > max_total_pixels:
                raise ImageLoadError("image exceeds max pixel limit")
            rgb = image.convert("RGB")
            return np.asarray(rgb, dtype=np.uint8), width, height, image_format
    except UnidentifiedImageError as error:
        raise ImageLoadError("image bytes are not a supported image") from error


def load_signed_image(
    image: dict[str, Any],
    *,
    allowed_hosts: list[str],
    max_bytes: int,
    max_total_pixels: int,
    timeout_seconds: int,
    urlopen_impl: Callable[[Request, int], Any] | None = None,
) -> LoadedImage:
    url = validate_image_url(str(image.get("signed_url") or ""), UrlPolicy(allowed_hosts))
    image_id = str(image.get("image_id") or "image")
    role = str(image.get("role") or "")
    request = Request(url, headers={"user-agent": "lynca-recognition-worker/1.0"})
    opener = urlopen_impl or _default_urlopen

    try:
        response = opener(request, timeout_seconds)
        with response:
            status = getattr(response, "status", 200)
            if status < 200 or status >= 300:
                raise ImageLoadError(f"image download failed with HTTP {status}")
            headers = getattr(response, "headers", {})
            length = _content_length(headers)
            if length is not None and length > max_bytes:
                raise ImageLoadError("image exceeds max byte limit")
            content_type = _content_type(headers)
            if content_type and content_type not in {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}:
                raise ImageLoadError("image content type is not allowed")
            data = _read_bounded(response, max_bytes)
    except SecurityError:
        raise
    except ImageLoadError:
        raise
    except HTTPError as error:
        raise ImageLoadError(f"image download failed with HTTP {error.code}") from error
    except URLError as error:
        reason = getattr(error, "reason", error)
        raise ImageLoadError(f"image download failed: {reason}") from error

    array, width, height, image_format = _decode_image(data, max_total_pixels)
    return LoadedImage(
        image_id=image_id,
        role=role,
        url=url,
        content_type=content_type or Image.MIME.get(image_format, "application/octet-stream"),
        size_bytes=len(data),
        width=width,
        height=height,
        array=array,
    )
