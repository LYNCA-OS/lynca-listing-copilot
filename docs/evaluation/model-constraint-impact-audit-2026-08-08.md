# Luna 模型约束影响审计 — 2026-08-08

## 决策

**反方结论先行：当前证据不支持“Production 在 Luna 调用前加了过多约束，
所以模型分数低”是主因。** 约束确实减少表达，但其中多数是在用 recall 换取
已经测得的 precision；盲目拆掉它们，比保留它们更差。当前最可信的分解是：

| 最早边界 | occurrence | 能说明什么 | 不能说明什么 |
|---|---:|---|---|
| 模型/开放观察仍未表达 | **254** | 在更开放的同图响应里也没有该 token | 不能据此断言像素不可见，也不能断言模型无能力 |
| schema / admission 未进入 canonical | **109** | 模型表达过，但 strict canonical schema 或字段权威没有保留 | 不能把 109 项全部自动提升为 CSM 真值 |
| Composer / marketplace projection 未发出 | **63** | canonical 输入已有影子，损失发生在模型调用之后 | 与模型输入约束无关 |

最新可复现 current-main analyzer baseline 是 **`0.7811418979` macro F1**。三个数字
是“最早边界”
归因，不是三个可相加的收益池。任何按 reference token 回填得到的分项或组合
oracle 都读取了答案；它们只是各最早边界内“只增加缺失 reference token”的
局部上界：**不可部署、不可作为完整机制 forecast、不可相加。**

本审计的 post-Luna replay 新增 paid calls：**0**。随后独立预注册的 residual v3
screen 在隔离 Singapore Preview 完成 **105 calls**；没有修改 Production runtime、
prompt、schema、admission 或 Composer。正式结果见
`docs/evaluation/model-residual-v3-paid105-2026-08-08.md`。

## 当前 Production 实际请求

实验 checkout 与 canonical Production 的四个核心文件在本轮逐字节一致；当前
Production 请求不是旧文档中的 `reasoning=none`，而是：

| 轴 | 当前值 | 代码证据 | 约束类型 |
|---|---|---|---|
| model | `gpt-5.6-luna` | `lib/listing/thin/csm-runtime-contract.mjs:19-33` | 固定模型 |
| reasoning | `low` | 同上 `:22-32` | 可能改变表达量和精度 |
| image detail | 默认 `high`；只允许 `high/original` | `api/csm-listing-title.js:67-73,335-346` | 视觉传输 |
| image count | 1–2 个 original slot | `lib/listing/storage/canonical-image-references.mjs:560-578` | 输入带宽 |
| selected image | 无更小 derived 时读 original | 同文件 `:383-415` | 当前 Production 惰性 |
| prompt | 约 2,782 字符、493 个空白分词 | `lib/listing/thin/canonical-fields.mjs:230-254` | 语义约束 |
| response | strict JSON Schema | 同文件 `:61-228,481-523` | 表达通道 |
| output cap | `8192` | 同文件 `:481-523` | 非当前瓶颈 |
| temperature/top_p/seed | 未发送；Luna 不接受 | `docs/handoff-2026-08-07.md:133-141` | 不可用轴 |
| extra providers | OCR/catalog/vector/web/second call 均无 | `lib/listing/thin/canonical-fields.mjs:1-19` | 架构边界 |

### Prompt 的具体限制

当前 prompt 同时包含 completeness 与 literal precision 两股相反的力：

1. 按 slab → front → back → grade/auto 区域顺序检查；前后图合并读取。
2. “report every field you can actually read”，80 字符预算不能成为漏报理由。
3. 只报当前图中可见内容，不能报“这张卡通常是什么”。
4. 不确定但看得到时必须报告值，并把字段名加入 `low_confidence`；完全看不清
   才进入 `unreadable`。
5. 每个字段只放自己的值，不生成标题，不在多个字段重复同一词。
6. parallel 拆成 basic colour、finish family、printed exact name；仅 colour 也应报告。
7. `product > set > card_name` 顺序互斥；前两者耗尽短语时 `card_name` 必须空。
8. serial 与 checklist code 分离；serial 任一数字不清楚时留空而不是猜。

