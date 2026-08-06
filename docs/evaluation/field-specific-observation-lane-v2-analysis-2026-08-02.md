# Field-specific observation lane v2：fresh150 信息增益与最小合约

## 决策

先接受反方观点：v1 的四数组和 7 行容量不是最大信息增益，而是给尚未出现的噪声预留输出。85 个 bare 正确增量中，38 个已经在 canonical fields，应该由 Composer/SEM 取回；真正需要同次 observation 捕获的只有 **47 个词次、39 个完整短语、30 张卡**。每张最多 **2** 个目标短语，所以 v2 的理论最优硬上限是一个统一数组、最多两行。

结论是 **GO_TO_PAIRED_FRESH150_EXPERIMENT_ONLY / STOP_PRODUCTION**。v2 只有捕获权限，没有 canonical、Composer 或持久化权限；同次调用是否真的捕获这些短语、以及 schema 是否干扰 canonical，仍必须用 fresh150 配对实验验证。

## 85 个增量的互斥分解

| 互斥角色 | 词次 |
|---|---:|
| downstream_existing | 38 |
| identity_phrase | 30 |
| finish_phrase | 10 |
| commercial_marker | 6 |
| exact_code | 1 |

这五类严格合计 85。`downstream_existing` 不进入 observation lane；其余四类合计 47。

| v2 角色 | 词次 | 卡数 | 完整短语 | exhaustive 另一次调用再现 | label oracle ΔF1 | 再现子集 oracle ΔF1 | 全追加时 >80 卡数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| identity_phrase | 30 | 20 | 22 | 21/30 (70.0%) | +0.013068 | +0.008823 | 5 |
| finish_phrase | 10 | 9 | 10 | 2/10 (20.0%) | +0.004263 | +0.000823 | 2 |
| commercial_marker | 6 | 5 | 6 | 4/6 (66.7%) | +0.002294 | +0.001583 | 2 |
| exact_code | 1 | 1 | 1 | 1/1 (100.0%) | +0.000342 | +0.000342 | 0 |

四类合并的 label oracle 是 **0.787481**，相对 canonical **+0.019718**；全部短语直接追加会让 7 张超过 80 字符，80 字符内逐卡选取的不可部署 oracle 仍为 **0.783138**，增量 **+0.015374**。

只取 exhaustive 在另一提示中重新表达的词，oracle 增量是 **+0.011572**。它比全 47 词上限更保守，但仍不是 same-call 捕获率。

## 为什么硬上限是两行

| 每卡允许行数 | 覆盖完整短语 | 总短语 |
|---:|---:|---:|
| 1 | 30 | 39 |
| 2 | 39 | 39 |

v1 最多 7 行，其中 identity 2、marker 2、serial 1、parallel 2。实证目标没有任何卡需要第三行；v1 每卡多预留 5 行，而且 stamped-serial 专槽没有覆盖本批唯一的 exact-code 目标。

## v1 覆盖缺口与 v2 最小变化

v1 schema 理论可容纳 46/47 个目标词，但 prompt 明确覆盖只有 **30/47（63.8%）**。主要缺口来自它主动排除 subject/team、没有 season/year、只给 serial 数字槽，以及未明确 Redemption/VMAX。

| v1 未覆盖字段/角色 | 词次 |
|---|---:|
| search_optimization | 5 |
| year | 5 |
| subject | 4 |
| commercial_marker | 2 |
| card_number | 1 |

v2 只做六个变化：统一 max-2 数组；显式互斥 role；允许完整 subject/team/city/character/season phrase；marker 补 Redemption/VMAX；serial 专槽改为零权限 exact-code；任何词已被 canonical fields 全覆盖的候选直接丢弃。世界知识仍被禁止，visual_pattern 只允许 finish。

## 污染风险：候选可以留，不能直接发

下面用全 150 张 bare-derived phrase candidates 做压力代理。它故意比 v2 目标宽，作用是估算“如果捕获后误 admission”会发生什么。

| 角色 | 候选数 | fully exact | full-token非连续 | partial | unsupported | token 支持率 | identity 冲突 | 数字风险候选 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| identity_phrase | 318 | 59 | 2 | 56 | 201 | 28.2% | 26 | 77 |
| finish_phrase | 50 | 19 | 5 | 10 | 16 | 57.9% | 0 | 0 |
| commercial_marker | 77 | 14 | 1 | 16 | 46 | 24.2% | 2 | 16 |
| exact_code | 57 | 3 | 0 | 0 | 54 | 5.3% | 0 | 54 |

因此理论 F1 上限不是准入预期。v2 parser 永远返回空 `field_updates` 和空 `admission_proposals`；候选只能进入离线 resolver。

