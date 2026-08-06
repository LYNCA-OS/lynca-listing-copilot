# World compatibility ranker v1：fresh150 本地反证与候选排序回放 — 2026-08-02

## 决策

先取反方假设：**当前本地目录并不是一个足以拿回准确率大头的世界模型；把它当约束器，长期更可能错杀正确识别。** fresh150 支持这个反方假设，也留下一个很窄的正资产：

- `product ↔ year` 对**模型已经表达出的 identity candidates**做 support-only 排序，150 张回放为 `15 胜 / 0 负 / 135 平`；它值得在独立未见集继续测，但尚不能进 resolver 或生产。
- `subject ↔ year` 为 `4 / 0 / 146`，只有四个非平局，双侧符号检验 `p=0.125`，统计功效不足。
- `subject ↔ team ↔ year` 为 `1 / 6 / 143`，当前定义对标题有用性是负资产，停止。
- `set` 没有 typed candidate pairs；`IP` 在 snapshot 中没有关系边。两者统计功效均为零。
- **hard reject 全面停止。** 用“目录里没有”拒绝 canonical year 时，subject-year 会错拒 33 张正确年份，product-year 会错拒 26 张正确年份。

因此总体状态是 `STOP_HARD_REJECTION_HOLD_RANK_ONLY`。没有生产接入、没有 provider 调用、没有标题改写。

## 这轮到底测了什么

输入全部是已保存的本地资产：

- canonical fresh150：`thin_canonical_high`，150 张；
- candidate-expression-v4：同一 asset set，150 张、291 个 identity hypotheses、模型输出的 `candidate_facts`；
- fresh150 loss ledger：`255 / 109 / 63`；
- content-addressed constraint snapshot：`constraint-model-v1-94b08531ca0f9fa3`，source SHA-256 `94b08531ca0f9fa3724d6a2b3f41615d7d0732d35798dd27bf919e7d95a58cbe`。

每个关系的反事实都遵守同一规则：

1. control 是 Luna 原始 candidate 顺序的第一个值；
2. treatment 只把有正向本地关系支持的既有 candidate 稳定排到前面；
3. snapshot 缺边只记为 untrusted contradiction，不扣分、不拒绝；
4. reviewed reference **不进入 ranker**，只在排序完成后计算所选 candidate 的 token F1；
5. 不创建 candidate、不改 candidate value、不删 candidate、不调用 Composer。

所以这里的 `15 / 0 / 135` 是**候选排序反事实**，不是最终标题 F1，也不能冒充生产准确率收益。

## 本地世界数据的真实覆盖

snapshot 虽由 `2,293,502` 张 source cards 编译，但关系密度和语义质量差异很大：

| Relation asset | Keys | 关键边界 |
|---|---:|---|
| `player_years` | 20,816 | 年份主要集中在近年，不是职业生涯的 exhaustive interval |
| `player_teams` | 4,694 | 仅占 player-year subject universe 的 22.55% |
| `player_team_years` | 4,694 | 无 semantic/exhaustive team contract |
| `set_product_years` | 30,600 | 27,854 个 key 跨年只指向一个 product，2,746 个多 product；仍无 edge-level provenance |
| `product_years` | 162 | 可用于正向 support，不可把缺年当反证 |
| `product_sports` | 162 | sport 不是 CSM 的 IP 关系 |
| IP relation | 0 | 无法测 IP ranking |

team 列存在确定的语义污染。仅列出明显或语义不相容的 14 个 label，就涉及至少 784 条 subject-team edges：`rookie` 139、`legend` 107、`raw` 84、`smackdown` 77、`nxt` 68、`legends` 57、`toy story` 49、`then` 49、`west` 34、`now` 32、`east` 28、`-` 22、`toy story 3` 20、`toy story 2` 18。这个 784 只是可证的下界，不是完整污染率。

fresh150 的 167 个 subject occurrences 中：

| Coverage | Occurrences | Share |
|---|---:|---:|
| exact `player_years` | 144 | 86.2% |
| exact `player_teams` | 121 | 72.5% |
| exact subject + current year has team edge | 64 | 38.3% |
| subject + year narrows to one team label | 50 | 29.9% |

