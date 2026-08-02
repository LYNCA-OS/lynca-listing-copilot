# LYNCA 识别准确率总战略（2026-08-01）

## 评估闸门更新

评估执行的本地 thin-path 并发固定为 **c2**。这是延迟约束下的稳定点：同一 20 张筛选中，c10 吞吐只高约 9%，但 p95 从 8.6 秒升到 37.3 秒；本轮 v4 的 c10 也观察到约 48 秒中位延迟，不能接受。hosted canonical 的 c120 是另一条容量边界，不能带入本地付费识别评估。评估脚本不传 `--concurrency` 时默认使用 c2，只有专门的容量实验才显式覆盖。

从本轮开始，所有新机制统一使用 **150 张回放 + 150 张真实卡**：回放用于零成本筛选，
真实 150 用于最终判断。此前的 100 张回放只作为探索证据，不作为新机制的最终晋级门槛。
机制样本只能帮助设计规则，不能单独证明正负资产。

## 1. 先修正目标

“从约 80% 到 100%”不是再补 20% 的普通优化，而是要消灭当前全部错误。
在图片信息缺失、细小字不可辨、目录不完整、写手标题约定不一致的条件下，强制每张卡
都给出 100% 确定答案，在理论上不可实现。

长期目标改为同时优化两条曲线：

1. **表达召回率**：模型是否把可能有用的信息说出来；
2. **自动接纳精度**：进入 CSM/SEM 和最终标题的信息是否正确。

允许“不确定候选”和人工复核，可以让自动接纳精度逼近高位；不能通过强迫模型猜测
来制造表面覆盖率。

总目标函数是：

`期望语义质量 - 错误代价 - 模型成本 - 延迟成本 - 长期维护成本`

硬约束是：关键错误（错误 serial、year、grade、subject、product/finish）不能用普通 F1
收益抵消；任何晋级路径必须可回放、可关闭、可回退。

## 2. 总架构：先表达，后理解，再合法化

```text
原图 / 可控视觉增量
        ↓
候选表达层（高召回、无字段权威）
        ↓
SEM 解析与世界模型（归义、补全、排除不可能）
        ↓
CSM admission（证据、兼容性、冲突、abstain）
        ↓
80 字符 Composer（grammar、优先级、预算）
        ↓
标题 + alternates + review trace
```

模型不再同时承担“看见、理解、选字段、压缩成 80 字符、保证合法”五个目标。模型负责
高召回表达和候选假设；确定性系统负责字段权威和商业输出。

### 层 A：视觉输入

- 默认继续使用 `high`。现有 50 对实验中 `original - high = -0.014329 F1`，5 胜、
  11 负、34 平；该批图片最长边均不超过 1400 px，没有 original 的分辨率余量。
- 不全局启用 original，也不全局增加第二次模型调用。
- 对 serial、rarity、year 等小字单独建立“大图或局部裁切”机制集。Common Sense Cow
  的全图调用把 `07/10` 读成或省略，而原图局部放大后清楚可见，说明这里是尺度/注意力
  问题，不是源图没有信息。
- 只有目标字段实验通过，裁切才可成为选择性升级；不能变回全局 OCR/多调用链路。

### 层 B：候选表达

这一层追求召回，不输出 title，也不输出 canonical fields。

下一版最小响应应分成两个顺序明确的通道：

1. `visible_facts`：少量、可定位的商业相关原文/标记；
2. `identity_hypotheses`：在 visible facts 之后，明确要求模型给出 1--3 个最具体的
   product/set/IP 身份假设，并标出 `visible_combination` 或 `model_knowledge`。

必要时再单独增加 `visual_hypotheses`，专门测 finish；不把身份、finish、serial 三种
不同错误机制混在一个实验里。

候选允许冲突、允许不确定、允许世界知识；但它们没有 canonical、renderer、storage
或 production 权限。

### 层 C：SEM 解析器

解析器必须先做到“零静默丢词”，再讨论晋级：

