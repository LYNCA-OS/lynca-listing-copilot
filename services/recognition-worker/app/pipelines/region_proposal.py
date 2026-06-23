from __future__ import annotations

from typing import Any


REGION_TEMPLATES = {
    "serial_number": (0.58, 0.72, 0.96, 0.93),
    "collector_number": (0.02, 0.72, 0.42, 0.96),
    "checklist_code": (0.02, 0.72, 0.45, 0.96),
    "grade_label": (0.05, 0.0, 0.95, 0.22),
    "year_product": (0.0, 0.0, 1.0, 0.22),
    "subject": (0.0, 0.18, 1.0, 0.55),
    "parallel": (0.0, 0.0, 1.0, 1.0),
    "card_type": (0.0, 0.0, 1.0, 0.3),
    "back_text": (0.0, 0.0, 1.0, 1.0),
}


def _rect_polygon(width: int, height: int, template: tuple[float, float, float, float]) -> list[list[int]]:
    x1, y1, x2, y2 = template
    return [
        [round(width * x1), round(height * y1)],
        [round(width * x2), round(height * y1)],
        [round(width * x2), round(height * y2)],
        [round(width * x1), round(height * y2)],
    ]


def propose_regions_for_rectified_card(
    requested_fields: list[str],
    rectified_size: list[int] | tuple[int, int],
    image_id: str = "image",
) -> list[dict[str, Any]]:
    width = int(rectified_size[0]) if rectified_size else 0
    height = int(rectified_size[1]) if rectified_size and len(rectified_size) > 1 else 0
    if width <= 0 or height <= 0:
        return proposed_regions(requested_fields)

    regions = []
    for field in requested_fields:
        template = REGION_TEMPLATES.get(field, (0.0, 0.0, 1.0, 1.0))
        regions.append({
            "region_id": f"{image_id}_{field}",
            "region_type": field,
            "polygon": _rect_polygon(width, height, template),
            "proposal_confidence": 0.55 if field in REGION_TEMPLATES else 0.25,
            "source": "rectified_card_template_r2",
        })
    return regions


def proposed_regions(requested_fields: list[str]) -> list[dict[str, Any]]:
    return [
        {
            "region_id": f"region_{field}",
            "region_type": field,
            "polygon": [],
            "proposal_confidence": 0,
            "source": "contract_placeholder",
        }
        for field in requested_fields
    ]
