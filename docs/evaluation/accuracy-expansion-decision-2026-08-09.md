# Accuracy expansion decision — 2026-08-09

## Executive decision

反方先成立：当前最危险的动作不是“束缚太多所以继续全面放开”，而是把模型的自由表达、字段准入、标题展示和评价尺子一起改动。那样即使 F1 上升，也无法知道收益来自哪里，更无法发现 CSM/SEM 已经受损。

本轮建议停在两个清晰边界：

1. **提交已确定的显示层正资产。** `exact_parallel_color_compaction` 已通过真实 Production finisher 的 150 张零调用回放：Macro F1 `0.780305 → 0.780613`，`1W/0L/149T`；canonical fields 字节变化、新 drop、截断、reference loss、unbacked token、numeric mutation、超 80 字符全部为 0。运行时代码提交为 `a9c30baf`。
2. **不把 wide residual v3 推进 Production。** 它在 paid35 上有 `+0.007107`、`4W/0L/31T`，但只有 4 个标题胜例，p50 latency `+29.9%`，而且 3 个胜例依赖 Production 当前并不存在的 `1st Bowman` residual phrase。宽 schema 是有信号的实验，不是已验证的生产资产。

下一轮是否扩范围，由本报告后的独立授权决定；本轮不再发付费请求。

## 为什么不能只看 F1

F1 是 Writer 标题 token 的兼容指标，不是事实准确率。它有三个结构性盲点：

- 字段角色错了但标题 token 相同，F1 看不见；
- Manufacturer/Product 去重后标题不变，CSM Product 丢失，F1 仍看不见；
- 编号、限编、评级等 critical fact 的一次错误，可能被大量普通 token 稀释。

新评价顺序必须是：

1. **Critical factual safety**：subject、year、product/set、card number、serial、grading 等关键事实错误为 0；
2. **Typed CSM/SEM accuracy**：逐字段 precision、recall、required-missing、wrong-role、canonical field fidelity；
3. **Title factual utility**：事实覆盖、reference-token loss、unbacked additions、numeric mutation、grammar、80 字符和 drop ledger；
4. **Operational Pareto**：provider failures/retries、input/output tokens、p50/p95 latency；
5. **Legacy F1**：只保留作趋势兼容和定位，不单独授权上线。

## 已验证结果的无巨细拆分

### 1. 可提交：exact parallel color compaction

机制只在以下条件同时满足时工作：

- canonical `surface_color` 是 `parallel_exact` 的完整 token；
- baseline 确实因为 80 字符预算丢了 `print_finish`；
- compact 后恢复该 bracket；
- 没有新增 drop、没有截断、标题仍不超过 80。

它不修改 CSM/SEM，只改变 Composer 的工作副本。Composer 已从 v1 升为可执行 v2；历史 v1 记录、Glass Box、人工 review 与跨部署 checkpoint 继续按 v1 回放，不会被今天的规则重写。

### 2. 有信号但不可提交：wide residual v3

paid105 是 35 张 × A/B/C：A/B 为 byte-identical canonical controls，C 只增加 residual schema。105 次全部完成、0 retry、0 failure。

- Resolver utility：`+0.007107`，`4W/0L/31T`；
- 三个标题胜例：printed `1st Bowman`；
- 一个标题胜例：slab `AUTO-RED REFRACTOR` 恢复 `Red`；
- 另外两个 field applications 标题不变；
- wide capture：31/35 cards、71 rows，但只有 6 cards 被 resolver 应用；
- canonical interference：均值基本为 0，未证明 schema 能提高模型本体；
- p50 latency：`5450ms → 7079ms`，ratio `1.299`；
- output tokens p50：约 `+76.6%`；
- A/B self-jitter：标题完全一致仅 18/35，fields 完全一致仅 5/35。

结论：模型确实看到了有价值的额外文字，但 wide schema 让它输出太多低价值 rows。瓶颈已从“有没有表达”变成“如何只表达最高价值的一条，并在下游安全路由”。

## 下一轮最值得扩的方向

### Priority A — same-call `residual_printed_phrase`

只在现有 Luna 同一次调用里增加一个 nullable string，最多复制一条完整卡面原文；不增加第二次模型调用，也不让它直接写 canonical authority。

后置 resolver 只做三种 source-only 路由：