完整字节来自 `lib/listing/thin/canonical-fields.mjs:230-254`。其中第 2、4 条是
**反压制**指令；第 3、7、8 条会减少表达，但其目的分别是防知识幻觉、字段振荡
和关键数字错误。

### Schema 的具体限制

`CANONICAL_FIELDS_SCHEMA` 有 23 个顶层 properties，23 个全部 required，且
`additionalProperties:false`。空字符串/空数组表达“不存在”，不是省略 property。

- 13 个自由字符串：`year/manufacturer/product/set/card_name/release_variant/
  parallel_exact/descriptive_rarity/team/card_number/serial/special_stamp/lot_count`；
- 4 个数组：`subjects/attributes/low_confidence/unreadable`，schema 本身没有
  `maxItems`；
- closed enum：language 10 项、surface colour 18 项、parallel family 23 项、
  attributes 8 项、description 2 项、grammar 3 项；
- structured grade 固定为 company/card grade/auto grade/grade type 四项；
- 没有开放 residual text、evidence ledger 或 model-knowledge hypothesis 通道。

因此 schema 可以真实压掉 schema 外表达；但“被压掉”不等于“应成为 canonical”。
109 项旧语义审计中，52 项 `safe_direct`、34 项 `needs_evidence`、11 项 synonym、
12 项 wrong-role。即使把 109 全部叫作 schema headroom，也至少 57 项不能直接自动
写回。来源：`docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.md:37-40`
及同名 JSON。当前 replay 把最前一层修正为 254；历史 255 台账保持 append-only，
不回写旧文件，也不得把两个版本混在一次汇总里。

## 四层必须分开

### 1. 模型前约束

图像选择、detail、prompt、reasoning 和 response schema 都在 Luna 输出前生效。
它们可以改变模型实际表达。只有 contemporaneous paired call 才能测其因果影响。

### 2. 模型自抖动

14 张真实卡在 **original vs original** control 中只有 4/14 每个字段完全一致；
21 个字段分歧中 12 个来自 `set/card_name` 边界，真正 misread 只有 2 个。
来源：`docs/handoff-2026-08-07.md:118-141`。因此 treatment 与单个 control 的差异
不能全部归因于 treatment；任何新实验必须有两个独立 canonical controls。

### 3. Schema 与 admission

Schema 决定模型能写什么；admission 决定已表达内容能否获得 canonical authority。
二者不能合并成“模型没看见”。候选 lane 可以用于测 schema suppression，但必须
`candidate_only`，自动 CSM/renderer/persistence authority 全为 false。

### 4. Composer

Composer 在 provider 返回后按 CSM grammar、marketplace profile 与 80 字符预算投影。
当前 replay 的 63 项属于这里，不能通过改 prompt 或图像修复。预算本身也不是
主要边界：旧 150 counterfactual 只有很小一部分由字符预算解释；当前请求 output
cap 更与 80 字符 Composer budget 无关。

## 已核实 ablation