## 请求与输出成本

| 合约 | prompt Δbytes | schema Δbytes | request Δbytes | 两行最大 JSON bytes | 约算输出 tokens |
|---|---:|---:|---:|---:|---:|
| v1 四数组/7行 | 977 | 1430 | 2428 | — | — |
| literal v2/max2 | 889 | 505 | 1415 | 318 | 80 |
| PSP hypothesis/max2 | 683 | 510 | 1211 | 471 | 118 |

字节只是静态合约成本；真实 input/output tokens 与 latency 必须由配对云端实验测量。

## Product / Set / Parallel 两项 hypothesis 候选

状态：**HOLD_SEPARATE_ARM_NOT_DEFAULT**，不进入 literal v2 默认 schema。

严格按 85 词账本，它能瞄准 16 个词、12 张卡，label oracle 增量 **+0.00696**；相对 literal v2 的独有已测目标是 **0**。也就是说，在当前账本内 literal observation 严格覆盖它的全部已知收益。

但它可能靠 model knowledge 补出 bare/exhaustive 都没表达的 product/set/parallel，这个主张现有账本无法证伪。已有 candidate-v4 的前两项 hypothesis 只能作为风险代理：274 个候选中，完整命中 reference 只有 7 个，部分命中 267 个；token 支持率 61.1%。因此它只能是**独立 treatment arm**，且必须先由 world support-only ranker 通过零调用门；不能和 literal v2 混在一个 schema 中，否则无法归因。

## Slab certificate anchor：明确 DEFER

状态：**DEFER_NO_VERIFIED_REGISTRY_COVERAGE**。它不占 literal v2 的两行、不进入默认 schema，也不增加本轮 paid arm。

exhaustive fresh150 在 37/150 张卡上读到唯一 7–12 位 `certification_number`，冲突 0；这些卡当前 F1 已是 0.865142。把这些卡其余 71 个缺失标题词全部恢复的标签 oracle 是 **+0.018012**，把 37 张全部变成满分的上限是 **+0.033265**。这两项恢复的不是证书号本身，因此不能当作 Registry 命中预测。

本地只证明了 `cert_registry` schema 与旧 V4 exact lookup seam 存在；没有 seed/insert，也没有 live row coverage 证据。现在把字段塞进 same-call schema 只会增加请求成本并与更有实证的 literal phrase 竞争，长期期望值为负。

若覆盖门以后通过，唯一允许的独立可选形状是 `slab_anchor={grader, certification_number, region=slab_label, basis=printed_text}`；只做 `(grader, cert_number)` exact lookup，结果仍是 candidate-only，当前图像冲突必须转 `REVIEW_REQUIRED`。在此之前不实现合同、不调用 Registry、不扩 fresh150。

## fresh150 最小实验

最低成本、能回答 literal v2 是否正资产的设计是 300 次调用：

1. shared control：同一批 150 的 canonical high；
2. treatment L：同一响应 canonical high + literal v2；
3. 两臂必须同 model、none effort、high detail、图像、顺序和并发配置；运行前断言 request bytes 不同。

若要同时保留未证伪的 hypothesis 问题，则增加独立 treatment H，总计 450 次调用；H 不能与 L 合并。它先通过 world ranker 的 candidate-value 不变、hard reject=0、source-order 排序增益门。

literal v2 的通过门：至少 8 张目标卡被捕获；冻结 label 上 resolver-oracle 至少 +0.003；canonical projection 无任何 critical numeric/subject/product mutation 且 aggregate 不退化；报告 token、latency p50/p95；全程单次模型调用和零自动 admission。

## Contract 与逐短语账本

- literal v2 contract：`experiments/accuracy/field-specific-observation-lane-v2.mjs`
- 独立 hypothesis contract：`experiments/accuracy/product-set-parallel-hypothesis-lane-v1.mjs`
- contract test：`scripts/field-specific-observation-lane-v2.test.mjs`
- 本分析：`scripts/analyze-field-specific-observation-lane-v2.mjs`
- 输入账本：`docs/evaluation/bare-canonical-complementarity-150-2026-08-02.json`，SHA-256 `74e7360be9aaa8cbe2fe563d12042fd85bedd77694963fe5ed4e7bf41e1a1758`

