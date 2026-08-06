# 新评价尺设计与验证 - 2026-08-03

状态：`LOGIC_VERIFIED / DATA_NOT_READY / HUMAN_UNVERIFIED / PRODUCTION_STOP`

关联任务书：`ruler-replacement-brief-2026-08-03.md`
关联提交：`2490419b`
实现仅位于 evaluation 层，没有改动 Luna、CSM/SEM、Composer 或 Production。

## 0. 决策

反方观点是：当前 token F1 虽然粗糙，但它在第一次盲判里以 74% 击败了
三把手工 CSM 尺子，所以应该继续使用。这个观点有一半是对的：token F1
不能被一把未经独立标注的新单分数直接替换。

但继续把 token F1 当生产主门也不对。它测量的是“一个标题与 Writer A 的
用词重合”，不是“系统正确识别了卡，也给出了可直接发布的标题”。

本设计不再制造第五个万能分数，而是把评价对象拆成两个真实阶段：

1. **Recognition truth**：CSM canonical object 识别了多少真实事实，又写入了
   多少错误或无法核验的事实；
2. **Title publishability**：Composer 从真实 canonical facts 中，是否发出了
   一个事实正确、必需信息完整、可选项处理合理、符合 80 字符契约的标题。

推荐主尺是一个决策向量：

| 角色 | 指标 | 用途 |
|---|---|---|
| Release gate | Publishable Card Rate (PCR) | 只用于 promotion；有多少卡可以不改事实直接发布 |
| Iteration driver 1 | Recognition Exact Fact Recall | 修对字段是否优于删掉字段 |
| Iteration driver 2 | Recognition Verified Claim Precision | canonical 是否加入错误事实 |
| Iteration driver 3 | Required Recall / unresolved ledger | 定位 PCR 被哪一条合取条件卡住 |
| Guardrail 1 | Critical false / unresolved card count | 身份、数字、grade 等硬错误一票否决 |
| Guardrail 2 | 80-char legality + latency/cost | 防止分数靠变长、变慢或多调用换来 |
| Secondary outcome | Blind Writer Preference / As-is Acceptance | 衡量写手市场表达偏好，不冒充字段真值 |

token F1 保留为 legacy compatibility metric 和回归诊断，但不再单独决定
GO/STOP。

PCR 是七条条件的合取，适合做发布闸门，不适合指导日常优化。机制迭代必须
看 driver 向量和逐字段 ledger；禁止通过放松 PCR 判据来制造进步。

## 1. 我们到底在测量什么

产品目的不是“与 Writer A 用同样的词”，而是：

> 写手上传图片后，尽快得到一个事实可靠、可直接上架、若要修改也只涉及
> 可选表达偏好的标题。

因此有三个被测对象：

1. **卡片事实识别质量**：对应 CSM canonical object；
2. **市场标题可发布性**：对应 SEM + Composer output；
3. **写手工作量**：对应盲选偏好、无修改接受率和语义修改量。

Writer A 的单条标题只对第 2、3 项提供有限证据，不能充当第 1 项的完整
字段真值。

## 2. 推荐设计：Semantic Publication Gate (SPG)

### 2.1 数据单位

最小单位不是 token，而是 typed semantic claim：

```json
{
  "field": "print_finish",
  "concept_id": "finish:gold-refractor",
  "value": "Gold Refractor"
}
```

每张卡有三个 claim 集合：

- `G_i`：独立人审后的 gold claims；
- `C_i`：CSM canonical claims；
- `T_i`：最终标题实际发出的 claims，由 Composer trace 提供。

两条 arm 必须使用完全相同的 claim representation。不能再出现 canonical
arm 按 fields 评分、string arm 按 title 评分。没有 typed trace 的纯字符串
arm，要么由盲审者做 claim segmentation，要么不具备 SPG 评分资格；不能用
title-derived SEM 给它自动补身份，因为那会用解析器给解析器打分。

`concept_id` 不是运行时 Composer 的必填输出。运行时首先要忠实记录
`field/value/rendered text/title span/source/transform`；冻结的离线 registry 再把
value 解析成 concept。显式传入未知 concept id、跨 field concept id，或 registry
内容与冻结 SHA 不一致时，scorer 必须 fail closed。

### 2.2 Gold label 必须有两个独立轴

每个 claim 分开标注：

```json
{
  "truth_status": "SUPPORTED | CONTRADICTED | UNKNOWN",
  "truth_source": "CARD_IMAGE | SLAB_LABEL | OFFICIAL_SOURCE | ADJUDICATED",
  "title_policy": "REQUIRED | OPTIONAL | FORBIDDEN | NOT_APPLICABLE",
  "evidence_refs": [],
  "adjudicated": true
}
```

这两个轴不能再放进同一个互斥枚举：

- `Gold Refractor` 可以同时是 `SUPPORTED + OPTIONAL`；
- TCG Manufacturer 可以是 `SUPPORTED + FORBIDDEN`；
- 错误的 `Blue Refractor` 是 `CONTRADICTED + NOT_APPLICABLE`；
- 图片无法确定的工艺是 `UNKNOWN`，不得强行写成 false。

