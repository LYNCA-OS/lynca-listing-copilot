# 薄链路 vs CSM 契约：缺口分析与贯彻状态

对照 Linear「40 Marketplace Composer」、COS-25、COS-27，以及仓库内 `lib/listing/csm/`。

判定原则（用户 2026-07-31 定）：**以契约为准补齐；只有长期负资产才不做。短期准确率下降可以接受。**

## 一、已从 CSM 直接引用（不再自己实现）

之前这些全部是手写复制品，而且**发明错了**。机械核对（grep CSM 全部导出 vs 薄链路实际调用）显示：`classifySemNumberBoundary` 曾被 import 但从未调用，37 个导出一个没碰。

| CSM 导出 | 用途 | 之前 |
|---|---|---|
| `semStandardTitleOrder` / `semTcgTitleOrder` / `semLotTitleOrder` | bracket 规范顺序 | 手写，**[Card Number] 排在 [Numerical Rarity] 前、[Subject] 排在 [Release Variant] 后，两处都反了** |
| `classifySemNumberBoundary` | 限编 vs 卡号 | 自写正则 |
| `semGrammarForResolved` / `semTcgIpLabel` | grammar 判定 + TCG `ip` bracket | 无 |
| `productsSemanticallyEquivalent` | 产品去重 | 字符串前缀比较 |
| `semCanonicalEditableFields` | schema 字段清单 | 自定 13 字段 |
| `titleDerivedSemSuggestion` | 标题反解成 SEM，用于字段级判据 | 无 |

**贯彻过程中抓到两处静默丢数据**，都是「报告说没丢、实际丢了」：

1. CSM 的 TCG 顺序用 `variant`/`product_finish`，Standard 用 `release_variant`/`print_finish`。按字段名过滤会把 **TCG 卡的平行 bracket 整个滤掉**，而 `dropped` 报空数组——因为它压根没进过顺序。
2. `manufacturer_product_set` 是**合并** bracket，映射到 `manufacturer` 一个字段会让**所有 lot 标题丢掉 product**。

## 二、已达标条款

| 契约条款 | 实现 | 实测 |
|---|---|---|
| Canonical Before Commercial | `canonical-fields.mjs` → `canonical-composer.mjs` | — |
| Deterministic Ordering | 引用 CSM 三个 title order | 打分器对词序不敏感（倒序 138/150 平），所以这是**白拿的契约分** |
| Character Budget = 80，「不得假设 85」 | `MARKETPLACE_PROFILES.ebay.characterBudget` | 原本 155/255 超限，现在 0 |
| Priority-Based Compression | `DROP_ORDER` 显式列表 + 复位 pass | +0.68pp（19:1，p=4e-5） |
| 数字限编 ≠ 卡号 | CSM `classifySemNumberBoundary` | 序号漏分子 51→0 |
| Composition Before Repetition | 前缀去重 + `productsSemanticallyEquivalent` | 全局去重会吃掉真词（`Triple Threads` 让 `Triple Relic` 变成 `Relic`），故只去前缀 |
| Manufacturer/Product 组合 | `inferParentManufacturer` | `Panini` 是全集最常缺的词 |
| Autograph → Auto | `compressAutograph` | — |
| Grammar Selection（Standard/TCG/Lot） | CSM 三套顺序 + 别名映射 | — |
| Marketplace Profiles | `profile.suppress` 按 grammar 分 | 见下节 |
| Representation Without Distortion | 只删不造 | — |
| `empty` 可表达 | `empty_fields` + `unreadable` + **`low_confidence`** | — |
| Card Name / Release Variant / Print Finish 分离 | 三个独立字段 | 合并成一个 `variant` 时支持率 0.50，是最差字段 |
| Descriptive Rarity 独立 bracket | `descriptive_rarity`（SSP/SP/Case Hit） | 之前 SSP 塞在 attributes 枚举里 |

## 三、Marketplace Profile 的抑制：契约在对象层，投影在市场层

这是我一度判错的地方。曾经写过「明确不做：无条件删卡号，契约写『若识别出且长度允许，保留它』」。

**那句话是关于 canonical object 的，不是关于 eBay 标题的。** 参考标题是**我们想要的输出**（`reviewed_title_is_ground_truth: true`），而 255 张里只有 3 张带卡号，模型却写了 143/150。字段照留在对象里（COS-27 学习闭环要用），eBay profile 选择不投影——这正是 Marketplace Profiles 的用法。

| 抑制项 | grammar | 实测 |
|---|---|---|
| `card_number` | standard / lot（TCG 例外，契约明确高优先且参考标题确有） | F1 0.7285 → 0.7655（113:3） |
| `search_optimization`（team） | 全部 | F1 0.7602 → 0.7879 |

**team 这条是不舒服的**：参考标题里确实有 `Spurs`、`Lakers`，说明 bracket 是要的——错的是**我们往里放的内容**（模型写 `San Antonio Spurs` 全名，多两个词换一个命中）。简称渲染 0.7602 仍不如抑制 0.7879。这是当前最好的答案，不是正确的答案，字段改成写简称后要重测。

## 四、仍未达标

| 条款 | 状态 | 阻塞 |
|---|---|---|
| Composer 消费 field-level confidence | ⚠️ 部分 | `low_confidence` 已收集，Composer 尚未据此改变行为 |
| 输出可溯源到 canonical object | ⚠️ 部分 | 有 `brackets`/`dropped`/`suppressed`/`restored` 账本，但没有字段级 provenance（source_type） |
| Title Variants / Structured Listing Fields / Description | ❌ | 未做 |
| COS-27 决策 4 的「备选」 | ❌ | 只有 empty / unreadable / low_confidence 三态，没有 alternatives |
| Lot canonical 结构完整重排 | ⚠️ | 用了 CSM 的 lot 顺序，但 subjects 上限与共享字段的判定仍简化 |

