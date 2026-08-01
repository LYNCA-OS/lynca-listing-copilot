# COS-27 — 修订版 CSM 蓝图：monorepo、学习闭环、延迟安全执行

交付物是**蓝图与仓库映射**。按 issue 原文：评审通过前不编码、不迁移、不删除、不部署。本文档不改动任何生产文件。

基线：`origin/main`，1251 个文件。

---

## 1. CSM 与 Listing Copilot 的分离

四个层面各自的边界，缺一层分离就是假的：

| 层面 | CSM | Listing Copilot |
|---|---|---|
| **仓库** | `csm/` 顶层目录 | `applications/listing-copilot/` |
| **依赖** | 不得 import 任何 `applications/**` | 可 import `csm/**` 的公开契约 |
| **数据归属** | ontology、registry、evidence、canonical object、学习语料 | 会话、批次、用户修改、提交记录、导出 |
| **运行时** | 可被多个应用调用，无 UI 假设、无租户假设 | 持有租户、认证、UI 状态 |

**依赖方向单向**，用 lint 规则强制而不是靠约定：

```
CSM 能力 → Listing Copilot 应用 → 可信用户提交
        → CSM 学习数据 → 大规模复核 → Registry/规则/模型改进 → 更强的 CSM 发布
```

Listing Copilot **消费** CSM，不得静默重定义 CSM 本体。今天违反这一条的地方在第 4 节列出。

---

## 2. monorepo 目标结构

按域归属划分，不按历史版本。**不使用 `v2`/`v4` 作为永久目录边界**——它们是时间标记，不是域。

```
csm/
  ontology/              # sem-definition, field-labels, product-semantics
  contracts/             # 阶段契约、provider 输出契约、schema 版本
  registry/              # 目录/清单知识（当前 lib/listing/catalog）
  recognition/           # 证据与候选产出，不做消解
  identity-resolution/   # 候选 → canonical object
  marketplace-composer/  # canonical object → 各市场投影
  learning/              # 反馈分类、验证事件、语料准入
  evaluation/            # 判据、配对 harness、一致性检查

applications/
  listing-copilot/
    api/                 # 当前 api/
    app/                 # 当前 app/
    client/              # 当前 lib/listing/client
    publishing/          # 当前 lib/listing/publishing

infrastructure/
  supabase/              # migrations, queries, rollbacks
  vercel/
  cloud-run/             # recognition-worker 部署

shared/                  # 租户、可观测性、有界 fetch 等跨域基建
data/                    # 小型固定数据集；大产物移出（见第 6 节）
tests/
tools/
docs/
```

**关键判断：`recognition/`、`identity-resolution/`、`marketplace-composer/` 是三个独立目录而不是一条链的三个文件**，因为 COS-25 的边界要求每一层可独立回放。

---

## 3. `origin/main` 文件级迁移分类

八类，按 issue 定义。**本阶段不移动任何文件。**

### 3.1 迁入 CSM 核心

| 现位置 | 目标 | 依据 |
|---|---|---|
| `lib/listing/csm/` (6) | `csm/ontology/` | 已经是本体定义 |
| `lib/listing/schemas/` (3) | `csm/contracts/` | |
| `lib/listing/evidence/` (2) | `csm/recognition/` | 证据 schema 与归一化 |
| `lib/listing/recognition/` (10) | `csm/recognition/` | 但 `commercial-review-*` 两个属应用层（见 3.2） |
| `lib/listing/ocr/` (2)、`lib/listing/preingestion/` (4) | `csm/recognition/` | |
| `lib/identity-resolution/` (17) | `csm/identity-resolution/` | |
| `lib/listing/resolver/` (5) | `csm/identity-resolution/` | |
| `lib/listing/renderer/` (7) | `csm/marketplace-composer/` | 当前是渲染器，契约上是 Composer |
| `lib/listing/catalog/` (23) | `csm/registry/` | |
| `lib/listing/grade/`(2)、`year/`(1)、`print-run/`(1) | `csm/ontology/` | 单字段语义 |
| `lib/listing/learning/` (3)、`lib/data-loop/` (5) | `csm/learning/` | |
| `lib/listing/evaluation/` (20) | `csm/evaluation/` | |
| `services/recognition-worker/` (39) | `csm/recognition/worker/` | 运行时部署见 3.3 |

