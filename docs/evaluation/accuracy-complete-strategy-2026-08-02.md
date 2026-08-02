# LYNCA 准确率完整战略 — 2026-08-02

## 0. 战略结论

反方观点是继续积累无损小规则：它们便宜、可回放，当前组合也确实是
正收益。这个观点只适合作为保底，不足以指导主攻方向。当前 combined
candidate 是 `0.785051`，到 `0.90` 还差 `0.114949`；全部已验证规则组合
只贡献 `+0.018124`，目标缺口是它的 `6.34x`。继续优化同一层，数学上
没有足够空间。

因此，准确率主线从“加规则”切换为“增加信息，再控制权限”：

> **保留模型的最大观察与候选表达；用有来源的关系知识做排序；最后才由
> CSM/SEM 和 80 字符 Composer 决定什么可以进入标题。**

主攻三个大头：

1. 给模型更多有效视觉像素，而不是更换一个 detail 名称；
2. 在同一次 Luna 响应中保留 canonical 没收住的完整短语；
3. 建立 release/product/set/parallel/finish 的可证伪关系资产，而不是
   泛化的球员百科。

当前不部署 Production，不调用 provider，不恢复 Cloud Run、向量、OCR、
web lookup 或第二次模型调用。

## 1. 北极星与不可混淆的指标

Production 准确率门槛不是一个分数，而是同时满足：

| 维度 | 门槛 |
|---|---|
| 独立 cloud fresh150 title macro F1 | `>= 0.90` |
| 关键事实错误 | `0` |
| 标题长度 | 全部 `<= 80` 字符 |
| 数字安全 | serial 分子/分母、年份、卡号、数量、grade 不得突变 |
| 身份安全 | subject、product、set、IP 不得发生无证据替换 |
| 链路 | 单次 GPT-5.6 Luna、reasoning `none` |
| 生产能力 | CSM/SEM 为最终 authority；候选和世界知识无直接发布权 |

必须同时报告三套指标：

- **Title F1**：是否贴近写手最终标题；
- **Field truth**：卡片事实是否正确；
- **Critical error**：是否出现不可接受的数字或身份错误。

单个写手标题不是完整字段真值。一个合法词没有出现在参考标题中，不等于
它是假事实；模型更像参考标题，也不自动等于模型更懂卡片。

## 2. 当前基线为什么看起来有 0.7 和 0.8 两套数

- 旧 255 卡、一句话裸模型、旧评测条件下，裸模型曾达到 `0.8334`；加
  80 字符约束后为 `0.8237`。
- 当前 fresh150 上，bare title 的 macro F1 是 `0.714701`，但 recall 是
  约 `0.816`。过去记住的“0.8”有一部分是 recall，不是最终 F1。
- 当前 canonical 是 `0.767764`；加入已验证的 combined replay bundle 后是
  `0.785051`。

这些数来自不同 cohort、prompt/schema 和输出边界，不能横向拼成一条趋势。
今后任何结论必须绑定 cohort SHA、request SHA、模型、prompt/schema、
Composer 和评分器版本。

## 3. 从信息论看损失在哪里

当前链路可以写成：

`source pixels -> Luna observation -> typed candidates -> compatibility rank -> CSM/SEM -> Composer`

fresh150 的 427 个 audited missing occurrences 按最早损失边界拆分：

| 最早损失边界 | 词次 / 卡 | 完美恢复后的 F1 | 上限增量 |
|---|---:|---:|---:|
| exhaustive/model 仍未表达 | 255 / 118 | `0.878026` | `+0.092975` |
| 模型表达、canonical 未保留 | 109 / 76 | `0.818167` | `+0.033116` |
| canonical 有、Composer 未发 | 63 / 46 | `0.805929` | `+0.020878` |
| 427 个全部恢复 | 427 / 137 | `0.923252` | `+0.138201` |
| 删除全部 285 个参考外 token | 285 / 117 | `0.856724` | `+0.071673` |

结论：

- 单独解决“模型没说”也只能到 `0.878`；
- 单独做精度删词也只能到 `0.857`；
- 达到 `0.90` 必须同时增加召回、改善候选分类/排序，并保住 precision；
- precision 不变时，需要拿回全部 recall oracle 的 `83.18%`，零碎规则不可能
  承担这个任务。

最大语义族：

| 语义族 | 词次 / 卡 | 完美恢复增量 |
|---|---:|---:|
| 完整身份/描述 | 101 / 64 | `+0.036491` |
| 平行/工艺 | 85 / 62 | `+0.031253` |
| 颜色 | 41 / 40 | `+0.014402` |
| serial/限编 | 42 / 39 | `+0.014158` |
| 属性/成分 | 36 / 33 | `+0.013392` |
| 裸数字/ordinal | 39 / 36 | `+0.013143` |

