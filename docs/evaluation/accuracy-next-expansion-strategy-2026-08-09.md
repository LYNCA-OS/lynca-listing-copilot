# 下一轮准确率扩范围决策报告 — 2026-08-09

状态：`DECISION_READY_CONDITIONAL / ZERO_PROVIDER_CALLS / NO_RUNTIME_CHANGE`

适用水位：`codex/model-constraint-diagnostic-20260808@f350ce6a`。本报告冻结于 compact residual v4 的 105-call 结果产生之前，因此不预设它 PASS；结果出来后必须按本文的条件分支执行，不能把本报告改写成事后预注册。

## Executive Summary

- **反方观点更可信：现在不该同时扩 grading、phrase、image 和 world 四条线。** 当前最大风险不是漏掉一个小规则，而是把 provider 输入、schema、resolver、world rank 和评价尺子一起改，最后即使分数上升也无法归因。理论最优解是每轮只改变一个 provider-level 变量，其余机制全部在同一冻结响应上做零调用消融。
- **下一轮先补尺子，再扩机制。** Token F1 继续保留为兼容趋势，但不能单独授权。迭代主尺应是 critical factual safety、typed-field precision/recall、required-missing/wrong-role、title factual utility 与 latency/token Pareto；最终发布主尺是 Publishable Card Rate（PCR）及 recognition precision/recall 的置信下界。
- **执行优先级是：grading/slab typed gold → phrase-aware Product/Set → support-only world rank → orientation/image transport。** 这与“图像或世界知识看起来更大”的直觉不同：评级结构化已有 38/38 exact 的独立证据；phrase resolver 已有 150 回放正信号；world 只有 candidate-rank 信号且本地资产已被清理；倒置卡在 255 卡审计中为 0，额外 bottom-band 又已被延迟否决。
- **真实 150 不是机械攒够 10 条规则就开跑。** “10 个机制”可作为批处理上限，不能作为统计门。购买 fresh150 必须同时满足：R0 独立 typed gold receipt 为 `COMPLETE`、所有用于决策的 truth metrics 非 `null`、wrong-role audit 为 `COMPLETE`、cumulative bundle 在 150 零调用回放中安全为正、当前 compact105 通过预注册门；`null` 永远不按 `0` 处理。若需要同批因果增益，150 张卡的 control+treatment 是 300 calls；若已有同版本、同图片、验前冻结的合法 control，可只新增 150 treatment calls。

## 当前准确率损失不在一个层级

当前可复现 current-main 150 回放的 macro F1 是 `0.781142`。最早损失边界为：

| 最早边界 | Occurrences | 卡数 | Add-only label oracle | 能指导什么 |
|---|---:|---:|---:|---|
| Luna / 开放观察仍未表达 | 254 | 118 | `+0.096946` | 需要新的同调用 evidence capture 或真实视觉输入实验 |
| Schema / admission 未保留 | 109 | 76 | `+0.042304` | 需要 typed candidate lane 与 source-aware resolver |
| Composer / marketplace 未发出 | 63 | 47 | `+0.023803` | 只能用零调用 Composer/priority/compaction 修复 |

这些是“最早边界”与读取答案后的局部上界，不能相加，也不能当机制 forecast。它们已经反证“继续加小 Composer 规则就是大头”：真正的上游机会在 254/109，但上游放开必须同时防止错误事实进入 canonical authority。

## 新尺子：F1 只做第五层诊断

### 迭代 driver 向量

每个 arm、每张卡、每个 typed field 都必须输出以下 ledger，禁止压成单个总分：

1. **Critical factual safety**：subject、year、product/set、card number、serial、grading、quantity 的 false、mutation、unresolved、required-missing；任何 observed critical false 都直接 STOP。
2. **Recognition Verified Claim Precision**：候选发布的 typed claim 中，有独立 source/gold 支持的比例；wrong-role 单列。
3. **Recognition Exact Fact Recall**：独立 gold 中 required facts 被正确识别的比例；不得因删光 optional/unknown 而提高。
4. **Typed field exactness**：逐字段 exact match、partial、missing、wrong-role、canonical-field fidelity；grading 必须拆成 company/card grade/auto grade/grade type。
5. **Title factual utility**：reference-token loss、unbacked addition、numeric mutation、grammar、80-char、drop ledger，并保留 legacy macro F1 与 W/L/T。
6. **Operational Pareto**：failure/retry、input/output tokens、p50/p95 latency、额外图片/变换成本。

