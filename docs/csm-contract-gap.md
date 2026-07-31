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

## 五、识别缺口不是契约问题（2026-08-01 审计）

`scripts/audit-pipeline-suppression.mjs` 逐词次归因，150 张：

```
写进标题了        74.4%
读到了但没写出来    3.5%   ← 链路压制
根本没读到        22.0%   ← 识别缺口
```

同一套审计跑主链路 252 张：71.6% / 6.5% / 21.9%。**两份毫无共同点的提示词，识别缺口几乎相同。**

而且被压制的 3.5% 里没有可捡的：35/57 来自 profile 抑制（放回去 F1 反而降），22/57 只在超过 80 字符时才回来。

没读到的那批词是 `ssp / sapphire / hyper / geometric / lucky / wave`——**目录知识，不印在卡面上**。用两条链路互为对照估天花板：64.6% 两条都写出、15.7% 只有一条写出（可改进拿到）、**19.6% 两条都拿不到**，recall 上界约 80.4%。

**结论：剩下的缺口要靠补充信息，不是靠减少束缚。** 仓库里已有 `lib/listing/knowledge/world-knowledge-layer.mjs`，契约是 `POST_OBSERVATION_SHADOW_ONLY`（先观察后知识，顺序正确），但 `target_fields` 只有 team/product、`paid_provider_call_allowed: false`，是脚手架不是能力——而缺的正好是 print_finish 和 descriptive_rarity。