- 保留原 span、位置、来源、候选角色和冲突；
- identity 先保持为 identity family，不在表达阶段强迫 product/set/IP 三选一；
- serial 只自动恢复同值格式，例如 `27/150 -> 027/150`；数值冲突绝不覆盖；
- product 只允许空值填充或严格 token extension，原值和扩展值都留 trace；
- 不继续扩张数百条手写 product regex，改为最长词组、兼容图和 reviewed attestation。

旧 free-title 的 product-only 零调用反事实为 `+0.003341 F1`、6 胜 0 负，但发现集和
筛选集都已参与假设选择，因此仍是探索结果，不是生产晋级证据。

### 层 D：世界模型

世界模型不是“替图片写答案”，而是候选生成器和矛盾检测器。核心数据结构：

- `subject -> affiliation/team -> valid interval -> sport/league`；
- `manufacturer -> product -> set/IP -> valid interval`；
- `manufacturer + product + year + set/card name + serial denominator -> legal finish`；
- alias、language、release naming 与来源版本。

每条边必须有 source、version、confidence、valid interval。第一阶段只允许：

1. 枚举候选；
2. 拒绝时间或产品体系上不可能的组合；
3. 标记需要复核。

它不能覆盖可见文字。

现有目录仍不足以承担该任务：product vocabulary 165 个，其中 official 74；finish
vocabulary 242 个，其中 official 仅 11；229 万卡 constraint snapshot 没有 finish
维度。目录资产保留，但必须升级为可验证的兼容图，而不是把“大目录”误当作世界模型。

### 层 E：CSM admission

CSM/内嵌 SEM 是唯一权威。Admission 使用：

- 可见证据；
- 候选来源和不确定性；
- 世界模型兼容性；
- 当前 canonical 值与候选的冲突关系；
- 字段级错误代价。

没有足够证据时 `abstain` 或保留 alternate，不能猜。错误的 serial/grade/year 比缺失
更危险，采用更高晋级门槛。

### 层 F：Composer

Composer 只做合法商业表达，不负责修正视觉事实。继续遵守 COS-8/COS-9 和 80 字符
契约。字段选择的理论形式是：

`max Σ(字段商业价值 × 正确概率 - 错误代价)`

约束为 grammar 合法、字段顺序、契约优先级和总长度不超过 80。现有 drop order 是该
问题的确定性近似；只有出现足够样本时才升级为同 tier 内的动态预算优化。

当前 Composer 修复已零调用回收 12/53 个下游遗漏：high100 `+0.006061 F1`、10 胜
0 负；148/150 重放约 `+0.0027`、6 胜 0 负。应保留。剩余大多是有意预算和 grammar
抑制，不能为了 token recall 全局恢复。全局恢复 team 的反事实为 high100
`-0.04342 F1`，明确是负资产。

## 3. 当前损失账户决定投资顺序

100 张极端实验中，296 个参考有益缺失词次的最早边界是：

| 最早边界 | 词次 | 卡数 | 战略含义 |
|---|---:|---:|---|
| exhaustive 仍未表达 | 170 | 77 | 视觉注意力、语义合成、世界知识主战场；不是 170 个已证实视觉盲点 |
| exhaustive 有、canonical 无 | 73 | 53 | 表达/字段压缩可争取；人工核后 37 个直接有用，oracle 上限约 `+0.021623 F1` |
| canonical 有、Composer 无 | 53 | 37 | 11 个已安全回收；其余多为契约预算和 suppression，不应全拿 |

因此优先级不是“再加 validator”，而是：

1. 先拿零调用的解析和 Composer 收益；
2. 再解决 identity 表达与语义合成；
3. 再补产品/年份/球队世界图；
4. finish 兼容图与小字视觉增量单独攻关；
5. 最后才考虑更高 reasoning 或更贵模型。

## 4. 两次 6 卡机制实验给出的边界

### Bounded evidence v2

- 预注册 product 通道仅 3/6；按合法 identity family 是 4/6；
- resolver 0 胜、0 负、6 平；
- finish 0/6 精确；需要 serial 的四张卡中 1 对、1 个 critical wrong、2 漏；
- 决策：`STOP`。