PCR 适合做 release gate，不适合做日常迭代指标；日常看上面的 driver vector，防止通过放松 publishable 判据制造“进步”。

### 当前尺子还缺真实 gold

现有 `117` 卡 / `285` disputes packet 的只读 readiness 审计结果是：

- `285/285` disputes 把 factual truth 与 title policy 混在一个轴；
- independent human labels 为 `0`；
- recognition precision 在完成复核后可算；
- recognition recall 与 PCR 当前都不可算；
- reviewed title 是 title ground truth，不是完整 typed-field ground truth。

因此，下一轮第一项工作不是再造 scorer，而是冻结 150-card typed annotation packet：对所有 critical fields 与本轮会触碰的 Product/Set/finish/slab fields 做完整 required-fact scan、source region、事实真值、标题是否应发布双轴标注。provider 调用预算为 `0`。

### 150-card 最终门

建议把“准确率超过 90%”写成可审计的合取门，而不是 `macro F1 >= 0.90`：

- 150 张中至少 `143/150` publishable，才使 95% Wilson 下界高于 `0.90`；
- candidate 的 macro Recognition Exact Fact Recall 与 Verified Claim Precision，card-level 95% CI 下界都 `>=0.90`；
- candidate 相对 paired control 的 recall 下界 `>= -0.01`、precision 下界 `>= -0.005`；
- observed critical false = `0`，critical unresolved = `0`；
- 全部标题 `<=80`，grammar/drop ledger 合法；
- provider failure/retry/request drift 为 `0`，latency/token 不突破冻结预算。

`0/150` critical error 只能把 95% 总体错误率上界压到约 `1.98%`，不能证明长尾低于 `0.1%`；证明 `0.1%` 需要至少 `2,995` 个相互独立的连续零错误样本，可在可靠 typed feedback 上长期累计，不需要一次付费完成。

## 四个扩范围方向的证据排序

### 1. Grading / slab typed recall：先补真值，不重复购买已证明的 grade schema

**结论：GO typed-gold；HOLD 新的 slab 规则，等待 compact105。**

独立 105 已经把 structured grading 从 `33/38 (86.8%)` 提升到 `38/38 (100%)`，`5` repairs、`0` grading regressions。38/38 的 95% Wilson 下界约 `0.908`，所以“card grade 与 auto grade 分开”本身已经是明确正资产，不应再拿它当新实验收费。

剩余问题不是“有没有 grade”，而是 slab 上的 exact finish/colour provenance：

- fresh150 有 `45` 张 graded cards；旧 scalar grade 已覆盖 `44/45`，主要损失是语义塌缩而非整体漏读；
- slab anti-guess prompt 把 false-colour `3→2`，却把 missed-colour `5→6`；
- blanket non-literal finish suppression 为 `3W/4L`，不能上线；
- wide residual 的四个胜例中只有一个来自 slab printed finish：`AUTO-RED REFRACTOR`。

最小机制不是更强的“不要猜颜色”，而是 `exact printed slab phrase + source_region=slab_label + typed role`。slab 标签背景色、塑料壳反光和卡面 visual colour 都只能是 observation，不能自动成为 commerce fact。

**下一步与样本：**

- 先对现有 150 全量补 typed gold；其中所有 graded/slab 卡作为必审 stratum，0 provider calls；
- 保留 30–60 张 graded/slab targeted diagnostic 只用于定位字段，不把富集比例冒充生产 PCR；
- compact105 若捕获至少预注册的 `6W/0L` 且所有 typed/latency 门通过，再把 slab phrase resolver 作为 fresh150 treatment 内的零调用 on/off 消融；
- GO 要求 slab finish/colour verified precision `100%`、critical regression `0`，并至少 `6` 个 exact targeted repairs；否则 HOLD，不为 F1 小涨放宽来源。