这决定了优先级：完整产品身份、平行/工艺和小字证据先于 Lot、小同义词和
更多 Composer 技巧。

## 4. 正确的总架构

### 4.1 观察层：尽量表达

- Luna 在同一次调用中看完整正反面和必要的确定性细节图；
- 输出 canonical fields，同时输出最多两条 observation candidates；
- literal text、source region、basis、候选角色必须保留；
- 不因为“不确定放哪个 CSM 字段”就丢掉它；
- 不使用第二次模型调用。

### 4.2 候选层：允许不确定

- observation 是 append-only evidence，不是 final fact；
- 完整短语优先，禁止 token fragment admission；
- visual pattern 与 printed text 明确分开；
- hypothesis 与 literal observation 分开实验、分开计费、分开归因。

### 4.3 世界模型：只做正向支持与排序

- 所有关系带 source、source version、SHA、有效区间和审核状态；
- 缺边是 `UNKNOWN`，不是 `FALSE`；
- 世界模型可以提高候选 rank、指出冲突或触发 abstain；
- 不能创造卡面没有的 serial、grade、cert number、subject 或 parallel；
- 不能覆盖 exact visible text。

### 4.4 CSM/SEM：最后决定合法事实

- CSM/SEM 是核心资产与唯一发布 authority；
- candidate 只有经过角色解析、来源检查、关系兼容和冲突门，才可提出
  admission proposal；
- 每个 admission、drop、normalization 都有 reason code 和版本；
- 字段 `empty` 与“不确定候选存在”是两种状态，不能混为一谈。

### 4.5 Composer：只做确定性表达

- 依 COS-8/COS-9 和最新 80 字符契约排序与压缩；
- 不负责猜身份、修世界知识或从颜色命名平行；
- Typed compaction/drop ledger 保留，但不再把它当准确率主攻方向。

## 5. 战略 A：有效视觉像素

### 已确认的输入事实

- fresh150 有 150 卡、300 图；300/300 都是 JPEG，长边最大 1400px，
  估算 JPEG quality 全部约 82；
- 225 portrait、74 landscape、1 square；40/150 卡正反方向不一致；
- 正常 Production JPG/PNG/WebP 上传本身不缩图；历史 fresh150 在更早的
  链路里已经统一压到 1400px；
- 当前 1400px cohort 的 `original - high = -0.014329`，5 胜/11 负/34 平，
  不能证明真实高分辨率原图的结论。

### 进入下一轮的视觉臂

**V1 — Pareto 臂：两张原图 + 一张正反底部 35% 纵向堆叠图。**

- images/card：3；
- bytes：control 的 `1.479x`；
- 512 tile proxy：`1.482x`；
- 目标区域线性尺度：p50 `1.071x`，p90 `1.425x`；
- 不删原图，不锐化，不 OCR，不加文本标签。

**V2 — Accuracy-ceiling comparator：两张原图 + 两张独立 bottom crop。**

- images/card：4；
- bytes：`1.568x`；
- tile proxy：`2.429x`；
- 线性尺度：p50 `1.786x`，p90 `2.381x`；
- 只有 V2 显著胜过 V1，额外 token 才有 Pareto 合理性。

### V1 105 张付费结果（已完成）

V1 已在完整 outside-development 105 张上完成唯一一轮付费对照：
`0.785180 -> 0.789985`（`+0.004805`），paired 为 `27/19/59`，
`p=0.302`。收益主要落在 `year`、`card_name`、`serial` 和
`descriptive_rarity`；`product`、`parallel_family`、`print_finish` 混合或
回退。代价是中位延迟 `5.545s -> 8.177s`、输入 token `+23.8%`，超过当前
写手路径的 6–8 秒预算，因此 **不进入生产**。保留为候选，下一步只能先做
零成本的压包/解析设计；没有成本下降前不再购买第二轮视觉样本。

详细结果见
[`visual-bottom-band-v1-paid105-2026-08-02.md`](./visual-bottom-band-v1-paid105-2026-08-02.md)。

### 视觉 STOP

- 自动卡体/前景裁剪：只敢裁 71/300，应用子集的中位增益仅 `1.047x`，
  且抽检会裁掉 PSA/封装标签；
- broad 2x2/六区域 evidence sheet：tile `1.598x`，区域尺度 p50 仅
  `0.879x`，不是放大；
