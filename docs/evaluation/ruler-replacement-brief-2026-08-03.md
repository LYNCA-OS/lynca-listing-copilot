# 换尺子任务书（给 sol）

> 2026-08-03。目标不是让分数变好看，是让**分数的变化方向与系统真实变好的方向一致**。
> 当前尺子在这一点上已经失效，下面是证据。所有数字来自 fresh150 已付费观察的零调用重放，
> 可复跑，脚本在 `scripts/replay-*-150.mjs`。

---

## 1. 当前尺子是什么

对每张卡：把 reference 标题和产出标题各自小写、去重音、按非字母数字切词、**去重成集合**，
算 precision / recall 的调和平均，再对 150 张取宏平均。

- reference = **单个写手（Writer A）确认过的一条 eBay 标题**。
- 长度无关、顺序无关、同义词敌对、层级敌对（`Gold Refractor` vs `Refractor` 只按词计）。
- 生产门槛把它定成 `>= 0.90`，另加「零 critical error」和「<= 80 字符」两条。

当前水位：canonical `0.766927`（R `0.7435` / P `0.8052`），已验证 bundle `0.785051`，
裸模型 `0.714701`。

---

## 2. 为什么必须换：四条独立证据

### 2.1 它判定的「精度损失」里 88% 不是错误

285 个「我们写了、reference 没有」的词次，逐条判过：

| 归类 | 词次 | 卡数 |
|---|---:|---:|
| 无法裁定的 reference 缺失 | 142 | 82 |
| 可能有用但写手没写 | 86 | 57 |
| **明显事实错误** | **33** | 26 |
| Composer 冗余 | 12 | 12 |
| reference 分词/拼写问题 | 12 | 10 |

只有 **12%** 是真错。其余是写手取舍、市场消费习惯和分词假象——尺子把它们全部记成扣分。

### 2.2 它的可达上限本身就不是 1.0

- 删光全部 reference-absent 词的 label oracle：`0.856724`
- 补回全部 427 个缺失词的 label oracle：`0.923252`

两个都要用到 reference，不可部署。也就是说：**在这把尺子上，完美系统的期望值落在 0.86–0.92 之间**，
而门槛定的是 0.90。没人量过写手之间能一致到多少——`F1(Writer A, Writer B)` 这个数字至今不存在。

### 2.3 它分不清「把一个字段修对」和「把一个字段删掉」

逐字段消融（删掉该字段后的 ΔF1，正数 = 该字段净负）：

```
print_finish     +0.002316   36胜/35负     ← 删掉反而略好
serial           -0.009607   25胜/45负
card_name        -0.012064
manufacturer     -0.021491
components       -0.031722
product          -0.059471
year             -0.063890
subjects         -0.134114    2胜/147负
```

`print_finish` 在这把尺子上是一枚硬币。但它按来源层拆开后差异极大：

| 来源层 | 卡数 | 词精度 | 整条全错 |
|---|---:|---:|---:|
| `parallel_exact`（名字印在卡面上） | 15 | **0.750** | 0 |
| `colour+family`（模型推断） | 72 | **0.313** | 34 |
| `colour_only` | 44 | 0.250 | （投影已拦住） |

Fisher 双侧 `p=6.77e-06`。**一半的卡带着一个约 70% 错的推断工艺词**，这是系统里最大的一块
集中质量缺陷——而尺子对「修好它」和「删掉它」给出几乎相同的分数（+0.0067 vs +0.0023）。

一把对「改进」和「截肢」无差别的尺子，不能用来指导以 CSM 为核心资产的系统。

### 2.4 它已经饱和：四条独立机制全部打在噪声里

| 机制 | 结果 | 代价 |
|---|---|---|
| literal observation v2（付费 105 配对） | `-0.00375`，23/25/57，p=0.885 | output token +56% |
| visual bottom-band v1（付费 105 配对） | `+0.004805`，27/19/59，p=0.302 | 中位延迟 +2.63s |
| world release identity graph | 覆盖不足，parallel edge 仅 2 条 | — |
| bare ∪ canonical raw union | `-0.055811` | 146 张新增错误词 |

四条方向完全不同的攻击，全部 ≤ 噪声。这不是四次失败，是**这把尺子对当前系统已经没有分辨力**。

另有两条我这轮亲自证伪的、原本以为是自伤的假设，一并记录以免重复：
eBay 压制解开是 `-0.0356`（SO，22胜98负）和 `-0.0370`（card_number，1胜109负）；
80 字符预算不是约束（中位标题 63 字符，放到无穷只值 `+0.0037`）。

---

## 3. 上一次换尺子是怎么失败的 —— 这是最重要的一段

不要跳过。**我们已经试过换尺子，输了。**

20 张有争议的卡，逐条对着契约盲判，然后**给尺子打分**：

```
token_recall   74%     ← 就是现在这把粗糙的袋装词尺子
csm_quality    58%
csm_fields     29%
csm_brackets   17%
```

四把手工尺子里三把输给了那把粗的。两个具体的失败机制：

1. 一把尺子对 canonical 臂按**字段**打分、对字符串臂按**标题**打分，把前者虚高了 5.2pp。
   写这把尺子的人，就是那条臂的作者，而且是在看见那条臂落后之后写的。
