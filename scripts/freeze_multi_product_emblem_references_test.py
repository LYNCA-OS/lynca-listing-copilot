#!/usr/bin/env python3

import importlib.util
import tempfile
import unittest
from pathlib import Path

from PIL import Image


MODULE_PATH = Path(__file__).with_name("freeze_multi_product_emblem_references.py")
SPEC = importlib.util.spec_from_file_location("multi_product_reference_freezer", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ReferenceFreezerTest(unittest.TestCase):
    def test_selection_set_and_first_eligible_orders_are_frozen(self):
        self.assertEqual(
            {key: row["page_order"] for key, row in MODULE.SELECTIONS.items()},
            {
                "PANINI_CONTENDERS": 1,
                "PANINI_SPECTRA": 4,
                "PANINI_ELITE": 2,
                "PANINI_DONRUSS_OPTIC": 4,
                "PANINI_PRIZM": 3,
            },
        )
        self.assertEqual(MODULE.PHOENIX_REFERENCE["crop_xywh"], [230, 525, 150, 140])

    def test_crop_is_fail_closed_at_source_bounds(self):
        image = Image.new("RGB", (100, 100), "white")
        self.assertEqual(MODULE.crop_image(image, [10, 20, 30, 40]).size, (30, 40))
        with self.assertRaises(ValueError):
            MODULE.crop_image(image, [90, 90, 20, 20])
        with self.assertRaises(ValueError):
            MODULE.crop_image(image, [0, 0, 0, 10])

    def test_candidate_manifest_requires_exact_pre_score_sha(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text("{}\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "SHA drifted"):
                MODULE.validate_candidate_manifest(path)

    def test_freezer_has_no_evaluation_registry_or_scoring_path(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertNotIn("EVALUATION_PAGES", source)
        self.assertNotIn("score_image", source)
        self.assertNotIn("findHomography", source)
        self.assertNotIn("knnMatch", source)

    def test_committed_reference_packet_is_complete_and_content_addressed(self):
        root = MODULE_PATH.parent.parent
        manifest_path = (
            root / "data/eval/product-emblem/multi-product-official-reference-v1.json"
        )
        self.assertEqual(
            MODULE.sha256_file(manifest_path),
            "eb61f4395ec079a3bb356dd444378adf75df91df13583b03c569eec3fd85e286",
        )
        manifest = __import__("json").loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["state"], "G1_REFERENCE_FROZEN")
        self.assertEqual(len(manifest["references"]), 6)
        self.assertFalse(manifest["integrity"]["evaluation_pages_accessed"])
        self.assertFalse(manifest["integrity"]["evaluation_sift_features_computed"])
        for reference in manifest["references"]:
            artifact = manifest_path.parent / reference["crop_artifact"]
            self.assertEqual(MODULE.sha256_file(artifact), reference["crop_artifact_sha256"])
            gray = Image.open(artifact).convert("L")
            self.assertEqual(
                MODULE.sha256_bytes(gray.tobytes()),
                reference["crop_raw_grayscale_sha256"],
            )
            self.assertGreaterEqual(reference["reference_sift_keypoints"], 5)


if __name__ == "__main__":
    unittest.main()