### 3.2 迁入 Listing Copilot 应用

| 现位置 | 数量 | 依据 |
|---|---|---|
| `api/` | 54 | 全部是应用端点；其中 `admin-apply-*-migration.js` 属基建（3.3） |
| `app/` | 20 | UI |
| `lib/listing/client/` | 5 | SDK、上传阶段、恢复策略 |
| `lib/listing/publishing/` | 6 | eBay 草稿与发布审计 |
| `lib/listing/feedback/` | 7 | 采集属应用；分类与语料准入属 CSM learning，需拆 |
| `lib/listing/recognition/commercial-review-*` | 2 | 商业复核工作流，不是识别 |
| `lib/listing/memory/`(2)、`readiness/`(2) | 4 | 会话态 |

### 3.3 保留为基建

`supabase/`（112，含 104 migrations）、`.github/`（20）、`vercel.json`、`middleware.js`、`lib/tenant/`（9）、`lib/observability/`（1）、`lib/ops/`（1）、`api/admin-apply-*-migration.js`、`playwright.config.mjs`。

### 3.4 保留为评测/工具

`scripts/` 435 个里 **252 个是 `*.test.mjs`** → `tests/`；其余 183 个再分：评测跑批与分析工具 → `csm/evaluation/` 或 `tools/`，一次性运维脚本 → `tools/maintenance/`。`e2e/`(1)、`maintenance/`(3)、`prototypes/`(4)、`animation-plans/`(5) → `tools/` 或删除候选。

### 3.5 仅慢路径

`lib/listing/retrieval/`（37）、`lib/listing/external/`（2）、`lib/listing/knowledge/`（2）、`lib/listing/cold-start/`（2）。

**依据不是猜的**：catalog assist 与 vector retrieval 在 255 张配对上被判为准确率零贡献、幻觉分别 +4/+5。它们不该在快路径上，但也不该删——目录知识是剩余识别缺口里唯一有机制可循的一块（见第 7 节）。

### 3.6 暂时保留的兼容/历史代码

`lib/listing/v4/`（64）、`lib/listing/pipeline/`（20）、`lib/listing/orchestration/`（10）、`lib/listing/candidates/`（5）、`lib/listing/providers/`（12）、`lib/listing/cache/`（4）、`lib/listing/storage/`（5）、`lib/listing/image-quality/`（3）。

**这是最大的一块，也是最需要行为对比才能动的一块。** `v4/` 不是域，是一次重写的时间标记；它内部的 `anchors/`、`route-planner/`、`targeted-assist/` 各自属于 recognition 或 identity-resolution，但拆分前必须逐个做行为对比——255 张配对已经证明这条链路整体是净负资产（0.743 vs 裸模型 0.8334，p<0.00001），**但"整体净负"不等于"每个部件都该删"**。

### 3.7 生成物/大数据 → 对象存储

`data/` 5.3 MB（48 文件）。评测数据集（255 张封签标签）留在仓库；跑批产物已在 `/Volumes/musician/lynca-offload/`，**不得回流仓库**。`prompts/`(6) 需判定是运行时资源还是历史样本。

### 3.8 行为对比后的删除候选

`prototypes/`(4)、`animation-plans/`(5)、`lib/vendor/`(6，需确认是否仍被引用)、`scripts/` 中被 253 个测试覆盖不到的一次性脚本。

**已知的两个死代码**（自身与测试之外零引用）：`lib/listing/csm/sem-validation.mjs`、`lib/listing/csm/product-semantics.mjs` —— 但这两个**现在已被薄链路引用**（见第 5 节），删除候选身份已失效。这正是"行为对比后再删"的价值。

---

## 4. Listing Copilot 静默重定义 CSM 的现存违规

审计发现的、需要在迁移中修掉的：