### 2. Phrase-aware Product / Set completeness：当前最值得继续攒的安全增益

**结论：GO 零调用扩规则；达到 cumulative gate 后进入 shared fresh150。**

现有 guarded phrase resolver 已证明完整短语比 token 命中安全：

- raw canonical 上 `+0.007099`、`13W/0L`，但有 displacement，不能直接用；
- 在 current expression overlay 上的 guarded incremental 是 `+0.002149`、`5W/0L/145T`；
- 再叠加 token-oriented schema73 后，只剩独立 `+0.000314`、`1W/0L`；
- 109 个 schema occurrences 中，v1 只 admit `9`，另有 `59` 尚无 phrase rule；12 个人工标注 wrong-role 全部被拒绝。

这说明 v1 是正资产但还不是大头。扩范围应瞄准完整 Product/Set hierarchy、season phrase、IP/release identity 和严格 Product token 超集；不得把 `STAR`+`WARS`、版权年份、biography 里的 rookie、背景颜色重新拼成事实。

**下一步与样本：**

- 在冻结的 150 raw response 上逐机制 replay，provider calls `0`；
- 每条机制必须使用 `complete phrase + region + role + basis + candidate field`，reference 只能在决策冻结后评分；
- 保留每条 `0 field regression / 0 reference loss / 0 numeric mutation / 0 >80` 的正资产，目标银行最多 10 条，但验前最多冻结 4 个独立 family；family 内相关规则必须先合成一个预注册 bundle，不能看 label 后从 10 条中择优；
- cumulative bundle 进入真实 fresh150 前至少 `ΔF1 >= +0.003`、`8W/0L`、typed-field fidelity 不退化；8W/0L 的双侧 sign p=`0.0078125`，4 个验前冻结 family 的 Bonferroni family-wise 上界约 `0.03125`。若实际检查 `m` 个独立候选或 family，必须按真实 `m` 校正为 `min(1, m×0.0078125)`；例如 `m=10` 时为 `0.078125`，不能沿用四-family 结论；
- `2024 BOWMAN DRAFT`、`OPTIC` 等会挤掉现有 title token 的候选继续 HOLD，直到 Composer 能 source-only 保留原有字段。

### 3. Support-only world model：信号比 orientation 强，但当前资产不可复现

**结论：HOLD；先重建最小 source-versioned graph，再做零调用终稿 replay。**

现有 evidence 并不支持 generic world knowledge 或 hard constraint：

- `product↔year` 对既有 identity candidates 的排序是 `15W/0L/135T`；
- `subject↔year` 是 `4W/0L`，功效不足；
- `subject↔team↔year` 是 `1W/6L`，明确停止；
- 用缺边 hard reject 会错拒 `28.0%` 的正确 subject-year 与 `34.7%` 的正确 product-year；
- 当前 world families 最多覆盖 upstream missing 的 `34/255 (13.3%)`，ranker 无法恢复 Luna 从未表达的 candidate。

`15W/0L` 只是 candidate-rank F1，不是最终 resolver+Composer 标题收益。更重要的是，当前 checkout 已按目录清理决策删除 `data/catalog/official` 和 constraint snapshot；world safety unit tests 仍可运行，但 coverage/replay 无法从 clean checkout 重建。旧保存结果只能作为历史假设，不能作为新的 release evidence。

正确的下一步不是恢复整套旧目录，而是按需重建最小 `release/year/product/set/parallel/finish` graph：每条 edge 有 source、version、valid interval 与 exhaustive/support-only contract；absence 永远是 `UNKNOWN`，world 只能稳定重排已有 candidate，不能生成、覆盖或拒绝 visible evidence。

**下一步与样本：**

