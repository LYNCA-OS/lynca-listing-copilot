from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse


class SecurityError(ValueError):
    pass


@dataclass(frozen=True)
class UrlPolicy:
    allowed_hosts: list[str]
    max_redirects: int = 0


def verify_bearer_token(header_value: str | None, expected_token: str) -> None:
    if not expected_token:
        raise SecurityError("recognition worker token is not configured")
    if not header_value or not header_value.startswith("Bearer "):
        raise SecurityError("missing bearer token")
    supplied = header_value.removeprefix("Bearer ").strip()
    if supplied != expected_token:
        raise SecurityError("invalid bearer token")


def validate_image_url(url: str, policy: UrlPolicy) -> str:
    parsed = urlparse(str(url or ""))
    if parsed.scheme != "https":
        raise SecurityError("image URL must use https")
    hostname = (parsed.hostname or "").lower()
    allowed = [host.lower() for host in policy.allowed_hosts]
    if hostname not in allowed and not any(hostname.endswith(f".{host}") for host in allowed):
        raise SecurityError("image URL host is not allowed")
    if parsed.username or parsed.password:
        raise SecurityError("image URL must not include credentials")
    return url


def redact_url(url: str) -> str:
    parsed = urlparse(str(url or ""))
    if not parsed.scheme or not parsed.netloc:
        return "[invalid-url]"
    path = parsed.path[:160]
    return f"{parsed.scheme}://{parsed.netloc}{path}"
