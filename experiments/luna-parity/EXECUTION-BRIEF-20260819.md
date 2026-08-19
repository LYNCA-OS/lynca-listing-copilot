# 执行书：识别链路的三处确定改动，以及一条必须先修的评测缺陷

**日期** 2026-08-19
**来源** 48 张 csmdata 金标上的 6 次配对实验 + 一次 240 次调用的噪声测量
**执行方** Cursor
**原料** `lynca-harness:experiments/luna-parity/`（全部可离线重放）

---

## 摘要

**三处**改动被证据支持。第一条是唯一有强证据的准确性改动（捏造 15/48 → 8/48），另两条不改变模型输出。

另外**五处**改动我测过，全部未通过判定门——但正确的结论不是「它们无效」，而是**当前的评测方法分辨不出它们**。所以本执行书的第三部分是修评测，不是修 runtime。

**不要**把第二部分（未证）里的任何东西当成待办。

---

## 〇、第一优先：多数投票做证据准入

### 证据

48 张卡各发五次逐字节相同的请求（240 次调用，0 错误），只保留 ≥3/5 次一致的字段：

```
单次采样   捏造 15/48
多数投票   捏造  8/48      降幅 47%
```

这是今天六次实验里**唯一效应远大于噪声的结果**（噪声底噪 SD 0.0422，其余五个效应在 −0.0095 ~ +0.0233）。

不改提示词、不改模型、不改架构。

### 机制

一个值若五次里只出现一次，按定义就不是有支撑的证据。这与 CSM 自身原则一致：

> Confidence is metadata, not proof. Provenance and relationships carry the explanation.

### 要做的改动

同一张卡采样 N 次（N=5 已验证；N=3 未验证），逐字段取多数：

- 达到多数的值 → 正常进入 canonical
- 未达多数的值 → **不得进入 canonical**，保留为 unresolved / 待复核
- **跨重复的不一致本身就是置信度信号**，比模型自报的 `low_confidence` 可靠（后者是自我评估，且当前无任何消费方）

### 按字段定采样量

翻转率差异极大，一视同仁会被最不稳的字段拖累：

```
print_finish      26/48   54%
product           17/48   35%
card_number        6/48   13%
year               5/48   10%
card_name / numerical_rarity / subject     ~4%
manufacturer / release_variant             ~2%
```

`manufacturer` 一次即可；`print_finish` 必须重复。

### 成本与验收

成本：每卡 N 倍调用。可与第一部分（缓存）叠加——稳定前缀命中后，重复采样的边际成本大幅下降。

验收：在 48 张金标上，多数投票的捏造 case 数须 ≤ 10（单次基线 15）。

⚠️ 未验证：N=3 是否足够；多数投票对准确率（非捏造率）的影响；延迟代价。**先测再上。**

---

## 一、可执行：把稳定文本移到 `instructions` 位

### 现状缺陷

请求把提示词和图片放进同一条 message 的 content 数组：

```js
input: [{ role: "user", content: [
  { type: "input_text", text: prompt },
  { type: "input_image", image_url: ... },   // 每张卡都不同
]}]
```

图片逐卡变化 → 整条 message 逐卡变化 → **前缀无法共享 → 缓存永远不命中**。

实测（`lynca-listing-copilot` 现役 prompt + schema，48–50 张卡）：

| 形态 | 缓存命中 |
|---|---|
| 文本与图片同一条 message | **0 / 49** |
| 文本移入 `instructions`，图片单独成 message | **47 / 48** |

命中后每次调用有 **2,390–3,743 token** 走缓存价。

### 要做的改动

```js
{
  model,
  instructions: <全部稳定文本>,          // 逐字节固定
  input: [{ role: "user", content: [ ...仅图片... ] }],
  text: { format: { type: "json_schema", ... } }
}
```

三条硬要求：

1. `instructions` 的字节在所有调用间**完全一致**（任何逐卡插值都会毁掉前缀）
2. user message **只放图片**，不放任何文本
3. 稳定文本必须 **≥1024 token**，否则达不到 OpenAI 缓存下限

第 3 条不是理论：现役 prompt 只有 **695 token**，低于阈值，**结构改对了也拿不到缓存**。当初把 CSM 压成 15 条散文是为了省 token，实际结果是既丢判据又丢缓存。

### 在 `lynca-runtime` 里的位置

`recognition/worker/frontier-worker.mjs`，约 423–440 行。当前请求体**没有 `instructions` 参数**，识别指令和图片都进 `input[0].content`——**同一个缺陷**。

⚠️ 我是在 `lynca-listing-copilot` 上实测的。搬到 `lynca-runtime` 前请自行确认那边的 `web_search` 工具调用不会改变前缀行为（工具定义在前缀里，应该无影响，但没实测）。

### 验收

对同一批卡连续跑 ≥10 次，从响应里读 `usage.input_tokens_details.cached_tokens`：

- 第 1 次可以是 0
- **第 2 次起必须 > 0**，否则前缀没生效，改动无意义

---

## 二、可执行：`set` 不再是 canonical field

### 依据

`lynca-csm` 于 2026-08-17 的创始人裁定，见 `csm/10-canonical-language.md` 的 Boundary rule 与「40 Marketplace Composer」文首：

> `set` and `search_optimization` are not canonical fields in this version.

> `Set` is **not** a canonical field in `csm-canonical-fields-v3`. A source or checklist label called Set is evidence or hierarchy context.

### 现状

`lynca-listing-copilot` 的输出 schema 仍包含 `set`，模型仍在填它。**规范已改，运行时未跟上。**

### 要做的改动

