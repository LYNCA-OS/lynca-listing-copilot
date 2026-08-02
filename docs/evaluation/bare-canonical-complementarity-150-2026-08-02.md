# Bare 与 canonical 互补性审计（fresh150）

## 结论

反方假设先成立：`44` 张 bare 胜利不能直接说明“放开输出就会更准”，因为这是两个独立模型响应，里面混有采样波动；raw token union 还会把错误数字和身份一起带入。审计后的高置信结论是：**互补信息真实存在，但只能先进入无生产权限的候选槽，不能自动并入 CSM。**

canonical 的宏 F1 为 **0.767764**，bare 为 **0.714701**。逐卡使用 reference 在两者之间选优的理论上限为 **0.794114**（较 canonical +0.026351），但这是不可部署的 label oracle。

## 口径与范围

- cohort 是同一批 150 张卡、同一图像集合、同一 `gpt-5.6-luna / reasoning none / high` 配置的两个 arm；每张都只有 1 次 provider attempt。
- bare 与 canonical 是两次独立响应，不是同一响应的两个投影。F1 是 reference 与标题的去重 token precision/recall 调和均值；44/95/11 是逐卡 F1 符号。
- “正确新增词”定义为 `(bare ∩ reference) \ canonical`；“错误新增词”定义为 `bare \ (reference ∪ canonical)`。字段归因先查 canonical raw fields，再查 title-derived SEM；后者只是候选，不是语义真值。
- manifest 对应的 `title-derived-sem` 已从 git history 找回并核对；当前版本只给两个既有 helper 增加 `export`，函数体与 projection 行为未变。哈希与 diff 结论保存在 ledger 的 `source_compatibility`。
- 没画汇总图：本任务的核心是多标签归因和逐卡异常，精确审计表比单轴图更不容易掩盖数字/身份冲突。

## 44 张 bare 胜在什么

44 张里共有 **85** 个“bare 命中 reference、canonical 标题没有”的词次；其中 **2** 张没有新增正确词，只是精度、顺序或复数差异，不属于 residual recall。

| 最早丢失边界 | 正确词次 |
|---|---:|
| CANONICAL_VALUE_PRESENT_TITLE_MISSING | 38 |
| CANONICAL_VALUE_ABSENT_KNOWN_FIELD | 36 |
| PARSER_UNASSIGNED_RESIDUAL_PHRASE | 11 |

| 候选 CSM/SEM 字段 | 正确词次 |
|---|---:|
| print_finish | 22 |
| search_optimization | 18 |
| residual_unassigned | 11 |
| card_name | 7 |
| subject | 6 |
| year | 5 |
| product | 4 |
| card_number | 3 |
| grading_info | 2 |
| ip_sport | 2 |
| manufacturer | 2 |
| set | 2 |
| special_stamp | 1 |

另一次 exhaustive/open prompt 对这些正确词次的复现率是 **72.9%**（62/85）。这只能证明“不同提示下可重复看见”，不能证明 canonical 同次调用加槽后仍会看见。

| 最早边界 | exhaustive 再现 | 再现率 |
|---|---:|---:|
| CANONICAL_VALUE_ABSENT_KNOWN_FIELD | 20/36 | 55.6% |
| CANONICAL_VALUE_PRESENT_TITLE_MISSING | 34/38 | 89.5% |
| PARSER_UNASSIGNED_RESIDUAL_PHRASE | 8/11 | 72.7% |

## 95 张 canonical 胜在什么

canonical 独有且命中 reference 的词次共 **85**；与此同时，bare 在这 95 张中有 **399** 个 reference 不支持的词，涉及 **95** 张。也就是说 canonical 的优势不是单纯“更保守”，而是结构化字段补全与抑制自由表达噪声同时发生。

其中 **42** 张 canonical 没增加任何正确 token，胜利完全来自压掉 bare 噪声；另外 53 张同时有结构化补全。下面第一张表是互斥主因，合计严格等于 95；第二张表是可多选原因。

| 互斥主因 | 卡数 |
|---|---:|
| bare_precision_only | 42 |
| exact_numeric | 19 |
| identity | 19 |
| components | 8 |
| finish_rarity | 5 |
| grading | 2 |

| 原因（可多选） | 卡数 |
|---|---:|
| bare_precision_noise | 95 |
| identity | 25 |
| exact_numeric | 24 |
| finish_rarity | 12 |
| components | 10 |
| phrase_completeness | 9 |
| grading | 3 |