### Candidate-first v3

- identity target 5/6，拿回 Common Sense Cow 的 `VeeFriends`；
- `Draft` 仍缺失；88 个候选中 `model_knowledge = 0`；
- 大量公司名、slogan、比赛数字和重复项占用容量；
- 无 canonical/production 泄漏；
- total tokens 比 v2 少 26.1%，但预注册 output cap 和 target gate仍失败；
- 决策：`STOP`。

结论不是“自由表达无效”，而是“自由抄写不等于身份合成”。下一步必须显式要求模型在
可见事实之后提出 identity hypothesis，而不是继续扩大事实列表。

## 5. 执行顺序

### P0：立即保留，零新增模型成本

1. 保留已验证的 Composer 11 个回收；
2. 保留 lossless SEM v2 的全部未分配 span；
3. serial 仅做同值前导零恢复；
4. product exact-extension 继续离线重放，但不生产晋级；
5. 修正新实验的 identity 口径为 `product + set + IP`，旧预注册结果不追改。

### P1：身份表达机制

只跑 6 张机制卡：`visible_facts -> identity_hypotheses`。通过条件：

- 6/6 identity target 出现在 hypothesis；
- visible/model-knowledge provenance 合法；
- 无 canonical/persistence 写入；
- 总 token 成本低于 v2；
- 通过只代表 capture，随后先做零成本 resolver。

### P2：身份 resolver

用同一 checkpoint 重放，不再调用模型。先生成 CSM candidate/alternate，再组合测试标题。
任一 critical false product/year 即停。只有 development 上净正，才进入独立 confirmatory。

首个零成本回放已经完成：`candidate-identity-replay-v1` 只接受有视觉 Logo/符号来源的
identity/affiliation 候选去填空 Set。机制 6 张上为 2 胜、0 负、4 平，macro F1
`0.666165 -> 0.688391`（`+0.022226`），无 critical false promotion；先前把版权/公司
文字也当 Set 的宽规则为 2 胜、3 负、`-0.001099`，已废弃。这个正收益仍是机制样本，不得
直接生产晋级，下一步是先过 150 张回放，再视结果进入 label-blind confirmatory150。

随后把 Logo→Set、printed set→Set、同值 serial 格式恢复三个机制统一回放到已有 100 张，
结果只有 serial 正向：`2/0/98`，`+0.002000 F1`，且没有错误改写；Logo→Set 为
`4/11/85`、`-0.006071`，printed set→Set 为 `1/4/95`、`-0.002882`，两者淘汰。这里
的 100 张是回放，不是新的付费请求；下一轮继续攒 5–8 个小机制，优先在这批回放筛选。

### P3：独立验证

- 固定、label-blind confirmatory150；
- 逐卡记录字段 win/loss、最早损失、critical error、token、latency、cost；
- `ΔF1 > 0`、wins > losses、0 critical false、0 超 80，才可继续；
- 机制集和已看过的 150 张不能冒充确认集。

### P4：世界模型 MVP

从错误频率最高且可验证的两张图开始：

1. product/set/IP/year 兼容图；
2. subject/team/year 时序图。

Finish 图在数据维度补齐后单独建，不与 identity MVP 同时上线。

### P5：视觉专项

建立真实大图和小字机制集，测试 high + 同调用局部裁切，而不是再做无分辨率余量的全局
original。serial、rarity、year 分开统计，错误读取比遗漏权重更高。

### P6：Shadow 与生产晋级

先只写 append-only candidate/alternate/trace，不改变写手标题。观察 writer correction 和
accept/reject。独立数据通过后才把单条规则纳入 CSM admission；每条规则可单独关闭和回放。

## 6. 评估与回退

每个候选改动必须同时报告：

- card-level 与 field-level win/loss；
- earliest-loss stage；
- critical false counts；
- macro F1、recall、precision 与 title legality；
- input/output/total tokens、p50/p95 latency、实际成本；
- 学习资产或运行资产结论。

