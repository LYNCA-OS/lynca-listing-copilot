#!/usr/bin/env python3
"""Run the one legal product-mark Validation-21 field evaluation.

The cohort and every input fingerprint are frozen below.  Prediction is run in
a child process with image-only labels.  Only after that process exits does this
driver open the frozen Validation truth packet and score the already-written
predictions.  The product-mark evaluator itself is not modified by this driver.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "product-mark-untouched-validation21-result-v1"
RUN_ID = "product-mark-untouched-validation21-20260730-v1"
GENERATED_DATE = "2026-07-30"

FROZEN_SPLIT_MANIFEST = Path(
    "/private/tmp/lynca-recoverable-mainline.PPqJ7t/.local/oracle/"
    "reproducible-frozen/manifest.json"
)
FROZEN_VALIDATION_TRUTH = Path(
    "/private/tmp/lynca-recoverable-mainline.PPqJ7t/.local/oracle/"
    "reproducible-frozen/validation.json"
)
SOURCE_INDEXES = (
    Path("/Users/paidaxin/lynca-listing-copilot/artifacts/smoke/reviewed-200.json"),
    Path(
        "/Users/paidaxin/Documents/Lynca/lynca-catalog-vocab/"
        "artifacts/smoke/reviewed-20.json"
    ),
    Path(
        "/Users/paidaxin/Documents/Lynca/lynca-catalog-vocab/"
        "artifacts/smoke/cold20.json"
    ),
)

EXPECTED_FILE_SHA256 = {
    str(FROZEN_SPLIT_MANIFEST): (
        "715a8f1ec3cf8cff3df59f2ad40e330102810d61f3fc843d9ef99b92f5808df0"
    ),
    str(FROZEN_VALIDATION_TRUTH): (
        "fd852f13c3ed4a3bb4df1bec36d213332f4f475b1618e7516bde9cf55e2bec60"
    ),
    str(SOURCE_INDEXES[0]): (
        "b87c5df2809cb4579293e5398bbb894c3f09b77caf572abe1d6e4f63c247d274"
    ),
    str(SOURCE_INDEXES[1]): (
        "07321d432ebd93d61857938de7c02f3bb7db3abb7aa69bf6a3135b05e95b3b0c"
    ),
    str(SOURCE_INDEXES[2]): (
        "0095f57af744a8e4594b948a22f196d06cc95a894cd5e6dc3175a6406170f9fe"
    ),
}

FROZEN_EVALUATOR_RELPATH = Path("scripts/audit_product_mark_sensor.py")
FROZEN_EVALUATOR_SHA256 = (
    "4237c1fa43f600937e4aebfb626dd343764105f084205590030bb9b05be63b2c"
)
FROZEN_REFERENCE_RELPATH = Path(
    "data/eval/product-emblem/multi-product-official-reference-v1.json"
)
FROZEN_REFERENCE_SHA256 = (
    "eb61f4395ec079a3bb356dd444378adf75df91df13583b03c569eec3fd85e286"
)
RETROSPECTIVE_TUNING_REPORT_RELPATH = Path(
    "docs/reports/no-full-provider-product-mark-sensor-2026-07-30.json"
)
RETROSPECTIVE_TUNING_REPORT_SHA256 = (
    "80c287b8056172b42a68e1a3b0afd1360640e3ab83766b95a67ac1369cbae1e8"
)

FROZEN_TARGET_MAX_DIMENSION = 500
FROZEN_PREDICTION_PROFILE = "retrospective_precision_candidate"
FROZEN_THRESHOLDS = {
    "PANINI_CONTENDERS": 5,
    "PANINI_DONRUSS_OPTIC": 5,
    "PANINI_ELITE": 5,
    "PANINI_PHOENIX": 5,
    "PANINI_PRIZM": 7,
    "PANINI_SPECTRA": 5,
}
SUPPORTED_PRODUCTS = frozenset(FROZEN_THRESHOLDS)

# This exact cohort was selected mechanically before prediction: all frozen
# Validation items whose Product field is CONFIRMED and whose front image is
# present in the three frozen local indexes with a matching content hash.
FROZEN_COHORT = (
    ("11485f06-22f8-4d96-a6d0-8eefabffda6a", "a6d641043adb66885ad98eddb583330c55f6797d3f43703800fe3532ba6127f8"),
    ("1eda9455-567b-4bd3-8ca9-aafe61b874f5", "6808dda56cdafb98ae531d8e880a3db41b69328011b848b19186d49c8ebccff5"),
    ("21d7fb3f-5919-4fea-97ab-cf2dd066d31b", "2f1c7e754a35fd505c821d82513a45756df629b2090e79d66ab6f683f6b517c4"),
    ("24111f44-cb35-49a2-bcaf-8a354bcddbf6", "02d823075d962d6aedc0491e30ef44090c07b95246d0788e7675aa11bd7126ef"),
    ("34a7f0fc-cc9b-4fb1-ac34-0dd67c4cebd9", "709dd962f74c598989fba0d298cf228624bce0a4b7615bcb4f9eaabad3f5029a"),
    ("43f2d69f-6ad0-4933-ad4b-65e6c8790ef0", "8dce3fa91a9e6c981f4fb3c1682ae4bcf64568040d52d13740735f87e41669e8"),
    ("44738aef-f306-4e60-956b-5babfa10f641", "c13985f6b4ca1a1be5ff19c119ebb3087cb5244fc97082296be3153d5eb038b0"),
    ("49c29a1f-3d1a-4b83-a1c3-3195c3da7a29", "1820206dcff6746d834f7e40cb999def50e4cdf3ad61a109843c8f5d64e5938e"),
    ("4e11e36f-cbff-4e48-a7f2-de29cf6592ca", "3014aef8fe8fcb21f82ac04ed7d0cccb01fd9d623183c9244c3b6e862dc798ee"),
    ("50146fbd-2389-4e29-a66a-1157c46b7406", "7c09659bdf5e95bb130cce0e1f16be5c3da1ec9b851923050e42936a50d2ab63"),
    ("51f6c758-ff84-486e-9ed1-7f5f0f87cb0c", "beeb0740efd13cb33e1a4ee864bb095150790c9724dbda62f3e59d34d27b18d2"),
    ("5fe1da1e-2f67-4181-9f61-d955e3ac8d82", "b8e8932d316cb391fc4ff7c1cad5b6b7290daee8266ce1ffc384e6daccce32fa"),
    ("61c9f6c6-b59a-4d9a-83c5-a44519462091", "c3c32028d1d836dede1537e94f7247f5f08c90223f1b4bbc8d1e9272384267fd"),
    ("684b864d-52fe-4354-9aab-bd0fbd10077e", "1fac22bb88d1ccf89c3c41d65c8fb2e22298e759fdde378131ccd1132ade45b2"),
    ("79d1dc14-6d9b-47ff-948d-129c245f8916", "082c075b5ab56cbf2c25ecf8a94bbe82950ab4c3a0ef8613164f714312cf96fc"),
    ("9191a5dc-4fad-4f25-b229-75d480eab72a", "18ee7b47a691a7ed66d59e7e42123dd1965831ae8f4a0475bbb9da452f6fb5a4"),
    ("9f58f9b3-9fc8-4b7b-bf3e-64c072a89100", "feda245b7f739cff83faaaa2e987332c87a210a7a04502a6e5e5ecffbe997274"),
    ("bcc038ca-a848-40d7-880b-993df6d706ff", "5813e6435b499cc7bbf0f5fefb5da82fe3173c5d1dd0914c4a2818c1b10d4bed"),
    ("c5e7ef40-557c-4fe8-b0af-4f3150b52f5c", "8b17b2c32902627c92d16b23290fa5fe7fe97194c357601763c2d0ecb8ccd9d0"),
    ("d7ddef98-7c3c-4f8e-b7f7-f7efc6c94c7c", "9ab27f5202a0f69b67c07d1725930c7016a7bdf72e065ebe1b2dd64e6a5a4407"),
    ("fbd2f900-0827-4fc2-937d-1803f56df469", "383e059219be2a6acfaad59da8508904a53a5daaf67b8a297f6c665a4c2b2ac8"),
)


class ContractError(RuntimeError):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def stable_hash(value: Any) -> str:
    return sha256_bytes(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ContractError(f"JSON root must be an object: {path}")
    return value


def assert_file_hash(path: Path, expected: str) -> None:
    if not path.is_file() or path.is_symlink():
        raise ContractError(f"required regular file missing: {path}")
    actual = sha256_file(path)
    if actual != expected:
        raise ContractError(f"fingerprint drift for {path}: {actual}")


def canonical_truth_product(value: Any) -> str:
    lowered = str(value or "").strip().lower()
    if "donruss optic" in lowered:
        return "PANINI_DONRUSS_OPTIC"
    if "phoenix" in lowered:
        return "PANINI_PHOENIX"
    if "contenders" in lowered:
        return "PANINI_CONTENDERS"
    if "spectra" in lowered:
        return "PANINI_SPECTRA"
    if "elite" in lowered:
        return "PANINI_ELITE"
    if "prizm" in lowered:
        return "PANINI_PRIZM"
    return "OTHER_PRODUCT"


def build_image_only_inputs(repo_root: Path, temporary_root: Path) -> list[dict[str, Any]]:
    """Resolve frozen images without opening the Validation truth packet."""
    manifest = load_json(FROZEN_SPLIT_MANIFEST)
    if manifest.get("frozen_assignment_id") != "v4-oracle-dev173-val37-holdout45-20260723":
        raise ContractError("frozen assignment drift")
    if manifest.get("actual_counts", {}).get("validation") != 37:
        raise ContractError("Validation split cardinality drift")
    validation_ids = set(manifest.get("partitions", {}).get("validation", []))
    frozen_ids = {item_id for item_id, _ in FROZEN_COHORT}
    if len(FROZEN_COHORT) != 21 or len(frozen_ids) != 21:
        raise ContractError("frozen cohort must contain 21 unique items")
    if not frozen_ids.issubset(validation_ids):
        raise ContractError("frozen cohort is not contained in Validation")

    source_rows: dict[str, list[tuple[Path, dict[str, Any]]]] = {}
    for source_path in SOURCE_INDEXES:
        source = load_json(source_path)
        for row in source.get("items", []):
            source_rows.setdefault(str(row.get("source_feedback_id", "")), []).append(
                (source_path, row)
            )

    image_dir = temporary_root / "images"
    image_dir.mkdir()
    resolved: list[dict[str, Any]] = []
    for item_id, expected_sha in FROZEN_COHORT:
        matches: list[dict[str, Any]] = []
        for source_path, row in source_rows.get(item_id, []):
            for image in row.get("images", []):
                if image.get("role") != "front_original":
                    continue
                if image.get("content_sha256") != expected_sha:
                    continue
                local_path = Path(str(image.get("local_path", "")))
                if not local_path.is_file():
                    continue
                matches.append(
                    {
                        "source_index": str(source_path),
                        "local_path": str(local_path),
                        "object_path": str(image.get("object_path", "")),
                    }
                )
        if not matches:
            raise ContractError(f"no hash-bound front image for {item_id}")
        matches.sort(key=lambda row: [str(path) for path in SOURCE_INDEXES].index(row["source_index"]))
        selected = matches[0]
        image_path = Path(selected["local_path"])
        if sha256_file(image_path) != expected_sha:
            raise ContractError(f"front bytes drifted for {item_id}")
        linked_path = image_dir / f"{item_id}.jpg"
        os.symlink(image_path, linked_path)
        resolved.append(
            {
                "item_id": item_id,
                "front_sha256": expected_sha,
                "front_object_path": selected["object_path"],
                "local_image_source_index": selected["source_index"],
                "local_image_path": selected["local_path"],
                "predictor_path": str(linked_path),
            }
        )

    blind_labels = temporary_root / "image-only-labels.jsonl"
    blind_labels.write_text(
        "".join(
            json.dumps(
                {"key": row["item_id"], "identity_ground_truth": {"product": ""}},
                separators=(",", ":"),
            )
            + "\n"
            for row in resolved
        ),
        encoding="utf-8",
    )
    return resolved


def run_frozen_predictor(
    repo_root: Path,
    temporary_root: Path,
    resolved_images: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    evaluator = repo_root / FROZEN_EVALUATOR_RELPATH
    reference = repo_root / FROZEN_REFERENCE_RELPATH
    assert_file_hash(evaluator, FROZEN_EVALUATOR_SHA256)
    assert_file_hash(reference, FROZEN_REFERENCE_SHA256)
    raw_output = temporary_root / "prediction.json"
    command = [
        sys.executable,
        str(evaluator),
        "--manifest",
        str(reference),
        "--labels",
        str(temporary_root / "image-only-labels.jsonl"),
        "--images",
        str(temporary_root / "images"),
        "--output",
        str(raw_output),
        "--target-max-dimension",
        str(FROZEN_TARGET_MAX_DIMENSION),
    ]
    prediction_started_at = datetime.now(timezone.utc).isoformat()
    process = subprocess.run(
        command,
        cwd=repo_root,
        check=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=os.environ.copy(),
    )
    prediction_completed_at = datetime.now(timezone.utc).isoformat()
    if process.returncode != 0:
        raise ContractError(f"frozen evaluator failed: {process.stderr.strip()}")
    raw = load_json(raw_output)
    if raw.get("network_calls") != 0 or raw.get("provider_calls") != 0:
        raise ContractError("frozen evaluator reported an external call")
    if raw.get("sensor", {}).get("target_max_dimension") != FROZEN_TARGET_MAX_DIMENSION:
        raise ContractError("target resize drift")
    thresholds = raw.get("sensor", {}).get("retrospective_candidate_thresholds")
    if thresholds != FROZEN_THRESHOLDS:
        raise ContractError("frozen threshold drift")
    raw_rows = raw.get("rows", [])
    if len(raw_rows) != len(resolved_images):
        raise ContractError("prediction cardinality drift")
    expected_images = {row["item_id"]: row["front_sha256"] for row in resolved_images}
    for row in raw_rows:
        item_id = str(row.get("item_id", ""))
        if expected_images.get(item_id) != row.get("image_sha256"):
            raise ContractError(f"prediction image binding drift for {item_id}")
        if row.get("ground_truth_product") != "UNKNOWN_PRODUCT":
            raise ContractError("truth leaked into predictor input")
    trace = {
        "predictor_process_invocations": 1,
        "prediction_started_at": prediction_started_at,
        "prediction_completed_at": prediction_completed_at,
        "predictor_exit_code": process.returncode,
        "predictor_input_truth_field_count": 0,
        "prediction_artifact_sha256": sha256_file(raw_output),
        "prediction_rows": len(raw_rows),
    }
    return raw, trace


def score_after_unseal(
    raw_prediction: dict[str, Any],
    resolved_images: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any], str]:
    """This is the first function allowed to open the Validation truth packet."""
    truth_unsealed_at = datetime.now(timezone.utc).isoformat()
    assert_file_hash(
        FROZEN_VALIDATION_TRUTH,
        EXPECTED_FILE_SHA256[str(FROZEN_VALIDATION_TRUTH)],
    )
    truth = load_json(FROZEN_VALIDATION_TRUTH)
    truth_rows = {str(row.get("item_id", "")): row for row in truth.get("items", [])}
    predictions = {str(row["item_id"]): row for row in raw_prediction.get("rows", [])}
    image_provenance = {row["item_id"]: row for row in resolved_images}

    rows: list[dict[str, Any]] = []
    for item_id, expected_sha in FROZEN_COHORT:
        truth_row = truth_rows.get(item_id)
        if truth_row is None:
            raise ContractError(f"Validation truth missing {item_id}")
        product_truth = (
            truth_row.get("reviewed_ground_truth", {})
            .get("fields", {})
            .get("product", {})
        )
        if product_truth.get("reviewed_status") != "CONFIRMED":
            raise ContractError(f"Product truth is not CONFIRMED for {item_id}")
        evidence_sources = product_truth.get("evidence_sources", [])
        if not evidence_sources:
            raise ContractError(f"Product truth has no provenance for {item_id}")
        canonical_truth = canonical_truth_product(product_truth.get("reviewed_value"))
        cohort_class = "SUPPORTED_POSITIVE" if canonical_truth in SUPPORTED_PRODUCTS else "OPEN_SET"
        prediction_row = predictions[item_id]
        prediction = prediction_row[FROZEN_PREDICTION_PROFILE]["prediction"]
        if cohort_class == "SUPPORTED_POSITIVE":
            outcome = "CORRECT" if prediction == canonical_truth else (
                "ABSTAIN" if prediction in {"UNKNOWN", "AMBIGUOUS"} else "WRONG_SUPPORTED_CLASS"
            )
        else:
            outcome = "CORRECT_REJECTION" if prediction in {"UNKNOWN", "AMBIGUOUS"} else "OPEN_SET_FALSE_POSITIVE"
        rows.append(
            {
                "item_id": item_id,
                "front_sha256": expected_sha,
                "front_object_path": image_provenance[item_id]["front_object_path"],
                "local_image_source_index": image_provenance[item_id]["local_image_source_index"],
                "truth": {
                    "reviewed_value": product_truth.get("reviewed_value"),
                    "canonical_product": canonical_truth,
                    "reviewed_status": product_truth.get("reviewed_status"),
                    "evidence_sources": evidence_sources,
                    "source_dataset": str(FROZEN_VALIDATION_TRUTH),
                },
                "cohort_class": cohort_class,
                "prediction": prediction,
                "prediction_reason": prediction_row[FROZEN_PREDICTION_PROFILE]["reason"],
                "scores": prediction_row.get("scores", {}),
                "outcome": outcome,
                "latency_ms": prediction_row.get("latency_ms"),
            }
        )

    supported = [row for row in rows if row["cohort_class"] == "SUPPORTED_POSITIVE"]
    open_set = [row for row in rows if row["cohort_class"] == "OPEN_SET"]
    supported_correct = sum(row["outcome"] == "CORRECT" for row in supported)
    supported_wrong = sum(row["outcome"] == "WRONG_SUPPORTED_CLASS" for row in supported)
    supported_abstain = sum(row["outcome"] == "ABSTAIN" for row in supported)
    open_correct = sum(row["outcome"] == "CORRECT_REJECTION" for row in open_set)
    open_false_positive = sum(row["outcome"] == "OPEN_SET_FALSE_POSITIVE" for row in open_set)
    emitted = [row for row in rows if row["prediction"] not in {"UNKNOWN", "AMBIGUOUS"}]
    emitted_correct = sum(
        row["cohort_class"] == "SUPPORTED_POSITIVE" and row["outcome"] == "CORRECT"
        for row in emitted
    )
    field_correct = supported_correct + open_correct
    metrics = {
        "denominator": len(rows),
        "supported_positive": {
            "denominator": len(supported),
            "correct": supported_correct,
            "wrong_supported_class": supported_wrong,
            "abstain": supported_abstain,
            "recall": round(supported_correct / len(supported), 6),
        },
        "open_set": {
            "denominator": len(open_set),
            "correct_rejection": open_correct,
            "false_positive": open_false_positive,
            "rejection_accuracy": round(open_correct / len(open_set), 6),
        },
        "emission": {
            "count": len(emitted),
            "correct_supported_emission": emitted_correct,
            "precision": round(emitted_correct / len(emitted), 6) if emitted else None,
        },
        "product_field_joint": {
            "correct": field_correct,
            "incorrect": len(rows) - field_correct,
            "accuracy": round(field_correct / len(rows), 6),
        },
        "latency_ms": raw_prediction.get("metrics", {}).get("latency_ms", {}),
    }
    if len(supported) != 5 or len(open_set) != 16:
        raise ContractError("frozen supported/open-set composition drift")
    return rows, metrics, truth_unsealed_at


def markdown_report(report: dict[str, Any]) -> str:
    metrics = report["metrics"]
    supported = metrics["supported_positive"]
    open_set = metrics["open_set"]
    joint = metrics["product_field_joint"]
    latency = metrics["latency_ms"]
    status = report["gate"]["status"]
    return f"""# Product-mark untouched Validation-21 v1

