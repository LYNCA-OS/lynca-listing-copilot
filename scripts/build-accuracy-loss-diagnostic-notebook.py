#!/usr/bin/env python3
"""Build and execute the reproducible LYNCA accuracy-loss notebook.

The runtime bundle does not ship Jupyter packages, so this script writes a
standards-compliant .ipynb and executes its Python code cells in one shared
namespace using only the standard library. Any failed assertion aborts the
build and leaves no newly written notebook.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import traceback
from pathlib import Path
from textwrap import dedent


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "notebooks" / "accuracy-loss-diagnostic-2026-08-01.ipynb"


def markdown(source: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": dedent(source).strip() + "\n"}


def code(source: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": dedent(source).strip() + "\n",
    }


cells = [
    markdown(
        """
        # LYNCA 识别准确率：损失账户与最小成本增量

        **结论先行。** 在同一批 high-100 卡上，296 个参考标题缺失 token occurrence
        精确拆为 `170 / 73 / 53`。最便宜且证据最强的方向不是把世界知识直接塞进
        视觉 prompt，而是允许同一次模型调用保留更宽的 append-only 证据，再由
        CSM/SEM resolver 分批取得晋升权限。模型表达可以放开；canonical 真值权限
        不能同时放开。

        本 notebook 只读本地、已付费完成的 artifact，不发 provider、Supabase、OCR、
        vector 或 Cloud Run 请求。
        """
    ),
    markdown(
        """
        ## Context & Methods

        - 单位是每卡去重后的 reference token occurrence，不是字段数、短语数或原始词频。
        - `170` 只表示 exhaustive 输出仍未表达，不能据此声称模型“视觉没看见”。
        - 人工审计的 `37` 是事后知道答案的 oracle pool，不是可实现收益预测。
        - paired sign test 只统计胜负卡，忽略平局；发现集上的 p 值仅作描述。
        - 所有输入由 hash manifest 固定；任何漂移都会 fail closed。
        """
    ),
    code(
        """
        import hashlib
        import json
        import math
        import os
        import re
        import statistics
        from pathlib import Path

        production_root = Path(os.environ.get("LYNCA_PRODUCTION_ROOT", "/Users/paidaxin/lynca-thin-production"))
        manifest_path = production_root / "docs/evaluation/accuracy-evidence-manifest-2026-08-01.json"
        manifest = json.loads(manifest_path.read_text())
        source_root = Path(os.environ.get("LYNCA_ACCURACY_EVAL_ROOT", manifest["source_checkout"]["local_root"]))
        roots = {"source_checkout": source_root, "production_checkout": production_root}

        def sha256(path):
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            return digest.hexdigest()

        files = {}
        for item in manifest["artifacts"]:
            path = roots[item["checkout"]] / item["relative_path"]
            assert path.is_file(), f"missing source: {path}"
            actual = sha256(path)
            assert actual == item["sha256"], f"hash drift: {item['id']} {actual}"
            files[item["id"]] = path

        def read_jsonl(path):
            return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

        def mean(rows, key):
            return statistics.fmean(float(row[key]) for row in rows)

        def paired_sign_test(wins, losses):
            n = wins + losses
            if n == 0:
                return 1.0
            tail = sum(math.comb(n, k) for k in range(0, min(wins, losses) + 1)) / (2 ** n)
            return min(1.0, 2 * tail)

        def pearson(xs, ys):
            mx, my = statistics.fmean(xs), statistics.fmean(ys)
            numerator = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
            denominator = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
            return 0.0 if denominator == 0 else numerator / denominator

        print(f"manifest sources verified: {len(files)}")
        print(f"evaluation root: {source_root}")
        """
    ),
    markdown("## Data integrity and the high-100 waterfall"),
    code(
        """
        extreme = read_jsonl(files["extreme-high-100-rows"])
        diagnosis = json.loads(files["extreme-high-100-waterfall"].read_text())
        extreme_by_arm = {}
        for row in extreme:
            extreme_by_arm.setdefault(row["arm"], []).append(row)

        canonical = extreme_by_arm["thin_canonical_high"]
        exhaustive = extreme_by_arm["exhaustive_observation_high"]
        assert len(extreme) == 200 and len(canonical) == len(exhaustive) == 100
        canonical_by_id = {row["asset_id"]: row for row in canonical}
        exhaustive_by_id = {row["asset_id"]: row for row in exhaustive}
        assert len(canonical_by_id) == len(exhaustive_by_id) == 100
        assert canonical_by_id.keys() == exhaustive_by_id.keys()
        assert all(canonical_by_id[k]["reference"] == exhaustive_by_id[k]["reference"] for k in canonical_by_id)

        stages = diagnosis["stages"]
        stage_rows = [
            ("exhaustive_not_expressed", stages["exhaustive_not_expressed"]["token_occurrences"], stages["exhaustive_not_expressed"]["affected_cards"]),
            ("canonical_schema_compression", stages["canonical_schema_compression"]["token_occurrences"], stages["canonical_schema_compression"]["affected_cards"]),
            ("downstream_composition", stages["downstream_composition"]["token_occurrences"], stages["downstream_composition"]["affected_cards"]),
        ]
        assert [row[1] for row in stage_rows] == [170, 73, 53]
        assert sum(row[1] for row in stage_rows) == 296
        assert diagnosis["paired_cards"] == 100

        print("earliest boundary                    occurrences  affected cards  share")
        for label, occurrences, cards in stage_rows:
            print(f"{label:36} {occurrences:11d} {cards:15d} {occurrences/296:7.1%}")
        """
    ),
    markdown("## Results: what exhaustive expression did and did not buy"),
    code(
        """
        canonical_metrics = {key: mean(canonical, key) for key in ("f1", "recall", "precision")}
        exhaustive_metrics = {key: mean(exhaustive, key) for key in ("f1", "recall", "precision")}
        canonical_output = sum(row["output_tokens"] for row in canonical)
        exhaustive_output = sum(row["output_tokens"] for row in exhaustive)
        token_ratio = exhaustive_output / canonical_output

        recovery_counts = [len(row["causes"]["canonical_schema_compression"]) for row in diagnosis["rows"]]
        observation_counts = [row["exhaustive_observation_count"] for row in diagnosis["rows"]]
        observation_recovery_r = pearson(observation_counts, recovery_counts)

        assert abs(canonical_metrics["f1"] - 0.7698022907754876) < 1e-12
        assert (canonical_output, exhaustive_output) == (10788, 149196)
        assert abs(token_ratio - 13.829810901001112) < 1e-12
        assert abs(observation_recovery_r - (-0.0129)) < 0.0001

        print("arm                         F1       recall   precision  output tokens")
        print(f"canonical high       {canonical_metrics['f1']:.6f}  {canonical_metrics['recall']:.6f}  {canonical_metrics['precision']:.6f}  {canonical_output:13,d}")
        print(f"exhaustive title     {exhaustive_metrics['f1']:.6f}  {exhaustive_metrics['recall']:.6f}  {exhaustive_metrics['precision']:.6f}  {exhaustive_output:13,d}")
        print(f"output-token multiplier: {token_ratio:.2f}x")
        print(f"observation count vs useful schema recovery: r={observation_recovery_r:.4f}")
        """
    ),
    markdown("## Manual semantic audit: the raw 73 are not 73 safe fields"),
    code(
        """
        audit_text = files["extreme-high-100-manual-audit"].read_text()
        required_fragments = {
            "direct": "| Direct, correctly scoped, commercially incremental evidence | 37 |",
            "duplicate": "| Exact evidence but already represented by a canonical synonym | 8 |",
            "candidate": "| Plausible but semantically ambiguous | 19 |",
            "collision": "| Wrong-role token collision | 9 |",
            "priority": "| Priority/budget drop | 25 | 16 |",
            "suppression": "| Marketplace suppression | 14 | 12 |",
            "lot": "| Lot grammar has no bracket | 4 | 2 |",
            "normalization": "| Silent normalization | 10 | 10 |",
        }
        assert all(fragment in audit_text for fragment in required_fragments.values())
        semantic_audit = {"direct": 37, "duplicate": 8, "candidate": 19, "collision": 9}
        downstream_audit = {"priority_budget": 25, "marketplace_suppression": 14, "lot_grammar": 4, "silent_normalization": 10}
        assert sum(semantic_audit.values()) == 73
        assert sum(downstream_audit.values()) == 53
        direct_oracle = re.search(r"Audited direct incremental pool\\s*\\|\\s*37\\s*\\|\\s*0\\.791425\\s*\\|\\s*\\+0\\.021623", audit_text)
        assert direct_oracle

        print("raw 73 class                 occurrences  decision")
        print("direct evidence                       37  resolver experiment")
        print("semantic duplicate                     8  retain evidence, do not duplicate title")
        print("candidate only                         19  require catalog/world compatibility")
        print("wrong-role collision                    9  reject promotion")
        print("direct-pool oracle ceiling: +0.021623 F1 (not a forecast)")
        """
    ),
    markdown("## Deterministic Composer recovery already measured"),
    code(
        """
        composer = json.loads(files["composer-recovery-high-100"].read_text())
        composer_148 = json.loads(files["composer-recovery-current-148"].read_text())
        composer_150 = json.loads(files["composer-recovery-old-150"].read_text())
        assert composer["population"] == 100
        assert composer["paired"] == {
            "delta_macro_f1": composer["paired"]["delta_macro_f1"],
            "delta_macro_recall": composer["paired"]["delta_macro_recall"],
            "delta_macro_precision": composer["paired"]["delta_macro_precision"],
            "changed_cards": 12,
            "wins": 9,
            "losses": 0,
            "ties": 91,
            "p_two_sided": 0.00390625,
        }
        assert composer["downstream_53"]["recovered_occurrences"] == 11
        assert composer["safety"]["over_80_characters"] == 0

        print("cohort             baseline   candidate   delta      wins/losses/ties")
        print(f"discovery high100  {composer['baseline']['macro_f1']:.6f}   {composer['candidate']['macro_f1']:.6f}   {composer['paired']['delta_macro_f1']:+.6f}   9/0/91")
        print(f"robustness 148     {composer_148['baseline']['macro_f1']:.6f}   {composer_148['candidate']['macro_f1']:.6f}   {composer_148['paired']['delta_macro_f1']:+.6f}   6/0/142")
        print(f"robustness 150     {composer_150['baseline']['macro_f1']:.6f}   {composer_150['candidate']['macro_f1']:.6f}   {composer_150['paired']['delta_macro_f1']:+.6f}   6/0/144")
        print("remaining downstream occurrences: 42 = 17 priority + 14 suppression + 4 lot + 7 normalization")
        """
    ),
    markdown("## Image detail: this cohort does not contain true full-resolution headroom"),
    code(
        """
        detail_rows = read_jsonl(files["high-vs-original-50-rows"])
        detail_summary = json.loads(files["high-vs-original-50-summary"].read_text())
        dimensions = json.loads(files["high-vs-original-source-dimensions"].read_text())
        detail_by_arm = {}
        for row in detail_rows:
            detail_by_arm.setdefault(row["arm"], []).append(row)
        high = {row["asset_id"]: row for row in detail_by_arm["thin_canonical_high"]}
        original = {row["asset_id"]: row for row in detail_by_arm["thin_canonical_original"]}
        assert len(high) == len(original) == 50 and high.keys() == original.keys()
        assert all(high[k]["reference"] == original[k]["reference"] for k in high)
        assert all(high[k]["input_tokens"] == original[k]["input_tokens"] for k in high)
        deltas = [original[k]["f1"] - high[k]["f1"] for k in high]
        wins = sum(delta > 1e-12 for delta in deltas)
        losses = sum(delta < -1e-12 for delta in deltas)
        ties = len(deltas) - wins - losses
        assert (wins, losses, ties) == (5, 11, 34)
        assert dimensions["summary"]["images_over_2048_long_edge"] == 0
        assert dimensions["summary"]["max_long_edge"] == 1400

        print(f"high F1:     {mean(high.values(), 'f1'):.6f}")
        print(f"original F1: {mean(original.values(), 'f1'):.6f}")
        print(f"original-high paired delta: {statistics.fmean(deltas):+.6f}")
        print(f"original wins/losses/ties: {wins}/{losses}/{ties}; sign p={paired_sign_test(wins, losses):.6f}")
        print(f"source images: {dimensions['images']}; max long edge: {dimensions['summary']['max_long_edge']} px; >2048 px: 0")
        print("decision: keep high for this cohort; test original only on a genuinely larger-source cohort")
        """
    ),
    markdown("## The three different '53' counts"),
    code(
        """
        free_projection = json.loads(files["free-title-csm-projection-150"].read_text())
        free_loss = free_projection["loss_diagnosis"]
        free_stages = free_loss["by_stage"]
        three_53s = {
            "raw_73_affected_cards": stages["canonical_schema_compression"]["affected_cards"],
            "high100_downstream_token_occurrences": stages["downstream_composition"]["token_occurrences"],
            "free_title_to_csm_losing_cards": free_loss["loss_rows"],
        }
        assert set(three_53s.values()) == {53}
        assert [(name, row["lost_token_occurrences"]) for name, row in free_stages.items()] == [
            ("parser", 50),
            ("admission_filter", 15),
            ("marketplace_profile", 17),
            ("budget_drop", 2),
            ("composer_normalization", 3),
        ]

        print("53 cards: raw 73 schema omissions touched 53 cards")
        print("53 occurrences: canonical had evidence but Composer omitted 53 token occurrences")
        print("53 cards: free title -> CSM projection lost on 53 of 150 cards")
        print("free-title projection stages (cards may overlap):")
        for name, row in free_stages.items():
            print(f"  {name:24} {row['affected_rows']:2d} cards / {row['lost_token_occurrences']:2d} occurrences")
        """
    ),
    markdown("## Cost-optimal first holdout: 50 cards outside the high-100 audit"),
    code(
        """
        canonical_v3 = [row for row in read_jsonl(files["canonical-v3-150-rows"]) if row["arm"] == "thin_canonical"]
        audited_ids = set(canonical_by_id)
        audited_v3 = [row for row in canonical_v3 if row["asset_id"] in audited_ids]
        holdout_v3 = [row for row in canonical_v3 if row["asset_id"] not in audited_ids]
        assert len(canonical_v3) == 150 and len(audited_v3) == 100 and len(holdout_v3) == 50
        assert not ({row["asset_id"] for row in audited_v3} & {row["asset_id"] for row in holdout_v3})

        def grammar_counts(rows):
            return {name: sum(row.get("grammar") == name for row in rows) for name in ("standard", "lot", "tcg")}

        print("cohort      n   baseline F1  mean ref chars  mean title chars  grammar std/lot/tcg  serial stated")
        for name, rows in (("audited100", audited_v3), ("holdout50", holdout_v3)):
            grammar = grammar_counts(rows)
            serial = sum(bool((row.get("fields") or {}).get("serial")) for row in rows)
            print(f"{name:10} {len(rows):3d}   {mean(rows, 'f1'):.6f}       {statistics.fmean(len(row['reference']) for row in rows):6.2f}          {statistics.fmean(len(row['title']) for row in rows):6.2f}       {grammar['standard']}/{grammar['lot']}/{grammar['tcg']}             {serial}")
        print("caveat: this is the unused remainder of an ordered corpus, not a randomized stratified sample")
        """
    ),
    markdown(
        """
        ## Takeaways and experiment ladder

        1. **Keep the current deterministic Composer recovery.** It is the only measured,
           zero-provider-cost positive asset here: `+0.0027–+0.0057`, no measured losses.
        2. **Open expression before promotion.** Add a bounded, same-call, append-only evidence
           lane for exact spans, region/source, and uncertainty. Do not reuse the old resolver
           that trusted model-authored roles.
        3. **Attach a high-precision resolver.** Start with printed/slab-anchored product/IP,
           explicit `1st`/Jersey/Redemption evidence, and lossless current-copy serial rendering.
           Measure control vs treatment on an independent paired 100-card holdout.
        4. **Use world knowledge as a compatibility graph, not an answer generator.** Player–team–
           year, manufacturer–product–set–year, and checklist enumerations may reject or rank an
           observed candidate; they may not overwrite card-visible evidence.
        5. **Then test selective visual increments.** One-call targeted crops for serial/code/year/
           product precede any second call. `original` should be retested only with source images
           above 2048 px.

        **Promotion gate:** report per-card and per-field wins/losses, false-role promotion,
        critical year/product errors, 80-character effects, token/latency/cost, and rollback.
        Full exhaustive runtime, generic web search, broad world-knowledge prompt injection,
        and global second calls remain rejected long-term assets.
        """
    ),
]


notebook = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3"},
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}


namespace = {"__name__": "__notebook__"}
execution_count = 0
for cell in notebook["cells"]:
    if cell["cell_type"] != "code":
        continue
    execution_count += 1
    stdout = io.StringIO()
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stdout):
            exec(compile(cell["source"], f"<cell-{execution_count}>", "exec"), namespace)
    except Exception:
        stdout.write(traceback.format_exc())
        raise
    cell["execution_count"] = execution_count
    value = stdout.getvalue()
    if value:
        cell["outputs"] = [{"name": "stdout", "output_type": "stream", "text": value}]

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
temporary = OUTPUT.with_suffix(".ipynb.tmp")
temporary.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n")
temporary.replace(OUTPUT)
print(f"executed {execution_count} code cells -> {OUTPUT}")