- exact printed marker，例如 `1st Bowman`；
- 有 canonical finish 证据佐证的完整 finish phrase；
- 对现有 Product 的严格 token 超集，例如 `Chrome → Topps Chrome`。

模糊短语只保留为 observation，**不应用到字段**。当前 zero-call adapter replay 可保留 wide-v3 的 35/35 titles 和 35/35 canonical fields；这只证明压缩适配器，不证明模型在 compact schema 下仍能捕获。

下一轮最低有效付费设计已算为 **105 calls**：

- 70 张 compact treatment，用于测 within-response resolver utility；
- 其中固定 35 张增加 contemporaneous canonical control，用于测 schema interference 与 latency；
- 70 treatment + 35 control = 105；
- c1、Singapore Preview、0 automatic retry、attempt-before-call durable ledger；
- 预期胜率沿用 development `4/35`，70 张达到至少 6 wins 的概率约 `82.5%`；6W/0L 的 two-sided exact sign p=`0.03125`。

通过门：

- typed critical errors、field regressions、reference loss、unbacked additions、numeric mutation全部为 0；
- resolver `ΔF1 ≥ +0.003`、至少 `6W/0L`；
- canonical interference `≥ -0.002`；
- output-token p50 ratio `≤1.20`；
- latency p50/p95 ratio `≤1.15/1.20`；
- 任何 retry、request drift、contract defect 直接 STOP。

这轮即使 PASS，也只允许进入 fresh150 bundle，不能直接部署 Production。

### Priority B — grading/slab typed recall

评级信息应是独立 typed head，而不是标题 token 的附属项。下一步应从 255 内部库里先冻结“有 slab + 有 grade/auto grade/认证/评级颜色文字”的 cohort，分别统计：

- grade company；
- card grade；
- auto grade；
- authentic/auto-only/card+auto 类型；
- slab 明示的 finish/colour。

这条方向的评价主尺是字段 recall/precision 和 critical error，不是总 F1。它可以复用同一个 residual phrase transport，但不得和 Priority A 的首轮因果实验同时改 schema。

### Priority C — phrase-aware product/set completeness

`Star Wars`、完整产品层级、系列名和 product extension 应以 phrase 为单位进入 resolver，避免 token 拆碎。先用现有 150 raw response 做零调用 replay；只有 source-only、0 field regression 的机制累计到 5–8 个，才放进共享 fresh150 treatment。

### Priority D — orientation and image transport

不做 blanket auto-rotate，也不把 `original` 默认当更准确。先对 255 内部库做 orientation census，并冻结倒置、横卡、正常竖卡三个 strata；只有倒置 strata 显著出现 typed-field recall 损失，才测试 EXIF-normalized/mental-rotation提示。图像变换与 residual schema 不在同一轮改变。

### Priority E — world support model

世界模型只做候选排序和“不可能组合”告警：球员—球队—年份—产品—套组。absence 永远是 UNKNOWN，不能覆盖卡面证据，也不能直接生成标题。它是中期资产，不是当前 4W 的最短路径。

## 明确不扩的方向

- 不恢复 wide residual arrays；
- 不全面解除 SEM/Composer 合法性边界；
- 不把 catalog/world knowledge 升为 canonical authority；
- 不增加 OCR、vector、Cloud Run、web lookup 或自动第二次 Luna；
- 不因单次 F1 上升忽略字段损失；
- 不把 development35、oracle 或 label-assisted replay 当 Production certificate；
- 不在同一付费实验里同时改变图片、prompt、schema、reasoning 和 resolver。

## 下一轮决策

建议下一轮只在以下两项中二选一：

1. **授权 105-call compact residual screen**：收益上限最大、设计已有功效、但仍是开发确认；
2. **暂不扩模型输入，先完成 grading/slab typed gold 与新尺子**：成本最低，能避免继续被 F1 误导。

我的置信度排序：先补 typed gold/新尺子 `0.78`；直接做 105-call compact screen `0.66`；继续 wide schema `0.08`；世界模型直接改标题 `0.03`。

无论选择哪一项，Production promotion 的最终门仍是独立 image-backed fresh150、绝对 accuracy `≥0.90`、critical factual error 为 0，并通过完整 protected release 与 Writer Journey。