| Ablation | 同批/配对结果 | 判断 |
|---|---|---|
| `none → low`, 105 | 历史 paired ablation 重算 `+0.016808`, 40W/21L/44T, `p=.0204`; precision `0.8273→0.8573` | **正；支持保留 low，但不是当前 Production 准确率** |
| `none → low`, 150 | 历史 paired ablation `+0.013184`, 49W/36L/65T, `p=.193` | 方向复现，单批不显著；不是当前 Production 准确率 |
| `low → medium`, 105 | `+0.015327`, 30W/19L/56T, `p=.152`; p50 `12.1s→16.0s` | 质量上界；延迟否决 |
| loosen printed→visible | `-0.0063`, 5W/11L/32T | **负；literal prompt 是 load-bearing** |
| 允许从 product line 猜 finish | `-0.0092`, 9W/15L/26T | **负；错值增加** |
| constructed few-shot | `-0.0017`, 7W/11L/32T | 负/漂移内 |
| corpus k-fold few-shot | `+0.0051`, 9W/7L/34T | 低于约 `0.009` 自抖动；现有语料无法判定 |
| structured serial | `+0.0015`, 9W/10L/31T；PARTIAL 0/50 | **负机制；目标状态不存在** |
| `high → original`, 50 | `-0.014329`, 5W/11L/34T；所有图 ≤1400px | 当前 cohort 为负；不能外推真正大图 |
| bottom 35% 第三视图, 105 | `+0.004805`, 27W/19L/59T, `p=.302`; latency +2.632s, input +23.8% | capture-positive、成本负、未过 gate |
| field-observation v2, 105 | 25 rows/23 cards；resolver `+0.000866`, 1W/0L/104T | schema 会释放表达，但未形成 big-head gain |
| output cap `4096→512`, 20 | `+0.0009`, 4W/3L/13T；512 更慢 | cap 不是表达/延迟修复 |
| `parallel_family` 扩 enum 假设 | 21 个错值中 20 个正确词已在 enum | enum 不是主限 |
| 1600px downscale parity, 14 | original/original 21 disagreements；original/downscale 20 | 未见 degradation；样本无标签且 Production producer 已回滚 |
| current-main 移除 withheld finish | `-0.0062278102`, 4W/15L/131T | **负；不应解除 finish withholding** |
| current-main 恢复 search optimization | `-0.0294731441`, 20W/96L/34T | **负；profile suppression 是 load-bearing** |
| current-main 恢复 card number | `-0.0396681751`, 1W/112L/37T | **负；大量无商业价值数字污染** |
| current-main 同时移除两类 profile suppression | `-0.0612523995`, 16W/119L/15T | **强负；约束不是主损失** |
| current-main generalizable Composer recovery | `+0.0023589744`, 3W/0L/147T；2 张有非 reference 的 title token 压缩删除 | 参考 F1 无损正向，但未过 `+0.003/8 wins` Gate 0 |
| 旧 narrow cumulative bundle | `+0.006900`, 13W/0L/137T | **development-selected utility screen**；逐 proposal 用 reference loss 拒绝，不能当 label-blind Gate 0 |
| 当前 label-blind safe-bundle utility | `+0.0060804745`, 11W/0L/139T；0 ref-loss/unbacked/>80 | utility PASS；输入混合 canonical/free/exhaustive，不能证明新 residual schema 会捕获这些证据 |
| 当前 typed candidate capture + resolver, 105 | `+0.0029180037`, 4W/0L/101T；25 candidates，2 ref-loss cards | **capture/non-interference FAIL**；未过 `+0.003/8 wins/0 ref-loss` |

post-Luna 数字安全计数已按语义修正：`49ers`、`76ers` 等 identity word 不再算
numeric claim。search 恢复是 0 numeric-add / 1 numeric-loss；card-number 恢复是
91 numeric-add；两类同时恢复是 83 numeric-add / 1 numeric-loss。所有新增数字均能
在 provider value field 找到，因此是“有来源但商业价值为负的 mutation”，不是
unbacked factual error。metadata 字段 `grammar/low_confidence/unreadable` 和未知 key
不再被当作 source evidence。

主要来源：

- `docs/EXPLORATION-LEDGER-20260805.md:70-152,185-220,277-286`；
- `docs/evaluation/model-score-recovery-plan-2026-08-01.md:239-261`；
- `docs/evaluation/visual-bottom-band-v1-paid105-2026-08-02.md:19-49`；
- `docs/evaluation/field-specific-observation-v2-paid105-2026-08-02.md:24-78`；
- `artifacts/effort-105-none-low/thin-path-gpt-5.6-luna.json:11-71`；
- `artifacts/effort-105-low-medium/thin-path-gpt-5.6-luna.json:11-71`；
- `artifacts/effort-low-150/thin-path-gpt-5.6-luna.json:11-71`。
- `docs/evaluation/post-luna-current-main-150-2026-08-08.md:11-37`。
- `docs/evaluation/model-residual-big-head-v2-replay-2026-08-08.md:5-31`。