最后两个数字才接近可做 temporal ranking 的覆盖；前两个大数不能当作可决策覆盖。

## 150 张 candidate-rank 反事实

| Relation | ≥2 candidates | 有正向世界边支持 | Top-1 改变 | 胜 / 负 / 平 | Eligible mean Δ candidate F1 | 双侧 sign p | 决策 |
|---|---:|---:|---:|---:|---:|---:|---|
| `product_year` over `identity` | 84 | 46 | 15 | **15 / 0 / 135** | +0.04377 | 0.000061 | HOLD，独立未见集复验 |
| `subject_year` over `year` | 24 | 10 | 4 | **4 / 0 / 146** | +0.03750 | 0.125 | HOLD，无统计功效 |
| `subject_team_year` over `affiliation` | 45 | 31 | 9 | **1 / 6 / 143** | -0.02387 | 0.125 | STOP |
| typed `set` | 0 | 0 | 0 | 0 / 0 / 150 | 0 | 1 | STOP / no counterfactual |
| typed `IP` | 0 | 0 | 0 | 0 / 0 / 150 | 0 | 1 | STOP / no relation |

### product-year 为什么是正信号，而不是“候选越长越好”

一个反方 control 是：完全不用世界关系，永远选 token 最多的 identity candidate。它得到 `33 胜 / 10 负 / 107 平`。gross recall 更大，但引入了十个损失，例如把版权长句、通用赛事名和 card-type phrase 排到真正产品前面。

product-year ranker 只在候选字符串包含已知 product，并且该 product 与可见 year 有正向边时提升它；结果把变化收窄为 15 张，15 胜且零负。这表明本地关系的价值更像**precision gate**，不是新知识生成器。

典型胜例：

- `Optic O Donruss` → `2025 PANINI — DONRUSS OPTIC FOOTBALL`；
- `OBSIDIAN` → `2024 PANINI - OBSIDIAN FOOTBALL`；
- `Donruss` → `2025-26 Panini - Donruss Basketball`。

这些 after values 全是 Luna 已经读出的 visible candidates；ranker 没有补写任何字。

但这个结论仍有两个硬限制：

1. snapshot 没有 row-level provenance，无法证明它与 fresh150 编译来源完全 disjoint；当前 `p` 值只对这一个 cohort 有效；
2. candidate F1 正向不保证 resolver + Composer 后的 80 字符最终标题仍正向。

### subject-year 的四个胜例

它把模型已经读出的多个年份候选从错误的 source order 调整为：

- `2022` → `2024`（Holger Rune）；
- `2025` → `2026`（Kendry Chourio）；
- `2011/12` → `© 2025 Futera`（Miroslav Klose）；
- `2024 season` → `2025`（Shohei Ohtani）。

方向合理，但四个非平局时最小可达双侧 sign-test p 仍是 `0.125`。至少还需要两个独立且同向的非平局，`6/0` 才会到 `p=0.03125`；这只是统计门，不是生产门。

### team 为什么停止

team ranker 往往能把 affiliation 列里的球队排到 `Topps`、`Upper Deck`、league/logo 等错位候选之前，但 reviewed 标题本身经常不需要球队。把“世界上正确的球队”提升成“标题最应该消费的 affiliation”混淆了事实正确性和 marketplace usefulness，因此 candidate-title F1 为 `1/6`。

正确架构应保留 team evidence，由 CSM/SEM/marketplace profile 决定是否消费；不能让 world rank 直接取得 title authority。当前 snapshot 的 team 污染又排除了 hard rejection，所以这条实现没有可保留的 active 行为。

## hard reject 被怎样反证

将“candidate year 不在 snapshot 的已知 years”视作拒绝条件，fresh150 得到：

| Negative rule | Covered cards | 真拒绝错误值 | **错拒正确值** | 错误值漏过 | Reject precision | Correct-value false reject rate |
|---|---:|---:|---:|---:|---:|---:|
| subject-year absence | 129 | 6 | **33** | 5 | 15.4% | 28.0% |
| product-year absence | 78 | 2 | **26** | 1 | 7.1% | 34.7% |

