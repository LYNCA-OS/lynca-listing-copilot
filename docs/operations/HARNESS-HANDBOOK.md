# Harness Handbook Maintenance Harness

LYNCA 使用 `Ruhan-Wang/Harness_Handbook` 作为辅助维护工具，而不是生产运行时依赖。它负责从源码生成静态调用图，帮助审查主链所有权、边界调用和重复路径。

## 安全边界

- 上游固定在 commit `92d66cc7b762ff6c2812877c5a37b84d709a47a3`，不跟随可变的 `main`。
- 该固定版本没有仓库级 LICENSE 文件，因此不复制或修改上游源码到 LYNCA 仓库；源码只下载到用户缓存。
- 默认只运行 Phase 1。该阶段是本地静态分析，不调用 LLM，也不上传源码。
- Phase 2/3 会把源码派生内容发送给 OpenAI-compatible API，必须显式传入 `--allow-llm`，并由操作者确认数据边界。
- Handbook 产物是维护证据，不是生产真值，也不能替代测试、云端烟测或发布门禁。

## 命令

```bash
npm run maintenance:handbook:check
npm run maintenance:handbook:test
npm run maintenance:handbook:bootstrap
npm run maintenance:handbook:phase1
```

完整 LLM Handbook 只在明确批准源码外发后运行：

```bash
HANDBOOK_LLM_API_KEY=... \
HANDBOOK_LLM_MODEL=... \
HANDBOOK_LLM_BASE_URL=... \
HARNESS_HANDBOOK_ALLOW_LLM=1 \
npm run maintenance:handbook:full
```

密钥只从环境变量读取，启动器不会打印密钥。

## 缓存与产物

- 默认缓存：优先使用 `/Volumes/musician/.cache/lynca-listing-copilot/harness-handbook/`；SSD 不可用时回退到 `~/.cache/lynca-listing-copilot/harness-handbook/`
- 默认产物：`artifacts/maintenance-handbook/<LYNCA commit>-<upstream commit>-<profile>/`
- `phase1/graph.json`：静态调用图
- `phase1/functions.csv`：函数清单
- `phase1/dropped_calls.json`：被丢弃的边
- `lynca-manifest.json`：两端 commit、源码清单哈希、模式和图规模
- `maintenance-summary.md`：维护摘要
- `generator.log`：完整生成日志

`runtime` 是默认源码 profile，包含生产 API、应用、库和非测试脚本；`full` profile 额外包含测试与实验源码：

```bash
node scripts/maintenance-harness-handbook.mjs run --phase 1 --profile full
```

## 维护节奏

1. 大型架构改动前后各跑一次 Phase 1。
2. 对比 `source_inventory_sha256`、边界节点和调用边变化。
3. 发现重复所有权或旧执行桥时，回到源码和测试确认，不直接依据图自动删除代码。
4. 升级上游前单独审查新 commit、LICENSE、依赖和产物差异，再更新 lock。