- 先重建最小资产并冻结 source fingerprints，provider calls `0`；
- 在与 graph compiler source 明确 disjoint 的 150 candidate cohort 上做 rank replay；若已有冻结 provider outputs，仍是 `0` calls；没有时只需 150 次 candidate capture，rank/control 来自同一响应；
- 再通过同版 resolver+Composer 回放最终 150 titles；最终标题至少 `8W/0L`、`ΔF1 >= +0.003`、candidate count/value mutation `0`、protected-visible reject `0` 才进入机制银行；
- 任何 hard reject 或直接 title authority 继续 STOP。若未来要证明 false reject `<0.1%`，仍需 2,995 个独立零错拒样本。

### 4. Orientation / image transport：当前不值得再买一轮

**结论：STOP blanket rotation；HOLD image expansion，直到出现更便宜的 transport。**

完整 reviewed image library 的人工审计是 `0/255` upside-down cards、`0/509` upside-down images、`0/509` EXIF orientation。Tesseract orientation 却对 `62` 张正常图给出非零 rotation，自动旋转的 false-positive mass 远大于可见收益。

同调用 mental-rotation prompt 在 13 张合成 180° 卡上只有 `7/13` 保持在 upright F1 的 `0.05` 内，并出现一次严重 subject/year 幻觉。它不能上线。

图像 transport 也已有实证：bottom-35% 第三视图在 105 卡上 `+0.004805`，但只有 `27W/19L/59T (p=0.302)`；p50 latency `5.545s→8.177s`，input tokens `+23.8%`。这是 capture-positive、writer-path cost-negative，不应重复购买相同设计。`high→original` 在当前所有图片 `<=1400px` 的 50 卡 cohort 上还是 `-0.014329`，也没有“original 一定更准”的证据。

只有出现以下任一新证据才重开：

- 新增真实、人工确认的 upside-down incident cohort，而不是合成旋转或 OCR 猜测；
- 一个离线 transport 方案能保留两侧全图与 slab label，同时把额外 input token 控制在 `<=10%`、本地 transform p50 `<=100ms`，并预计 provider p50 增幅 `<=10%`；
- 先在至少 30 张真实风险卡和同量 landscape/upright negative controls 上通过 `0` identity/numeric/grade regression，再考虑独立 150 paired arm。

在此之前，orientation/image 不占下一轮 provider 预算。

## 理论最优实验矩阵与调用预算

### 原则：按“provider-level 变量”分轮，不按功能名字分轮

Phrase resolver、world ranker、Composer 都可以在同一冻结 response 上 on/off，边际调用成本为 0；schema、prompt、reasoning、图片 bytes 会改变 provider response，必须独立成 paid arm。把它们混在一起会失去因果可识别性。

| 阶段 | Cohort | Provider 变量 | Calls | 目的 | 放行条件 |
|---|---:|---|---:|---|---|
| R0 — typed gold/ruler | 150 production-mixture cards | 无 | 0 | 建 critical/required/typed 双轴 gold | coverage gate 完整；labels/sealer/scorer SHA 冻结 |
| R1 — 当前 compact screen | 70 treatment + 35 contemporaneous controls | response schema only | **105，已批准** | 否证 compact capture、interference、cost | 严格按 prereg PASS/HOLD/STOP；不得事后改门 |
| R2 — phrase/slab/world replay bank | 同一冻结 150 responses | downstream only | 0 | 单机制与 leave-one-out interaction | 每机制和 cumulative bundle 全部 safety=0；bundle `>=8W/0L`, `ΔF1>=.003` |
| R3 — fresh150 paired expansion | 150 control + 150 treatment | 只保留一个 provider-level 变量 | **300** | 同批因果增益 + typed/PCR | R0 receipt `COMPLETE`、truth metrics 全非 `null`、wrong-role `COMPLETE`，再与所有 mechanism/operational gates 合取通过 |
| R4 — independent promotion | 新的、未用于开发的 150 | frozen candidate | **150 incremental**；若无合法 frozen control 则 300 | 绝对 `>=0.90` 发布证明 | `>=143/150` publishable、precision/recall CI、0 critical |
| R5 — image transport（条件式） | 独立 150 pair | image bytes only | **300** | 只在廉价 transport 先过离线门后执行 | accuracy gain 与 latency/token 同时 Pareto |

