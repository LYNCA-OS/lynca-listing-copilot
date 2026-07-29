#!/usr/bin/env python3
"""Freeze the six official product-mark references for the G1 gate.

This script is intentionally reference-only.  It consumes the already acquired
template candidate bundle, verifies every selected source byte and decoded
pixel hash, makes each predeclared crop exactly once, and records the frozen
SIFT reference evidence.  It contains no evaluation-page registry and cannot
score an evaluation image.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import tempfile
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, __version__ as PILLOW_VERSION


SCHEMA_VERSION = "multi-product-emblem-official-reference-v1"
FROZEN_G0_COMMIT = "71ed382b1cddf98375210e1d57f722d778f121a9"
FROZEN_G0_DOCUMENT_SHA256 = (
    "77bb72ca261e90cbfc4a819cfeb35b8a6c667d91b06cf8c3f45e4946eabdaf4c"
)
FROZEN_CANDIDATE_MANIFEST_SHA256 = (
    "bc2b5d39fefea3389b0f477914967502d0b593ce8bfd1df5d9d7e0f226d30b12"
)
FROZEN_CANDIDATE_SCHEMA = "multi-product-emblem-reference-candidates-v1"
REFERENCE_CANDIDATE_COMMITS = [
    "62c76bcf",
    "ecfd26d0",
]

SIFT_CONFIG = {
    "nfeatures": 4000,
    "contrastThreshold": 0.015,
    "edgeThreshold": 12,
}

# Coordinates were chosen once from the G1 template contact sheets, before any
# evaluation image was acquired or scored.  They already include the frozen
# ten-pixel visual padding around the complete product mark.
SELECTIONS = {
    "PANINI_CONTENDERS": {
        "page_order": 1,
        "crop_xywh": [95, 1078, 273, 127],
        "selection_reason": "first candidate is one card front with complete mark",
    },
    "PANINI_SPECTRA": {
        "page_order": 4,
        "crop_xywh": [813, 89, 167, 153],
        "selection_reason": "first three candidates are multi-card or packaging; fourth is first eligible card front",
    },
    "PANINI_ELITE": {
        "page_order": 2,
        "crop_xywh": [953, 339, 128, 156],
        "selection_reason": "first candidate is packaging; second is first eligible card front",
    },
    "PANINI_DONRUSS_OPTIC": {
        "page_order": 4,
        "crop_xywh": [198, 42, 164, 161],
        "selection_reason": "first three candidates are multi-card or packaging; fourth is first eligible card front",
    },
    "PANINI_PRIZM": {
        "page_order": 3,
        "crop_xywh": [672, 68, 358, 139],
        "selection_reason": "first candidate is multi-card and page-order two is broken; third is first eligible card front",
    },
}

PHOENIX_REFERENCE = {
    "product_key": "PANINI_PHOENIX",
    "source_page_url": (
        "https://blog.paniniamerica.net/"
        "panini-2023-24-phoenix-basketballs-arrival-heats-up-hoops-collections/"
    ),
    "original_url": (
        "https://blog.paniniamerica.net/wp-content/uploads/2024/09/IMG_3038.png"
    ),
    "reader_transport_url": (
        "https://r.jina.ai/http://blog.paniniamerica.net/wp-json/wp/v2/posts?"
        "slug=panini-2023-24-phoenix-basketballs-arrival-heats-up-hoops-collections"
    ),
    "reader_payload_sha256": (
        "229634c0c6aeefff7be211d90f7e2b8d362961a34d09878a8535eaa0cc62a7ff"
    ),
    "content_html_sha256": (
        "c71440c3dfaf7ff48d915a2cda54bb47b885b0bc33505ea484ddb10e9ef96423"
    ),
    "wordpress_post_id": 293754,
    "wordpress_modified_gmt": "2024-09-27T18:48:11",
    "featured_media_id": 293773,
    "transported_sha256": (
        "8c15b3a411a6202c7b4bdf60fd1b5a39268f605a043f18f40db23fb0fb0ba3f3"
    ),
    "width": 600,
    "height": 765,
    "crop_xywh": [230, 525, 150, 140],
    "expected_crop_raw_grayscale_sha256": (
        "5be53e3ad989847800b4fc4704ac616530a88f8deea0cd45827bad579b0bb80d"
    ),
    "legacy_gate_document": (
        "docs/evaluation/day-one-emblem-prospective-gate-2026-07-29.md"
    ),
    "selection_reason": "reused byte-for-byte from the previously frozen Phoenix gate",
}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def decoded_rgb_sha256(image: Image.Image) -> str:
    return sha256_bytes(image.convert("RGB").tobytes())


def crop_image(image: Image.Image, crop_xywh: list[int]) -> Image.Image:
    x, y, width, height = crop_xywh
    if min(x, y, width, height) < 0 or width == 0 or height == 0:
        raise ValueError(f"invalid crop coordinates: {crop_xywh}")
    if x + width > image.width or y + height > image.height:
        raise ValueError(f"crop exceeds source bounds: {crop_xywh} vs {image.size}")
    return image.convert("L").crop((x, y, x + width, y + height))


def describe_crop(gray: Image.Image, output_path: Path) -> dict[str, Any]:
    raw = gray.tobytes()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    gray.save(output_path, format="PNG", optimize=False)
    sift = cv2.SIFT_create(**SIFT_CONFIG)
    keypoints, _descriptors = sift.detectAndCompute(np.asarray(gray), None)
    keypoint_count = len(keypoints or [])
    if keypoint_count < 5:
        raise ValueError(
            f"reference crop {output_path.name} has only {keypoint_count} SIFT keypoints"
        )
    return {
        "crop_raw_grayscale_sha256": sha256_bytes(raw),
        "crop_artifact_sha256": sha256_file(output_path),
        "crop_artifact_bytes": output_path.stat().st_size,
        "reference_sift_keypoints": keypoint_count,
    }


def validate_candidate_manifest(path: Path) -> dict[str, Any]:
    if sha256_file(path) != FROZEN_CANDIDATE_MANIFEST_SHA256:
        raise ValueError("G1 candidate manifest SHA drifted")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != FROZEN_CANDIDATE_SCHEMA:
        raise ValueError("G1 candidate manifest schema drifted")
    if manifest.get("frozen_g0_commit") != FROZEN_G0_COMMIT:
        raise ValueError("G1 candidate manifest is not bound to frozen G0")
    if manifest.get("frozen_g0_document_sha256") != FROZEN_G0_DOCUMENT_SHA256:
        raise ValueError("G1 candidate manifest G0 document SHA drifted")
    if manifest.get("evaluation_pages_accessed") is not False:
        raise ValueError("G1 candidate acquisition touched evaluation pages")
    if manifest.get("sift_features_computed") is not False:
        raise ValueError("G1 candidate acquisition computed SIFT")
    products = manifest.get("products")
    if not isinstance(products, list) or {row.get("product_key") for row in products} != set(SELECTIONS):
        raise ValueError("G1 candidate product set drifted")
    return manifest


def selected_candidate(product: dict[str, Any], page_order: int) -> dict[str, Any]:
    matches = [row for row in product.get("candidates", []) if row.get("page_order") == page_order]
    if len(matches) != 1:
        raise ValueError(f"expected one page-order {page_order} candidate")
    return matches[0]


def build_reference_row(
    *,
    product: dict[str, Any],
    selection: dict[str, Any],
    crop_dir: Path,
) -> dict[str, Any]:
    candidate = selected_candidate(product, int(selection["page_order"]))
    source_path = Path(candidate["local_path"])
    if sha256_file(source_path) != candidate["transported_sha256"]:
        raise ValueError(f"transported source SHA drifted for {product['product_key']}")
    image = Image.open(source_path).convert("RGB")
    if list(image.size) != [candidate["width"], candidate["height"]]:
        raise ValueError(f"source dimensions drifted for {product['product_key']}")
    if decoded_rgb_sha256(image) != candidate["decoded_rgb_sha256"]:
        raise ValueError(f"decoded source SHA drifted for {product['product_key']}")
    crop = crop_image(image, selection["crop_xywh"])
    artifact_name = f"{product['product_key'].lower()}.png"
    crop_details = describe_crop(crop, crop_dir / artifact_name)
    return {
        "product_key": product["product_key"],
        "authority": "OFFICIAL_PANINI_TEMPLATE_PAGE",
        "source_page_url": product["page_url"],
        "reader_transport_url": product["reader_transport_url"],
        "reader_payload_sha256": product["reader_payload_sha256"],
        "content_html_sha256": product["content_html_sha256"],
        "wordpress_post_id": product["wordpress_post_id"],
        "wordpress_modified_gmt": product["wordpress_modified_gmt"],
        "featured_media_id": product["featured_media_id"],
        "candidate_page_order": candidate["page_order"],
        "original_url": candidate["original_url"],
        "transport_url": candidate["transport_url"],
        "transported_sha256": candidate["transported_sha256"],
        "decoded_rgb_sha256": candidate["decoded_rgb_sha256"],
        "width": candidate["width"],
        "height": candidate["height"],
        "crop_xywh": selection["crop_xywh"],
        "crop_padding_px": 10,
        "crop_artifact": f"reference-crops/{artifact_name}",
        "selection_reason": selection["selection_reason"],
        **crop_details,
    }


def build_phoenix_row(source_path: Path, crop_dir: Path) -> dict[str, Any]:
    if sha256_file(source_path) != PHOENIX_REFERENCE["transported_sha256"]:
        raise ValueError("frozen Phoenix source SHA drifted")
    image = Image.open(source_path).convert("RGB")
    if list(image.size) != [PHOENIX_REFERENCE["width"], PHOENIX_REFERENCE["height"]]:
        raise ValueError("frozen Phoenix source dimensions drifted")
    crop = crop_image(image, PHOENIX_REFERENCE["crop_xywh"])
    artifact_name = "panini_phoenix.png"
    crop_details = describe_crop(crop, crop_dir / artifact_name)
    if (
        crop_details["crop_raw_grayscale_sha256"]
        != PHOENIX_REFERENCE["expected_crop_raw_grayscale_sha256"]
    ):
        raise ValueError("frozen Phoenix crop SHA drifted")
    return {
        **{key: value for key, value in PHOENIX_REFERENCE.items() if not key.startswith("expected_")},
        "authority": "OFFICIAL_PANINI_TEMPLATE_PAGE",
        "decoded_rgb_sha256": decoded_rgb_sha256(image),
        "crop_padding_px": "PREVIOUSLY_FROZEN_GEOMETRY",
        "crop_artifact": f"reference-crops/{artifact_name}",
        **crop_details,
    }


def build_manifest(
    *,
    candidate_manifest_path: Path,
    phoenix_source_path: Path,
    crop_dir: Path,
) -> dict[str, Any]:
    candidate_manifest = validate_candidate_manifest(candidate_manifest_path)
    products = {row["product_key"]: row for row in candidate_manifest["products"]}
    references = [build_phoenix_row(phoenix_source_path, crop_dir)]
    references.extend(
        build_reference_row(
            product=products[product_key],
            selection=SELECTIONS[product_key],
            crop_dir=crop_dir,
        )
        for product_key in SELECTIONS
    )
    if len(references) != 6 or len({row["product_key"] for row in references}) != 6:
        raise ValueError("reference set is not exactly six unique products")
    return {
        "schema_version": SCHEMA_VERSION,
        "state": "G1_REFERENCE_FROZEN",
        "frozen_g0_commit": FROZEN_G0_COMMIT,
        "frozen_g0_document_sha256": FROZEN_G0_DOCUMENT_SHA256,
        "reference_candidate_commits": REFERENCE_CANDIDATE_COMMITS,
        "reference_candidate_manifest_sha256": FROZEN_CANDIDATE_MANIFEST_SHA256,
        "selection_policy": {
            "maximum_inspected_candidates": 30,
            "rule": "first one-card front with complete product mark",
            "crop": "one axis-aligned crop with ten-pixel visual padding",
            "minimum_reference_sift_keypoints": 5,
        },
        "sensor": {
            "opencv_sift": SIFT_CONFIG,
            "input": "grayscale",
            "reference_templates_per_product": 1,
        },
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "opencv": cv2.__version__,
            "pillow": PILLOW_VERSION,
            "cv_threads": 1,
        },
        "integrity": {
            "evaluation_pages_accessed": False,
            "evaluation_images_displayed": False,
            "evaluation_sift_features_computed": False,
            "production_behavior_changed": False,
        },
        "references": references,
    }


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    descriptor, temporary_name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-manifest", type=Path, required=True)
    parser.add_argument("--phoenix-source", type=Path, required=True)
    parser.add_argument("--crop-dir", type=Path, required=True)
    parser.add_argument("--output-manifest", type=Path, required=True)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    result = build_manifest(
        candidate_manifest_path=args.candidate_manifest,
        phoenix_source_path=args.phoenix_source,
        crop_dir=args.crop_dir,
    )
    write_json_atomic(args.output_manifest, result)
    print(
        json.dumps(
            {
                "ok": True,
                "state": result["state"],
                "references": len(result["references"]),
                "manifest": str(args.output_manifest),
                "manifest_sha256": sha256_file(args.output_manifest),
                "evaluation_pages_accessed": False,
                "evaluation_sift_features_computed": False,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