### 2.3 同义词和层级

同义词由版本化 concept registry 处理：

- `Auto` 与 `Autograph` 指向同一个 concept id；
- `RC` 与 `Rookie` 指向同一个 concept id；
- 大小写、重音和复数只做表面 normalization，不创造新事实。

层级不使用任意 partial-credit 权重：

- `Gold Refractor` 是 `Refractor` 的子概念；
- 输出 `Refractor` 时，它是一个真实的泛化，所以不扣 claim precision；
- 但它没有恢复 `Gold Refractor` 的 leaf specificity，因此不能获得 exact fact
  recall；
- 如果 gold 把 `Gold Refractor` 标为 title `REQUIRED`，泛化的 `Refractor`
  也不能满足 required recall；
- 如果它是 `OPTIONAL`，标题可以省略或只写真实的上位概念，但 canonical
  recognition 仍因没有识别 leaf 而损失 exact fact recall。

这样“修对 Gold Refractor”严格优于“删除 finish”，同时“写手没有在标题里
写可选 finish”不会被误判成事实错误。

### 2.4 数学定义

对每张卡：

```text
Recognition Verified Precision
  = supported canonical claims
    / (supported canonical claims + contradicted canonical claims)

Recognition Exact Fact Recall
  = independently supported gold leaf claims recovered exactly in C_i
    / independently supported gold leaf claims

Required Title Recall
  = REQUIRED gold claims satisfied by T_i
    / REQUIRED gold claims
```

`UNKNOWN` 不进入 precision 分母伪装成 false，也不能被忽略。任何已发布的
unknown claim 会进入 unresolved ledger，并阻止该卡成为 publishable。

进入评分前，annotation packet、scorer、critical policy 与 concept registry 都必须
版本冻结；后两者的声明 SHA 必须与规范化内容重算结果一致。否则该卡是
`ineligible`，publishability 为 `null`，不是 fail 也不是 pass。

一张卡只有同时满足以下条件，`publishable_i = 1`：

1. annotation 完整且全部经过独立 adjudication；
2. canonical 和 title 都没有 contradicted claims；
3. 已输出 claim 中没有 unresolved claim；
4. 所有 `REQUIRED` claims 已发出；
5. 所有 `FORBIDDEN` claims 未发出；
6. critical false、critical unresolved、critical required-missing 全部为 0；
7. 标题长度、grammar、redundancy 三个确定性检查全部通过。

主指标：

```text
Publishable Card Rate = sum(publishable_i) / eligible_cards
```

`annotation_complete = false` 时，分数必须是 `null`，不能把缺标签当通过。

### 2.5 为什么它不会奖励“截肢”

以错误 print_finish 为例：

| 操作 | False claim | Exact fact recall | 标题可发布性 |
|---|---:|---:|---|
| 保留错误 finish | 有 | 0 | Fail |
| 删除 finish | 无 | 0 | 若 OPTIONAL 可 Pass |
| 修成正确 finish | 无 | 1 | Pass |

删除可以使标题暂时安全，但不能提升 recognition recall；修对同时改善
recognition 和 publishability。两者不再被压成几乎相同的 token F1。

### 2.6 它会在什么情况下骗人

- Gold claims 漏标时，unresolved rate 会被人为抬高；因此不完整卡必须
  `ineligible`，不能默认为错或对。
- Concept hierarchy 写错会系统性偏袒某种表达；registry 必须版本化、独立
  审核并在 arm 输出冻结前确定；scorer 会重算 registry SHA，不接受只填一个
  64 位字符串的“纸面冻结”。
- `REQUIRED/OPTIONAL/FORBIDDEN` 仍有写手偏好；它要由独立写手标注并按
  STANDARD/TCG/LOT grammar 分层报告，不能由机制作者决定。
- PCR 是严格 pass rate，对小缺陷敏感；所以必须同时报告三个 driver ledger，
  不能只报一个百分比。

## 3. 辅助设计一：Blind Pairwise Writer Preference

### 定义

给独立写手看图片和匿名 A/B 标题，不给 Writer A reference、arm 名、模型
置信度或实验假设。写手选择 `A / B / TIE / BOTH_UNPUBLISHABLE`。

### 真值与单位

- 真值来源：两位独立写手 + 第三人只裁定分歧；
- 单位：card-level pairwise preference；
- 同义、层级和可选项由写手按市场用途自然处理。

### 成本

60-100 张 contested cards 通常约 1-2 reviewer-hours/人，另加 adjudication；
实际速度要用前 20 张 pilot 计时后更新。

### 它会骗人

两条 arm 如果共享同一个事实错误，写手可能仍会选一个“更好看”的标题。
所以它只能是 marketplace outcome，必须在 SPG critical gate 之后使用，不能
替代 field truth。

## 4. 辅助设计二：Writer As-is Acceptance / Semantic Edit Burden