1. **薄链路曾手写 `BRACKET_ORDER`**，与 `semStandardTitleOrder` 有两处顺序相反（[Card Number] 排在 [Numerical Rarity] 前、[Subject] 排在 [Release Variant] 后）。已改为引用。
2. **薄链路曾手写限编/卡号判据**，与 `classifySemNumberBoundary` 并存。已改为引用。
3. **`printFinishSuggestion` 未导出**，导致消费者必须复制降级阶梯（COS-40）。
4. **三套 grammar 顺序字段名不一致**，按名过滤会静默丢 bracket（COS-39）——已造成两次真实数据丢失。
5. **Auto/RC 在 keep-list 上但 `semStandardTitleOrder` 里没有位置**（COS-41）。

前两条是 Listing Copilot 侧的违规，已修；后三条是 CSM 侧需要拍板的，已开 issue。

---

## 5. 快路径 / 慢路径执行契约

延迟**可观测但不作为自动失败门**。

### 快路径

```
正反面材料
→ 整卡模型推理 + OCR + 本地 Registry 访问（可并行处）
→ 证据与 bracket 候选
→ 一次 Identity Resolution
→ canonical identity
→ 确定性 Marketplace Composer
→ 可复核的 Listing Copilot 结果
```

**快路径不得被阻塞于**：可选网络检索、重复模型轮次、训练、大规模反馈分析、影子实验、非关键遥测、深度富化。

TCG 与 Non-TCG 走正常路径；**Lot 明确走慢路径**。

### 慢路径

Lot 处理、深度 OCR、外部/目录富化、低置信度校验、学习聚合、模型训练、评测。

### 分阶段埋点（九项，全部为诊断证据，不是 SLA）

`upload_ready_ms`、`queue_wait_ms`、`ocr_ms`、`primary_model_ms`、`registry_ms`、`identity_resolution_ms`、`composer_ms`、`persistence_ms`、`user_perceived_total_ms`，外加 `path_reason`（fast / slow 及其原因）。

**已有实测基线可作为对照**：薄链路 provider 延迟中位 3.2–3.5 秒、输出 24–104 token；旧链路 5.8–9.5 秒、553–1247 token。

---

## 6. 可信反馈契约

每次 trusted Submit 必须保存的 12 项，均已可从 CSM 现有能力产出：

| 项 | 来源 |
|---|---|
| asset/run identity | harness / 应用 |
| 原始 canonical fields 与标题 | `resolvedFieldsToSemSuggestion` + Composer |
| 提交/修正后的标题与结构化编辑 | `buildWriterTitleSemCandidate` |
| 证据与不确定状态 | `empty` / `unreadable` / `low_confidence` 三态 + `SEM_OBSERVATION_LAYER` |
| CSM schema 版本 | `SEM_STANDARD_VERSION` |
| Registry/规则版本 | 待接 |
| 识别模型与 OCR 版本 | provider 回显 |
| Identity Resolution 版本 | 待接 |
| Composer 版本 | 待接 |
| 应用版本 | 待接 |
| 用户/租户溯源与时间戳 | 应用 |
| 可逆/排除状态 | `buildSemValidationEvent` 的 `dataset_disposition` |

进入语料由 `classifyWriterFeedbackForSemanticLearning` 分层：**商业反馈 / 重复模式 / 已复核本体三者不得混同**——REJECT 是商业反馈不是语义真值，EDIT 在稳定样本上才是 `REVIEWED_SEMANTIC_TRUTH`。

`buildSemValidationEvent` 已强制三项父级 id、VALIDATED 必须有复核人+时间+identity group+支持性来源。**这四道门禁不得放宽**：不可回放的学习记录比没有更糟。

---

## 7. 与 COS-25 的交接

本蓝图评审通过后，COS-25 的实施顺序建议：

1. **先做可回放的持久化**（Supabase schema：asset、evidence、candidate、resolved field、composer output、validation event、版本引用），因为"每层可从存储证据回放"是 COS-25 唯一无法事后补的验收项。
2. 再做模块边界迁移，逐目录做行为对比。
3. `v4/` 最后动，且必须逐部件对比——整体净负不等于部件皆负。

**当前完成度**：canonical object → marketplace composition 两段已按 CSM 实现并通过逐卡一致性检查（8 条契约，v3/v4 产物均 0 违规）。upload → asset → evidence → identity resolution 四段未开工。