- 在当前 1400px cohort 重测 `original`；
- 用 PNG 替代 quality-90 JPEG：样本体积约 `5.61x`，无 Pareto case。

### 真正的 high/original 策略

另建 native cohort：原始长边至少 3000px，保存原文件 SHA，确保不是历史
压缩图。只在这个 cohort 上做 contemporaneous paired `high/original`。

## 6. 战略 B：同次表达增量

### Literal observation lane v2

bare/canonical 互补审计中，44 张 bare 胜利包含 85 个正确增量：

- 38 个 canonical raw fields 已有，属于下游表达问题；
- 47 个需要新的 observation capture；
- 47 个对应 39 个完整短语、30 张卡；
- 120 张需要 0 行、21 张需要 1 行、9 张需要 2 行；没有卡需要第 3 行。

因此理论最优 schema 不是 v1 的四数组/七行，而是一个统一数组、最多两行，
角色为：

- `identity_phrase`；
- `finish_phrase`；
- `commercial_marker`；
- `exact_code`。

成本与上限：

- request 静态增量 1,415 bytes，比 v1 少 `41.7%`；
- 两行最坏约 80 output tokens；
- 47 词 label oracle `+0.019718`；
- 80 字符内 oracle `+0.015374`；
- exhaustive 另一次调用复现子集 oracle `+0.011572`。

这些只是上限。Literal v2 当前状态是
`GO_TO_PAIRED_FRESH150_EXPERIMENT_ONLY / STOP_PRODUCTION`。105 张付费验证后，
零成本 resolver 只安全拿回 1 张卡的同数值 serial 格式（`+0.000866`，
1 胜/0 负/104 平），没有达到大头门槛；因此继续保持 candidate-only，
不进入 runtime。

### PSP hypothesis beam

- 最多两个互斥 Product/Set/Parallel tuple；
- 当前账本瞄准 16 词/12 卡，oracle `+0.00696`；
- 相对 literal v2 的独有已测收益为 0；
- candidate-v4 风险代理中 274 个候选只有 7 个完整命中。

决定：`HOLD_SEPARATE_ARM_NOT_DEFAULT`。在 source-backed ranker 可用前，
不进入默认 schema，也不与 literal v2 混跑。

### Slab cert anchor

- 37/150 卡能读出唯一 7–12 位 cert number，冲突 0；
- 这些卡当前 F1 已有 `0.865142`；
- 恢复其 71 个 missing token 的 label oracle 是 `+0.018012`；
- perfect-card 上限 `+0.033265`。

但本地只证明 schema 存在，没有 Registry 行覆盖证据。决定：
`DEFER_NO_VERIFIED_REGISTRY_COVERAGE`。未来只能单独使用
`slab_anchor={grader, cert_number}` 做 exact lookup，不占 literal v2 两行。

## 7. 战略 C：世界知识资产

### 当前世界模型为什么不是正资产

- 当前 world relation 最终只纠正 1 个 token/1 卡，replacement oracle
  `+0.000606`；
- Product-year 曾有 15 个 candidate-rank wins，进入 final title 后纠正 0；
- Release graph exact 支持 5 卡，但 5 卡的值已经在标题里，纠正 0；
- Team ranker 实测 1 胜/6 负；
- 若把缺边当反证，会错拒 28.0% 正确 subject-year、34.7% 正确
  product-year。

当前 world resolver 仍 STOP；source-versioned graph asset 已构建，但覆盖率
不足，状态为 `BUILT_ADVISORY_INSUFFICIENT_COVERAGE`，不进入 runtime。

### 世界模型应该长什么样

第一优先不是“球星在哪个队”，而是：

`release <-> year/season <-> manufacturer/product <-> set/insert <-> parallel/finish`

本地 official asset 有 143 records，但只有 15 个 product-set pairs，
product-parallel、set-parallel、product-set-parallel 全为 0。它在物理上
无法解决 finish 大头。

最小 edge 必须含：

`edge_id, subject_type, subject_normalized, predicate, object_type,
object_normalized, release_id, valid_from, valid_to, category_or_ip,
source_url, source_sha256, source_version, evidence_type,
coverage_contract, confidence, adjudication_status`

顺序：

1. release/year/product/set/parallel/finish；
2. character/IP/release identity；
3. versioned product-year/set-product；
4. player-team-year 最后做，只作弱支持。

世界资产的 KPI 不是 edge 数量，而是：在 150 final titles 上改变多少个 typed
field、产生多少胜/负、是否出现 visible-evidence rejection。

## 8. 战略 D：精度真值与第二写手

