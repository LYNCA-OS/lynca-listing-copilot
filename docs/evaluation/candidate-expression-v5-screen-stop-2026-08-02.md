# Candidate expression v5 screen — stop

日期：2026-08-02  
状态：evaluation-only；不接入 CSM/SEM，不进入生产

负向实验源码已在结论确认后删除；checkpoint、报告和本决策记录保留，避免把长期负资产留在运行器里。

## 假设

v4 的输出上限已经是 10 条事实；新增预算不是最小改动。v5 只改提示中的槽位分配：优先保留 product/set/IP、subject/team、year/language、serial/card number、finish/parallel/rarity/attribute；同值去重，并要求对 serial 与 finish 再扫一次；仍使用 v4 的严格 JSON schema、10 facts、3 hypotheses 和 4096 output-token 上限。

## 屏幕设计

- 模型：GPT-5.6 Luna，reasoning `none`
- 图片：`high`
- Cohort：外部开发集同一批 20 张，正好与 v4 fresh screen 配对
- 并发：2
- v4：`artifacts/candidate-expression-v4/fresh-outside-screen-20-2026-08-02/`
- v5：`artifacts/candidate-expression-v5/fresh-outside-screen-20-2026-08-02/`
- 评估器只量表达捕获，不把候选事实提升为 canonical title

## 结果

| 指标 | v4 | v5 | 变化 |
|---|---:|---:|---:|
| cards | 20 | 20 | — |
| expression macro F1 | 0.58602 | 0.58570 | −0.00032 |
| best-hypothesis macro F1 | 0.6567 | 0.5250 | −0.1317 |
| wins / losses / ties（逐卡表达 F1） | — | 12 / 8 / 0 | 方向不稳定 |
| median output tokens | 394 | 333.5 | −60.5 |
| median latency | 8722.5 ms | 8637.5 ms | −85 ms |
| defect cards | 1 | 1 | 无改善 |

逐卡审计显示，v5 在部分卡保住了 `Refractor`、`20/25`、`Auto` 等值，但也把同一产品重复两次、把 `2008` 重复、或用 `FIFA WORLD CUP` 之外的统计语句占用事实槽位；9 号卡的 `Red Sparkle` 反而在 v5 丢失。这不是稳定的“表达增益”。

## 决策

1. v5 停止，不跑 150 张付费确认，不改生产提示或 schema。
2. v5 目录和结果保留，作为负资产证据；后续候选必须先在零成本回放中证明 downstream 不丢参考 token，再考虑付费 150。
3. 继续使用已有的 150-card 回放结果：只保留同时满足 `wins > losses`、`reference_loss_cards = 0`、`over_80 = 0` 且语义边界可解释的窄机制。它们仍是 evaluation-only，直到有真正独立的 150 张 sealed cohort。

证据文件：

- v4：`artifacts/candidate-expression-v4/fresh-outside-screen-20-2026-08-02/expression-report.json`
- v5：`artifacts/candidate-expression-v5/fresh-outside-screen-20-2026-08-02/expression-report.json`
- v5 原始 checkpoint：`artifacts/candidate-expression-v5/fresh-outside-screen-20-2026-08-02/thin-path-gpt-5.6-luna.jsonl`
