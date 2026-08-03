# 对 `ruler-replacement-design-2026-08-03.md` 的评审

> 评审人：新尺子的**非作者**（任务书作者）。
> 这不构成设计里要求的独立盲判 —— 我既写了任务书又提出了下面的改动，
> 元验收仍必须由第三方完成。本文只做两件事：确认哪些声称我复核过了，
> 以及指出三处我认为会出问题的地方。
> 当前状态不变：`HUMAN_UNVERIFIED / PRODUCTION_STOP`。

---

## 0. 先接受纠正

设计第 9 节对任务书的五条纠正，我全部接受，没有保留意见：

| 条目 | 我原来的说法 | 正确的说法 |
|---|---|---|
| 9.1 | 「285 个词里 88% 不是错误」 | 只有 12% 是**已确认**错误；其余含 142 个 unresolved，未定就是未定 |
| 9.2 | 「0.857–0.923 是完美系统的期望区间」 | 是受 Writer A 约束的 deletion/addition oracle，不是对总体的估计 |
| 9.3 | 「四条机制全落噪声，说明尺子饱和」 | 也可能是真实收益小或 105 张功效不足；饱和要靠盲判失败来证 |
| 9.6 | 我在生产门槛里写「零 critical error」 | 105/105 只把总体上界压到约 2.81%，必须写 observed count 和区间 |

9.5 那条（CSM 定义合法性，不自动提供事实真值）是整份设计里最重要的一句，
也是我任务书里缺的那块拼图。

---

## 1. 复核结果

跑过，声称属实：

```
node scripts/semantic-publication-ruler.test.mjs        PASS
node scripts/ruler-annotation-readiness.test.mjs        PASS
node scripts/audit-ruler-annotation-readiness.mjs       输出与文档 5.3 节一致
```

`audit` 报的四条 blocker 与文档表格逐项对得上：285 个 dispute 全部是单一互斥枚举、
18 个 `components` 需重判 field role、独立 labels 为 0。

### 1.1 我的数据独立佐证了双轴这个核心选择

双轴不是理论修饰。逻辑探针（Stage A 性质，**不是**给任何 arm 重判）：

```
发 "Rainbow Refractor"  publishable=false  required_recall=1  识别 exact_recall=1
发 "Refractor"          publishable=true   required_recall=1  识别 exact_recall=1
整条不发                publishable=false  required_recall=0  识别 exact_recall=1
```

三条臂识别 exact_recall 都是 1 —— **模型本来就看对了，旧尺子在为一个正确的观察扣分**。
而且旧尺子分不出「删掉」和「删对地方」：在 token F1 上它们是 `+0.0023` 和 `+0.0104`，
同一根轴上的两个点；在 SPG 上一个不可发布、一个可发布，是分类差异。

`rainbow` 在 150 张里出现 30 次、命中 0 次，是高频真实类别。**旧尺子根本无法表达它。**
双轴是必需的，不是优雅的。

---

## 2. 三处我认为会出问题

### 2.1 `5.1` 第 7 步（required-fact scan）是承重墙，但没有规格

recognition recall 的**分母完全由它决定**。文档写了「非常关键」，但没给可验证的界。

失败模式很隐蔽：如果扫描浅，所有 arm 的 recall 会**一起**虚高，
尺子看起来很健康，而系统漏掉的还是同一批事实 —— 这正是旧尺子的病（两份记录互相
印证，与现实无关），换个形式复发。

**建议**：加一条对 gold 自身的覆盖审计。抽 20 张让一位 reviewer 做**无约束的整卡转录**，
再量 `union + scan` 捕获了其中多少比例，把这个数字和 gold 一起冻结。

这与「证明检查在该失败时会失败」是同一种纪律：不能只声明某一步重要，要能测它做到了多少。
（已在 pilot ballot 里放了 `missing_facts_scan` 两个字段做小规模演练。）

### 2.2 成本没有汇总，而且 Stage B 并不比 gold 便宜

SPG 要输出 preference 就必须有 gold，所以 **Stage B 被 gold 构建卡住**，不能提前跑。
真正能出 GO/STOP 之前的人力总量是：

- 争议集双轴标注 × 2 人 + 第三人裁定
- 60–100 组对比判断 × 2 人 + 裁定
- 加上 2.1 建议的 20 张覆盖审计

写手时间是这个项目最稀缺的资源，也是写手一致性测量要用的同一份资源。
**建议在动手前把总人时算出来交给 founder 拍**，而不是边做边发现。

顺带一个排期观察：写手一致性包要的是「按平时习惯快速写标题」，
gold 标注要的是「慢速仔细判断」—— **两种人力模式不同，可以并行**，
且前者每张便宜得多、不阻塞 SPG。若只能先安排一件，建议先发写手包。

### 2.3 PCR 是 7 条合取，不适合当迭代指标

文档把 PCR 列为 Primary。作为 promotion gate 它是对的；但作为**迭代**指标分辨率太低 ——
动了哪一条看不出来，而且它会被 7 条里最弱的一条支配。

