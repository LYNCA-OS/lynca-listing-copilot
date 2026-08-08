# Model residual compact v4 zero-call screen — 2026-08-08

## Decision

**HOLD_PRODUCTION / TITLE_AND_FIELD_FIDELITY_PRESERVED_HOLD_INDEPENDENT_GATE.** 反方先成立：paid105 的 `4W/0L` 不能直接授权把 wide v3 推进 Production；它来自 35 张 enriched development cohort，机制家族也是看过 paid105 结果后提出的。

单一 nullable string `residual_printed_phrase` 是当前四个方案中最小的 **full-lane-preserving replay**：它保留 35/35 resolved titles、35/35 canonical fields、`+0.0071073` 与 `4W/0L/31T`，候选行从 71 降到 31，同口径 JSON 字节从 7987 降到 1597（-80.0%）。这证明 adapter 在既有 capture 上无损，不证明 compact schema 会让模型同样捕获，也不是 Production promotion gate。

本轮没有 formal independent paid prereg：schema fingerprint 已记录，但 `schema_frozen_for_provider_run=false`。在下一次真实 paired call 前，必须另建并冻结 prereg；不能把事后压缩屏伪装成预注册实验。

## Label-blind selection boundary

冻结 checkpoint 后，先按以下次序选择方案，随后才读取 sealed labels：

1. 35/35 精确复现 full-v3 resolved title；
2. 35/35 精确复现 full-v3 canonical fields；
3. resolver rejection、contract defect、ambiguous route、over-80 全为 0；
4. serialized candidate bytes 最少；
5. selected rows 最少只作 tie-break。

按这套 title + field 双门，最小合格方案是 `single_printed_phrase`。`label_bytes_read_before_selection=false`，但 general single-string 假设来自 paid105 后的压缩诊断，因此仍不能把本屏当独立确认。

## Variant comparison

| Variant | rows | JSON bytes | ~tokens | byte reduction | title fidelity | field fidelity | ΔF1 | W/L/T |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| single_printed_phrase | 31 | 1597 | 400 | 80.0% | 35/35 | 35/35 | +0.0071073 | 4/0/31 |
| ranked_max1 | 31 | 3729 | 933 | 53.3% | 35/35 | 35/35 | +0.0071073 | 4/0/31 |
| ranked_max2 | 54 | 5960 | 1490 | 25.4% | 35/35 | 35/35 | +0.0071073 | 4/0/31 |
| explicit_short_fields | 7 | 1507 | 377 | 81.1% | 35/35 | 34/35 | +0.0071073 | 4/0/31 |

约算 token 只使用保守的 4 bytes/token 静态代理，不是 provider usage。真实 token 与 latency 必须由 paired cloud treatment 测量。

这里的 1597 bytes 包含 35 张每张都必须输出的 property key、非空 value 或 `null`。任何“609B”结果若没有使用同一 35-card aggregate wire 口径，不能拿来覆盖这张表；它应另列为 request/schema delta 或 non-null subset，直到同口径复算。

其中对象 max1 在 35 张上为 3729 bytes / 约 933 tokens，reference loss、unbacked token、unsupported numeric、resolver rejection、over-80 均为 0/0/0/0/0。它与 general string 同为 31 个 phrase，但 role/region/basis 元数据令其多 2132 bytes。

## Canonical field recovery

最初只允许 marker/slab 的 single-string 会丢 `a9aadb`：full v3 用 printed `Topps Chrome` 把 Product 从 `Chrome` 扩成 `Topps Chrome`。general string 现在从 max1 选最高价值完整 printed phrase，并由 adapter 仅凭 phrase + canonical token 关系把它路由为 Product extension，因此恢复到 35/35 fields。两显式字段仍是 34/35，证明“标题一样”不能替代 field fidelity。

Adapter 不接收 label，也不在 wire 上携带 role/region：exact marker 优先；明确 finish-family 次之；严格 Product token 超集走 identity extension；其余保持 other-visible。多重角色命中一律 `ambiguous` 并 fail closed；当前 35 张 ambiguous route 为 0。

## Preserved title wins

| Asset | compact evidence | ΔF1 |
|---|---|---:|
| `91524c` | `1st Bowman` | +0.0619048 |
| `bc2c29` | `1ST BOWMAN` | +0.0882353 |
| `87df03` | `1st Bowman` | +0.0519481 |
| `0a34c5` | `AUTO-RED REFRACTOR` | +0.0466667 |

三张标题收益来自 printed `1st Bowman`，一张来自 `AUTO-RED REFRACTOR`。标题损失、field mismatch、ambiguous route、rejection、contract defect、over-80 均为 0。

## What this changes

- paired general candidate：一个 required nullable string `residual_printed_phrase`，容纳最高价值的完整 printed phrase。
- 仍是 candidate-only；不自动写 CSM、SEM、Composer 或持久化。
- 后置 adapter 推断 marker、finish 或 compatible Product extension；所有改变继续经过既有 v3 guards。
- 两显式字段虽略少 44 bytes，却只有 34/35 field fidelity，不进入无损候选集。
- 对象 max1 是同语义的带元数据对照；general string 以 41.6% 的 candidate bytes 保留相同 title/field 结果。

## Production hold

本回放复用了 wide-v3 已经捕获的文本，无法回答 compact schema 是否仍会读到这些 general phrases，也无法测 canonical interference、真实 token 或延迟。下一道有效门必须冻结独立 cohort，做 paired cloud control vs compact treatment，并继续把 title 与 canonical-field fidelity 分开验收；通过前不改 Production runtime。

Provider calls: **0**. Production runtime changes: **0**. Production deployed: **false**.