285 个 reference-absent token 的完整拆分：

| 类别 | 词次 / 卡 |
|---|---:|
| 明确同角色事实冲突 | 33 / 26 |
| 有 visible/official 支持但写手省略 | 86 / 57 |
| Composer 同义冗余 | 12 / 12 |
| 拼写/分词风格 | 12 / 10 |
| 无法判定 | 142 / 82 |
| COS/TCG 应抑制违规 | 0 / 0 |

修完全部 33 个明确错误，oracle 只有 `+0.007838`；盲删 86 个被写手省略
但有证据的词，会让 title F1 虚增 `+0.019401`，同时可能降低事实准确率。

最低成本的校准不是重写 150 个标题：

1. Writer B 只审 117 张卡的 285 个争议词，均值 2.44 词/卡；
2. 盲看 image + field/value/region，隐藏 Writer A 标题和模型 confidence；
3. 标记 `VISIBLE_TRUE / FALSE / OPTIONAL_TITLE / REQUIRED_TITLE / UNKNOWN`；
4. Writer A 只复核 B 判有效但 A 省略的项和 UNKNOWN；
5. 第三人只仲裁显式分歧；
6. 最终分别保存 `field_truth` 与 `title_preference`。

任何机制不得靠删除 B 确认的 visible truth 来获得“准确率提升”。

## 9. 小规则与 Composer 的位置

已验证的规则 bundle 保留冻结：`0.766927 -> 0.785051`，`+0.018124`，
28 胜/0 负/122 平。它是正资产，但不再消耗主研究预算。

已完成且 STOP 的下游方向：

- bounded residual marker admission：`-0.000764`；
- current official exact Release join：5/150 覆盖，final-title 0 收益；
- typed Pareto Composer：deployable 0 收益；
- product-year world extension 到 final title：`-0.000156`；
- raw bare/canonical union：`-0.055811`；
- free title 直接成为 authority：44 胜/95 负/11 平；
- global drop-order rewrite；
- broad team restore、broad product projection、serial 自我验证。

以后发现一个小规则：先跑 retained150 replay；有损立即 STOP，无损正收益进
冻结银行。不能把规则数量当作离 0.90 的进度。

## 10. 最省成本的实验顺序

### Phase 0 — 已完成的零调用筛选

- 427 recall ledger 与 285 precision ledger；
- literal v2 schema/contract 与污染压力代理；
- 300 图视觉预算与多视图离线原型；
- world asset coverage；
- STOP/GO 机制隔离；
- 所有实验文件无 runtime import。

### Phase 1 — 先补测量与数据资产

并行进行（当前可验证状态）：

1. 第二写手审 285 个争议词（需要真人盲审，当前标记为待外部证据）；
2. 获取一批新的、独立 sealed 150 卡，不能从已参与机制选择的 255 张里
   拼出来（本轮付费上限已改为 105，新增独立 150 不再自动购买）；
3. 建 source-versioned release/product/set/parallel/finish 资产（已生成
   144 条 advisory edges；覆盖不足，状态为
   `BUILT_ADVISORY_INSUFFICIENT_COVERAGE`）；
4. hosted no-score preflight 已由云端链路/图片预算实验覆盖；请求字节、
   image count、checkpoint/operation fingerprint 已验证，视觉 transform
   的实际延迟与 token 代价也已纳入 105 张报告。

### Phase 2 — 第一轮真实验证：只测两个大机制（已以 105 完成）

为了降低成本，先用 shared control 的两轮 105 张验证，不再购买 450 次：

- A：canonical high control；
- L：A + literal observation v2；
- V：A + one two-bottom-band sheet。

每轮 210 次单次 Luna 调用。逐卡轮换顺序，共享同一 hosted Vercel -> Singapore
Storage -> Luna 路径。不能拿旧 control 对新 treatment。

V 已测得 `+0.004805` 但中位延迟上升至 `8.177s`，所以未通过写手路径
Pareto 门槛；不再购买两张 independent bottom crops。该 ceiling comparator
标记为 `UNVERIFIED_DEFERRED_AFTER_COST_STOP`。

PSP hypothesis、cert anchor、当前 world resolver 不进入这一轮。

### Phase 3 — 机制组合与独立 promotion gate

只有 L/V 中至少一个成为正资产，且世界 ranker 在零调用 final-title replay
通过，才组成候选 bundle。组合不能在发现 cohort 上直接晋级；若未来仍有
必要，只能在另一批独立 sealed 105 上做 contemporaneous paired
control/treatment，且必须先得到明确的零成本正证据；本轮不再购买新的
付费 cohort。