## Residual v3 paid105 actual result

35 张卡按 A/B/C 三臂完成 105/105 调用，0 retry、0 failure。A/B 是逐卡字节相同
的 canonical control，C 只增加 `residual_visible_evidence` response property。
完整 checkpoint 和 envelope 全部通过身份、哈希、served-effort 与 deterministic
replay 验证后，分析器才打开 sealed labels。

预注册总结果为 **FAIL**：

- resolver `+0.0071073`, `4W/0L/31T`，过 delta 与 safety 门，但没有达到 8 wins；
- canonical interference `+0.0000480`，没有均值回归；唯一 shape defect 在 A/B/C
  同一张卡上都存在，不是 treatment-induced，但仍违反 absolute-zero gate；
- input token p50 ratio `1.0264` 通过，latency p95 ratio `1.1638` 通过；latency p50
  ratio `1.2989` 失败；
- C 捕获 31/35 卡、71 行，但只有 6 卡改变 typed fields、4 卡改变标题；3 个 win
  来自 `1st Bowman`，1 个来自 slab 上的 printed finish；
- self-jitter 很大：A/B exact title 只有 18/35，exact fields 5/35，但 aggregate
  F1 delta 只有 `+0.0006724`，没有方向性偏差。

成本大头不是 input schema bytes，而是输出冗长：C input p50 只多 2.64%，output
token p50 多 76.65%。因此保留 candidate-side-channel 的研究价值，但拒绝当前宽
schema 实现，不进 Production，也不继续购买同方向实验。

## 历史决策路径：先零调用，后 35 × 3

### Gate 0 — utility 与当前 capture 必须分开

零调用证据不是“没有正向 resolver 资产”，而是两层结果：

| 零调用问题 | Cohort | 结果 | 结论 |
|---|---:|---:|---|
| 已有 source-only resolver 是否有 utility | 150 reused/development | `+0.0060804745`, 11W/0L/139T，0 ref-loss/unbacked/>80 | **descriptive utility PASS** |
| 当前 typed residual candidates 能否供给该 utility 且不干扰 canonical | 105 | `+0.0029180037`, 4W/0L/101T，2 ref-loss | **capture/non-interference FAIL** |

旧 narrow bundle 的 `+0.006900`, 13W/0L/137T 也必须保留，但它在每个 proposal
上读取 reference token loss 来决定是否拒绝，是 development-selected utility
screen，不是 label-blind deployable gate。当前 150 safe bundle 去掉了这一类评分时
选择，证明窄 resolver 有可复用 utility；但其输入来自 canonical、free-expression
与 exhaustive 三类已付费输出，不能证明一个新的 same-call residual schema 会产出
所需证据。

这是运行 v3 之前的 Gate 0 水位：**当时的 residual capture 与 non-interference
未过门**，不是“零调用 resolver 没有正资产”。后续 v3 通过独立审查、物理
label-free input、sealed-label receipt 与 Preview-only authorization 后才获得一次性
105-call 授权；上面的 actual result 取代了“尚未运行”的状态，但不改变 Production
边界。

### 最小可辨识实验 — 35 张 × 3 arms = 105 calls

目标不是证明新 schema 上线，而是区分“schema treatment 的信号”与“同请求自抖动”。

同一组 35 张卡，按固定 salted SHA-256、label-blind 从未用于该 resolver 的 105 reserve
中选出；每张按轮换顺序调用三次：

| Arm | Calls | 请求 |
|---|---:|---|
| A — canonical control 1 | 35 | 当前 Production low/high/prompt/strict schema |
| B — canonical control 2 | 35 | 与 A 字节相同，但独立 provider response |
| C — schema treatment | 35 | input text 与 A/B 字节相同；只把 response schema 增加最多 8 行的 `candidate_only` visible-span ledger |