## 五、v3 实测：CSM 贯彻后 canonical 决定性获胜

```
arm              n      F1  recall  precis  tok_rec  len  out_tok
thin_budgeted   150  0.7132  0.7604  0.6818   0.8098   71       24
thin_canonical  150  0.7731  0.7432  0.8186   0.7805   61       97
配对 delta_F1 = +0.0599   canonical 99 : budgeted 46 : 平 5   p=1.28e-5
```

**两把尺子结论相反**：token recall 仍偏袒 budgeted，因为它只算 recall。参考标题是**我们想要的输出**，多写的词占了 80 字符预算，所以 precision 必须算——F1 下 canonical 领先 6pp。

字段拆分的效果：`print_finish` 111/150（合并成 `variant` 时支持率 0.50，是最差字段）、`card_name` 67、`release_variant` 4、`descriptive_rarity` 8。**`low_confidence` 用在 23 张**，上一版 `unreadable` 只有 3 张——给模型第三态，它会用。

### 「Composer 消费 confidence」这条的实测答案：保留，不是丢弃

离线试了按 `low_confidence` 丢字段：丢全部 −0.0039（9:13），只丢 print_finish +0.0014（11:7 不显著）。**模型标为不确定的值仍然是净有用的。** CSM 写的是 review_required（保留 + 标记），不是移除——契约是对的，我想丢掉是错的。

## 六、识别缺口不是契约问题（2026-08-01 审计）

`scripts/audit-pipeline-suppression.mjs` 逐词次归因，150 张：

```
写进标题了        74.4%
读到了但没写出来    3.5%   ← 链路压制
根本没读到        22.0%   ← 识别缺口
```

同一套审计跑主链路 252 张：71.6% / 6.5% / 21.9%。**两份毫无共同点的提示词，识别缺口几乎相同。**

而且被压制的 3.5% 里没有可捡的：35/57 来自 profile 抑制（放回去 F1 反而降），22/57 只在超过 80 字符时才回来。

没读到的那批词是 `ssp / sapphire / hyper / geometric / lucky / wave`——**目录知识，不印在卡面上**。用两条链路互为对照估天花板：64.6% 两条都写出、15.7% 只有一条写出（可改进拿到）、**19.6% 两条都拿不到**，recall 上界约 80.4%。

**结论：剩下的缺口要靠补充信息，不是靠减少束缚。**

### 缺口的新形态（v3 后）

字段拆分把「字段为空」这个形态基本消掉了（`print_finish` 空且参考有工艺词的卡：v2 的 50 张 → 3 张）。剩下的是**名字不完整或写错**：参考有工艺/颜色词的 96 张里，完全命中 28 / 部分命中 34 / 完全不中 21 / 空 13；另有 22 张参考没有工艺词而我们写了。

样例暴露了它由两种成因混合：

```
观察 "Yellow Refractor"  参考 "Gold Refractor"    ← 颜色看错，视觉问题
观察 "Prizm"             参考 "Lucky Hyper"       ← 平行名需要目录
观察 "Gold Refractor"    参考 "Yellow Geometric"  ← 连 serial 都读错(1/25 vs 01/35)
```

### 模型自身知识补不了（实测 0/8）

`lib/listing/thin/knowledge-fill.mjs` 实现了 `POST_OBSERVATION_SHADOW_ONLY` 的活体版本：只填空字段、只填 print_finish/descriptive_rarity、只在模型说 certain 时写入、写入即标 low_confidence。

8 张部分命中的卡上探路，**模型全部拒答**。给它 product + serial + 球员名，它无法判定是哪个平行版本。这否掉的是「模型 prior」，不是知识补充这个方向本身。

### 联网搜索可用（已验证）

provider 支持 `tools: [{type:"web_search"}]`，实测会真去检索并返回带 url_citation 的答案。注意：**有 web_search_call 时 `body.output_text` 为空**，文本在 `output[].content[].text`。

### 联网知识补充：实测等于零（2026-08-01）

40 张失败子集（`print_finish` 与参考不符或为空），每张一次带 `web_search` 的文本调用，只允许补全平行名：

```
改善 13 / 变差 5 / 拒答 17 / 无变化 5      补对 15 词次，多加 7 词次
```

搜索确实能干活——`/50 → Gold Refractor` 补对、`Prizm → Green Pulsar` 两个词都补上、甚至**纠正了模型看错的颜色**（Yellow→Gold）。但换算成 F1：

```
基线      F1=0.7731  r=0.7432  p=0.8186
加知识后  F1=0.7744  r=0.7474  p=0.8157
逐卡配对  delta=+0.0013  胜 11 : 负 9 : 平 130   p=0.82
```

**+0.0013，不显著，等于零。** 补对的词和加错的词互相抵消（`Purple Refractor → Purple Geometric Refractor`，而答案是 Raywave）。

判定范围要说清楚：**这否掉的是「用 web_search 补 print_finish」这一个实现**，不是「补充信息」这个方向。它只覆盖 23/150 张（搜索 42% 拒答）、只改一个字段、用的是通用搜索而不是卡牌目录数据库。真正的卡牌世界引擎（结构化 checklist 数据，按 product + 印量直接查平行）没有被测过。