### 定义

生产中记录：

- `as_is_acceptance_rate`：写手不改事实直接确认的卡占比；
- `critical_edit_rate`：写手修改身份、年份、serial、grade、数量等的卡占比；
- `semantic_edits_per_card`：按 typed field event 记录修改，不按字符串 Levenshtein；
- `time_to_confirm`：标题出现到确认的时间。

### 真值与单位

- 真值来源：真实 writer action；
- 单位：card/session；
- 可选词序和同义改写不应被算成事实错误。

### 成本

需要前端持久化真实 field-level edit event，并绑定已经存在的 session/image
lineage；不需要为 lineage 另建一条链。上线后边际标注成本低，但需要足够真实流量。

### 它会骗人

写手可能因为赶时间接受错误标题，也可能因个人风格重写正确标题；不同写手
熟练度和卡种会造成 selection bias。因此这是长期业务 outcome，不是离线
gold truth。

## 5. 真值采集方案

### 5.1 不需要机械标 150 x 15 个 bracket

最省成本的 gold construction 是 claim-union review：

1. 取 control 与 treatment 的 canonical/title claim union；
2. 加入 Writer A 标题无法覆盖的 critical anchors；
3. 独立 reviewer 看原图，必要时看有版本和 SHA 的官方来源；
4. reviewer 分别填 truth axis 与 title-policy axis；
5. 两人分歧由第三人 adjudicate；
6. 未决定项保留 `UNKNOWN`，不允许多数猜测变成 truth；
7. 最后做一次 required-fact scan，补充“两条 arm 都漏掉”的 gold claims。

最后一步非常关键。只审 arm union 会让两条 arm 共同漏掉的事实从 recall
分母消失，从而虚高新尺子。

### 5.2 Reviewer 隔离

- 尺子作者不能单独担任 reviewer；
- A/B 顺序使用 asset hash 固定随机；
- reviewer 看不到 reference title、arm 名、模型 confidence、当前 F1 或假设；
- scorer、concept registry、critical policy 在 sealed labels 打开前冻结 SHA；
- tuning set 与 sealed meta-validation set 按 physical card/capture session 隔离。

### 5.3 现有 117 卡 / 285 dispute packet 的实际能力

零调用审计结果：

| 项目 | 数量 |
|---|---:|
| cards | 117 |
| disputes | 285 |
| 带 model evidence | 108 |
| 可直接映射 canonical field | 267 |
| 需要重新判 field role | 18，全部来自 `components` |
| truth/title 两轴被混成一个枚举 | 285 |
| 已填独立 labels | 0 |

因此这个 packet：

- 修成 dual-axis 后，可以校准 reference-absent prediction 的 precision；
- 不能计算 recognition recall，因为它没有完整 supported gold facts；
- 不能计算 Publishable Card Rate，因为它没有 required-missing scan；
- 不能直接给任何 arm GO/STOP。

对应审计命令：

```bash
node scripts/audit-ruler-annotation-readiness.mjs
```

### 5.4 Required-fact scan 的覆盖验收

`union + required scan` 不能自己证明分母完整。先从同一 source pool 按 hash
划出 20 张 coverage-only cards，再封存其余 meta-validation cohort。把这 20 张交给
一位没有看到任何 arm claims、也没有参与这 20 张 gold construction 的 reviewer
做无约束整卡 typed transcription；它们
只审 gold construction，不进入 ruler meta-validation，也不能验后塞回 sealed set。

把 unrestricted transcript 记为 `U_i`，构造后的 gold 记为 `G_i`：

```text
Exact Gold Coverage = sum(|U_i intersect G_i|) / sum(|U_i|)
Critical Gold Coverage = captured critical claims / transcript critical claims
```

这里的交集必须通过同一个冻结 concept registry/claim resolver 计算，不得直接比较
raw string，也不得见到 `concept_id` 就忽略 value。显式 concept id 的 field/value
必须与 registry 一致；`Auto/Autograph` 这类 alias 应合并；重复或冲突 gold claim
直接 fail closed。

预注册通过条件：

- 20/20 卡完成；
- micro Exact Gold Coverage `>=0.95`；
- macro card Exact Gold Coverage `>=0.95`，且任一卡不得低于 `0.80`；
- Critical Gold Coverage `=1.00`；
- critical-field policy 已批准、冻结，且内容重算 SHA 匹配；
- 按 field 和 grammar 报告 missing ledger，不能只报总均值。

这里不报 claim-level Wilson：同一卡里的 claims 不是独立 Bernoulli 样本，把它们
当 IID 会虚构精度。20 卡只是 gold-construction 的 process audit，不是对总体覆盖率
做 95% 统计证明；真正的尺子元验收仍由固定 sealed100 独立卡承担。

如果失败，只能修 gold construction 流程并在另一批 coverage cards 上重验；
不能把本批 unrestricted transcript 直接补回后，再把同一批称为通过。