Production 只在组合达到 `>=0.90` 且 0 critical error 后讨论。

## 11. 每条臂的硬门槛

### 通用

- macro F1 `>= +0.003`；
- 至少 8 胜、0 负；
- 0 serial/year/card number/quantity/grade/subject/product critical mutation；
- 0 unrelated-field drift；
- 0 标题超过 80；
- request bytes 必须不同，arm fingerprint/checkpoint 不能串用；
- 报告 input/output/cached tokens、p50/p95 latency、provider retry、成本。

### Literal v2

- 至少 8 张目标卡捕获新增正确短语；
- canonical projection aggregate 不退化；
- frozen-label resolver oracle至少 `+0.003`；
- 任何 candidate 自动写入 CSM/Composer/persistence 都是 contract failure。

### Visual V

- 至少恢复 6 个 serial/card-number/marker/product/finish 精确目标；
- 0 multiple-card confusion；
- V input token 增幅 `<=35%`；
- transform p50 `<=150ms`；
- request p50 墆幅 `<=20%`、p95 `<=25%`；
- orientation mismatch 40 卡不能成为集中损失组。

### World ranker

- final-title delta `>= +0.02` 才证明资产规模足够成为“大头”；
- candidate value 不可创建、删除或突变；
- hard reject visible evidence = 0；
- shuffled-edge、longest-candidate、source-removed controls 必须失败或显著更差；
- 缺边永远不能作为反证。

## 12. 回退、版本和长期复利

每个机制都独立版本化：image transform、prompt/schema、candidate parser、
world asset、ranker、CSM/SEM、Composer、scorer。operation key 必须包含所有
内容 SHA。

正资产判定分三层：

1. discovery replay/paired150 正收益；
2. 独立 fresh150 复现；
3. Production shadow 无关键回退。

任何长期负资产整体删除；其中可迁移的观测、数据或测试单独保留。短期负反馈
可以接受，但必须增加知识或排除一个大假设。

写手修正只形成 provenance-bearing candidate。重复独立证据或 official source
通过后，才能晋级为 world edge/registry fact。按 physical card、capture session
和 source feedback ID 划分数据，防止评测泄漏。

## 13. 明确不再做

- 不恢复 Cloud Run；
- 不恢复向量库；
- 不引入 generic OCR；
- 不做 web lookup 自动链路；
- 不做第二次 Luna 调用；
- 不把 exhaustive 长文放默认 runtime；
- 不让 free expression 直接获得 canonical 权限；
- 不在当前 1400px 数据上重复 high/original；
- 不让 generic player-team 世界知识覆盖卡面；
- 不因目录缺边拒绝候选；
- 不用 20 卡或单个均值晋级；
- 不把 label oracle、coverage 或 candidate-rank win 冒充 final-title 收益；
- 不在达到独立 `0.90` 前把 accuracy 实验部署到 Production。

## 14. 当前状态

| 项目 | 状态 |
|---|---|
| Small positive replay bundle | 冻结保留，非主攻 |
| Literal observation v2 | 105 paid capture 完成；resolver `+0.000866`，未过门槛；Production STOP |
| Bottom two-band visual view | 105 paid 完成，+0.48pp 但延迟负资产；Production STOP |
| Two independent bottom crops | `UNVERIFIED_DEFERRED_AFTER_COST_STOP` |
| PSP hypothesis | `UNVERIFIED_HOLD`，无独立证据，不购买新 arm |
| Cert anchor | `UNVERIFIED_DEFER_NO_REGISTRY_COVERAGE` |
| Current world/official resolver | STOP |
| New release/parallel source graph | 已构建 144 条 advisory edges，但覆盖不足；`BUILT_ADVISORY_INSUFFICIENT_COVERAGE` |
| 285-token second-writer calibration | `UNVERIFIED_REQUIRES_HUMAN_BLIND_REVIEW` |
| Production deployment | PAUSED |

本战略的详细证据见：

- `accuracy-big-head-priorities-2026-08-02.md`；
- `accuracy-big-head-exploration-portfolio-2026-08-02.md`；
- `fresh150-visual-multiview-offline-audit-2026-08-02.md`；
- `field-specific-observation-lane-v2-analysis-2026-08-02.md`；
- `combined-precision-loss-ledger-150-2026-08-02.md`；
- `world-asset-coverage-audit-150-2026-08-02.md`。

本轮准确率付费验证为两轮 paired 105（共 420 次成功 Luna 调用）；其后的
resolver、世界图谱、校准包和所有分析均为零调用。runtime/Production changes：0。
