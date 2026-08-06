# LYNCA 薄链路三日交接文档（给 Claude）

> 交接时间：2026-08-03（Asia/Shanghai）
> 工作窗口：2026-08-01 至 2026-08-03，含约 15 小时的密集实验、代码和生产核查。
> 当前文档的目标：让下一位执行者可以从事实、证据和边界继续工作，不把探索结果误当成生产结论。

## 0. 先读这一页：当前结论

反方观点是继续堆叠小规则：它们便宜，且已有一组无损正收益回放。但这
不足以把准确率从当前约 `0.785` 推到 `0.90`。因此主线已经从“继续加约束”
切换为：

> 先让 Luna 在一次调用里尽量看见、表达和保留候选；再由有来源的兼容性
> 知识做排序；最后只由 CSM/SEM 和确定性 Composer 决定什么能进入标题。

目前没有把任何新的准确率实验臂接入生产。生产准确率提升状态是
`PAUSED`，不是 `GO`。

### 不能违反的边界

- 核心资产是 CSM 以及其内嵌的 SEM。模型候选、残余观察和世界知识不能
  静默获得 canonical 或生产 authority。
- 当前薄链路只允许一次 GPT-5.6 Luna 调用，`reasoning = none`；随后走
  CSM/SEM admission 和确定性 Composer。
- 不恢复 Cloud Run、向量库、泛 OCR、web lookup 或自动第二次模型调用。
- 标题最终必须服从最新的 80 字符契约；COS-8/COS-9 的字段优先级不能
  被应用层自行重排。
- 任何模型输出新信息，首先属于带来源的 candidate/evidence；只有通过
  CSM/SEM 的明确 admission 才能成为 canonical。
- 不在文档、提交或终端输出中写入 API key、Supabase secret key、登录密码。

## 1. 仓库、分支和服务边界

### 当前准确率实验 checkout

```text
/Users/paidaxin/lynca-thin-path
branch: feat/thin-path
origin: https://github.com/LYNCA-OS/lynca-listing-copilot.git
```

这个 checkout 用于准确率回放、实验 harness、零成本 resolver 和文档。
当前 `feat/thin-path` 工作树在交接前是干净的，最新提交为：

```text
0d2fb0f0 feat(accuracy): close strategy branches with zero-cost evidence
```

### 生产 checkout

```text
/Users/paidaxin/lynca-thin-production-main
branch: codex/thin-production-mainline
```

生产部署只能从生产 checkout 做。当前实验 checkout 里的旧版
`docs/operations/active-service-context.json` 是实验历史上下文，不要据它
直接执行生产迁移或部署；生产主线的 Singapore 上下文在生产提交
`c851b84a` 中已经固定。

### Vercel / Supabase

- Vercel 生产项目：`lynca-listing-copilot`。
- 容量实验项目：`lynca-capacity-lab`，只能部署 Preview，不能部署 Production。
- 生产写入已经由 `c851b84a` 切到 Singapore Supabase，生产项目 ref 是
  `irpgnhkslrsiucybkufc`。只在生产 checkout 的 canonical cwd 做远端操作。
- Sydney 项目是旧路径；不要把它恢复成新上传目标，也不要从实验 checkout
  盲目执行 migration。
- `SUPABASE_SECRET_KEY` 只能从已配置环境读取，永远不打印。

### 生产端已经确认的范围

`docs/operations/production-front-end-verification-2026-08-02.md` 和
`docs/operations/production-cloud-runtime-evidence-2026-08-02.md` 记录了：

- 公开入口 HTTP 200，登录页渲染正常，浏览器控制台错误为 0；
- 前台没有旧的 start-recognition 控件；上传自动启动识别，后续上传会
  追加到同一生命周期；
- 生产请求返回 `CSM_THIN_DIRECT`、GPT-5.6 Luna、reasoning none；
- Cloud Run、vector、generic OCR 均为 0；
- 真实服务器侧曾观测到 7 个薄链路 session，其中 6 个完整落库，每个
  只有一行 marketplace output；
- 成功请求总时长约 `3.621-5.240s`，p50 `3.749s`，p90 `5.106s`，
  p95 `5.240s`；provider Luna 是主要耗时，不能靠旧 sidecar 解释；