已实现 `gold-coverage-audit-v1` 及反事实测试。浅扫描每卡漏一个非关键事实时
coverage 为 `0.90` 并失败；漏任一 critical fact 也失败；完整 gold 才通过。

## 6. 新尺子的元验收

“更贴合 CSM”不是元验收。唯一有效的验收是：新尺子在未见过的争议卡上，
是否比 token F1 更接近独立人类判断。

### 6.1 三阶段协议

#### Stage A - 逻辑反事实

必须固定通过：

- 修对错误字段优于删除；
- 删除 OPTIONAL title fact 不降低 publishability，但降低 recognition recall；
- 同义词不互相扣分；
- 上位概念不算 false，但不能冒领 leaf exact recall；
- REQUIRED leaf 不能被泛化词满足；
- 任意 critical false 或 critical unresolved 阻止发布；
- 缺 gold labels 返回 null，不得 fail-open。

这些测试已实现并通过。

#### Stage B - 独立盲判 calibration

1. 先用 20-30 张 pilot 修 ballot/ontology 的机械问题；pilot 不计最终结果；
2. 根据 pilot 的 card-level paired delta 做预注册 power simulation，随后一次性冻结
   `n=100`；不得看 sealed outcome 后从 60 追加到 100；
3. 在出 label 前冻结 scorer bundle、critical policy、concept registry、grammar
   checker SHA、arm outputs、source pool 与 salted-hash selection manifest；100 张必须
   是 100 个不同 physical card/capture，并覆盖至少三组正交 arm；
4. 预先冻结 STANDARD/TCG/LOT 与 arm-pair 配额。任何要作正式门的 stratum 至少
   20 张；达不到时该层只能报 descriptive/`INCONCLUSIVE`，不能被总均值代替；
5. 两位独立 reviewer，第三人只裁定分歧；
6. 独立 marketplace panel 对每个匿名标题只回答 `AS_IS_PUBLISHABLE / NEEDS_EDIT`；
   同卡两臂自然形成 `A_ONLY / B_ONLY / BOTH / NEITHER`，不要求写手在两个都能
   发布时硬选一个；
7. SPG 对每个 arm 输出 publishable boolean；legacy token F1 只有在 tuning set
   预先冻结单标题 threshold 后，才能输出同一 binary prediction；
8. 在 sealed set 上计算 sensitivity、specificity、balanced accuracy；同一卡两臂的
   不确定性必须按 card cluster bootstrap 或 paired randomization 估计，不能把 200
   个标题当成 200 个独立样本。

Gold truth/title-policy panel 与 marketplace as-is panel 必须彼此看不到对方标签；
后者不得看到 concept registry、required policy 或任何分数。差值区间使用 paired
card bootstrap 或等价的 paired randomization，不使用把两臂拆开的 item-level Wilson。

建议通过条件如下；它们在 owner 批准并写入 selection manifest 前仍是
`PROPOSED`，不得验后调整：

- 100/100 评分材料完整，并共享一个验前封存的 cohort approval manifest；
- 200 个 arm-title labels 中至少 30 个 `AS_IS_PUBLISHABLE`、30 个 `NEEDS_EDIT`；
  任一类不足则本次只能 `INCONCLUSIVE`；
- SPG balanced accuracy `>=0.80`，且 sensitivity、specificity 各 `>=0.75`；
- `balanced_accuracy(SPG) - balanced_accuracy(token F1)` 的 card-clustered paired
  95% CI 下界 `>0`；
- 匿名展示顺序互换不改变单标题判断，不能出现 arm-position bias；
- 达到正式样本下限的 grammar/arm-pair stratum 不得出现显著反向；未达下限的
  stratum 明示 `INCONCLUSIVE`，不能写成通过。

样本量不能再用单个 discordance 比例 `q` 的近似式验后解释。正确做法是用 pilot
得到的每卡 paired correctness delta 与标签 prevalence，按预定检验做 Monte Carlo
或 permutation power simulation，验前锁定 `n=100`。如果预算内功效仍不足，结论
就是 `INCONCLUSIVE`；不能追加样本、换阈值或改 strata 后继续看同一 sealed set。

`expected_approval_manifest_sha256` 必须从独立、append-only 的 approval allowlist
读取，不能由当前评分请求携带的 manifest 现场计算。当前 evaluation skeleton 只会
验证传入 expected SHA 与所有材料是否一致，还没有 authority allowlist；因此即使
逻辑测试全绿，也仍是 `HUMAN_UNVERIFIED/PRODUCTION_STOP`。

#### Stage C - 独立 promotion cohort

只有 Stage B 通过后，才在另一批独立 105 张 cohort 上使用 SPG。source pool、
目标 tenant/grammar/card-type mixture、salted-hash selector 和 105 个 asset/
physical-card 映射必须在输出与 labels 之前封存；同一实体卡的不同照片不能重复计。

主 cohort 必须按目标生产 mixture 做无权重抽样，才能使用后面的 `101/105`
Wilson 门。为观察稀有 grammar 而额外富集的卡放进独立 diagnostic cohort；若主
cohort 使用分层/加权抽样，就必须改用预注册的 design-weighted estimator，不能再
把 `101/105` 叫作生产 PCR。