**建议明确写死**：PCR 是 promotion gate，driver 向量才是迭代指标。
否则一定会有人直接优化 PCR，而优化一个合取的最省力方式是让判据变松。

---

## 3. 接入差距：尺子要的本体，链路里没有

这一节和 2.x 不同 —— 它不是设计问题，是设计与现状之间的距离。
按「谁挡住谁」排：

### 3.1 链路产不出 SPG 的数据单位（工程，最便宜）

SPG 的最小单位是带 `concept_id` 的 typed claim。全仓
`lib/listing/thin/` 与 `lib/listing/csm/` 对 `concept_id` 的引用数为 **0**，
链路输出的是 bracket 和字符串。

后果：**今天拿一次生产运行，构造不出 `T_i`** —— 除非事后用解析器把标题拆回 claim，
而那正是 2.1 节明令禁止的「用解析器给解析器打分」。

这是最大的工程缺口，也是最便宜的一个：Composer 已经知道每个渲染值来自哪个 bracket，
缺的是同时吐出它解析到的 concept id。不补这条，SPG 永远要靠人工 claim segmentation。

### 3.2 concept registry 不存在，且不是应用层能建的（治理，最慢）

同义（`Auto` ≡ `Autograph`）与层级（`Gold Refractor` ⊂ `Refractor`）是这把尺子的
承重本体，CSM 里没有。按 COS-23 与 COS-27，这是 CSM 契约增补，需要拍板。

**已开 COS-43 并指派 Fei。** 这条通常比 3.1 慢，建议尽早启动，不要等 3.1 做完。

3.1 与 3.2 是同一个问题的两半：**尺子要的本体，链路里没有。**
一个是「没有地方放 concept id」，一个是「没有 concept id 可放」。

### 3.3 SPG 结构上当不了运行时指标

它需要每张卡有经过裁定的 gold，生产流量里没有、也不可能有。
**SPG 天然是离线闸门。**

能在线上跑的是设计第 4 节（as-is acceptance / edit burden）。
现状：`lib/listing/feedback/feedback_loop.mjs` 已有 `field_level_diff` 与
`field_level_ground_truth`，粒度够；缺的是 `as_is_acceptance_rate`、
`critical_edit_rate`、`time_to_confirm` 这些聚合，以及与 session/image lineage 串接。

**这条建议排在 3.2 之前**：它是唯一能从真实流量持续产出、不吃人工标注的信号，
而且材料已有八成。

### 3.4 `redundancy_ok` 没有实现

`title_constraints` 三项里，长度和 grammar 我们的一致性检查已有
（`scripts/csm-conformance.mjs` 规则 7 和 1/8），但 **`redundancy_ok` 目前只是
SPG 的一个入参，没有任何东西计算它**。

今天要跑 SPG，这一格得手填 —— 一个手填的布尔值出现在 7 条合取的发布判据里，
就是个后门。

### 3.5 critical-field 政策没有被批准过

`DEFAULT_CRITICAL_FIELDS` 写在模块里，但「什么算致命错误」是业务判断。
它的权威来源现在是「某次 commit」。必须有人拍板，并在开封 sealed labels 之前冻结 SHA。

---

## 4. 建议顺序

1. **Composer 吐 typed claim trace**（我们自己的层，可测，不需要任何人批准）
2. **§4 运行时指标接起来**（材料已有八成，不吃人工标注，能持续产信号）
3. **concept registry 进 CSM**（COS-43，需要拍板；先开 issue 比先写代码重要）
4. redundancy checker + critical-field 政策冻结（都是小工作，但不做就是判据里的后门）

第 1 条做完之前，SPG 每跑一次都要人工把标题拆成 claim；
第 3 条做完之前，`Auto` 与 `Autograph` 会被当成两个事实。
这两条是「能不能用」的门槛，其余是「用得对不对」的门槛。

---

## 5. 本轮两件产物的状态（未重判）

- **finish 词表门 `+0.010424`（30胜4负）**：在**旧尺子**上测的，维持原状，
  不拿 SPG 重新解释。
- **写手一致性包**：50 张，图已签名，100/100 可访问，可以立即发出。
  它只测旧 token F1 的 human ceiling，不替代 SPG 的 dual-axis labels
  —— 设计第 8 节已说明这两个样本量目标不矛盾。
- **dual-axis pilot ballot**：25 张 / 45 条 claim，抽自 finish 词表门扣词的 50 张。
  **该样本已声明不得用于 meta-validation** —— 它是被我写的机制选出来的，
  用它证明 SPG 胜过 token F1 等于在产生假设的样本上给尺子打分。
  仅用于试跑表格机制，不计入任何结论。

---

## 6. 唯一的真阻塞项

同意设计第 11 节：**由非尺子作者完成 dual-axis blind pilot 之前，
SPG 不给任何 arm 判 GO/STOP，也不接入生产。**

本评审不改变该状态。