回退条件：长期期望收益为负、维护复杂度持续增长、独立集不净正、出现任一未经允许的
critical false promotion，或重新引入 Cloud Run、向量库、OCR sidecar、默认第二调用等已
退役路径。

阶段失败可以保留为实验知识；失败实现不能留在生产运行图里。

## 7. 2026-08-02 follow-up: serial prompt clause stopped

The first six-card run was invalid: the treatment prompt was declared in the
arm but was not injected into the request body. Its numbers are discarded as
evidence. After fixing the runner and adding a direct prompt-difference
assertion, the corrected paired screen produced 3 treatment wins, 1 control
win and 2 ties, with paired delta `+0.0393 F1` (`p=0.625`). It recovered
`027/150` and `02/25` on two cards, but did not recover `05/20`, changed
unrelated identity wording, and had 5.49 s median latency versus 4.68 s for
control. The prompt arm remains `STOP`: n=6 is insufficient and the output is
not isolated to serial transcription.

The result sharpens the next experiment rule: a prompt sentence that targets a
real loss account is not enough. It must preserve unrelated canonical fields,
show no critical numeric mutation, and improve the intended field in a paired
screen before it can join a larger bundle. The safer serial asset remains the
zero-cost, source-anchored same-value resolver over an exhaustive observation
checkpoint; that resolver is still evaluation-only because the production
canonical response does not carry an independent observation channel.

## 8. 2026-08-02 follow-up: fresh 150 confirmation and narrow serial candidate

A new paid paired run completed with 150 unique cards and one provider attempt
per arm. Canonical versus free expression was `95/44/11`, raw `ΔF1=+0.0531`,
exact sign-test `p=1.82e-5`. This confirms the authority split on a fresh
cohort, but it is not permission to enable every downstream resolver.

Offline decomposition against the current Composer stopped the strict free
product extension (`3/2/145`, one reference-loss card), and stopped broad
same-value serial formatting (`4/1/145`, the Messi `29/199 → 029/199`
reference loss). The combined bundle was also stopped (`7/3/140`). A narrower
single-digit-only serial candidate (`5/20 → 05/20`, `8/25 → 08/25`) was
`2/0/148`, `+0.001027`, with no reference-loss or over-80 card, but it was
selected after inspecting the confirmation set and is therefore still
evaluation-only. It needs an independent, pre-registered 150-card run before
promotion.

The detailed ledger is in
`docs/evaluation/accuracy-bundle-confirmatory-150-2026-08-02.md` and the
machine-readable decomposition is in
`artifacts/accuracy-bundle-confirmatory-150-2026-08-02/mechanism-decomposition.json`.

The fresh loss split is now also measured: 118/150 cards and 255 token
occurrences were lost before exhaustive expression, 76/150 and 109 at
canonical schema compression, and 46/150 and 63 at downstream composition.
The next gain hunt should therefore target one small visual/world-knowledge
capture or evidence-admission mechanism, not another blanket output constraint.

## 9. 2026-08-02 follow-up: gated free-expression overlays

The 150-card replay now has a reusable projection screen rather than ad-hoc
field merging. Broad product, card-name, RC, SP and SSP promotion all hit a
negative card-level result and are `STOP`. The only replay candidates are
source-shaped, non-overwriting overlays:

- extend a canonical pure colour only when free expression supplies the same
  colour plus a restricted finish family;
- retain a leading zero only for a one-digit current-copy serial;
- admit an explicit `SAR` marker when descriptive rarity is empty;
- admit the literal TCG marker `Trainer Gallery` only into an empty card name;
- admit the literal Bowman marker `1st Bowman` only into an empty descriptive rarity;
- extend product only when a known CSM manufacturer prefixes a strict product extension.

The six-mechanism overlay was `8/0/142`, `+0.004727` macro F1, with zero
reference token loss and zero over-80 titles on this replay. This remains a
small-cohort candidate, not a production result. The next paid step is one
isolated real 150-card confirmatory arm with all six overlays pre-registered;
no candidate overlay is wired into the production Composer before that gate.

