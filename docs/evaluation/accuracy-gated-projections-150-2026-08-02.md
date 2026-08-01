# 150 卡自由表达窄投影回放（2026-08-02）

这是零供应商成本的回放，不是新的付费请求。输入是同一批 150 张卡的 `thin_budgeted` 与 `thin_canonical_high` 配对结果，另取已落盘的 exhaustive 观察用于序号保护。脚本是 [analyze-accuracy-150-gated-projections.mjs](/Users/paidaxin/lynca-thin-path/scripts/analyze-accuracy-150-gated-projections.mjs)，规则已沉淀到 [accuracy-mechanism-bundle-v1.mjs](/Users/paidaxin/lynca-thin-path/lib/listing/thin/accuracy-mechanism-bundle-v1.mjs)。两者都只做评估，不被生产 thin path 导入。

## 结论

“把自由标题解析出的字段全部合并回 canonical”不成立。它会把模型的错误产品、错误颜色、错误 RC 和不相容 card name 一起提升为标题事实。

当前唯一值得攒入真实 150 卡确认批次的是六个很窄的、可回滚的机制：

1. canonical 只有纯 `surface_color`，没有 `parallel_family`，自由表达明确给出同颜色加受限 finish family（如 `Orange Refractor`、`Blue Wave`）时，只扩展 `print_finish`，不覆盖既有 exact/family。
2. 已有的单数字序号保护：只把 `8/25` 的观察形式 `08/25` 保留为候选，不把 `29/199` 改成 `029/199`。
3. 自由表达明确给出 `SAR`，且 canonical 的 descriptive rarity 为空时，才添加 `SAR`。
4. TCG 自由表达逐字出现 `Trainer Gallery`，且 card name 为空时，才补这个明确的 card name。
5. Bowman 产品/套组上下文中自由表达逐字出现 `1st Bowman`，且 descriptive rarity 为空时，才补这个明确标记。
6. 只有 CSM 已识别的常见 manufacturer（Topps、Panini、Upper Deck、Leaf）作为前缀，且自由 product 是 canonical product 的严格扩展时，才补完整 product；未知 manufacturer 不扩展。

六者叠加在这批回放上合计 8 胜、0 负、142 平，宏平均 F1 增益约 `+0.004727`。这只是筛选信号，不是生产收益证明：改动卡数很少，必须用新的真实 150 卡确认；在此之前不进生产。

## 门禁结果

| 机制 | 改动卡 | 胜 | 负 | 平 | Δ macro-F1 | 决定 |
|---|---:|---:|---:|---:|---:|---|
| finish family + 纯颜色 | 2 | 2 | 0 | 148 | +0.000936 | REPLAY_CANDIDATE |
| 单数字序号保护 | 2 | 2 | 0 | 148 | 约 +0.00103 | REPLAY_CANDIDATE |
| `SAR` only | 1 | 1 | 0 | 149 | +0.000246 | REPLAY_CANDIDATE |
| `Trainer Gallery` 明示 | 1 | 1 | 0 | 149 | +0.000963 | REPLAY_CANDIDATE |
| `1st Bowman` 明示 | 1 | 1 | 0 | 149 | +0.000386 | REPLAY_CANDIDATE |
| 常见 manufacturer 的 product 扩展 | 2 | 2 | 0 | 148 | +0.001377 | REPLAY_CANDIDATE |
| 六机制叠加 | 8 | 8 | 0 | 142 | +0.004727 | REPLAY_CANDIDATE |
| 空 product 全量补回 | 2 | 1 | 1 | 148 | +0.000312 | STOP |
| product 两词扩展 | 3 | 2 | 1 | 147 | +0.000966 | STOP |
| 短 card_name 全量补回 | 4 | 1 | 3 | 146 | −0.001213 | STOP |
| RC 全量补回 | 22 | 3 | 19 | 128 | −0.004464 | STOP |
| `SSP` 全量补回 | 5 | 2 | 3 | 145 | −0.000172 | STOP |
| `SP` 全量补回 | 4 | 0 | 4 | 146 | −0.001067 | STOP |

脚本输出的逐卡 ledger 保留每张改动卡的 before/after、F1 delta、reference token loss 和 80 字符安全标记；任何负收益、参考词丢失或超长都会自动标为 STOP。

## 为什么不把 exhaustive 观察直接接生产

exhaustive 只证明模型在另一种输出约束下曾经表达过某些词，不证明这些词的语义角色正确。它仍混有统计表、职业经历、版权行、背景颜色和错误的 parallel 名称。因此它可以用于发现候选机制和做离线回放，不能作为生产第二次调用或隐式检索旁路。

## 晋级门

- 先用这六个窄机制形成一个隔离实验 arm；不改默认生产 Composer。
- 新的真实 150 卡必须逐卡比较，至少保留 wins/losses/ties、F1、recall、precision、长度、参考词丢失、输入/输出 tokens、延迟和成本。
- 只要出现任何参考词丢失、超 80、或逐卡负收益未被机制设计明确解释，整批 STOP，回退到当前生产主干。
- 只有真实 150 卡独立确认正收益后，才讨论生产晋级。

当前 reviewed-title 图像集共 255 张：本次 development 150 已被用于候选发现，独立 reserve
只有 55 张，另有 50 张未形成完整的 150 张新 cohort。因此现在不重复付费跑同一批 150，
也不把 55/50 的小批次冒充确认结论；下一次真实确认应先补齐一套新的 150 张 label-blind
样本。
