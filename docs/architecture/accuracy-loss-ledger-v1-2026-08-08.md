# Accuracy Loss Ledger v1 架构与验收 - 2026-08-08

## 决策

反方观点是：若损失 ledger 会改变 CSM/SEM 权威字段、80 字符标题、provider
调用次数或持久化协议，就不应进入生产热路径；离线日志已经足够，新增运行时代码只会增加
CPU、体积和恢复复杂度。这个担忧的置信度高于“为了可观测性可以接受语义变化”。

因此本方案只做同次调用的观测：从既有 provider 输出和既有 Composer 结果计算一个有界、
hash-only 的 ledger。它不参与解析、准入、排序、标题组成或重试决策。保留它的理由是，离线
日志无法可靠回答一次已付费且可能需要恢复的结果究竟在 provider 输出捕获、解析、CSM/SEM 准入、
marketplace profile、80 字符预算还是最终标题边界发生了信息损失。

## 不变量

- 不改变 `title`、`fields`、grammar、置信度或 Composer 的 80 字符合同。
- 不增加或重放 provider call；ledger 在同一响应上纯本地计算。
- 不改变 recognition、resolution、marketplace 三个既有 packet hash 的字节或含义。
- 不增加数据库 migration；现有 session JSON 仅新增 ledger 的 version/hash 收据。
- ledger 不是证据、标签或质量分数，hash 只证明字节绑定，不证明 provider 内容真实。
- 不把 raw provider 文本写入 CSM rows、session、marketplace 输出或浏览器响应。

## 五阶段 hash 链

版本固定为 `same-call-accuracy-loss-ledger-v1`，最大序列化体积为 16,384 bytes。
对象 key 规范排序，SEM 数组保留原顺序，因为 subject 顺序可能改变标题。

1. `raw_provider_output`：记录原始输出的 SHA-256 与 UTF-8 字节数，不复制正文。
2. `parsed_fields`：记录规范化解析对象的 SHA-256，并以 `source_sha256` 指向阶段 1。
3. `admitted_canonical_fields`：记录已准入 SEM 投影的 SHA-256、固定 source-map 版本、
   原因码和逐字段收据，并指向阶段 2。
4. `composed_bracket_ledger`：记录 included、profile policy、实际 suppression、预算丢弃、
   restore、normalization、truncation、预算与长度，hash 仅覆盖该 bracket ledger，并指向阶段 3。
5. `final_title`：记录最终标题 SHA-256 与 UTF-8 字节数，并指向阶段 4。

顶层 `ledger_sha256` 再绑定 version 与全部五阶段。validator 同时重算链、体积、Composer
ledger、最终标题，并将 admitted 阶段绑定到实际 `result.fields`；任何篡改均 fail closed。
链从 provider output 开始，不能观察图片像素中存在但 provider 未表达的事实；它不是视觉
召回率测量。

### 17 字段 admitted 绑定

字段顺序不是 provider key 顺序，而是冻结的 CSM allowlist：`year`、`ip_sport`、
`language`、`manufacturer`、`product`、`set`、`subject`、`card_name`、`card_number`、
`descriptive_rarity`、`numerical_rarity`、`release_variant`、`print_finish`、
`special_stamp`、`grading_info`、`description`、`search_optimization`。

每项只保存 `input_present`、`input_value_sha256`、`admitted_present`、
`admitted_value_sha256`、`status` 和原因码。`status` 只能是 `unchanged`、
`normalized`、`derived`、`dropped` 或 `empty`。validator 按同一 allowlist 重建实际 SEM
投影，逐字段核验 admitted presence/hash，因此仅重算顶层 hash 不能伪造与权威字段的绑定。

## Input-side trust boundary

边界入口是未受信任的 raw provider output。允许的唯一流向是：

`provider bytes -> versioned source map -> observational hashes/reason codes`

source map `csm-sem-provider-source-map-v1` 明确 provider key 到 17 个 CSM 字段的映射；未知
字段不扩张权威面，不支持的 shape 标为 `UNSUPPORTED_SOURCE_SHAPE`。输入 hash 不可用于恢复
值、填空、覆盖可见证据或判断事实真伪；`derived` 也只描述既有 CSM/SEM 结果，不能证明推导
正确。后续若改变 source key、字段语义或状态语义，必须发布新 ledger/source-map 版本，不能
原地改写 v1。