candidate 与当前 approved control 在相同 105 张图片上各冻结一份输出，再开 gold
labels。若已有同版本、同图片、验前冻结的 control trace 可以复用，就不重复付费；
否则不能拿历史异质 cohort 冒充 paired control。105 张任一张材料不合格时，PCR
分母不得缩小，本次 Stage C 为 `INCONCLUSIVE/STOP`。

Stage C 的 CI 实现规格也必须写进同一验前 manifest：resampling unit 是唯一
`physical_card_id`，candidate/control 必须成对抽取；任何 expected card 的 recall 或
precision 为 null 时整次 gate 不具备资格，禁止 pairwise deletion。默认使用
100,000 次 deterministic paired card bootstrap，seed 由
`sha256(cohort_selection_sha256 | scorer_bundle_sha256)` 导出，报告 percentile 95%
区间；若 selection manifest 预先定义了 strata，则在 strata 内重采样并用预定 target
weights 汇总。`-0.01/-0.005` 两个非劣界、absolute `0.90` 门、seed、replicates、
null policy 与 CI 方法必须一起冻结。所有条件是合取的 intersection-union gate，
不能只挑显著的一项报告。

## 7. `0.90` 应该换成什么

不能把旧 F1 的 `0.90` 直接复制到任意新连续分数。推荐把它翻译为一个可
解释的 card-level 目标：

> 真实 Publishable Card Rate 的 95% Wilson 下界高于 0.90。

在 105 张独立卡上：

- `100/105` 的下界约 `0.8933`，不通过；
- `101/105` 的下界约 `0.9061`，通过；
- 所以 promotion 门是至少 `101/105` 张 publishable。

同时必须：

- observed critical-false cards = 0；
- observed critical-unresolved cards = 0；
- candidate 相对 paired control 的 Recognition Exact Fact Recall 差值，card-level
  paired 95% CI 下界 `>= -0.01`；
- candidate 相对 paired control 的 Recognition Verified Claim Precision 差值，
  card-level paired 95% CI 下界 `>= -0.005`；
- candidate 的 macro Recognition Exact Fact Recall，card-bootstrap 95% CI 下界
  `>=0.90`；
- candidate 的 macro Recognition Verified Claim Precision，card-bootstrap 95% CI
  下界 `>=0.90`；
- 全部标题 `<=80`；
- 单次 Luna、reasoning none；
- latency/cost 不突破已批准预算。

上面 `-1pp/-0.5pp` 是保守的候选 non-inferiority margin，不是已经批准的业务
常数。owner 必须在开 labels 前，按漏事实与写错事实的损失函数批准或收紧；验后
不能改。critical fields 不使用平均非劣界，任何 observed false/unresolved 都直接
STOP。所有 driver 还要按 field 与 grammar 出 ledger：样本足够的层出现实质反向
就阻止 promotion，样本不足的层只报 `INCONCLUSIVE`。

这组门防止 candidate 靠删光 OPTIONAL facts 提高 PCR。PCR 回答“能不能直接发”，
paired recognition guardrail 回答“是否以损失识别能力换安全”；两者必须同时通过。
因此这里的“准确率超过 90%”不是单指 PCR：publishability、recognition exact
recall 和 verified precision 三个下界都要过 0.90，同时还要相对 control 非劣。

需要说清统计边界：105 张里 0 个 critical error，只能把总体错误率的 95%
上界限制到约 `2.81%`，不能声称总体“绝对为零”。若要证明错误率低于：

- `1%`：至少需要 299 个连续零错误样本；
- `0.1%`：至少需要 2995 个连续零错误样本。

这不要求增加 provider paid cohort。可以在已经产生、相互独立且有可靠真值
的生产/回放样本上累计，但不能重复计同一 physical card/capture。

## 8. 是否需要 `F1(Writer A, Writer B)`

SPG 的字段真值不依赖 `F1(A,B)`，所以它不是构建新主尺的前置条件。但它
对两件事有价值：

1. 量化旧 token F1 的 human-human ceiling；
2. 决定 token F1 应保留多宽的 compatibility band。

样本量不能在不知道方差时伪精确：

- 先做 30 张 independent-title pilot，估计 per-card F1 标准差；
- 若标准差约 `0.15-0.20`，把 mean F1 的 95% 区间控制在约 `+-0.03`，需要
  约 97-171 张；现有 150 张量级合理；
- 若完全不假设方差，按 `[0,1]` 最坏界需要约 1068 张，现实上没有必要；
- 推荐使用 100-150 张独立 Writer B 标题，并始终报告 bootstrap CI 与
  grammar 分层，不只报一个均值。

当前已经有一个更便宜的第一阶段 harness（提交 `a758386a`）：

- `scripts/build-writer-b-packet.mjs`：按 asset hash 从 150 张中固定抽 50 张，
  packet 只含图片和空白 Writer B title；
