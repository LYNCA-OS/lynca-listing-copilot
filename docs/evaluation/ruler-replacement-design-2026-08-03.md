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
| Primary | Publishable Card Rate (PCR) | 有多少卡可以不改事实直接发布 |
| Driver 1 | Recognition Exact Fact Recall | 修对字段是否优于删掉字段 |
| Driver 2 | Recognition Verified Claim Precision | canonical 是否加入错误事实 |
| Guardrail 1 | Critical false / unresolved card count | 身份、数字、grade 等硬错误一票否决 |
| Guardrail 2 | 80-char legality + latency/cost | 防止分数靠变长、变慢或多调用换来 |
| Secondary outcome | Blind Writer Preference / As-is Acceptance | 衡量写手市场表达偏好，不冒充字段真值 |

token F1 保留为 legacy compatibility metric 和回归诊断，但不再单独决定
GO/STOP。

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
  审核并在 arm 输出冻结前确定。
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

需要前端把 field-level edit event 与 session/image lineage 持久化。上线后边际
标注成本低，但需要足够真实流量。

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
2. 冻结 scorer、critical policy、concept registry 和 arm outputs；
3. 使用至少 60 个 adjudicated non-tie contested comparisons，覆盖至少三组
   正交 arm 和 STANDARD/TCG/LOT；
4. 两位独立 reviewer，第三人裁定分歧；
5. token F1 与 SPG 都只输出 arm preference，不看 reviewer label；
6. 在 sealed set 上比较它们与 adjudicated preference 的 paired agreement。

通过条件：

- SPG absolute agreement `>= 0.80`；
- `agreement(SPG) - agreement(token F1)` 的 paired 95% CI 下界 `> 0`；
- A/B 互换后结果完全反向，不能出现 arm-name bias；
- 各 grammar 和各 arm pair 不得出现方向相反的系统偏差；
- 如果 60 个 non-ties 不足以得出结论，扩到 100；不得在看过 sealed labels
  后改规则再重算同一 set。

#### Stage C - 独立 promotion cohort

只有 Stage B 通过后，才在独立 105 张 cohort 上使用 SPG。旧 token F1 同时
报告，作为 bridge，不再是唯一门。

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
- 全部标题 `<=80`；
- 单次 Luna、reasoning none；
- latency/cost 不突破已批准预算。

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
  或 sealed label；当前 URL 未签名，需要由正确环境生成短期 signed URL。

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

- `lib/listing/evaluation/semantic-publication-ruler.mjs`
- `lib/listing/evaluation/ruler-annotation-readiness.mjs`

验证与审计：

- `scripts/semantic-publication-ruler.test.mjs`
- `scripts/ruler-annotation-readiness.test.mjs`
- `scripts/audit-ruler-annotation-readiness.mjs`

复跑：

```bash
node --check lib/listing/evaluation/semantic-publication-ruler.mjs
node --check lib/listing/evaluation/ruler-annotation-readiness.mjs
node scripts/semantic-publication-ruler.test.mjs
node scripts/ruler-annotation-readiness.test.mjs
node scripts/audit-ruler-annotation-readiness.mjs
```

已验证输出：

- repair fact recall `0.5`，delete `0`；
- OPTIONAL omission 仍可 publish；
- generic parent title 可为真，但 REQUIRED leaf 不通过；
- critical false 不可 publish；
- 105 张达到 PCR 下界 `>0.90` 的最小通过数是 `101`；
- 现有 packet 117 cards / 285 disputes，267 可映射，18 个 `components`
  需要 field-role review，独立 labels 为 0。

## 11. 当前结论和下一步

当前可以确认的是：

- 新尺子的逻辑结构可执行；
- 它能形式化区分“修对”和“删除”；
- 它能把事实真值、标题可选项和层级具体度拆开；
- 现有 285 packet 不足以生成主分数；
- 没有独立人审前，它仍是 `HUMAN_UNVERIFIED`。

下一步只有一个真正的阻塞项：由非尺子作者完成 dual-axis blind pilot。
pilot 前不得用本尺子重新判 print-finish、visual、literal、world model 或任何
已存在 arm 的 GO/STOP，更不得接入 Production。