The full per-card ledger and all STOP candidates are in
`docs/evaluation/accuracy-gated-projections-150-2026-08-02.md` and
`artifacts/accuracy-bundle-confirmatory-150-2026-08-02/gated-projection-screen.json`.

## 10. 2026-08-02 follow-up: fresh mixed response and outside-development audit

The later paired response run completed 150/150 cards with new provider
responses. Canonical high versus the free title arm was `102/39/9` (canonical
wins/free wins/ties), F1 `0.7731` versus `0.7207`. This confirms the authority
split on fresh responses; it does not make free expression a production arm.

The fixed 150 contains all 105 cards outside the canonical development set and
45 deterministic development-overlap cards. The 105-card slice is the largest
independent-card subset currently available, but it is not an independent
150-card confirmation cohort.

The v2 safety gates removed the two v1 false promotions (conflicting finish
denominators and Lot product displacement). The product extension then replayed
as `6/0/144`, ΔF1 `+0.002826` on the mixed 150 and `5/0/100`, ΔF1 `+0.003419`
on the outside-development 105. This strengthens the candidate but does not
authorize production: the production canonical response does not emit the
free-expression channel needed by this resolver, and the trigger count remains
small.

The targeted serial follow-up was `1/0/22`, ΔF1 `+0.004831`; it remains
evaluation-only because the cohort is selected by the canonical serial shape.
The full per-card account is in
`docs/evaluation/accuracy-mechanism-confirmatory-2026-08-02.md`.

## 11. 2026-08-02 follow-up: conditional product evidence arm stopped

A lower-cost same-call alternative was screened on 20 paired cards: one
optional `product_evidence` string instead of a full free title. The model left
the field empty on all 20 cards, so the intended channel never ran. Treatment
F1 was `0.7766` versus `0.7847` control, with `2/3/15` paired outcomes; median
latency rose from 4.494s to 5.960s and output tokens from 104 to 117.

This is a mechanism failure, not an underpowered positive screen. The arm was
removed from the thin evaluator after recording the audit in
`docs/evaluation/canonical-product-evidence-v1-screen-20-2026-08-02.md`.
Do not spend the 150-card confirmation budget on it.

## 12. 2026-08-02 follow-up: v4 identity replay stop

The stored v4 candidate-expression responses were replayed against the stored
canonical fields without new provider calls. The resolver admitted a visible
`logo_or_symbol` identity or affiliation into an empty Set. On the 102 cards
that matched the partial development response set, the overlay produced only
`4/12/86` wins/losses/ties and changed macro F1 from `0.761042` to `0.756854`
(`−0.004188`). It is therefore a negative runtime asset and is stopped.

The twelve losses are not random: team marks, NFLPA, BECKETT and fragments
such as `Optic O Donruss` were promoted as Set. Disney and VeeFriends produced
four useful-looking wins, but that is not enough to permit a generic logo rule.
The complete per-card ledger is in
`docs/evaluation/candidate-expression-v4-identity-replay-stop-2026-08-02.md`.
Future identity work must separate IP/product identity from affiliation,
grading-company marks and logo fragments before another paid confirmation.

## 13. 2026-08-02 follow-up: guarded narrow bundle replay

The open-expression v4 response was paired with the canonical-v3 checkpoint and
replayed through the same deterministic Composer. The six narrow overlays were
applied sequentially, with a per-card guard that rejects any proposal that
crosses 80 characters or removes a token already present in the reference title.

The final development replay was `12/0/138`, Δ macro F1 `+0.006551`, with zero
reference-token loss and zero over-80 titles. The gain is interaction evidence,
not independent generalization: the same 150-card development cohort supplied
the canonical and expression checkpoints. The receipt is
`artifacts/candidate-expression-v4/expression-v4-narrow-bundle-replay-150-2026-08-02.json`.

Keep the bundle evaluation-only. It is a candidate for a pre-registered
independent 150-card confirmation, not a production Composer change. The
per-card guard is part of the experiment contract and must remain attached if
the bundle is later re-tested.

## 14. 2026-08-02 follow-up: source-pool boundary is real