## 存储与泄漏边界

- 跨请求或持久化边界时，完整 ledger 只存在于 provider authority 的完整
  `PERSISTENCE_PENDING` 恢复结果中，使已付费结果可以在不追加 provider call 的前提下继续
  持久化；进程内构建对象不构成第二份 durable authority。
- `csm-persistence-checkpoint-v2` 只额外绑定 ledger version/hash；同时继续绑定 tenant、
  operation、payload、session 和三个既有 packet hashes。
- 正式 CSM session 的 `csm_owner_versions` 只保存
  `accuracy_loss_ledger_version` 与 `accuracy_loss_ledger_sha256`，不保存完整 ledger 或 raw 值。
- CSM rows 的 marketplace structured output 不含 ledger；公开成功响应同时剥离完整 ledger
  和 persistence checkpoint。浏览器、marketplace Composer 及其下游均无法把 ledger 当成
  上游证据侧信道。

## 恢复兼容

- v2 checkpoint 必须携带完整 ledger，且 checkpoint version/hash 必须与经 v1 validator
  验证并绑定实际结果的 ledger 一致。
- `csm-persistence-checkpoint-v1` 是 pre-ledger checkpoint，继续允许恢复，但它必须完全不含
  ledger、ledger version 或 ledger hash；混合形态 fail closed。
- `ACCURACY_LOSS_LEDGER_VALIDATORS` 是追加式 registry。已发布的 ledger v1 validator 必须
  永久保留；未来版本只能新增 validator，不能替换 v1 逻辑，否则旧的 durable checkpoint
  可能被迫再次付费或永久不可恢复。

## 回滚

这是无 migration 的代码回滚，但不能删除恢复能力。安全顺序是：停止生成新的 v2 checkpoint，
保留 v1 ledger validator、v2 checkpoint validator 和 v1 pre-ledger validator，继续排空已有
authority 结果；确认没有待恢复的 v2 后，才可把新流量发回 pre-ledger emitter。若必须紧急回到
旧二进制，先暂停新 provider admission，并证明不存在待恢复 v2，或保留一条兼容恢复路径。
不得通过删除 authority 记录、伪造 v1 checkpoint 或重复 provider call 完成回滚。

## 验收清单

- [x] ledger 单测证明：一次 provider call，title/fields 与未加 ledger 的 baseline 相同。
- [x] 五阶段 source hash、顶层 hash、17 字段顺序/状态、16 KiB 上限均被 validator 覆盖。
- [x] 篡改阶段、checkpoint ledger hash 或 admitted 字段 hash 均 fail closed。
- [x] v2 完整绑定可恢复；纯 v1 pre-ledger checkpoint 仍可恢复；混合形态拒绝。
- [x] CSM session 仅 version/hash；CSM rows、marketplace output、公开浏览器响应无完整 ledger
  和 raw provider 内容。
- [x] provider calls、title、fields、三个 packet hashes 与数据库 schema 均无变更。
- [x] 合入前完整运行 `npm run check && npm test`；两套 PostgreSQL 17.10 集成测试均实际
  执行，未以 skip 代替。局部 `test:csm-thin` 不能替代它。
- [ ] 任何生产发布仍需独立的 active-service、CI、部署与真实 Writer Journey 验证；本文和本地
  测试都不是生产证据。

## 本地测量，不是生产结论

2026-08-08 在本机 Node `v26.4.0` 上，`node scripts/accuracy-loss-ledger.test.mjs`
通过。一个覆盖多字段的本地样本 ledger 为 6,310 bytes。对同一样本连续执行 10,000 次
build + validate，观测 wall 2,232.196 ms、user CPU 2,430.911 ms、system CPU 70.114 ms，
约 223.220 us wall/次、250.102 us CPU/次。

这些数字仅是单机、单进程、合成样本的局部开销与体积检查，不是生产 p95、吞吐、费用、
内存上限或商业准确率证据，也不能据此放宽 16 KiB fail-closed 上限。