| canonical 来源字段 | 正确词次 |
|---|---:|
| numerical_rarity | 24 |
| card_name | 11 |
| print_finish | 10 |
| search_optimization | 10 |
| set | 9 |
| manufacturer | 7 |
| product | 5 |
| subject | 4 |
| year | 4 |
| grading_info | 3 |
| descriptive_rarity | 2 |
| language | 1 |
| release_variant | 1 |

## Union 上限与风险

| 机制 | 宏 F1 | 相对 canonical | 权限 / 风险 |
|---|---:|---:|---|
| raw token union | 0.711953 | -0.055811 | 不可部署；146 张新增错误词，30 张数字风险，88 张估算超过 80 字符 |
| label-filtered token union | 0.896294 | +0.12853 | reference oracle，仅理论覆盖上限 |
| 全量 phrase candidates 直接并入 | 0.711953 | -0.055811 | 禁止；28 张身份冲突，30 张数字风险 |
| 80 字符内 phrase subset label oracle | 0.795553 | +0.02779 | reference oracle；全卡精确搜索=true |

raw union 的结果给出反证：**“让两边都说，再把词拼起来”不是正资产机制。** 可保留的是 phrase-aware、带字段角色和 provenance 的 candidate lane；它必须默认零权限，再由 SEM/世界模型做证据解析。

## 同次 canonical 调用的自由观察槽

结论：**TESTABLE_NOT_PROVEN**。

- 24 张触及“字段已有、Composer 没发”，应先走零调用 Composer/SEM 修复，根本不需要新模型槽。
- 25 张触及“可映射字段但 canonical 没给”，是短语候选槽的主要目标。
- 7 张触及“当前 parser 没分配角色的 residual phrase”。它们不等于 CSM 外字段：`Star Wars`、`Disney`、`Trainer Gallery` 等正说明 phrase-aware resolver 仍有缺口；在解析前只能进 append-only evidence。
- 2 张 bare 胜利没有新增正确词，新增槽无法保证拿回。

最小可证伪实验不是第二调用，而是 canonical 同一响应增加一个严格有界、独立、无生产权限的 `residual_phrases[]`：每项只含完整短语、图像区域、候选角色、可见/推断 provenance 与置信度。先在现有 raw response 上做零调用 resolver replay；只有候选覆盖和冲突门槛通过，才进入 fresh150 的 5–8 机制合并实测。

## 稳健性与未决问题

- exact checkpoint SHA、字节数、manifest fingerprint、配对 asset/reference/image hash、arm 数量和 attempt 数都 fail closed；任何 cohort 漂移都会终止脚本。
- exhaustive 复现率不是 sensitivity control：它来自第三次、且提示更开放的响应，只能说明候选可见性。
- label oracle 选择依赖 reference；真实系统没有这个信息。0.794114 不能作为上线预期，只能作为“两个独立 draw 的样本内天花板”。
- title-derived SEM 会误分角色（例如把相邻介词吞进 subject）；因此本报告只用它做候选归因，绝不自动 admission。

## 建议的下一步

1. 先取回 24 张字段已有但 Composer 没发的卡：这是零调用、低耦合机制。
2. 用完整短语做 phrase-aware resolver 回放，重点覆盖 `Star Wars`、`Disney`、`Trainer Gallery`、球队城市、完整 product/set 层级；数字冲突一律 fail closed。
3. 只有上述回放仍无法触达的 7 张 parser-unassigned 卡，才进入同次响应 `residual_phrases[]` 小机制；槽位零生产权限且必须有 region/provenance。
4. 该机制与其他 5–8 个正资产候选攒齐后，再跑 fresh150；独立验证它是否保持 canonical 字段质量，而不是用两个独立 draw 的 oracle 代替实测。

## 44 张 bare 胜利逐卡明细

