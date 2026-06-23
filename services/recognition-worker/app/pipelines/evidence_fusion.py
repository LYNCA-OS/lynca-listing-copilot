from __future__ import annotations


def fuse_evidence_placeholder() -> dict:
    return {
        "status": "NO_EVIDENCE",
        "items": [],
        "note": "Fusion waits for OCR, Agnes, and retrieval evidence. No generated facts are fabricated.",
    }