- 这些是链路和持久化证据，不是 `>=0.90` 准确率证据，也不是新的并发上限
  结论。

### Linear / CSM 契约水位

本轮已按 live issue 核对并完成的 COS 是：`COS-8`、`COS-9`、`COS-25`、
`COS-26`、`COS-27`，均为 `Done`。后续不要凭本地文档推断状态；每次要更新、
提交或部署前都要重新读取 Linear live issue。

必须保留的契约细节：

- COS-8：三级（先删）是 `Card Number`；二级是 `Print Finish`、
  `Descriptive Rarity`；一级（最后删）包括 `Year`、`Manufacturer`、
  `Product`、`Set`、`Subject`、`Card Name`、`Release Variant`、
  `Numerical Rarity`、`SO`、`Grading Info`。`Release Variant` 不能被当成
  低级字段提前丢弃。
- COS-9 TCG：`Manufacturer` 和 `Product` 是 `****` 最低级，绝大多数 TCG
  上架场景应省略，因为 `Set` 才是产品标识；`Language` 是一级字段，紧跟
  `IP`，取值 EN/JP/CN/KR。
- COS-26 是较新的 `under 80 characters` 契约；不要恢复旧的 85 字符实现。
- CSM canonical field 名单必须以 CSM 为准；不能在应用层的 `THIN_FIELDS`、
  `unknownFieldNames` 或别的本地名单里静默删掉 `language` 等合法字段。

## 2. 三日时间线

### 2026-08-01：薄链路和生产边界固定

1. 固定单次 Luna -> CSM/SEM -> Composer 的 thin path；保留 trace 和
   checkpoint/persistence 边界。
2. 明确 Cloud Run、向量库、泛 OCR 和自动二次调用均不再是准确率路径。
3. 固定 production authority boundary：探索分支不得因为 replay 变好
   而自动进入生产。
4. 复核 production 的上传、登录、CSM 路由和持久化证据。
5. 重新确认准确率工作应该抓“大头”，而不是继续增加束缚层。

### 2026-08-02：准确率大头实验和停止决策

1. 对 fresh150 做裸模型、canonical、exhaustive、Composer 和组合 bundle
   的互补损失分解。
2. 在 Singapore storage 上完成两个 paired paid105 验证：literal
   observation v2 和 visual bottom-band v1。
3. 对 literal observation 做了零成本 resolver replay；没有把候选旁路
   接入运行时。
4. 构建 source-versioned release identity graph；确认当前世界资产覆盖不足，
   不能负责 final title。
5. 生成第二写手 blind calibration packet，等待人审，不自行伪造 field truth。
6. 合并策略关闭审计：保留小 bundle 作为冻结 fallback，停止 visual、world
   ranker、free expression final authority 和广泛 Composer/drop-order 重写。

### 2026-08-03：收尾和交接

1. 最新策略提交完成，工作树和 `git diff --check` 保持干净。
2. 把过去三天的实验、生产边界、证据文件和下一步整理为本文。
3. 本文之后，任何新机制仍须先回放，再决定是否使用最多 105 张付费验证。

## 3. 现在到底有几套“准确率”

不要再把旧链路的 recall、裸模型的单独分数和当前 canonical 的 title F1
拼成一条趋势。当前记录是不同 cohort、prompt/schema、Composer 和评分器的
结果，必须绑定实验版本。

| 指标 | 当前数值 | 解释 |
|---|---:|---|
| fresh150 bare title macro F1 | `0.714701` | 裸模型结果；recall 约 `0.816`，不能把 recall 当 F1 |
| fresh150 canonical | `0.767764` | CSM/SEM 合法输出基线 |
| fresh150 combined positive replay candidate | `0.785051` | 已验证小机制 bundle，仍不是生产证据 |
| 生产目标 | `>=0.90` | 独立 cloud fresh cohort，并且零 critical error |
| 当前距目标 | `0.114949` | 这就是为什么小规则不可能成为主攻方向 |

旧的“裸模型 0.8 几”来自旧 cohort 或 recall/不同评分边界。以后所有报告
都要写清 cohort SHA、request SHA、模型、prompt/schema、Composer 和 scorer。