Treatment property 最多 8 行，每行 exact keys 为 `text/role/region/basis`。
`role` 只允许 `identity_phrase/finish_phrase/commercial_marker/exact_code/
other_visible`，`basis` 只允许 `printed_text/visual_pattern`。捕获 envelope 在应用层
强制 `authority="candidate_only"`；不得包含 reference、catalog 或 model-knowledge
值。canonical 23 fields 与 A/B 完全相同。这样 C 相对 A/B 的差异包含“给模型一个
额外 schema 表达通道”的完整因果处理，而 A↔B 直接估计相同请求的自抖动。

预注册 estimand：

- 每卡 schema effect：`score(C) - mean(score(A), score(B))`；
- self-drift：`abs(score(A) - score(B))` 与 A/B 字段 disagreement；
- 主机制指标：C 捕获且冻结的 source-only utility resolver 可安全应用的 target occurrences，减去 A/B
  任一 canonical field 已表达的 occurrences；
- non-interference：C 的 canonical precision 不低于 A/B 均值，critical mutation 0；
- economics：总 input/output tokens、p50/p95 latency、失败/重试、每个安全 recovery 成本。

冻结 analyzer 的通过条件必须同时满足：

1. resolver 在 C 上至少 8 wins、0 losses，`ΔF1 >= +0.003`，且 critical、
   reference loss、unbacked token、unsupported numeric、over-80 全为 0；
2. C canonical 相对 pooled A/B 的 `ΔF1 >= -0.002`，canonical shape defect 为 0；
3. input-token p50 ratio `<=1.06`，latency p50 `<=1.15`、p95 `<=1.20`。

Self-jitter 与 sign test 仍报告，但没有被事后加入 decision gate。35 张的统计能力
不足以确认很小的总体 F1 增益；它只用于否证 schema treatment、验证机制与成本。
未过时不得扩到 150，也不得把 105-call screen 写成 accuracy promotion。

### Preview execution contract

- 唯一项目 `lynca-capacity-lab`，Preview function 在 Singapore `sin1`；Production
  调用物理禁止；
- concurrency 1、105 hard cap、0 automatic retry；
- authorization receipt 绑定 prereg、payload、sealed-label SHA、deployment、run
  fingerprint 与 call cap；
- 每次调用前 durable `ATTEMPTED`，逐 job 检查 signed-URL TTL；
- semantic、normalized、wire SHA 分离，checkpoint 保存 provider response、raw
  structured output 与 full envelope receipt；
- analyzer 只有在 105 jobs、envelope replay、dataset/mapping/path 全部验证后才读
  sealed labels。

### 实验完整性硬约束

Production 的两层 identity 不能混写：durable **operation key** 故意不含
`reasoning_effort`，以保持同一用户操作稳定；但 execution **payload hash 已包含
reasoning_effort 和 original image identity**。同 operation key、不同 effort 会
payload-conflict；旧 hash 兼容查找只允许 `low`，不会让未来 `none/max` 复用旧结果。
见 `lib/listing/thin/luna-direct-dispatcher.mjs:65-126` 与
`api/csm-listing-title.js:395-410,452-500`。

仍未被 execution payload hash 字节级绑定的是实际 prompt、schema 和 output cap；
这里只绑定 `prompt_version`，所以这些字节改变时必须升级版本或使用隔离 eval
identity。35×3 必须走隔离 harness：每个 arm 有独立 run id/out-dir，A/B 的
`full_request_payload_sha256` 相同但 provider response/attempt identity 不同，C 的
`full_request_payload_sha256` 只因 schema bytes 改变。调用前断言：

- A request bytes 与 B 相同；
- C 仅 schema bytes 不同；
- 三 arm 的 dataset/image/model/effort/detail/cap/prompt hash 相同；
- 不允许跨 run id resume，不允许让 Production operation dedupe A/B，也不允许把
  replay row 计为新 call。

## Source receipts

以下 SHA-256 在本审计时从工作区只读计算；它们锁定输入与当前实现，不给 oracle
增加部署权威：