- `scripts/score-writer-agreement.mjs`：在同一批卡上报告 `F1(A,B)`、
  `F1(system,A)`、`F1(system,B)` 及 deterministic bootstrap CI；
- 已生成的 50 行 worksheet 经扫描不含 Writer A title、system title、score
  或 sealed label；`faa205c5` 评审时 100/100 个图片 URL 可访问。URL 有时效，
  真正发给 Writer B 前仍要复验，过期只重签、不重抽样。

这里的样本量目标不同，不矛盾：若真实 writer agreement 约 0.83，已知
per-card SD 约 0.1439，则 n=50 足以判断其区间是否明显低于 0.90；若要把
human-human mean 估到约 `+-0.03` 并做 grammar 分层，仍建议扩到 100-150。
这个 harness 只测旧 token F1 的 human ceiling，不能替代 SPG dual-axis labels。

## 9. 任务书中需要纠正的前提

### 9.1 “88% 不是错误”过度推断

证据只支持“285 个 reference-absent 词中，12% 已确认明显错误”。其余 88%
包含 142 个 unresolved，不能直接宣布为真或非错误。

### 9.2 `0.856-0.923` 不是完美系统的期望区间

这两个数是受 Writer A reference 约束的 deletion/addition oracle，不是对
perfect system 的统计估计。它们证明 token F1 的目标函数有冲突，但不能
用来声明真实 ceiling。

### 9.3 四条机制接近零，不足以单独证明尺子饱和

也可能是机制真实收益很小、105 张统计功效不足、或成本抵消了收益。尺子
失效的强证据是已审计的事实/可选项混淆和盲判失败，不是“四次实验没显著”。

### 9.4 第二写手 packet 尚未真的分成两轴

当前 `reviewer_options` 是单一互斥列表，一个 reviewer 不能同时表达
`VISIBLE_TRUE + OPTIONAL_TITLE`。v2 必须用两个字段。

### 9.5 CSM 契约定义合法性，不自动提供事实真值

字段顺序、类型和 drop priority 可以来自 CSM/SEM；某张卡是否真是
`Gold Refractor` 仍要来自图片、slab、官方 release source 或独立 adjudication。

### 9.6 “零 critical error”是 cohort 观察，不是总体证明

105/105 无错误仍有约 2.81% 的总体上界。报告必须写 observed count 和区间，
不能只写“zero”。

## 10. 已实现的 evaluation-only 骨架

核心：

- `lib/listing/evaluation/semantic-publication-contract.mjs`
- `lib/listing/evaluation/semantic-publication-concepts.mjs`
- `lib/listing/evaluation/semantic-publication-ruler.mjs`
- `lib/listing/evaluation/semantic-publication-material-validator.mjs`
- `lib/listing/evaluation/semantic-publication-cohort-gate.mjs`
- `lib/listing/evaluation/ruler-annotation-readiness.mjs`
- `lib/listing/evaluation/gold-coverage-audit.mjs`

验证与审计：

- `scripts/semantic-publication-ruler.test.mjs`
- `scripts/ruler-annotation-readiness.test.mjs`
- `scripts/audit-ruler-annotation-readiness.mjs`
- `scripts/gold-coverage-audit.test.mjs`

复跑：

```bash
node --check lib/listing/evaluation/semantic-publication-ruler.mjs
node --check lib/listing/evaluation/semantic-publication-contract.mjs
node --check lib/listing/evaluation/semantic-publication-concepts.mjs
node --check lib/listing/evaluation/semantic-publication-material-validator.mjs
node --check lib/listing/evaluation/semantic-publication-cohort-gate.mjs
node --check lib/listing/evaluation/ruler-annotation-readiness.mjs
node scripts/semantic-publication-ruler.test.mjs
node scripts/ruler-annotation-readiness.test.mjs
node scripts/audit-ruler-annotation-readiness.mjs
node scripts/gold-coverage-audit.test.mjs
```

已验证输出：

- repair fact recall `0.5`，delete `0`；
- OPTIONAL omission 仍可 publish；
- generic parent title 可为真，但 REQUIRED leaf 不通过；
- critical false 不可 publish；
- critical policy 未以 `FROZEN_APPROVED + SHA` 提供时，整卡不具备评分资格；
- critical policy 与 concept registry 的声明 SHA 都会按规范化内容重算；
- scorer bundle 覆盖 contract、concept resolver、semantic scorer、material validator、cohort gate、
  gold coverage audit 与 CSM/SEM field definition；外置 grammar checker 另以 SHA
  绑定，不能只写一个可复用名字；
- 未批准/被篡改的 registry、未知 concept id、跨 field concept id 均 fail closed；
- title trace 的 `source_fields` 必须包含 claim 自己的 canonical field，不能把 year
  假称为 finish 的来源；render span、transform 与最终 title 不一致时 fail closed；
- 每个 title claim 还必须能从同卡 canonical claim exact/approved-generalization 推导；
  只有同名 `source_fields`、却没有对应 canonical identity 时整卡 ineligible；