## 4. 最大损失在哪里

fresh150 的 427 个 missing occurrences 按“最早损失边界”分解如下：

| 最早损失边界 | 词次 / 卡 | 全部恢复后的 F1 上限 | 理论增量 |
|---|---:|---:|---:|
| 模型/exhaustive 没有表达 | `255 / 118` | `0.878026` | `+0.092975` |
| 模型表达但 canonical 丢弃 | `109 / 76` | `0.818167` | `+0.033116` |
| canonical 有值但 Composer 没发 | `63 / 46` | `0.805929` | `+0.020878` |
| 427 个全部恢复 | `427 / 137` | `0.923252` | `+0.138201` |
| 删除全部 reference-absent token | `285 / 117` | `0.856724` | `+0.071673` |

最大语义族是：

- 完整身份/描述：`101 / 64`；
- 平行/工艺：`85 / 62`；
- 颜色：`41 / 40`；
- serial/限编：`42 / 39`；
- 属性/成分：`36 / 33`；
- 裸数字/ordinal：`39 / 36`。

结论：只修 Composer、只清 precision 或只加世界知识，都无法单独到
`0.90`。要同时增加上游信息、把完整短语保留下来，并且不让不确定候选
越权进入标题。

## 5. 已完成实验和决策

### 5.1 150 张零成本 replay：小正收益 bundle

以前在 20 张卡上看起来有希望的机制已经迁移到 150 张 replay：

- Vocabulary admission：`+0.002231`，`4/0/146`；
- Identity -> Set：`+0.002187`，`4/0/146`；
- 组合 bundle：`+0.006900`，`13/0/137`；
- 更完整的 retained positive bundle：`+0.018124`，`28/0/122`。

决策：`KEEP_FROZEN_NOT_MAIN_HEAD`。这是可回滚的正资产和 baseline
fallback，不再把它误当作从 `0.785` 到 `0.90` 的主方案。

对应证据：

- `docs/evaluation/20-card-replay-transfer-150-2026-08-02.md`
- `docs/evaluation/accuracy-combined-positive-bundle-v1-replay-150-2026-08-02.md`
- `docs/evaluation/accuracy-strategy-closure-audit-2026-08-02.md`

### 5.2 Literal observation v2：表达增量可以保留，但不能直接发布

实现位置：

- `scripts/run-thin-path-eval.mjs`
- `experiments/accuracy/field-specific-observation-lane-v2.mjs`
- `experiments/accuracy/field-observation-resolver-v1.mjs`
- `scripts/replay-field-observation-resolver-v1-105.mjs`

设计：一次 Luna 调用在 canonical 后最多保留两条 typed candidate，角色为
`identity_phrase`、`finish_phrase`、`commercial_marker`、`exact_code`。
每条候选要有 literal text、source region、basis 和 provenance；候选不直接
进入 CSM、Composer、persistence 或 Production。

付费105 paired 验证（control/treatment 共 210 次成功 provider calls）：

- treatment 最终标题 F1：`0.77860`；control：`0.78235`；delta `-0.00375`；
- wins/losses/ties：`23/25/57`，`p=0.885`；
- 候选捕获：25 rows / 23 cards；18/25 有 reference-token overlap，
  仅作诊断，不能当作 final-title gain；
- input tokens `+4.8%`，output tokens `+56.1%`，median latency `+949ms`。

零成本 resolver replay：

- 105 cards，1 个安全 admission（`05/50` over `5/50`），24 个 candidate-only；
- F1 `0.777106 -> 0.777972`，delta `+0.000866`；
- wins/losses/ties：`1/0/104`；reference losses `0`；over80 `0`；
- 未达到主攻门槛（至少 8 wins、0 losses、至少 `+0.003`）。

决策：保留捕获和 resolver 作为候选研究资产，但冻结为
`SAFE_MICRO_REPAIR_NOT_BIG_HEAD`，不接入 runtime，不再用付费调用证明它的
大头价值。

证据：

- `docs/evaluation/field-specific-observation-v2-paid105-2026-08-02.md`
- `docs/evaluation/field-specific-observation-lane-v2-analysis-2026-08-02.md`
- `docs/evaluation/residual-evidence-lane-v1-design-2026-08-02.md`