| asset 后缀 | ΔF1（bare-canonical） | reference 支持的完整短语 | 新增正确词与最早边界 | bare 新增错误词 |
|---|---:|---|---|---|
| 04bed0401e6450349141 | +0.035714 | Dolphins | dolphins→known-field miss [search_optimization] | miami |
| 0dd3315a29711425e71b | +0.108974 | Shop Promo; PSA 10 | shop→field→Composer [card_name]; promo→field→Composer [card_name]; psa→field→Composer [grading_info]; 10→field→Composer [grading_info] | ed gem mt |
| 12eca650b27f025d5a1c | +0.153846 | Blue Shimmer | blue→field→Composer [print_finish]; shimmer→field→Composer [print_finish] | nm |
| 1ab36981fdce86771040 | +0.111842 | Disney; Dalmatian | disney→parser-unassigned; dalmatian→known-field miss [subject] | the lion king 164/199 |
| 1b6c3c565cffb8fb3442 | +0.025974 | — | 无新增正确词 | prospects 2 pink refractors |
| 268055e5845c6ecfcf83 | +0.095238 | 2026; New York Mets | 2026→known-field miss [year]; new→known-field miss [search_optimization]; york→known-field miss [search_optimization]; mets→field→Composer [search_optimization] | lava /75 rc prospect |
| 274c5078fce5de006ab1 | +0.074074 | Rookie Ticket | rookie→known-field miss [card_name]; ticket→known-field miss [card_name] | mint |
| 2e500fea9778f1bfafc7 | +0.022222 | Raiders | raiders→field→Composer [search_optimization] | jersey /299 |
| 34413231dd0ea69e68a4 | +0.090909 | Rookie | rookie→known-field miss [card_name] | chargers |
| 35540f2899f796676dcd | +0.155844 | Splash of Color | splash→known-field miss [card_name]; color→known-field miss [card_name] | racing |
| 3c690ab7d28f6c3d3e89 | +0.045455 | Arsenal | arsenal→field→Composer [search_optimization] | hp 10 foly |
| 413aa29a2561ee50f989 | +0.004831 | Green; Tennis | green→field→Composer [print_finish]; tennis→known-field miss [ip_sport] | /35 rc canada |
| 46be33ef1f2dbc0956af | +0.013158 | Refractor; Dodgers | refractor→known-field miss [print_finish]; dodgers→field→Composer [search_optimization] | gold g 11 |
| 4aa0c1e7f7e95ed8ae49 | +0.181538 | Violet Speckle | violet→field→Composer [print_finish]; speckle→field→Composer [print_finish] | /299 9/10 |
| 4c8131eeda536c66d385 | +0.030769 | Redemption | redemption→parser-unassigned | — |
| 4cd844c77ea0347c87da | +0.005305 | 242; Iconic | 242→known-field miss [card_number]; iconic→field→Composer [set] | ja 9 gem mt japanese foil |
| 522dae554f642f6810eb | +0.028986 | Rookie; Refractor | rookie→parser-unassigned; refractor→known-field miss [print_finish] | mojo /5 mavericks |
| 5bbc14c582d6f0b34f77 | +0.187692 | RC; Refractor | rc→field→Composer [search_optimization]; refractor→field→Composer [print_finish] | — |
| 5edfef737b8f58f5253b | +0.069565 | Orange Refractor; Dodgers | orange→field→Composer [print_finish]; refractor→known-field miss [print_finish]; dodgers→field→Composer [search_optimization] | /25 |
| 646c3f4af20b9ee7fe07 | +0.024615 | — | 无新增正确词 | rookie refractors |
| 64d10f8c8986aa1c9af4 | +0.199275 | Star; SCD | star→field→Composer [manufacturer]; scd→known-field miss [subject] | nm/mt |
| 6d227f82fdcb2ded4b6d | +0.24 | Luis Cova; David | luis→field→Composer [subject]; cova→field→Composer [subject]; david→field→Composer [subject] | prospects |
| 70559ba85193165a2f95 | +0.046154 | Blue Refractor | blue→field→Composer [print_finish]; refractor→field→Composer [print_finish] | /150 gem mt |
| 7059d3b39d01402f0e61 | +0.195652 | VeeFriends; Refractor | veefriends→known-field miss [product]; refractor→known-field miss [print_finish] | vt foil /10 |
| 7815e1aeda1f8e00dd4e | +0.060606 | VeeFriends; Refractor | veefriends→known-field miss [product]; refractor→known-field miss [print_finish] | vf sp rc |
| 7c93444e09007eaec82f | +0.011765 | MJx | mjx→known-field miss [product] | jersey rare |
| 805d56c3f42c2ad4218c | +0.041872 | Gold Refractor; Padres | gold→field→Composer [print_finish]; refractor→field→Composer [print_finish]; padres→field→Composer [search_optimization] | /50 rc |
| 86990bc00f236f49430e | +0.130326 | 2024 25; Spurs | 2024→known-field miss [year]; 25→known-field miss [year]; spurs→field→Composer [search_optimization] | sp pulsar /50 |
| 89cde2e9bc69a6edb4fd | +0.08 | Kings | kings→field→Composer [set] | /15 hrk so |
| 8cabcafd0596fbab0bb0 | +0.121212 | Optic | optic→known-field miss [product] | /25 |
| 952016ff08174d8a0b0a | +0.068966 | Panini | panini→field→Composer [manufacturer] | — |
| 9ef085a2c3022091aec0 | +0.056022 | Tennis; Refractor | tennis→known-field miss [ip_sport]; refractor→known-field miss [print_finish] | orange /50 |
| a12d7e8c2d623c870df4 | +0.011765 | 2024 | 2024→known-field miss [year] | milwaukee brewers rookie |
| a13d07f85029e110759d | +0.06 | Real Madrid | real→field→Composer [search_optimization]; madrid→field→Composer [search_optimization] | hp 4 foil |
| a4051a222e9be2cf8149 | +0.04 | Two Tubes | two→parser-unassigned; tubes→parser-unassigned | 2016 edri rc |
| a8a73b44f77bf6e823e2 | +0.063158 | Refractor | refractor→known-field miss [print_finish] | checkered bantamweight |
| b514a8918dbc221a17bd | +0.27451 | Los Angeles Dodgers | los→known-field miss [search_optimization]; angeles→known-field miss [search_optimization]; dodgers→field→Composer [search_optimization] | — |
| bc6cd6c49b79324c84d7 | +0.068421 | 2025; Lakers | 2025→known-field miss [year]; lakers→field→Composer [search_optimization] | orange /50 |
| bcc4e7ac4ac23e1e69d3 | +0.212121 | Refractor; Polanco | refractor→known-field miss [print_finish]; polanco→field→Composer [subject] | sapphire waldschmidt |
| c1fdabad9da739fc592f | +0.133333 | Common; Refractor | common→known-field miss [print_finish]; refractor→known-field miss [print_finish] | new york knicks |
| c6ecb08d49256335aa6b | +0.191304 | 1st; Blue; RC | 1st→known-field miss [special_stamp]; blue→field→Composer [print_finish]; rc→known-field miss [search_optimization] | wave |
| dbf99f2a5e722e98b87a | +0.015038 | Rookie | rookie→parser-unassigned | /175 |
| e25ba92ef5f8fb4207a0 | +0.015873 | VMAX; Trainer Gallery | vmax→parser-unassigned; trainer→parser-unassigned; gallery→parser-unassigned | black gold silver tempest |
| f371844dc1d0c6e49f92 | +0.148707 | Star Wars; DF 3 | star→parser-unassigned; wars→parser-unassigned; df→field→Composer [card_number]; 3→field→Composer [card_number] | 1999 episode i foil |