2. 另一把把 CSM 自己 keep-list 的顺序**装反了**，方向恰好也是抬高同一条臂。

两把在整个过程中都显得很有原则。都是靠手读 20 张卡抓出来的，不是靠代码审查。

**推论（新尺子必须继承的约束）**：

- 尺子不得由它将要偏袒的那条臂的作者单独认证。
- 「更贴合 CSM 契约」不构成尺子更好的证据。csm_brackets 是最贴合契约的一把，得分 17%。
- 上面那 20 个标签也是我自己填的，比让尺子自评好，但**仍然不独立**。
  一轮由别人判的小样本，比我判的大样本更值钱。

---

## 4. 手上已有的材料

- `lib/listing/csm/sem-definition.mjs`：`semCanonicalEditableFields`、三套 grammar 顺序、
  `classifySemNumberBoundary`、`isSemNumericalRarityText`、`isSemCardNumberText`、`semGrammarForResolved`
- `lib/listing/csm/title-derived-sem.mjs`：`validateTitleDerivedSem`、`resolvedFieldsToSemSuggestion`、
  `buildWriterTitleSemCandidate`、`SEM_VALIDATION_SOURCE_TYPES`
- `scripts/calibrate-title-metric.mjs`：盲判台账，A/B 匿名 + 哈希定序 + 答案分离存放。**复用它。**
- 第二写手盲判 packet：117 张卡、285 个争议词次，已生成、**尚无人判**。
  选项是 `VISIBLE_TRUE` / `VISIBLE_FALSE` / `OPTIONAL_TITLE` / `REQUIRED_TITLE` / `UNKNOWN`
  ——注意它已经把「事实为真」和「该不该进标题」分成了两个轴。
- 255 条写手确认标题；fresh150 的逐卡 ledger（含 44/95/11 全部明细）。
- CSM 持久化 6 张表的行构造器 + 148/148 回放。

---

## 5. 真正的难点（请直接攻这里）

**我们只有标题真值，没有字段真值。**

任何按字段判的尺子都要面对这三条路，每条都有已知的坑：

- **(a) 去采字段真值** —— 150 张 × 约 15 个 bracket 的人工标注。最干净，最贵，
  且一旦 cohort 换了就要重采。
- **(b) 从写手标题反解字段** —— 循环论证，而且已知会错：title-derived SEM 会把相邻介词
  吞进 subject，会把 `1st` 同时判给 card_name / descriptive_rarity / search_optimization。
  用它当真值，等于用我们的解析器给我们的解析器打分。
- **(c) 换掉「判什么」** —— 不判标题相似度，判别的东西。这条最开放，也最可能是对的，
  但必须能回答：新判据的真值从哪来，成本多少，以及它为什么不会重蹈 csm_brackets 的覆辙。

第二个难点：**生产门槛其实已经是两段式的**——`F1 >= 0.90` **加上**「serial / 年份 / 身份 /
grade / 数量 / IP-product 零 critical error」。第二段从来没有被操作化过。有没有可能
critical-error 那一段才是真正的尺子，而 F1 那一段应该退化成一个宽松的辅助指标？

---

## 6. 需要 sol 回答的

1. 我们到底在测量什么？「标题和写手一致」是目的，还是「卡被正确识别」的一个劣质代理？
   如果是后者，正确的被测量对象是什么？
2. 给出 1–3 个具体的尺子设计，每个都要写清：真值从哪来、单位是什么（词/字段/整卡）、
   怎么处理层级与同义（`Gold Refractor` vs `Refractor`）、怎么处理写手可选项、
   成本、以及它在什么情况下会骗人。
3. 对每个设计给出**元验收**：怎么证明这把新尺子比 token F1 更好？
   已知「更贴合契约」不算证据（csm_brackets 17%）。可用的只有盲判台账。
4. `0.90` 这个数在新尺子上该定成多少，依据是什么？
   如果依据需要 `F1(Writer A, Writer B)`，明确说需要，并给出所需最小样本量。
5. 明确指出上面哪些前提你认为是错的。这份材料由我写，我这轮已经错了两次。

---

## 7. 硬边界

- CSM / SEM 是最终 authority；候选、世界知识、模型残余观察都不得静默获得 canonical 权限。
- 薄链路只允许一次 GPT-5.6 Luna 调用、`reasoning = none`。
- 不恢复 Cloud Run、向量库、泛 OCR、web lookup、自动第二次模型调用。
- 标题 80 字符契约（COS-26）；COS-8 / COS-9 的字段优先级不得由应用层重排。
- 新尺子在被独立盲判证明之前，不得用来判定任何机制的 GO / STOP。
- 换尺子不改变生产状态：当前是 `PAUSED`，不是 `GO`。

---

## 8. 复跑

```bash
cd /Users/paidaxin/lynca-thin-path
node scripts/replay-field-ablation-150.mjs
node scripts/analyze-print-finish-gate-150.mjs
node scripts/replay-print-finish-gate-150.mjs
node scripts/replay-suppression-recheck-150.mjs
node scripts/replay-budget-counterfactual-150.mjs
```

全部零 provider 调用，读的是 `artifacts/accuracy-bundle-confirmatory-150-2026-08-02/`。