### 5.3 Visual bottom-band v1：短期正，生产 Pareto 负

实现是一次调用内追加一张由原图正反面底部 35% 生成的 native-pixel sheet；
原图仍在前面，不 OCR、不锐化、不引入第二次模型调用。

完整 paid105 paired 验证（共 210 次成功 provider calls）：

- control F1：`0.785180`；treatment：`0.789985`；delta `+0.004805`；
- wins/losses/ties：`27/19/59`，`p=0.302`；
- median latency：`5.545s -> 8.177s`，增加 `2.632s`；
- input tokens：约 `+23.8%`；output 基本不变；
- field token-hit 净变化：card_name `+6`、year `+4`、serial `+4`、
  descriptive_rarity `+4`，但 product `-3`、parallel_family `-4`、
  print_finish `-2`。

决策：`COST_NEGATIVE_CANDIDATE`。短期 title F1 是正，但超过写手路径
约 6-8 秒预算，不能进生产，也不再购买第二轮 visual paid sample。

证据：

- `docs/evaluation/visual-bottom-band-v1-paid105-2026-08-02.md`
- `docs/evaluation/fresh150-visual-multiview-offline-audit-2026-08-02.md`

### 5.4 High vs original：尚未回答，不能凭直觉下结论

现有 fresh150 的 300 张图都是最长边约 1400px 的 JPEG。这个 cohort 上的
`original - high = -0.014329` 只说明在已压缩图上不能证明 original 更好，
不说明真正的 3000px 原图没有收益。

如果重新研究，必须使用原始长边至少 3000px、保留文件 SHA 的新 cohort，
同时 paired 比较 `high` 和 `original`。在没有该 cohort 前，状态保持
`UNVERIFIED_COHORT_MISSING`。

### 5.5 世界模型 / release identity graph：资产已构建，但覆盖不够

当前世界模型只允许做 positive support、冲突提示和 candidate ranking：

- 缺边是 `UNKNOWN`，不是 `FALSE`；
- 不能覆盖可见文字；
- 不能凭球员生涯创造 card name、serial、grade、cert 或 parallel；
- 每条 edge 必须有 source、source version/SHA、effective interval、审核状态。

当前 source-versioned graph 已构建：10 个 manifest sources、144 条 edges，
其中 product 105、set 14、parallel 2、rarity 23。由于只有 2 条 parallel
edge，状态是 `BUILT_ADVISORY_INSUFFICIENT_COVERAGE`，不是 runtime knowledge。

旧的 official/local asset audit 也显示：约 143 条记录中只有 15 个 product-set
pair，product-parallel、set-parallel、product-set-parallel 均为 0；当前
world/team/product ranker 没有可推广的 final-title gain，team ranker 还出现
`1 win / 6 losses`，因此已 STOP。

实现和证据：

- `scripts/build-source-versioned-release-identity-graph-v1.mjs`
- `scripts/build-source-versioned-release-identity-graph-v1.test.mjs`
- `docs/evaluation/world-release-identity-graph-v1-build-2026-08-02.md`
- `docs/evaluation/world-asset-coverage-audit-150-2026-08-02.md`
- `docs/evaluation/world-compatibility-ranker-v1-stop-2026-08-02.md`

### 5.6 第二写手 blind calibration：已生成，尚未有人审

生成：117 张卡、285 个 disputed occurrences。packet 不包含 Writer A 标题
和 reference title，选项为 `VISIBLE_TRUE`、`VISIBLE_FALSE`、
`OPTIONAL_TITLE`、`REQUIRED_TITLE`、`UNKNOWN`。

状态：`UNVERIFIED_REQUIRES_HUMAN_BLIND_REVIEW`。不能把 reference-absent
token 直接当错误，也不能把模型输出直接当 field truth。应先把
`field_truth` 与 `title_preference` 分开标注，再做零成本 replay。

实现和证据：

- `scripts/build-second-writer-calibration-packet-285.mjs`
- `docs/evaluation/second-writer-calibration-285-2026-08-02.md`

## 6. 旧的九小时探索，哪些能拿回来