## 95 张 canonical 胜利逐卡明细

| asset 后缀 | ΔF1（bare-canonical） | canonical 独有完整短语 | canonical 独有正确词与字段 | 原因 | bare 错误词数 |
|---|---:|---|---|---|---:|
| 0184bc4079b5350adad2 | -0.10582 | 9 | 9 [grading_info] | grading; bare_precision_noise | 2 |
| 0692862d56755fe4e863 | -0.034632 | 6/8 | 6/8 [numerical_rarity] | exact_numeric; bare_precision_noise | 3 |
| 080f2cb760945426220d | -0.333333 | Happy Holidays | happy [set]; holidays [set] | identity; bare_precision_noise; phrase_completeness | 6 |
| 098dbc6f39f5cccb43ff | -0.203297 | Red; 11/15 | red [print_finish]; 11/15 [numerical_rarity] | finish_rarity; exact_numeric; bare_precision_noise | 6 |
| 0c7b873fec31df71ddb3 | -0.197628 | 2023 Wild Card | 2023 [year]; card [manufacturer] | identity; bare_precision_noise; phrase_completeness | 7 |
| 0e81149eb058b3a98a15 | -0.028986 | — | — | bare_precision_noise | 4 |
| 10f650102a783e83aff4 | -0.023333 | Panini | panini [manufacturer] | identity; bare_precision_noise | 5 |
| 12f2d135218a7ca35d3e | -0.059259 | — | — | bare_precision_noise | 3 |
| 145998198f262d24fb1b | -0.123529 | — | — | bare_precision_noise | 4 |
| 159b07bd6d12e0e4e794 | -0.15 | 18/50 | 18/50 [numerical_rarity] | exact_numeric; bare_precision_noise | 4 |
| 1638841b99625325c7d4 | -0.107692 | Hoopla | hoopla [card_name] | identity; bare_precision_noise | 5 |
| 17d4ec4dd5aa0af31a78 | -0.02381 | — | — | bare_precision_noise | 3 |
| 1f3be5eca26948c10405 | -0.233333 | Xfractor 038/220 | xfractor [print_finish]; 038/220 [numerical_rarity] | finish_rarity; exact_numeric; bare_precision_noise; phrase_completeness | 5 |
| 2cada69235bf401f2a16 | -0.105413 | 60/75; Patch | 60/75 [numerical_rarity]; patch [search_optimization] | exact_numeric; components; bare_precision_noise | 4 |
| 316c9c2012386b0a64ed | -0.2 | Relic | relic [search_optimization] | components; bare_precision_noise | 3 |
| 31ed8405fc7d36c8ea60 | -0.222222 | — | — | bare_precision_noise | 4 |
| 3215d29874a3dad22bbb | -0.113095 | — | — | bare_precision_noise | 4 |
| 3304222f844f985e9574 | -0.027692 | 07/25 | 07/25 [numerical_rarity] | exact_numeric; bare_precision_noise | 5 |
| 34bee0c655a1edcd18b9 | -0.076522 | 1074/1999 | 1074/1999 [numerical_rarity] | exact_numeric; bare_precision_noise | 2 |
| 350b42505d0a78017742 | -0.080201 | — | — | bare_precision_noise | 3 |
| 3b5183224a0714e832b9 | -0.167224 | Topps; Red | topps [manufacturer]; red [print_finish] | identity; finish_rarity; bare_precision_noise | 5 |
| 410c0c9aa76e944a0cbc | -0.074074 | 22/50; PSA | 22/50 [numerical_rarity]; psa [grading_info] | exact_numeric; grading; bare_precision_noise | 2 |
| 431bf2f794eaf169c532 | -0.188889 | Gold | gold [print_finish] | finish_rarity; bare_precision_noise | 4 |
| 4a36645e653a8b8a8019 | -0.296443 | 2024 25; 2/5 | 2024 [year]; 25 [year]; 2/5 [numerical_rarity] | identity; exact_numeric; bare_precision_noise; phrase_completeness | 6 |
| 4a97e73ddf0b28cca095 | -0.141176 | — | — | bare_precision_noise | 4 |
| 50e7a946ce9892a1f2fb | -0.284091 | — | — | bare_precision_noise | 6 |
| 52526222b532fbef54e2 | -0.036232 | — | — | bare_precision_noise | 2 |
| 52c03ac5508069913414 | -0.166667 | — | — | bare_precision_noise | 8 |
| 576057c604b9c50f806c | -0.068182 | — | — | bare_precision_noise | 4 |
| 58264271a4854c4a73ed | -0.190016 | 92/99 | 92/99 [numerical_rarity] | exact_numeric; bare_precision_noise | 6 |
| 59c73afe530cf56006c3 | -0.273684 | Konnor | konnor [subject] | identity; bare_precision_noise | 7 |
| 5b9bb32f10e297d65584 | -0.003344 | — | — | bare_precision_noise | 5 |
| 5fd1a40d7b38a755be74 | -0.076923 | UEFA | uefa [product] | identity; bare_precision_noise | 3 |
| 62cc2e317ae5cd859774 | -0.233333 | — | — | bare_precision_noise | 5 |
| 63bfb7a3cd432ce59360 | -0.13369 | — | — | bare_precision_noise | 8 |
| 649595fdd1f5ec9fc02e | -0.2 | Soccer; 29/199 | soccer [product]; 29/199 [numerical_rarity] | identity; exact_numeric; bare_precision_noise | 3 |
| 659d6de445a5a7f8fdca | -0.172727 | RC | rc [search_optimization] | components; bare_precision_noise | 4 |
| 65efa016ae8c5a82f3fa | -0.025 | — | — | bare_precision_noise | 5 |
| 6683a671093f786a0948 | -0.16 | Through; Years | through [set]; years [set] | identity; bare_precision_noise | 3 |
| 67bb24bb668bed358368 | -0.115385 | — | — | bare_precision_noise | 7 |
| 69e5113bcd0c8438df45 | -0.325758 | Geometric; 119/150; 1st | geometric [print_finish]; 119/150 [numerical_rarity]; 1st [descriptive_rarity+search_optimization] | finish_rarity; exact_numeric; components; bare_precision_noise | 6 |
| 6b8dd60cff233e74c68a | -0.077778 | — | — | bare_precision_noise | 4 |
| 6cbe7097beee5ecb14ba | -0.181481 | — | — | bare_precision_noise | 7 |
| 6d735fe449afe45dbaa5 | -0.153846 | Prizm; RC | prizm [print_finish]; rc [search_optimization] | finish_rarity; components; bare_precision_noise | 3 |
| 77f1063c48c35c3d3583 | -0.074074 | Dual; RC | dual [card_name]; rc [search_optimization] | identity; components; bare_precision_noise | 3 |
| 7ae66142ce80a2d06fc0 | -0.044872 | — | — | bare_precision_noise | 7 |
| 8541091b7125268e2d05 | -0.172727 | Fleer | fleer [manufacturer+product] | identity; bare_precision_noise | 4 |
| 85c1779f6c205ba425c6 | -0.082816 | — | — | bare_precision_noise | 2 |
| 86c114c0d0e9866d56cf | -0.004348 | — | — | bare_precision_noise | 3 |
| 88345e7136c1087e5187 | -0.017391 | — | — | bare_precision_noise | 3 |
| 8945fde9c65cb1b9f3a8 | -0.164835 | — | — | bare_precision_noise | 5 |
| 8b3024b5cc435830e80c | -0.052288 | — | — | bare_precision_noise | 2 |
| 8c2e0969acfd82951320 | -0.24 | Panini; Red; 18/49 | panini [manufacturer]; red [print_finish]; 18/49 [numerical_rarity] | identity; finish_rarity; exact_numeric; bare_precision_noise | 4 |
| 8e6763a0f5c15b07ef8a | -0.095238 | 2/8 | 2/8 [numerical_rarity] | exact_numeric; bare_precision_noise | 5 |
| 8fb29302a15dd34e880b | -0.011905 | — | — | bare_precision_noise | 4 |
| 92df2086a5b302c00a0b | -0.108262 | Signature | signature [set+card_name] | identity; bare_precision_noise | 2 |
| 940144961215fef91c18 | -0.091304 | — | — | bare_precision_noise | 4 |
| 94876e6b8026ed98af01 | -0.123529 | — | — | bare_precision_noise | 5 |
| 981cde75132b2b4a3269 | -0.088889 | 03/25 | 03/25 [numerical_rarity] | exact_numeric; bare_precision_noise | 2 |
| 9aa010e8badc5bece7b9 | -0.076923 | Panini; 18/27 | panini [manufacturer]; 18/27 [numerical_rarity] | identity; exact_numeric; bare_precision_noise | 3 |
| 9be0cc1a90961255c312 | -0.039526 | — | — | bare_precision_noise | 3 |
| a0250627a306090528ce | -0.076522 | RC | rc [search_optimization] | components; bare_precision_noise | 2 |
| a0cb37084a005a8998fb | -0.185464 | Signature | signature [card_name] | identity; bare_precision_noise | 4 |
| a38ced8b163264d9d95a | -0.116667 | Rookie Ticket | rookie [card_name]; ticket [card_name] | identity; bare_precision_noise; phrase_completeness | 3 |
| a78c9e94bec0ced79c29 | -0.086957 | Patch | patch [search_optimization] | components; bare_precision_noise | 3 |
| ac56300fcdbf84e6f7d2 | -0.009804 | — | — | bare_precision_noise | 3 |
| b30172f8db7f7620575f | -0.066253 | Refractor; Auto | refractor [print_finish]; auto [search_optimization] | finish_rarity; components; bare_precision_noise | 3 |
| b70318cffa06b389f851 | -0.120879 | 12/50 | 12/50 [numerical_rarity] | exact_numeric; bare_precision_noise | 7 |
| ba0f97b835e28571d19f | -0.267692 | Next Stop Signatures; 72/75 | next [set]; stop [set]; signatures [set+card_name]; 72/75 [numerical_rarity] | identity; exact_numeric; bare_precision_noise; phrase_completeness | 4 |
| bc9654d83b13db44d507 | -0.131579 | Series | series [set] | identity; bare_precision_noise | 6 |
| c279329f2f78d7f65071 | -0.070707 | — | — | bare_precision_noise | 3 |
| c2b77d787bd8cd8345e3 | -0.113757 | JP; Special Art Rare | jp [language]; special [card_name]; art [card_name]; rare [card_name] | identity; bare_precision_noise; phrase_completeness | 1 |
| c4905891fd0ed7eb8308 | -0.076923 | Chrome; 1st; 45/71 | chrome [product]; 1st [card_name+descriptive_rarity+search_optimization]; 45/71 [numerical_rarity] | identity; finish_rarity; components; exact_numeric; bare_precision_noise | 4 |
| cba457f4bf50ba75d06a | -0.29697 | — | — | bare_precision_noise | 7 |
| cbc017ae11b53874adf3 | -0.107143 | Refractor | refractor [print_finish] | finish_rarity; bare_precision_noise | 3 |
| ccc908ae3278d88b80dc | -0.086687 | — | — | bare_precision_noise | 4 |
| cd081e3a017a5c05b5b5 | -0.119565 | Basketball | basketball [product] | identity; bare_precision_noise | 4 |
| cd842de8c33e22b20d47 | -0.31746 | 2025; Gold Refractor 17/50 | 2025 [year]; gold [print_finish]; 17/50 [numerical_rarity] | identity; finish_rarity; exact_numeric; bare_precision_noise; phrase_completeness | 5 |
| d1cc0f12cdbba0306e8b | -0.080808 | — | — | bare_precision_noise | 9 |
| d22900c718eb034ad08d | -0.190476 | — | — | bare_precision_noise | 5 |
| d768c8f01fbfdd779bb0 | -0.143333 | Kendry Chourio Marek Houston Aiva | kendry [subject]; marek [subject]; aiva [subject] | identity; bare_precision_noise; phrase_completeness | 7 |
| dfba61396ec82f2b864e | -0.169772 | 13/25 | 13/25 [numerical_rarity] | exact_numeric; bare_precision_noise | 3 |
| e0962fbbfd41c6c77f55 | -0.225564 | — | — | bare_precision_noise | 5 |
| e0ee4e7070fe806e72b5 | -0.097222 | — | — | bare_precision_noise | 3 |
| e15bc8c40fe668ae0b9e | -0.129187 | — | — | bare_precision_noise | 4 |
| e2c50c291e40a226e90e | -0.130435 | 27/50 | 27/50 [numerical_rarity] | exact_numeric; bare_precision_noise | 2 |
| e5c7694ffc8faf61ee31 | -0.156522 | 09/10 | 09/10 [numerical_rarity] | exact_numeric; bare_precision_noise | 3 |
| e6b0b7875e666c36be6b | -0.191304 | 3/8 | 3/8 [numerical_rarity] | exact_numeric; bare_precision_noise | 6 |
| e90ca474692fe8f57b44 | -0.031621 | — | — | bare_precision_noise | 4 |
| ee03ba06dd634655b4ba | -0.095238 | Horizontal | horizontal [release_variant] | finish_rarity; bare_precision_noise | 3 |
| eee05fabd6546ee79c5b | -0.080201 | — | — | bare_precision_noise | 4 |
| f246b38058854d10b78a | -0.069565 | — | — | bare_precision_noise | 2 |
| f38c2a941033069e52b2 | -0.042735 | 9 | 9 [grading_info] | grading; bare_precision_noise | 2 |
| f52efb0422eb065b42e8 | -0.118577 | SkyBox | skybox [manufacturer] | identity; bare_precision_noise | 5 |
| f584d8bfc9982bfd0246 | -0.02381 | — | — | bare_precision_noise | 6 |

## 硬边界

- reference 只用于离线诊断和 oracle；没有构造任何可部署 selector。
- phrase candidate 不得写 CSM、Composer、Supabase 或生产标题。
- exhaustive 是另一条 open prompt 调用，只是复现证据，不是 same-call 证据。
- 本次 provider 调用 0，生产改动 0。

## 数据与逐卡账本

- 配对数据：`artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl`
- manifest：`artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.manifest.json`
- exhaustive 复现证据：`artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl`
- 逐卡 ledger：`docs/evaluation/bare-canonical-complementarity-150-2026-08-02.json`（150 张；含 44/95/11 全部明细）