### 为什么不是一次四臂 750 calls

四个 treatment 加一个 shared control 在 150 卡上是 `150 + 4×150 = 750 calls`，但 grading/slab、phrase 和 world 大部分作用发生在 provider 输出之后，完全可以在同一 response 上零调用消融。一次四臂还会把 image/schema 的交互混入结论。

成本最优路线是：

1. 当前 105 先回答 compact schema 是否值得继续；
2. 其后所有 downstream 机制用同一响应做零调用 bank/leave-one-out；
3. 只让一个冻结 provider-level bundle 进入 150 pair；
4. final independent 150 只做绝对 promotion，不再探索。

如果目标只剩“candidate 本身是否可生产”，且已有同版本、同图片、验前冻结并通过 integrity 的 control trace，R4 可只新增 `150` treatment calls。否则必须付 paired `300`，不能用历史异质 control 节省出一个虚假的因果结论。

## 统一 GO / HOLD / STOP 门

### Mechanism bank GO

- zero-call 150 replay `ΔF1 >= +0.003`；
- 至少 `8W/0L`；
- critical false/mutation/unresolved、typed-field regression、reference loss、unbacked addition、unsupported numeric、over-80 全为 `0`；
- 不读取 label 选择 arm、rule、threshold 或 asset；
- 与已有机制做 leave-one-out 后仍有独立或明确互补贡献。

### Fresh150 paid gate

- R0 的独立 SPG/cohort receipt 必须为 `COMPLETE`，approval/material/policy/registry/scorer SHA 与唯一 physical-card cohort 已冻结；
- `critical_factual_error_cards`、`critical_unresolved_cards`、typed precision、exact recall、required-missing/required-count 与 unresolved prediction 等用于决策的 cohort-level truth metrics 全部非 `null`；
- 独立 wrong-role audit 必须为 `COMPLETE` 且值非 `null`；任何 `null` 都代表未知，绝不等同于 `0`；
- compact105 预注册门、cumulative mechanism bank 门和 operational gate 必须全部 PASS；任一缺失即 HOLD，不授权 fresh150。

### HOLD

- 方向为正但非平局太少、字段 gold 不完整或 operational cost 未过；
- candidate-level 正信号尚未转化为 final title；
- 机制依赖被清理或未 versioned 的资产；
- HOLD 不等于负资产，也不授权追加同类 paid calls。

### STOP

- 任一 critical false、numeric/identity/grade mutation；
- 任何 visible evidence 被 world/catalog 缺边拒绝；
- request drift、retry、resume ambiguity、schema/arm fingerprint 不一致；
- accuracy 小涨但 p50/p95 latency 或 token 超预算；
- 用 reference/asset-id 选择规则，或在同一实验同时改变 image、prompt、schema、reasoning、resolver。

## 已证伪或已被成本否决的旧方向

| 方向 | 已有结果 | 决策 |
|---|---|---|
| 全面放开 withheld finish | `-0.006228`, `4W/15L` | STOP |
| 恢复 search optimization | `-0.029473`, `20W/96L` | STOP |
| 恢复 card-number 输出 | `-0.039668`, `1W/112L`, 91 numeric additions | STOP |
| 同时拆两类 profile suppression | `-0.061252`, `16W/119L` | STOP |
| printed→visible prompt 放宽 | `-0.0063`, `5W/11L` | STOP |
| 从 product line 猜 finish | `-0.0092`, `9W/15L` | STOP |
| wide residual v3 | `+0.007107`, 仅 `4W/0L`; p50 latency `+29.9%`, output p50 `+76.6%` | STOP wide shape；只保留 compact hypothesis |
| generic auto-rotation / mental rotation | 0 real incidents；62 false orientation flags；合成卡出现严重身份错 | STOP |
| bottom-35% 第三图原设计 | `+0.004805` 但 27W/19L；p50 `+2.632s` | HOLD，成本负 |
| 当前 generic world hard reject | 正确值 false reject `28.0%/34.7%` | STOP |
| team world rank | `1W/6L` | STOP |
| generic catalog/vector/OCR/web/second Luna | 没有可归因 fresh150 正收益，且增加延迟/authority 风险 | STOP 当前默认路径 |