- annotation claim 必须有合法 `truth_source` 与非空 `evidence_refs`；仅写
  `adjudicated=true` 不能构造可评分材料；
- `redundancy_ok` 由 typed title claims 自动计算，覆盖同义重复和父子概念共发，
  不再接受手填布尔值；
- 重复 10 次正确 claim 不能稀释 1 个错误 claim；precision 按 semantic set 计数，
  重复 gold annotation 直接拒绝；
- gold scan 每卡漏一个事实时 coverage audit 会失败；
- 105 张达到 PCR 下界 `>0.90` 的最小通过数是 `101`；
- 当前 cohort module 只验证固定分母与材料资格，并明确返回
  `promotion_decision=null`；paired/absolute recognition gate 未实现前，代码不能给 GO；
- 现有 packet 117 cards / 285 disputes，267 可映射，18 个 `components`
  需要 field-role review，独立 labels 为 0。

## 11. 当前结论和下一步

当前可以确认的是：

- 新尺子的逻辑结构可执行；
- 它能形式化区分“修对”和“删除”；
- 它能把事实真值、标题可选项和层级具体度拆开；
- 现有 285 packet 不足以生成主分数；
- 没有独立人审前，它仍是 `HUMAN_UNVERIFIED`。

当前不能确认它是正资产。我们只验证了逻辑单调性、抗刷分和材料封存；Stage B
还没有独立人类元验收，Stage C 也没有 paired fresh105。因此状态继续是
`PRODUCTION_STOP`，不得拿零调用反事实测试代替真实 promotion 证据。

当前最便宜的下一个证据是由非尺子作者完成 dual-axis mechanics pilot；但它不是
唯一的 promotion blocker。正式使用前还必须完成：独立 sealed meta-validation、
critical policy 与 COS-43 concept registry 冻结、可信 Composer claim trace、以及
gold coverage audit。任何一项未完成，SPG 都只能返回 ineligible/null。

coverage audit 目前还有一个显式 P2：`STANDARD/TCG/LOT` 是 evaluation-only
fail-closed allowlist；CSM/SEM 尚未导出正式 grammar enum。它不阻止本轮逻辑提交，
但在 CSM 提供 authority 前不能升级成生产规则。

blind pilot 前不得用本尺子重新判 print-finish、visual、literal、world model 或
任何已存在 arm 的 GO/STOP，更不得接入 Production。

## 12. `faa205c5` 评审后的修订

### 12.1 评审意见处置

| 评审项 | 处置 |
|---|---|
| required-fact scan 没有验收规格 | 接受；新增独立 20 卡 unrestricted transcription coverage gate |
| 人力成本未汇总 | 接受；见 12.2，执行前先批准预算 |
| PCR 不适合作迭代指标 | 接受；PCR 固定为 release gate，driver 向量才指导迭代 |
| typed claim trace 缺口 | 部分接受；先持久化 field/value/render span/provenance，concept_id 等 COS-43 |
| concept registry 不存在 | 接受；registry 属于 CSM 治理，应用层不得先造既成事实 |
| 把 concept_id 当 trace 首要缺口 | 不接受；根因是最终 Composer 没有 claim ownership/span，concept 可离线解析 |
| 在线反馈指标约八成可用 | 不接受；只有 as-is 可直接派生，其余缺 typed event 或浏览器时间点；见 12.5 |
| redundancy_ok 是手填后门 | 接受并修复；typed checker 计算同义与父子概念冗余 |
| critical policy 未批准 | 接受并修复；没有经内容校验的 `FROZEN_APPROVED + SHA` 时 SPG 返回 ineligible |
| 60 不够再看结果扩 100 | 不接受；改为验前 power simulation 后固定 100，禁止 optional peek |
| PCR 单门可防删除刷分 | 不接受；Stage C 新增 paired recall/precision non-inferiority guardrail |
| coverage 可以直接比 concept_id/raw value | 不接受；coverage 复用冻结 resolver，校验 id/value/field 与 alias |
| source_fields 足以证明 title lineage | 不接受；T_i 必须由同卡 C_i 的同一 identity 或批准泛化推导 |
| 文件继续堆在一个 scorer | 不接受；拆成 contract/concept resolver、semantic scorer、material validator、cohort gate |

### 12.2 人力成本和最省钱顺序

以下是执行前预算，不是假装精确的工时承诺。先用前 20 张记录实际秒数，再
收窄区间：

| 工作 | 人力假设 | 预计总人时 |
|---|---|---:|
| Writer B 盲写 50 张 | 1 人，45-90 秒/卡，加交接 | `0.8-1.5h` |
| dual-axis mechanics pilot 25 卡/45 claims | 1 人，只查表格机制 | `0.7-1.5h` |
| sealed100 完整 gold + required scan | 2 人独立判断，10-14 claims/卡 | `12-27h` |
| sealed100 A/B marketplace label | 2 人，30-60 秒/arm-title | `2-4h` |
| gold coverage audit 20 卡 | 1 人无约束整卡转录，3-5 分钟/卡 | `1-1.7h` |
| 分歧裁定与数据整理 | 只裁定真实分歧 | `2-4h` |