The reviewed Supabase table contains 255 image-backed rows: 150 are already in
the development cohort and only 105 are outside it. The 30
`v4_writer_feedback_events` rows embed original images, but they are
`OBSERVE_ONLY`/`ADMIN_TEST_ONLY` accepts without sealed reviewed corrections;
they are diagnostic material, not accuracy labels. A mixed 150 therefore cannot
be called an independent 150. Acquire a new label-blind, sealed image pool
before promoting any overlay.

This boundary is intentional: no amount of replay can create independent
evidence from reused cards. Until the pool exists, use zero-cost replay to
reject negative mechanisms and document candidates, but do not spend provider
calls on a pseudo-confirmation run.

## 15. 2026-08-02 follow-up: registry-attested insert interaction

The previously screened `attested_insert` resolver was replayed before the six
narrow overlays. It admits only a high-confidence printed `insert_name` whose
value is attested by the local knowledge registry, and only into an empty
`card_name`. The combined development replay reached `13/0/137`, Δ macro F1
`+0.006900`, with zero reference-token loss and zero over-80 titles.

This is a useful positive interaction candidate, not a production result. A
control replay with the experiment-only `product_leaf_recovery` feature
disabled (matching production `main`) produced the same `13/0/137` and
`+0.006900`; the result therefore does not depend on that unpromoted feature
for this cohort. Its source is still the exhaustive observation checkpoint,
which the production canonical response does not carry. Keep it behind the
same independent-150 gate and preserve the per-card budget/reference guard
when re-testing.

## 16. 2026-08-02 follow-up: same-call open evidence is stopped

The one-call `canonical + open_evidence` screen was tested on 20
outside-development cards. The raw paired response was not significant
(`5/3/12`, `ΔF1=+0.007638`, `p=0.7266`), while median latency rose from
`5.887s` to `9.301s`, total tokens rose 13.1%, and output tokens rose 4.4x.
The treatment also changed unrelated canonical fields, so that raw lift cannot
be attributed to the evidence channel.

The valid control-isolated replay recomposed the canonical control fields on
both sides and injected only a strict, image-anchored product candidate from
the open ledger. It produced `0/0/20`, `ΔF1=0`, one candidate-product card,
zero reference losses, and zero over-80 titles. The first replay that used
each treatment's drifting canonical fields (`5/3/12`, three reference-loss
cards) is retained as a diagnostic only and is not evidence of mechanism gain.

Decision: **STOP** this response shape before any 150-card paid gate. It is a
capture artifact, not a positive runtime asset. Keep the raw ledger for future
resolver design, but do not add it to the production schema, default prompt,
or second-call path. Accuracy work now returns to deterministic Composer/SEM
replays and only the smallest pre-registered candidate mechanisms whose source
can exist in the production contract.

## 17. 2026-08-02 follow-up: IP field screen held, not promoted

COS-9 gives TCG `[IP]` a first-class bracket, but the thin schema previously
carried only the fixed IP labels derived by `semTcgIpLabel`. A 20-card,
evaluation-only screen added one printed `ip` field to the same response. Five
TCG cards emitted an IP and four were new over the prior canonical control; no
standard card emitted one and no title exceeded 80 characters.

The live paired result was `6/4/10`, `ΔF1=+0.003504`, but unrelated fields also
drifted, so it is diagnostic only. The control-field replay that changed only
the IP was `1/0/19`, `ΔF1=+0.003509`, a positive direction too sparse for a
verdict. A separate replay that also forced `grammar=tcg` when an IP appeared
was `1/1/18`, `ΔF1=-0.000658`: the VeeFriends card lost `Original Artwork`
after the TCG order was applied. This is the current contract interaction to
solve, not a reason to weaken COS-9.

Median latency increased `12.6%` (5.786s -> 6.513s), input tokens `4.2%`, and
output tokens `5.8%`. Decision: **HOLD** this mechanism in the next 5--8
candidate bundle; do not spend the independent 150-card gate on it alone and
do not wire the new field to production. Promotion requires a grammar-safe
projection with no VeeFriends-style reference loss, then a fresh 150-card
confirmation.