旧链路本身不能恢复。可迁移的是它的因果结论：

- fat path 比裸模型在 255 张 paired cards 上损失约 `9.05pp`，且更慢、更
  吃 token；
- catalog/vector assistance 没有带来已测准确率收益，反而增加 hallucination；
- 过度反幻觉规则在 release condition 被禁用后，错误压掉了 Refractor、
  Prizm、Holo 等可见工艺词；
- 强迫完整 serial numerator 会改变 serial 行为，但在 80 字符预算下常常
  变成 zero-sum trade；
- schema 和 authority 必须分开：canonical 很重要，但不能在观察刚产生
  时就把它丢掉。

因此旧链路留下的是“更大观察通道 + 候选旁路 + 最后收权”的设计原则，
不是 OCR、向量库、目录检索或第二次调用。

## 7. 云端、并发和延迟：不要和准确率混淆

- 之前测过很高的 provider/API 突发并发，不能推导一个租户生产时的安全
  并发；生产甜蜜点必须在真实 Vercel/Supabase topology 上测。
- 当前生产成功薄链路请求约 3.6-5.2 秒，主要时间在一次 Luna provider call。
- 之前本地端到 Supabase 的上传/签名/校验长尾曾达到几十秒；这属于网络和
  持久化边界，不是模型准确率结果。
- 不要用提高并发来掩盖单请求长尾，也不要把容量 lab Preview 部署成生产。
- 新的准确率 paid validation 上限是每个机制最多 105 张；150 张主要用于
  replay、oracle 和 historical evidence，不能自行扩大付费规模。

## 8. 生产准确率门槛

任何 accuracy arm 在考虑 Production 前都必须同时满足：

| 门 | 要求 |
|---|---|
| 独立 cohort | 新的、sealed、未参与机制选择的 cloud cohort |
| title macro F1 | `>= 0.90` |
| critical errors | `0`，尤其是 serial、年份、身份、grade、数量、IP/product |
| 长度 | 所有标题 `<= 80` 字符 |
| request | 单次 GPT-5.6 Luna，reasoning none |
| authority | CSM/SEM 是最终 authority；候选和世界模型无直接发布权 |
| 可回滚 | arm、Composer、CSM/SEM 版本和 evidence ledger 可独立回退 |
| 延迟 | 不以牺牲写手可接受的 6-8 秒预算为代价 |

“回放通过”“请求字节不同”“单测全绿”“oracle 很高”都不是生产准确率
门槛的替代品。

## 9. 给 Claude 的下一步顺序

### A. 先完成低成本、非付费工作

1. 阅读本文和 `docs/evaluation/accuracy-strategy-closure-audit-2026-08-02.md`。
2. 让第二写手完成 117 张 / 285 disputes 的 blind review；不把 scoring map
   提前暴露给标注者。
3. 把 Writer B 的 `field_truth` 与 `title_preference` 分开入账，并对每个
   disputed occurrence 保留 card/session/source lineage。
4. 对所有已有 candidate 做 phrase-aware、role-aware resolver replay；
   先在 150 replay 上测，发现 loss 立即 STOP。
5. 扩充 source graph 的真实 release/product/set/parallel/finish coverage；
   先做 coverage audit 和 zero-call counterfactual，再决定是否付费。

### B. 只有出现新信息后才考虑付费 105

以下任一条件成立，才可提出新的 paired paid105：

- 真正的 native >=3000px image cohort，回答 high/original；
- Writer B 证明一批 candidate 的 field truth，并能由 resolver 安全接入；
- source graph 获得真实、独立、可审计的 finish/release tuples；
- 同次 observation lane 能证明大规模、无损的上游表达缺口。

没有这些新证据，不要为了“再看看”重复 paid call。

### C. 只有最终独立门通过才考虑生产

1. 在独立 cloud cohort 上完成确认实验；
2. 逐字段报告 wins/losses/ties、critical errors、长度、token、latency、
   cost 和 rollback；
3. `>=0.90` 且零关键错误；
4. 通过 production checkout 的 service-context、Vercel、Supabase 和
   front-end smoke；
5. Linear acceptance-complete issues 先保持 `Done`，再由生产 checkout
   做部署。

