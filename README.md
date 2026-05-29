# Metaverse Listing Copilot

元宇宙卡牌 listing workflow 的独立内部 webtool。

这个 repo 从 `lynca-metaverse-os` 拆出，避免 Listing Copilot 的独立 API key、部署节奏、测试周期影响 Metaverse OS。

## 当前定位

- 域名目标：`listing.lyncafei.team`
- 前端：原生 HTML / CSS / JavaScript
- backend：Vercel API functions + middleware
- AI pipeline：OpenAI vision/title generation
- 数据源：静态 `resolution.json`
- 登录：固定账号密码，通过环境变量配置

它不是 eBay 自动上架系统，也不接 eBay API。当前 MVP 是 copy-paste assistant：批量上传卡图，按 Single Image 或 Front / Back Pair 生成 eBay-ready 标题，并给出 HIGH / UNSURE / FAILED 分流。

## 目录结构

```text
lynca-listing-copilot/
├─ app/
│  ├─ index.html
│  ├─ login.html
│  ├─ listing-copilot.css
│  ├─ listing-copilot.js
│  ├─ login.js
│  └─ resolution.json
├─ api/
│  ├─ login.js
│  ├─ logout.js
│  ├─ session.js
│  └─ listing-copilot-title.js
├─ docs/
│  └─ spec-v1.md
├─ scripts/
│  └─ dev-server.mjs
├─ middleware.js
├─ vercel.json
├─ package.json
├─ .env.example
└─ .gitignore
```

## 本地运行

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```text
METAVERSE_USERNAME=listing
METAVERSE_PASSWORD=change-me
METAVERSE_AUTH_SECRET=replace-with-a-long-random-secret
OPENAI_API_KEY=
OPENAI_LISTING_MODEL=gpt-4.1-mini
```

启动：

```bash
npm run dev
```

访问：

```text
http://localhost:3000
```

未配置 `OPENAI_API_KEY` 时，系统会用 filename fallback 验证上传、配对和复制流程。

## Vercel 部署

这个 repo 应作为独立 Vercel Project 部署：

```text
GitHub repo: lynca-listing-copilot
Root Directory: ./
Production domain: listing.lyncafei.team
```

Vercel 环境变量：

```text
METAVERSE_USERNAME
METAVERSE_PASSWORD
METAVERSE_AUTH_SECRET
OPENAI_API_KEY
OPENAI_LISTING_MODEL
```

## 检查

```bash
npm run check
```

完整产品规则见 [docs/spec-v1.md](docs/spec-v1.md)。