| Path | SHA-256 |
|---|---|
| `lib/listing/thin/canonical-fields.mjs` | `ab6e89ce99c4ff48293c65b7dbf20cb323f62586d44936b7a57f44554474973c` |
| `lib/listing/thin/csm-runtime-contract.mjs` | `99d2f39068f5acacd00e208beae6fb2aea9648ebcc1ee2718a54ae01d438501e` |
| `lib/listing/thin/luna-direct-dispatcher.mjs` | `a47a023816ce94c37962c66a0d942bb861c75bb356bb5c2451bcf3c62053082d` |
| `lib/listing/storage/canonical-image-references.mjs` | `aa44d6cd418f83850ec1053e47eab81d93778061721d58f93fe30023edac52ca` |
| `api/csm-listing-title.js` | `ef53a287c1bdafd9a71c51dbc4b74a54101288081dee89e70063ded83654e70b` |
| `docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.json` | `5d1719d32752ccfd6039769488aba3d34afda39fb0d4d14994d2148a9cff682a` |
| `artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl` | `2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5` |
| `artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl` | `96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9` |
| `artifacts/effort-105-none-low/thin-path-gpt-5.6-luna.json` | `d8f771fd87d426f34c3fec1381b4b67fe82c3ca011d3b3d1e298a05aa3786830` |
| `artifacts/effort-105-low-medium/thin-path-gpt-5.6-luna.json` | `cfca61b35ff43671aa3354058f4de76e0fdb1413a59f947639be8ba70fa1a3c5` |
| `docs/evaluation/visual-bottom-band-v1-paid105-2026-08-02.md` | `100270700576d09b238d63a0540147e5ad9e315f947b38db715c2d00aae465f3` |
| `docs/evaluation/model-score-recovery-plan-2026-08-01.md` | `225f8e908b06255f8324815c27bb0c5471f713124db6085256a76a28a66d120c` |
| `docs/EXPLORATION-LEDGER-20260805.md` | `e9dab27a44c73b589a578ad668a54dece464a116d377b501f3de137ed7d89df5` |
| `docs/evaluation/post-luna-current-main-150-corpus-manifest-2026-08-08.json` | `d2ca5eb34f09c736fd92d04133656b0a2fdfbde6f25a63ea017051025441c155` |
| `docs/evaluation/post-luna-current-main-150-2026-08-08.json` | `ab1413e3e8ec11e511201c71ab86a941f5dd3419d9d2abf0b57fc65dcdc6aedb` |
| `scripts/analyze-post-luna-current-150.mjs` | `e2fc69c9a9b8865bca8cd6c677affadaeb60c42e4c49e34246548518124b67cf` |
| replay local-module graph (32 files) | `9e4ec0d51c138de47e7ce0d05b68a07beb5a308c7ab447a418f9150da80e94f8` |

当前 replay 的 `254/109/63` 与 baseline `0.7811418979` 已 materialize 在上表的
post-Luna receipt。旧 `255/109/63` 文件作为历史证据保留，不覆盖、不把不同
scorer/recomposition 版本的 F1 混成一次增益。

两份 `artifacts/` raw corpus 均被 Git ignore；上表的 SHA receipt 不等于 clean
checkout 自带这些内部响应。tracked manifest 只保存路径、哈希、行数/arm 和配对
契约，不含 raw provider output，也明确禁止复制进 Production。analyzer 在缺文件、
hash/row/arm/pairing 不符时 fail closed；因此复跑前置条件是授权工作区已放置 exact
corpus，而不是“任意 clone 可独立复现”。

## 最终边界

- 保留 Production `low/high/strict canonical`；没有证据支持现在拆掉 literal discipline。
- 254 是未表达上界，不是“视觉失败”；109 是候选池，不是 canonical 真值；63 交给
  admission/Composer replay，不归因于 prompt。
- residual v3 已花费冻结上限 105 calls，并以 3 个 gate failure 结束；不继续购买同类
  schema 实验。
- 保留 6 个 safe typed outcomes 与 Preview harness；拒绝当前 8-row 宽 residual schema。
- 后验 `PRIZM` 线索只能进入未来的 label-blind zero-call replay，不能回写本次 gate。
- 即使小型 schema screen 通过，也不自动授权 Production；独立 fresh150
  `>=0.90` 且零 critical factual errors 的 promotion gate 不变。