因此：

- 先发 Writer B 50 卡：约 `0.8-1.5h`，立即测旧尺子的 human ceiling；
- SPG fixed sealed100 元验收：约 `18-38h`；
- 不设置“先 60、看结果再追加”的路径；pilot 只用于流程与验前功效估计。

不建议在 SPG 自身通过元验收前，把现有 285 disputes 全部双人标完。它们是
precision error taxonomy，不是证明尺子有效的必要前置；先全标预计还要
`4-8h`，长期可能有用，但短期会把最稀缺的人力押在一把尚未通过的尺子上。

### 12.3 Typed trace 与 concept registry 解耦

最小可用 trace 是：

```json
{
  "claim_id": "stable-per-output-claim-id",
  "field": "print_finish",
  "canonical_value": "Gold Refractor",
  "rendered_text": "Gold Refractor",
  "title_spans": [{ "start": 42, "end": 57 }],
  "source_fields": ["print_finish"],
  "transform_codes": ["EXACT_OR_ALIAS"],
  "emission_status": "FULL",
  "concept_id": null
}
```

`concept_id` 在 COS-43 registry 冻结前必须允许为空。先写临时 concept id 会让
应用层提前定义 CSM 本体，违反本设计最重要的 authority 边界。SPG gold
package 可以在离线评分时，把 claim 映射到独立审核的 concept registry；运行时
trace 只负责忠实记录 Composer 从哪个 bracket 发出了什么。

trace 必须在 Composer 最终 normalization、dedupe、budget、restore 和 hard
truncation **之后**生成。现有 `included_brackets` 不能替代它：截断后 ledger
没有重算，可能声称某个 bracket 已发出，而标题里只剩半个词或已完全删除。
只有 `emission_status=FULL` 的 atomic claim 才能进入 `T_i`。

每种 `transform_code` 必须有冻结的确定性 validator。当前 evaluation skeleton 只
接受 `EXACT_OR_ALIAS` 与 `LOT_CARD_LOT`；prefix compaction、复合短语等在 validator
落地前一律 fail closed。trace 的 `source_fields` 还必须包含被声明 claim 自己的
canonical field，防止借一个真实但无关字段伪造 provenance。

### 12.4 在线和离线的职责

- SPG：离线 promotion gate，需要独立 gold，不可能成为每个生产请求的实时
  accuracy score；
- 在线：持续收集 as-is acceptance、critical edit、semantic edits/card 和
  time-to-confirm；
- 在线数据只能形成 learning candidate，不能因为写手按下确认就自动成为
  semantic truth；
- 两套指标通过 session、image、canonical packet 和 Composer trace lineage
  连接，但 authority 不互相继承。

### 12.5 代码审计后的真实接入差距

评审 3.3 把线上材料成熟度估高了。当前不是“八成已有，只差聚合”：

| 指标 | 当前可用程度 | 不能冒充的部分 | 最小补法 |
|---|---|---|---|
| as-is acceptance | 可直接由当前 terminal `ACCEPT/EDIT/REJECT` 派生 | 旧 410 route 的聚合 | 只聚合当前 feedback revision，按 tenant/model/prompt/grammar 分层 |
| critical edit | `0/1` 真 typed event | 当前 `field_level_diff` 是标题反解析、仅 8 个粗字段且漏 deletion | 提交时持久化 immutable `field/from/to/change_kind`，再按冻结 policy 派生 |
| semantic edits/card | `0/1` 真 typed event | Production 明确不提交 reviewed semantic fields，ground truth 恒为空 | 与 critical edit 共用 typed delta，不另造解析链 |
| time-to-confirm | 只有 server-ready 到 click 的上偏代理 | 浏览器 title-visible 时刻未持久化 | 首次展示结果时冻结 `title_presented_at` 与 monotonic duration |

反而 session -> durable asset -> verified image set 的 lineage 已由 identity snapshot、
image-set SHA、RPC 和 trigger 校验接通；不应重复建表。仍缺的是跨不同拍摄识别
同一实体卡的 `physical_card_id`，只有需要跨 capture 去重时才新增。

typed trace 上线前还有两个更靠前的 STOP blocker：

1. `finishCanonicalTitle()` 会丢 `bracket_text`、character budget 和部分 projection
   ledger，并重命名 drop/suppress/restore；persistence 仍按 raw Composer shape 读，
   所以真实 orchestration 的 drop trace 不完整；
2. persistence 当前写 `structured_output.evidence`，而 foundation migration 的
   CHECK 明确禁止该顶层 key；JS 单测没有执行数据库 CHECK。

因此正确顺序是：先补 real-seam 与 SQL-contract 反事实测试并修这两处，再做
Composer-owned claim trace；之后才接 typed writer edits。COS-43 registry 可以并行
治理，但不得以阻塞为由在应用层临时造 concept id。