## 10. 最小操作清单

在实验 checkout 中可以安全执行的零成本检查：

```bash
cd /Users/paidaxin/lynca-thin-path
git status --short --branch
git diff --check
npm run test:thin-path
node scripts/replay-field-observation-resolver-v1-105.mjs
node scripts/build-source-versioned-release-identity-graph-v1.mjs
node scripts/build-second-writer-calibration-packet-285.mjs
```

运行付费脚本前必须先：

1. 确认 cohort、request bytes、control/treatment、输出目录和 checkpoint
   完全隔离；
2. 确认授权的 paid cap 仍是 105；
3. 确认使用 Singapore storage 和正确的 provider/model；
4. 确认不会自动写入 canonical 或 Production；
5. 确认 key 只从环境读取且不会出现在日志。

生产操作只能在：

```bash
cd /Users/paidaxin/lynca-thin-production-main
node scripts/verify-active-service-context.mjs
```

通过后再按生产部署流程执行。不要在本实验 checkout 里做 `supabase db
push`、migration history repair、Vercel production deploy 或打印 secret。

## 11. 证据索引

### 策略和总账

- `docs/evaluation/accuracy-complete-strategy-2026-08-02.md`
- `docs/evaluation/accuracy-big-head-exploration-portfolio-2026-08-02.md`
- `docs/evaluation/accuracy-strategy-closure-audit-2026-08-02.md`
- `docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.md`
- `docs/evaluation/combined-precision-loss-ledger-150-2026-08-02.md`

### 实验结果

- `docs/evaluation/field-specific-observation-v2-paid105-2026-08-02.md`
- `docs/evaluation/visual-bottom-band-v1-paid105-2026-08-02.md`
- `docs/evaluation/accuracy-combined-positive-bundle-v1-replay-150-2026-08-02.md`
- `docs/evaluation/bare-model-current-150-2026-08-02.md`
- `docs/evaluation/bare-canonical-complementarity-150-2026-08-02.md`
- `docs/evaluation/world-release-identity-graph-v1-build-2026-08-02.md`
- `docs/evaluation/second-writer-calibration-285-2026-08-02.md`

### 生产和拓扑

- `docs/operations/production-front-end-verification-2026-08-02.md`
- `docs/operations/production-cloud-runtime-evidence-2026-08-02.md`
- `docs/operations/production-latency-audit-2026-08-02.md`
- `docs/operations/active-service-context.json`（实验 checkout 旧上下文；
  生产以 production checkout 的同名文件为准）
- 生产切 Singapore 的提交：`c851b84a`

## 12. 交接时的状态字典

- `KEEP_FROZEN_NOT_MAIN_HEAD`：有回放正收益，保留可回滚，不当主攻。
- `CAPTURE_COMPLETE_CANDIDATE_ONLY`：表达捕获完成，但没有 canonical 权限。
- `SAFE_MICRO_REPAIR_NOT_BIG_HEAD`：只允许窄、可证伪的微修复；不是大头。
- `COST_NEGATIVE_CANDIDATE`：短期分数正，但延迟/token 使生产长期为负。
- `UNVERIFIED_*`：没有所需 cohort、来源或人审，不能写成正收益。
- `STOP`：该方向已有反证或结构性不足，除非出现新信息，不再继续投入。
- `PAUSED`：生产 promotion 暂停，不等于代码不存在。

## 13. 最后的交接判断

这三天已经把“看起来有希望的零碎改动”与“真正可能改变准确率上限的
信息增量”分开了。下一位执行者最重要的工作不是继续加束缚，而是：

1. 先把 285 个争议 token 变成可靠的 field truth / title preference 证据；
2. 让完整短语和可验证的视觉/关系证据在同一次调用中留下来；
3. 让 CSM/SEM 继续掌握最终 authority；
4. 只有在 150 replay 和最多 105 张真实 paid validation 都证明正资产后，
   才考虑生产；
5. 在达到 `>=0.90` 和零 critical errors 前，不部署新的准确率改动。

这份文档是事实水位，不是下一轮实验的自动授权。任何新实验都要补充独立
证据、成本、延迟、回滚点和明确的 GO/STOP 判定。