| asset 后缀 | 角色 | 完整短语 | 目标词 | exhaustive 再现词 | 候选字段 | v1 prompt覆盖 |
|---|---|---|---|---|---|---|
| 04bed0401e6450349141 | identity_phrase | Dolphins | dolphins | — | search_optimization | no |
| 1ab36981fdce86771040 | identity_phrase | Disney | disney | disney | ip_sport | yes |
| 1ab36981fdce86771040 | identity_phrase | Dalmatian | dalmatian | — | subject | no |
| 268055e5845c6ecfcf83 | identity_phrase | 2026 | 2026 | 2026 | year | no |
| 268055e5845c6ecfcf83 | identity_phrase | New York Mets | new york | new york | search_optimization | no |
| 274c5078fce5de006ab1 | identity_phrase | Rookie Ticket | rookie ticket | rookie ticket | card_name | yes |
| 34413231dd0ea69e68a4 | identity_phrase | Rookie | rookie | rookie | card_name | yes |
| 35540f2899f796676dcd | identity_phrase | Splash of Color | splash color | color | card_name | yes |
| 413aa29a2561ee50f989 | identity_phrase | Tennis | tennis | tennis | ip_sport | yes |
| 46be33ef1f2dbc0956af | finish_phrase | Refractor | refractor | — | print_finish | yes |
| 4c8131eeda536c66d385 | commercial_marker | Redemption | redemption | redemption | commercial_marker | no |
| 4cd844c77ea0347c87da | exact_code | 242 | 242 | 242 | card_number | no |
| 522dae554f642f6810eb | commercial_marker | Rookie | rookie | — | commercial_marker | yes |
| 522dae554f642f6810eb | finish_phrase | Refractor | refractor | refractor | print_finish | yes |
| 5edfef737b8f58f5253b | finish_phrase | Orange Refractor | refractor | — | print_finish | yes |
| 64d10f8c8986aa1c9af4 | identity_phrase | SCD | scd | — | subject | no |
| 7059d3b39d01402f0e61 | identity_phrase | VeeFriends | veefriends | veefriends | product | yes |
| 7059d3b39d01402f0e61 | finish_phrase | Refractor | refractor | — | print_finish | yes |
| 7815e1aeda1f8e00dd4e | identity_phrase | VeeFriends | veefriends | veefriends | product | yes |
| 7815e1aeda1f8e00dd4e | finish_phrase | Refractor | refractor | — | print_finish | yes |
| 7c93444e09007eaec82f | identity_phrase | MJx | mjx | — | product | yes |
| 86990bc00f236f49430e | identity_phrase | 2024 25 | 2024 25 | 25 | year | no |
| 8cabcafd0596fbab0bb0 | identity_phrase | Optic | optic | optic | product | yes |
| 9ef085a2c3022091aec0 | identity_phrase | Tennis | tennis | tennis | ip_sport | yes |
| 9ef085a2c3022091aec0 | finish_phrase | Refractor | refractor | — | print_finish | yes |
| a12d7e8c2d623c870df4 | identity_phrase | 2024 | 2024 | — | year | no |
| a4051a222e9be2cf8149 | identity_phrase | Two Tubes | two tubes | two tubes | subject | no |
| a8a73b44f77bf6e823e2 | finish_phrase | Refractor | refractor | — | print_finish | yes |
| b514a8918dbc221a17bd | identity_phrase | Los Angeles Dodgers | los angeles | los angeles | search_optimization | no |
| bc6cd6c49b79324c84d7 | identity_phrase | 2025 | 2025 | 2025 | year | no |
| bcc4e7ac4ac23e1e69d3 | finish_phrase | Refractor | refractor | — | print_finish | yes |
| c1fdabad9da739fc592f | finish_phrase | Common | common | common | print_finish | yes |
| c1fdabad9da739fc592f | finish_phrase | Refractor | refractor | — | print_finish | yes |
| c6ecb08d49256335aa6b | commercial_marker | 1st | 1st | 1st | special_stamp | yes |
| c6ecb08d49256335aa6b | commercial_marker | RC | rc | — | search_optimization | yes |
| dbf99f2a5e722e98b87a | commercial_marker | Rookie | rookie | rookie | commercial_marker | yes |
| e25ba92ef5f8fb4207a0 | commercial_marker | VMAX | vmax | vmax | commercial_marker | no |
| e25ba92ef5f8fb4207a0 | identity_phrase | Trainer Gallery | trainer gallery | — | set | yes |
| f371844dc1d0c6e49f92 | identity_phrase | Star Wars | star wars | star wars | ip_sport | yes |

## 硬边界

- 本次 provider 调用 0，runtime/Production 改动 0。
- reference 只参与离线 oracle 和污染标注，不进入任何 parser、ranker 或选择器。
- literal 与 hypothesis schema 相互独立；没有组合 treatment。
- 任何 candidate 自动进入 CSM、Composer、持久化或生产标题都属于 contract violation。