Status: **`{status}`**

This was the single frozen product-field evaluation. Predictions were generated
before the Validation Product truth was opened. Provider, network, production,
and holdout IO were all zero.

| Slice | Result |
| --- | ---: |
| Supported positives | {supported['correct']}/{supported['denominator']} correct; {supported['abstain']} abstain; {supported['wrong_supported_class']} wrong class |
| Open-set products | {open_set['correct_rejection']}/{open_set['denominator']} correctly rejected; {open_set['false_positive']} false positive |
| Joint Product field | {joint['correct']}/{report['metrics']['denominator']} = {joint['accuracy']:.2%} |
| Precision when emitting a supported product | {metrics['emission']['precision'] if metrics['emission']['precision'] is not None else 'N/A'} |
| Sensor latency | p50 {latency.get('p50')} ms; p95 {latency.get('p95')} ms |

The denominator is exactly **5 supported positives + 16 open-set items** from
the frozen Validation split. Image SHA overlap with the 17-row tuning cohort is
zero. The truth is a `CONFIRMED` Product field backed by the recorded
writer-reviewed-title bounded-span provenance; it is not an independently
reconstructed full-card identity.

## Interpretation boundary

This result evaluates one Product-mark field sensor only. It does **not** test
Year, Subject, Card Number, Retrieval, Selection, Resolver, Renderer, the
80-character title contract, or writer-visible end-to-end latency. Therefore it
cannot prove, and must not be presented as, **85% title accuracy** or production
readiness.
"""


def verify_report(report: dict[str, Any]) -> None:
    if report.get("schema_version") != SCHEMA_VERSION:
        raise ContractError("report schema drift")
    if report.get("holdout", {}).get("io_count") != 0:
        raise ContractError("holdout IO must be zero")
    if report.get("external_calls") != {"provider": 0, "network": 0, "production": 0}:
        raise ContractError("external-call boundary drift")
    if report.get("execution_trace", {}).get("predictor_process_invocations") != 1:
        raise ContractError("predictor must run exactly once")
    if report.get("execution_trace", {}).get("predictor_input_truth_field_count") != 0:
        raise ContractError("truth leaked into predictor")
    if report.get("metrics", {}).get("supported_positive", {}).get("denominator") != 5:
        raise ContractError("supported-positive denominator drift")
    if report.get("metrics", {}).get("open_set", {}).get("denominator") != 16:
        raise ContractError("open-set denominator drift")
    if report.get("contamination_boundary", {}).get("tuning_image_sha_overlap_count") != 0:
        raise ContractError("tuning overlap is nonzero")
    expected_hash = report.get("report_sha256")
    payload = dict(report)
    payload.pop("report_sha256", None)
    if expected_hash != stable_hash(payload):
        raise ContractError("report self-hash drift")


def run(repo_root: Path, output_json: Path, output_md: Path) -> dict[str, Any]:
    for path, expected in EXPECTED_FILE_SHA256.items():
        if path == str(FROZEN_VALIDATION_TRUTH):
            # The exact expected digest is frozen in source, but the file itself
            # is not opened until after the predictor child has exited.
            continue
        assert_file_hash(Path(path), expected)
    assert_file_hash(repo_root / RETROSPECTIVE_TUNING_REPORT_RELPATH, RETROSPECTIVE_TUNING_REPORT_SHA256)
    if output_json.exists() or output_md.exists():
        raise ContractError("single-shot output already exists; rerun is forbidden")

    with tempfile.TemporaryDirectory(prefix="product-mark-validation21-") as temp_value:
        temporary_root = Path(temp_value)
        resolved_images = build_image_only_inputs(repo_root, temporary_root)
        raw_prediction, execution_trace = run_frozen_predictor(
            repo_root, temporary_root, resolved_images
        )

        # The Validation truth packet is first opened here, after the predictor
        # has exited and its prediction artifact has been hashed.
        rows, metrics, truth_unsealed_at = score_after_unseal(
            raw_prediction, resolved_images
        )

    tuning_report = load_json(repo_root / RETROSPECTIVE_TUNING_REPORT_RELPATH)
    tuning_hashes = {str(row.get("image_sha256", "")) for row in tuning_report.get("rows", [])}
    current_hashes = {row["front_sha256"] for row in rows}
    overlap = sorted(tuning_hashes & current_hashes)
    if overlap:
        raise ContractError("untouched Validation overlaps tuning images")

    driver_path = Path(__file__).resolve()
    report: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "run_id": RUN_ID,
        "generated_at": GENERATED_DATE,
        "scope": "UNTOUCHED_FROZEN_VALIDATION_PRODUCT_FIELD_SINGLE_SHOT",
        "gate": {
            "status": "FIELD_SENSOR_EVIDENCE_ONLY",
            "title_accuracy_85_proven": False,
            "production_ready": False,
        },
        "external_calls": {"provider": 0, "network": 0, "production": 0},
        "holdout": {
            "consumed": False,
            "io_count": 0,
            "note": "Only the frozen split manifest and Validation packet were opened.",
        },
        "execution_trace": {
            **execution_trace,
            "truth_unsealed_at": truth_unsealed_at,
            "prediction_generated_before_truth_unsealed": (
                execution_trace["prediction_completed_at"] <= truth_unsealed_at
            ),
        },
        "cohort_contract": {
            "selection_policy": (
                "All frozen Validation items with Product reviewed_status=CONFIRMED and a "
                "locally readable front whose bytes match the frozen local index hash; no "
                "selection used a sensor prediction."
            ),
            "frozen_assignment_id": "v4-oracle-dev173-val37-holdout45-20260723",
            "validation_split_size": 37,
            "evaluation_item_count": len(rows),
            "supported_positive_count": 5,
            "open_set_count": 16,
            "item_ids": [row["item_id"] for row in rows],
            "item_front_sha256": [
                [row["item_id"], row["front_sha256"]] for row in rows
            ],
            "cohort_fingerprint_sha256": stable_hash(
                [[row["item_id"], row["front_sha256"]] for row in rows]
            ),
        },
        "input_fingerprints": {
            "frozen_split_manifest": {
                "path": str(FROZEN_SPLIT_MANIFEST),
                "sha256": EXPECTED_FILE_SHA256[str(FROZEN_SPLIT_MANIFEST)],
            },
            "validation_truth": {
                "path": str(FROZEN_VALIDATION_TRUTH),
                "sha256": EXPECTED_FILE_SHA256[str(FROZEN_VALIDATION_TRUTH)],
                "truth_field": "reviewed_ground_truth.fields.product",
                "required_status": "CONFIRMED",
            },
            "local_image_indexes": [
                {"path": str(path), "sha256": EXPECTED_FILE_SHA256[str(path)]}
                for path in SOURCE_INDEXES
            ],
            "frozen_evaluator": {
                "path": str(repo_root / FROZEN_EVALUATOR_RELPATH),
                "sha256": FROZEN_EVALUATOR_SHA256,
            },
            "official_reference_manifest": {
                "path": str(repo_root / FROZEN_REFERENCE_RELPATH),
                "sha256": FROZEN_REFERENCE_SHA256,
            },
            "evaluation_driver": {
                "path": str(driver_path),
                "sha256": sha256_file(driver_path),
            },
        },
        "evaluator_contract": {
            "sensor_version": raw_prediction.get("schema_version"),
            "prediction_profile": FROZEN_PREDICTION_PROFILE,
            "target_max_dimension": FROZEN_TARGET_MAX_DIMENSION,
            "thresholds": FROZEN_THRESHOLDS,
            "algorithm": raw_prediction.get("sensor", {}).get("algorithm"),
            "ratio_threshold": raw_prediction.get("sensor", {}).get("ratio_threshold"),
            "ransac_reprojection_threshold_px": raw_prediction.get("sensor", {}).get(
                "ransac_reprojection_threshold_px"
            ),
        },
        "contamination_boundary": {
            "untouched_relative_to": "PRODUCT_MARK_SENSOR_THRESHOLD_AND_RESIZE_TUNING",
            "tuning_report_path": str(repo_root / RETROSPECTIVE_TUNING_REPORT_RELPATH),
            "tuning_report_sha256": RETROSPECTIVE_TUNING_REPORT_SHA256,
            "tuning_image_count": len(tuning_hashes),
            "tuning_image_sha_overlap_count": len(overlap),
            "tuning_image_sha_overlap": overlap,
            "limitation": (
                "Untouched is specific to product-mark sensor calibration. These Validation "
                "images may have appeared in unrelated historical system evaluations."
            ),
        },
        "metrics": metrics,
        "rows": rows,
        "claim_boundary": {
            "evaluates": "Product field sensor only",
            "does_not_evaluate": [
                "full SEM",
                "title token recall",
                "80-character Renderer output",
                "end-to-end writer-visible latency",
                "production behavior",
            ],
            "title_accuracy_85_claim_allowed": False,
        },
    }
    report["report_sha256"] = stable_hash(report)
    verify_report(report)

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_md.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    output_md.write_text(markdown_report(report), encoding="utf-8")
    return report


def self_test() -> None:
    assert canonical_truth_product("Panini Donruss Optic") == "PANINI_DONRUSS_OPTIC"
    assert canonical_truth_product("Panini Prizm FIFA Soccer") == "PANINI_PRIZM"
    assert canonical_truth_product("Topps Chrome") == "OTHER_PRODUCT"
    assert len(FROZEN_COHORT) == len(set(FROZEN_COHORT)) == 21
    assert len({item_id for item_id, _ in FROZEN_COHORT}) == 21
    print("product-mark Validation-21 contract self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-json")
    parser.add_argument("--output-md")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--verify-report")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if args.verify_report:
        verify_report(load_json(Path(args.verify_report)))
        print("product-mark Validation-21 report verification passed")
        return
    if not args.output_json or not args.output_md:
        parser.error("--output-json and --output-md are required for the single run")
    repo_root = Path(__file__).resolve().parent.parent
    report = run(repo_root, Path(args.output_json).resolve(), Path(args.output_md).resolve())
    print(
        json.dumps(
            {
                "output": str(Path(args.output_json).resolve()),
                "status": report["gate"]["status"],
                "metrics": report["metrics"],
                "report_sha256": report["report_sha256"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
