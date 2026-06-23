from __future__ import annotations


def candidate_verification_unavailable() -> dict:
    return {
        "status": "DISABLED",
        "candidates": [],
        "features": {
            "keypoint_match_count": None,
            "inlier_count": None,
            "inlier_ratio": None,
            "reprojection_error": None,
            "layout_consistency": None,
            "verification_score": None,
        },
    }
