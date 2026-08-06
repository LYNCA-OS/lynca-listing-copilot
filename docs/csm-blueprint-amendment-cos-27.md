# COS-27 — 修订版 CSM 蓝图：monorepo、学习闭环、延迟安全执行

交付物是**蓝图与仓库映射**。按 issue 原文：评审通过前不编码、不迁移、不删除、不部署。本文档不改动任何生产文件。

基线：`origin/main`，1251 个文件。

## 验收项对照

| COS-27 验收项 | 落在 | 状态 |
|---|---|---|
| 仓库/依赖/数据归属/运行时四层分离 | §1 | 已给出四层边界表 |
| monorepo 结构足以指导 COS-25 | §2 | 目录级 + §3 文件级 |
| CSM 绝不依赖应用代码 | §8 | **实测今天为 0**，并给出 CI 门禁 |
| 可信 Submit 进入可溯源、**可逆**的语料 | §6 §10 | 溯源已可产出；可逆机制已设计，**写入路径未实现** |
| TCG/Non-TCG 走正常路径，Lot 明确慢路径 | §5 | 已定义 |
| 不确定与 `empty` 仍是正确输出 | §6 | 三态已实现并在 148 张上验证 |
| 逻辑层不得自动变成串行远程服务 | §9 | 给出四条升级判据 |
| 延迟按阶段可观测且不设自动失败 SLA | §5 | 九项 + 实测覆盖 2/226 |
| 快路径与慢路径显式分离 | §5 | 已定义 |
| 现有内容有文件/目录级迁移分类 | §3 | 八类全覆盖 |
| 评审前不编码/删除/迁移/部署 | 全文 | **本文档未改动任何生产文件** |

需要拍板的选择集中在 §12，未决风险在 §13。

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

**当前埋点覆盖是实测的，不是估计的**：`origin/main` 的 `lib/`、`api/`、`services/` 里有 **226 个不重复的 `_ms` 字段**，其中命中上述九项契约的只有 **2 个**（`queue_wait_ms`、`identity_resolution_ms`）。

这个数字的意义不是「埋点太少」——恰恰相反，是**埋点很多但没有一个是按阶段契约组织的**。226 个计时器分散在各自的模块里，各自定义边界，无法拼成一条 upload→output 的分解。所以第 5 节的九项不是「再加九个计时器」，而是**一层规范化的阶段口径**，其中 224 个现存计时器应被归类为模块内部诊断，不进入阶段分解。

如果不这么做，可预期的结果是第 227 个计时器：多一个数，仍然回答不了「时间花在哪一段」。

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

**当前完成度（2026-08-01）**：薄链路已产出 canonical object、evidence、candidate、resolution、resolved bracket、marketplace output 六类行；存储行可离线 148/148 回放，PostgREST transport 已实现且默认关闭。COS-8/9 的压缩优先级与 TCG Language 已贯穿解析、canonical CSM 和持久化。仍未完成的是应用调用点、真实 Supabase 写入验证、migration applied 状态和 COS-26 的 TCG/Non-TCG 端到端 demo；因此不得把“代码已构造”写成“系统已运行”。

---

## 8. 依赖方向如何强制

验收项「CSM 绝不依赖 Listing Copilot 应用代码」如果只写在文档里，等于没写。

**当前实测状态（好消息）**：九个 CSM 候选目录对 `api/`、`app/`、`lib/listing/client`、`lib/listing/publishing` 的 import 数均为 **0**。

| 目录 | 违规 import |
|---|---|
| `lib/listing/csm/` | 0 |
| `lib/identity-resolution/` | 0 |
| `lib/listing/resolver/` | 0 |
| `lib/listing/renderer/` | 0 |
| `lib/listing/catalog/` | 0 |
| `lib/listing/learning/` | 0 |
| `lib/data-loop/` | 0 |
| `lib/listing/evaluation/` | 0 |
| `lib/listing/evidence/` | 0 |

**结论：依赖方向今天就是干净的，迁移不需要先做解耦。** 这把 COS-25 的风险显著降低——目录移动是重命名，不是重构。

**强制机制**：一条 CI 检查，在 `csm/**` 里 grep 对 `applications/**` 的 import，非零即失败。理由是它必须**廉价到不会被绕过**：一条 grep 谁都能读懂、跑得比测试快、失败信息就是文件名和行号。依赖图工具在这个规模上是过度设计，而过度设计的门禁最终会被 skip。

真正的风险不是 import，是**静默重定义**（第 4 节的六例都是这类：没有一条是非法 import，全部是应用层自己写了一份 CSM 已有的规则）。这类问题 grep 抓不到，只能靠**行为一致性检查**（`scripts/csm-conformance.mjs`，逐卡断言契约条款）。两者是互补的，缺一不可：

- grep 防的是**结构**违规——容易犯、容易查、容易修。
- conformance 防的是**语义**违规——不易犯（要动手抄）、极难查（本项目已因此丢过两次真实数据）、修起来便宜。

## 9. 逻辑层 ≠ 远程服务

验收项「逻辑 CSM 层不得被自动转成串行远程服务」。

`csm/` 下的八个子目录是**模块边界**，默认全部是同进程函数调用。切分目录的目的是可替换、可独立回放、可独立测试，**不是**部署单元。

**当前薄链路只有一个必需的跨进程边界**：

| 边界 | 理由 | 是否保留 |
|---|---|---|
| Luna 模型 provider | 模型托管在外部 | 保留 |
| `services/recognition-worker`（Cloud Run） | 历史兼容代码；2026-08-01 owner 确认全部停止 | 不在正常路径，不恢复、不探活、不部署 |
| OCR provider（Google Vision / Paddle） | 历史链路依赖 Cloud Run | 不在正常路径 |
| 向量 worker / vector store | 3,659 次实测中 92.7% 零候选，且 owner 已停库 | 默认关闭，不恢复 |