原因不是公式问题，而是数据物理边界：snapshot 的 years 是观测到的 catalog years，不是 subject/product 的 complete valid interval。`absence ≠ contradiction`。

set-product 也不能硬拒。现有 enumerator 在 fresh150 只给出 4 个 VALUE，其中：

- `Dressed to Impress → Panini Court Kings`：兼容；
- `Metallic Marks → Panini Black`：兼容；
- `Hoopers → Topps Hoops`：近似 alias；
- **`Throwback → Panini Select`：错误，reference/product 是 Panini Donruss。**

所以即便 `set + year + manufacturer` 收敛为一个本地值，也不是 exhaustive truth。

## 它能拿回 255 / 旧 359 的多少

fresh150 的 255 个 `exhaustive_not_expressed` occurrences 中，identity-world families 的最大结构上界只有：

- product/set/IP 14；
- year/season 11；
- subject/name 6；
- team/league 3；
- 合计 **34 / 255 = 13.3%**。

这仍只是 addressability ceiling。255 的定义正是 exhaustive 没表达；没有 candidate 时，ranker 一个也拿不回来。其余 221 次主要是 finish、serial、attribute、rarity、color、lot 和 token boundary，不能靠 subject-team-year/product-set/IP 排序解决。

旧 359 分类也给出相同反证：明确的 team/league 只有 5 次；year/number 42 次还混有印刷数字与 serial；finish/color/attribute/rarity 已明确合计 133 次；产品/套组不完整在未量化的“其他”中。世界 compatibility 可以验证候选组合，但不能替模型补出它从未表达的完整产品短语。

对旧 `73 + 53` 也要划清范围：它可能帮助 73 中的少量 ambiguity/candidate-only identity 项；它不负责 exact evidence admission，也完全不能修 53 个 Composer/profile/budget/normalization 损失。

## 最小长期架构

```text
Luna visible facts / hypotheses
              |
              v
  world support-only ranker   (no generation, no overwrite)
              |
              v
  CSM/SEM admission + resolver
              |
              v
 deterministic Composer/profile
```

v1 的安全不变量已被代码和测试固定：

- output candidate multiset 与 input 完全相同；
- candidate values 字节不变；
- current hard rejection count 恒为 0；
- exact/stamped/logo visible candidates 永远不可 hard reject；
- reference 不进入排序；
- 没有 provider、vector、OCR、Cloud Run、web 或远端服务。

## 下一道门

product-year 只有满足全部条件才可从 HOLD 继续：

1. 建一个与 snapshot compiler source fingerprints 明确 disjoint 的新 150 candidate cohort；
2. 仍只做零调用 candidate replay，wins > losses 且双侧 sign `p < 0.05`；
3. candidate count delta = 0、value mutation = 0、protected-visible reject = 0；
4. 再把排序结果送入同版 resolver + Composer 做完整 150 标题回放，不能只看 candidate F1；
5. 只有最终标题 F1 正、无 numeric/subject critical regression，才进入 shadow canary；仍不直接上生产。

hard rejection 的门更高。若目标是把 false reject 限在 0.1% 以下，并在 95% 置信度下用零失败证明，至少需要：

`n >= ln(0.05) / ln(0.999) = 2994.2`，即 **2,995 个独立、零错拒样本**。

在此之前，即使补齐 edge-level source、version、confidence、valid interval 和 semantic/exhaustive contracts，也只能 rank/abstain，不能 reject visible truth。

## 可执行文件

- `experiments/accuracy/world-compatibility-ranker-v1.mjs`：evaluation-only support ranker；
- `scripts/world-compatibility-ranker-v1.test.mjs`：不可生成、不可变值、visible protection 测试；
- `scripts/replay-world-compatibility-ranker-v1.mjs`：150 张零调用覆盖/反证/rank replay；
- `docs/evaluation/world-compatibility-ranker-v1-replay-150-2026-08-02.json`：逐关系和逐 changed-card ledger。

复现：

```bash
node --test scripts/world-compatibility-ranker-v1.test.mjs
node scripts/replay-world-compatibility-ranker-v1.mjs
```