从输出契约里移除 `set`；来源里出现的 Set 标签按裁定处理——**解析进 Product 或 Card Name（当证据支持时），否则保留为 auxiliary / unresolved**，不得静默丢弃。

⚠️ 这条会改变输出，因此**必须先修第三部分的评测**再验收，否则无法判断影响。

---

## 三、必须先修：评测分辨不出要测的效应

### 证据

48 张卡，每张发**五次逐字节相同的请求**（同 instructions、同 schema、同图片、同模型、同 effort），240 次调用，0 错误：

```
标题在重复间不同        79%
捏造状态在重复间翻转     28%
纯重采样的 |F1 差|      0.0529
```

对照今天全部六次实验的效应量：

```
论证空字段     +0.0233        CSM 字段语义   −0.0095
判据摘录       +0.0178        第二眼          +0.0006
完整规范       +0.0064
```

**噪声比最大的效应还大一倍。**

再对照仓里的历史结论（`docs/EXPLORATION-LEDGER-20260805.md`）：Arm B/C/D 为 −0.0063 / −0.0092 / −0.0017，p = 0.21 / 0.31 / 0.48——**同一个分布**。

结论：**近几周基于「50 张卡 + 单次采样 + sign test」做出的取舍，没有被证据支持过。** 包括「prompt 已达局部最优」这一条。

### 为什么不能靠调参解决

`lib/listing/thin/csm-model-optimization-pack.mjs`：

```js
sampling_parameters: "omit"   // Luna 拒绝 temperature / top_p / seed
```

**这个模型无法确定性输出。** 噪声是模型固有属性，只能靠重复采样平均。

### 要做的改动

1. **每臂每卡多次采样取均值**，并**按字段分别定采样量**。已算出：分辨 +0.05 需约 11 次重复，分辨 +0.02 需约 69 次——**后者不可行**，所以判定门要么接受更大的最小可检效应，要么改用字段级指标。复算：`node experiments/luna-parity/noise-floor/analyze.mjs`。
2. **改判定门**。现行 `delta ≥ 0.02 且 p ≤ 0.05` 在单次采样下**在数学上不可达**（需 ~69 次重复）。门本身没错，错的是喂给它的读数。建议改为字段级判定：稳定字段（manufacturer/subject/release_variant，翻转 ≤4%）单次采样即可判定，不稳定字段（print_finish 54%、product 35%）单列并要求重复。
3. **报准确率必须同时报捏造率**。`experiments/luna-parity/csm-typed-field-score.mjs` 按 csmdata 的 `acceptance-policy-v2` 判定，已自证（`csm-typed-field-score.test.mjs`）。

### 附带：这不只是评测问题

79% 和 28% 是**生产事实**。同一张卡传两次，大概率得到两个不同标题，有 28% 概率一次捏造一次不捏造。**这是用户可见的稳定性缺陷，与准确率无关。**

对策见第〇部分：多数投票已实测可将捏造从 15/48 降到 8/48。

补充读数（同一次 240 调用）：

```
每张卡 F1 标准差        0.0422
五次完全一致的卡         3/48  (6%)
捏造状态翻转             19/48 (40%)
分辨 +0.02 所需重复次数  ~69   ← 单靠重复采样不可行
分辨 +0.05 所需重复次数  ~11
```

`print_finish` 54% 的翻转率是产品缺陷：同一张卡传两次，光学 finish 有一半概率不同。

---

## 四、明确不要做

以下五条我都测过，**全部未过门，不要执行**：

| 改动 | delta F1 | p |
|---|---|---|
| 注入 Composer 判据摘录 | +0.0178 | 0.50 |
| 注入 Composer 完整规范 | +0.0064 | 0.86 |
| 注入 CSM 字段语义 | −0.0095 | 0.70 |
| 要求论证空字段（schema 加 `absent`） | +0.0233 | 0.20 |
| `low_confidence` 触发第二眼 | +0.0006 | 0.86 |

其中「论证空字段」额外引入了 **77 次假性缺失**（模型声称卡上没有，金标说有），把可见的漏报换成了隐蔽的错误确认，**明确不建议**。

另外两条也不要做：

- **提高 `reasoning_effort`**：p50 从 11.3s 涨到 21.6s，越过 20 秒发布门
- **换模型**：创始人已裁定不换

---

## 五、执行顺序

1. 做第一部分（缓存位置）——不改输出，且能降低后续重复采样的成本
2. 按第三部分改评测（多次采样 + 双指标）
3. 做第〇部分（多数投票），用新评测验收；先确定 N 与延迟代价
4. 最后做第二部分（`set` 字段），用新评测验收

**第 2 步之前不要做任何会改变模型输出的改动**，否则无法判断效果。

---

## 六、数据与可复现性

```
experiments/luna-parity/
  csm-typed-field-score.mjs        按 acceptance-policy-v2 的字段级评分器（自证测试齐）
  csm-typed-field-score.test.mjs
  noise-floor/                     48 卡 × 5 次，240 行原料 + analyze.mjs
  justify-empty/ second-look/ field-semantics/ full-spec-cache/ csm-source-context/
                                   各含 raw-results.jsonl + score.mjs
```

金标：`LYNCA-OS/csmdata` @ `3a86aa4`，`npm test` 通过（53 cases / 106 images / 53 answers）。

**队列是 48 张不是 53 张。** 剔除的 5 张是泄漏卡：CSM 文档的 regression fixtures 与 `card_name` 定义里点名的 `Power Chords` / `Kaboom!` / `Regalia Relics`，恰好是队列中三张卡的金标答案。**任何要把规范文本喂给模型的实验，都必须先做这项泄漏扫描。**