`identity-resolution/`、`marketplace-composer/`、`registry/`、`ontology/` **今天不跨进程，且不得因为目录分离而变成跨进程**。

**判据（写成规则，避免逐次争论）**：一个模块边界只有在具备下列理由之一时才可升级为远程边界——(a) 不同的运行时/语言；(b) 独立的伸缩或硬件需求；(c) 外部厂商；(d) 独立的故障域且已有实测证据表明合并会放大故障。**「架构上更清晰」不是理由。**

原因是这条链路是串行的：每加一个远程跳，快路径就多一次网络往返、一次序列化、一个新的失败模式，而快路径的实测中位已经是 3.2–3.5 秒。把四个逻辑层拆成四个服务，会在**不改变任何识别准确率**的前提下让延迟和故障率同时变差。

## 10. 学习语料的可逆性

决策 6 要求「保留溯源与可逆性」。可逆性不是删除权限，是**排除机制**。

机制：语料成员身份由 `dataset_disposition` 决定，且**只追加不改写**。

- 撤回一条记录 = 追加一条 `EXCLUDED` 状态的新事件，指向原事件 id；不删除原始行。
- 语料的「当前视图」是按事件时间取每条 run 的最新 disposition。
- 因此任何一次训练/评测集构建都可以指定一个时间点，重建**当时**的语料——这是可回放的前提。

`buildSemValidationEvent` 已强制四道门禁（三项父级 id、VALIDATED 必须有复核人 + 时间 + identity group + 支持性来源）。**这四道门禁不得放宽**：不可回放的学习记录比没有更糟——它会污染语料且无法定位。

**尚未实现、需要在 COS-25 落地的**：排除事件的写入路径，以及「按时间点重建语料」的查询。目前只有单条事件的构造能力。

## 11. 迁移顺序与验证门

每一步都有一个**可失败的检查**，而不是「做完看看」。

| 步 | 内容 | 通过条件 |
|---|---|---|
| 0 | 对齐 `origin/main` 基线 | 工作树干净，不从特性分支部署 |
| 1 | 可回放持久化落库 | 逐卡回放一致率 = 100%（当前离线 148/148） |
| 2 | 建 `csm/` 目录 + CI import 门禁 | grep 门禁为 0 且在 CI 中生效 |
| 3 | 按目录迁移，**每目录一次提交** | 每次迁移后 conformance 0 违规 + 全量测试通过 |
| 4 | 阶段埋点规范化 | 九项齐全，`path_reason` 可区分快/慢 |
| 5 | `v4/` 逐部件行为对比 | 每个部件有配对测量结论才动 |

**第 1 步必须在第 3 步之前**，理由不是偏好：「每层可从存储证据回放」是 COS-25 唯一**无法事后补**的验收项。一条持久化了摘要而不是输入的链路，永远不可回放，而且要到需要重新推导时才会发现。

**第 5 步放在最后**，因为 `v4/`（64 文件）是最大的一块，且 255 张配对已证明这条链路**整体**是净负资产（0.743 vs 裸模型 0.8334，p<0.00001）——但「整体净负」不等于「每个部件都该删」。逐部件对比是唯一能区分这两者的方法。

## 12. 本次评审需要拍板的事项

以下六条是本蓝图**主动选择**的、并非 issue 原文直接规定的，需要明确通过或否决：

1. **`csm/` 的八个子目录按域切分**（第 2 节），不设 `v2`/`v4` 永久目录。
2. **依赖门禁用 CI grep 而非依赖图工具**（第 8 节），理由是廉价到不会被绕过。
3. **模块边界默认同进程**，升级为远程需满足四条理由之一（第 9 节）。
4. **可逆性用只追加的排除事件实现**，不做物理删除（第 10 节）。
5. **迁移顺序：先持久化，后目录，`v4/` 最后**（第 11 节）。
6. **226 个现存 `_ms` 计时器归类为模块内部诊断**，不进入九项阶段分解（第 5 节）。

以及三条**待 CSM 侧拍板**的本体问题，已单独开 issue，不在本蓝图内解决：COS-39（三套 grammar 字段名不一致）、COS-40（`printFinishSuggestion` 未导出）、COS-41（Auto/RC 在 keep-list 上但无 bracket 位置）。

## 13. 未决问题与风险

| # | 问题 | 风险 | 现状 |
|---|---|---|---|
| 1 | `lib/listing/feedback/`（7 文件）需拆分：采集属应用、分类与准入属 CSM learning | 拆错会让应用层持有语料准入权 | 未做文件级拆分方案 |
| 2 | `scripts/` 183 个非测试脚本的二次分类 | 低 | 只做到粗分类 |
| 3 | `prompts/`（6）是运行时资源还是历史样本 | 低，但影响它归 `csm/` 还是 `tools/` | 未判定 |
| 4 | `lib/vendor/`（6）是否仍被引用 | 低 | 未确认 |
| 5 | Registry / Identity Resolution / Composer / 应用四个版本号的产生与存储方式 | **中高**——第 6 节可信反馈契约有四项标注「待接」，缺版本号的学习记录不可回放 | 未设计 |
| 6 | 迁移期间生产分支与 `csm/` 重构的并行策略 | 中——目录大规模移动会让所有在途 PR 冲突 | 未定 |

**第 5 项是其中最值得先解决的**：它不是迁移问题，是数据问题。迁移可以重做，写进语料的、缺版本引用的记录不能。
