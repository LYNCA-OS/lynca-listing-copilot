from __future__ import annotations


def embeddings_unavailable() -> dict:
    return {
        "status": "DISABLED",
        "models": {},
        "features": [],
    }
