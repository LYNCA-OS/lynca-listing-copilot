# Image Detail High vs Auto, 10-Card Paired Blind Test

GitHub Actions run: [29406307603](https://github.com/LYNCA-OS/lynca-listing-copilot/actions/runs/29406307603)

## Test contract

- Same 10 seeded-random eBay cards in both arms.
- Seller titles were sealed until scoring and were never sent to recognition.
- Same production deployment, GPT-5 mini model, prompt mode, priority service tier,
  concurrency 2, and disabled identity cache.
- The only intended provider input difference was image detail: `high` vs `auto`.
- Seller-title policy score is a weak diagnostic label, not reviewed SEM ground truth.

## Result

| Metric | High | Auto |
| --- | ---: | ---: |
| Completed | 10/10 | 10/10 |
| Technical failures | 0 | 0 |
| Weak policy score average | 0.735871 | 0.643371 |
| Grade reference preservation | 3/5 (60%) | 2/5 (40%) |
| Run wall time | 59.539s | 78.999s |
| Completed cards/minute | 10.08 | 7.60 |
| Writer-ready p50 | 28.349s | 19.020s |
| Writer-ready p95 | 48.170s | 65.772s |
| Provider p50 | 7.526s | 6.858s |
| Provider p95 | 11.587s | 35.199s |
| Total tokens | 72,411 | 79,786 |

Relative to `high`, `auto` produced one weak-label recovery, five regressions,
and four no-change outcomes. It improved median latency but made tail latency,
batch throughput, token use, grade preservation, and overall weak-label quality
worse.

## Field presence

| Field | High | Auto |
| --- | ---: | ---: |
| Year | 90% | 80% |
| Manufacturer | 90% | 70% |
| Product | 100% | 90% |
| Set | 100% | 100% |
| Subject | 100% | 80% |
| Card name | 80% | 90% |
| Surface color | 40% | 0% |
| Print-run numerator/denominator | 50% | 40% |
| Grade company | 30% | 40% |
| Card grade | 30% | 30% |
| Auto grade | 20% | 10% |

## Decision

Keep `high` as the production default. `auto` remains available only as an
explicit evaluation override. The result is directional rather than a formal
SEM accuracy claim because the 10 cards use sealed seller titles as weak labels.
The paired evidence is nevertheless strong enough to reject `auto` as the
default under the product priority of accuracy first, throughput second, and
tail stability third.

Full paired output:
`data/eval/image-detail-ablation/high-vs-auto-10-20260715.json`.
