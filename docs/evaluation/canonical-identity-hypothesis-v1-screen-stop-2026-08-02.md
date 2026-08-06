# Canonical identity/world hypothesis v1 — screen stop

日期：2026-08-02  
状态：evaluation-only；不接入 CSM/SEM，不进入生产

负向实验源码已在结论确认后删除；checkpoint、报告和本决策记录保留，避免把长期负资产留在运行器里。

## 为什么测它

100 张极端实验中，`exhaustive` 仍未表达的 170 个词次是最大潜在收益池，
其中 product/set/IP 占比最高。这个 arm 试图在**同一次** Luna 调用里保留
canonical 字段，同时增加最多 3 条明确标注来源的 product/set/IP hypothesis；
它不增加第二次模型调用，hypothesis 永远不是 canonical authority。

## 结果

- Cohort：与 v4 外部开发屏幕相同的 20 张卡，`high`，GPT-5.6 Luna，reasoning `none`，并发 2。
- canonical control：F1 `0.8223`，median latency `4,563 ms`，median output `107` tokens。
- identity hypothesis treatment：F1 `0.8195`，median latency `6,619 ms`，median output `152` tokens。
- paired：treatment 2 wins / 5 losses / 13 ties，Δ macro F1 `−0.0028`，sign-test `p=0.453`。
- hypothesis capture：18/20 cards，19 hypotheses；17 `visible_combination`，2 `model_knowledge`；3 cards had field defects。
- best-hypothesis macro F1：`0.4003`（20-card denominator）。

模型确实愿意表达补全，但内容大多是泛化运动类别或产品概括，例如
`Topps Chrome Football`、`Bowman Chrome Baseball`；这类词不能在没有独立
兼容图和证据时写进 Product/Set。hypothesis 通道还让 canonical 字段发生了
不稳定变化，并增加约 2.1 秒中位延迟。

## 决策

1. 停止 v1，不跑 150 张付费确认。
2. 不把 model-knowledge hypothesis 写入 CSM/SEM；不增加第二次模型调用。
3. 保留 raw hypotheses 作为学习资产，后续只有在有版本化 temporal/product
   compatibility graph、字段级 admission 和零损失回放时才重启。
4. 当前准确率工作回到已经通过安全闸门的窄机制：Composer/serial/product
   的零成本回放候选；任何生产 promotion 仍需要独立 sealed 150-card gate。

Artifacts：

- `artifacts/canonical-identity-hypothesis-v1/fresh-outside-screen-20-2026-08-02/`
- `lib/listing/thin/canonical-identity-hypothesis-v1.mjs`
