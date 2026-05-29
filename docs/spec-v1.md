# Metaverse Listing Copilot V1.0 Spec

Build Metaverse Listing Copilot as a standalone internal webtool in `lynca-listing-copilot`.

This spec includes:

- webpage UI
- webpage UX
- bulk upload / pairing logic
- vision extraction principles
- resolution engine principles
- eBay title generation principles
- confidence routing
- editable JSON mapping structure
- backlog exclusions

## 1. Product Positioning

Metaverse Listing Copilot 是服务于元宇宙 listing workflow 的独立内部 webtool。

它未来部署到 `listing.lyncafei.team`，产品边界上只服务于元宇宙 listing workflow，不作为对外开放产品。

它不是：

- eBay automation agent
- auto-listing system
- folder export system
- cloud drive sync system
- downloadable ZIP generator

它是：

- title generation copilot
- bulk image upload tool
- front/back card pairing interface
- confidence-routed title output page
- copy-paste assistant for existing eBay listing workflows

## 2. Webpage UI

页面视觉参考当前 LYNCA AI webtool 风格：

- dark premium interface
- grid background
- top brand bar
- central workspace
- explanation panel
- upload control bar
- dashboard metrics
- asset-level output boxes

不要做 marketing landing page。打开后应直接进入工作界面。

## 3. Webpage UX / User Flow

1. Staff 打开 `/`。
2. Staff 批量上传卡图。
3. 选择模式：
   - Single Image：一张图等于一个 card asset。
   - Front / Back Pair：第 1 + 第 2 张图为 card 1，第 3 + 第 4 张图为 card 2。
4. 页面立即展示配对预览。
5. Staff 点击 `开始生成`。
6. 每个 asset 进入 AI vision/title pipeline。
7. 每个 asset 右侧出现一个 title output box。
8. Staff 按 confidence 复制或复核标题。

## 4. Input & Pairing Logic

支持 JPG / PNG / WEBP。

Single Image Mode：

- 每张图片生成一个 asset。
- 适用于只有正面、评级卡正面、或单图足够识别的场景。

Front / Back Pair Mode：

- 按上传顺序配对。
- 奇数张图片时，最后一张作为缺少背面的 asset，必须标记为需要人工关注。
- 不做文件夹导出，不改变用户本地文件。

## 5. Vision Extraction Principles

Vision Engine 负责从图片中提取字段，不直接决定最终 eBay 标题。

需要尽量提取：

- player / character / artist
- year
- brand / set
- subset / insert
- card number or code
- serial number
- autograph / relic / patch / sketch / grade status
- visible text from label or card back
- unresolved fields

失败场景：

- 多卡 lot
- 图片过糊
- 角度或反光严重
- 只看到无关背景
- 关键市场信息无法安全判断

## 6. Resolution Engine Principles

Resolution Engine 用已知 mapping、card code、checklist hint 补全 Vision Engine 未能确定的信息。

当前 V1 只使用 editable JSON mapping，不引入数据库。

示例：

```json
{
  "SR-KD": "Star Swatch Signatures",
  "FIN-10": "NBA Finals Nameplates",
  "TP-NYK": "Triple Patches",
  "VPA-VIN": "Vertical Patch Auto"
}
```

Resolution Engine 可以补全：

- insert name
- subset name
- parallel name
- case hit / short print hint
- common card-code expansion

如果 mapping 不确定，不能强行改写为 HIGH。

## 7. Title Output Principles

Title Engine 负责把字段转成 80 字符以内的 eBay-ready title。

目标不是 generic card identification，而是接近资深 Metaverse Cards listing specialist 的标题习惯。

规则：

- 最长 80 字符。
- 保留市场相关信息。
- 保留 player / character / artist names。
- 保留 insert、parallel、serial number、grade、auto、relic、patch、sketch。
- 不过度标准化 collector terminology。
- 不把不确定信息写得像确定事实。
- 标题应适合复制到现有 eBay listing workflow。

## 8. Confidence Routing

HIGH：

- 标题可直接复制上架。
- 关键字段完整。
- 没有明显市场术语风险。

UNSURE：

- 主体大致正确。
- parallel、insert、card code、serial、grade 或 market term 仍需人工复核。
- V1 中 fallback result 默认 UNSURE。

FAILED：

- 图像是 lot / 多卡组合。
- 图片太糊。
- 无法安全识别。
- API 或 vision pipeline 失败。

## 9. Output UI

每个 card asset 拥有自己的 output box。

Output box 必须包含：

- title textarea
- confidence badge
- copy button
- follow-up advice / reason
- expandable reasoning section

颜色规则：

- HIGH = green
- UNSURE = yellow
- FAILED = red

Reasoning section 显示：

- player / character
- year
- brand / set
- subset / insert
- card number or code
- serial number
- autograph / relic / patch / sketch / grade status
- unresolved fields

## 10. API Cost Tracking

页面需要展示：

- Images uploaded
- Card assets detected
- Processed assets
- HIGH count
- UNSURE count
- FAILED count
- Estimated API requests
- Estimated API cost

V1 的 cost 是 directional estimate，不做账单系统。

## 11. JSON / Config Structure

当前 config：

```text
app/resolution.json
```

后续可以扩展：

```text
app/config/
├─ resolution.json
├─ title-rules.json
└─ confidence-rules.json
```

V1 暂不迁移到数据库。

## 12. Backlog / Not V1

V1 不做：

- eBay API integration
- automatic listing
- scheduled posting
- folder export
- ZIP download
- cloud drive sync
- full card database
- user role permission matrix
- multi-tenant account system

这些可以进入后续 backlog，但不能影响 V1 的轻量 workflow 目标。