这些结论不是“所有约束永远正确”，而是当前证据已足以拒绝重复购买同一实验。真正值得扩的是一个窄的同调用 evidence transport，加上 source-aware typed routing；不是把保护层整体拆掉。

## 给下一轮授权的条件式建议

1. **现在批准且立即执行：** R0 typed gold/ruler、phrase/slab 零调用 replay、world 最小资产重建的可行性审计；provider calls `0`。
2. **compact105 = PASS：** 把 compact phrase lane 加入 mechanism bank；继续攒到最多 10 个“独立、零回归”的机制，但 fresh150 入场券必须是 `R0 receipt COMPLETE && truth metrics 全非 null && wrong-role COMPLETE && cumulative 8W/0L && ΔF1>=.003 && operational PASS`；数量本身不授权，`null` 永远不等于 `0`。
3. **compact105 = HOLD：** 不买 fresh150；先完成 typed gold，并用现有响应把 phrase-aware 与 slab resolver 做到 cumulative gate，再重新决定。
4. **compact105 = STOP：** 关闭该 schema family；转向 phrase-aware downstream 与最小 source-versioned world rank，不扩大图片或宽 schema。
5. **现在不批准：** orientation/image 新 paid arm、generic world model、wide residual、第二调用或整套约束解除。

我的核心建议是：**下一轮只争取“更多可见证据进入候选层”，不让更多未经证实的事实进入 canonical 层。** 这是同时提高 recall 和守住 critical precision 的最短路径。

## Caveats and evidence receipts

- current-main `0.781142`、历史 fresh150 与 Production finisher 的 F1 来自不同 scorer/recomposition 水位，报告没有把它们相减或相加。
- 254/109/63 与所有 oracle 都读取 reviewed title，只用于定位物理边界，不是 deployable gain。
- grading 38/38 来自独立 105；slab finish/colour 尚无等价 typed gold。
- world `15W/0L` 是 candidate rank；当前 clean checkout 缺 catalog/constraint 资产，coverage replay 在本轮只读验证中因缺文件 fail closed。
- 本报告没有 provider/network 调用，没有修改 runtime/runner，也没有部署 Production。

主要证据：

- [`model-constraint-impact-audit-2026-08-08.md`](./model-constraint-impact-audit-2026-08-08.md)
- [`post-luna-current-main-150-2026-08-08.md`](./post-luna-current-main-150-2026-08-08.md)
- [`model-residual-compact-v4-cloud-prereg-2026-08-09.md`](./model-residual-compact-v4-cloud-prereg-2026-08-09.md)
- [`orientation-grading-color-audit-2026-08-03.md`](./orientation-grading-color-audit-2026-08-03.md)
- [`accuracy-phrase-aware-resolver-v1-replay-150-2026-08-02.md`](./accuracy-phrase-aware-resolver-v1-replay-150-2026-08-02.md)
- [`world-compatibility-ranker-v1-stop-2026-08-02.md`](./world-compatibility-ranker-v1-stop-2026-08-02.md)
- [`world-asset-coverage-audit-150-2026-08-02.md`](./world-asset-coverage-audit-150-2026-08-02.md)
- [`visual-bottom-band-v1-paid105-2026-08-02.md`](./visual-bottom-band-v1-paid105-2026-08-02.md)
- [`ruler-replacement-design-2026-08-03.md`](./ruler-replacement-design-2026-08-03.md)
- [`ruler-design-review-2026-08-03.md`](./ruler-design-review-2026-08-03.md)

本轮只读验证：

- PASS：ruler annotation readiness、reviewed field evaluator、phrase-aware resolver、provider transport comparator、world ranker safety invariants；
- BLOCKED AS EXPECTED：world asset coverage 的两项重放测试缺 `data/catalog/official` 与 constraint snapshot；没有用弱替代物伪造通过。
