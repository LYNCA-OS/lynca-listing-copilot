# Listing Copilot

Internal LYNCA webtool for turning collectible card images into copy-paste-ready English eBay listing titles.

Listing Copilot is not an eBay auto-listing system and does not call the eBay API. It is an operator assistant: upload card images, generate title candidates, review confidence, and copy accepted titles into the listing workflow.

## Product State

- Frontend: native HTML / CSS / JavaScript in `app/`
- Backend: Vercel API functions in `api/`
- Auth: simple internal login via environment variables
- AI pipeline: OpenAI vision/title generation using prompts in `prompts/`
- Knowledge support: local registry in `lib/listing-knowledge-registry.mjs`
- Tests: mock title audit and upload safety scripts in `scripts/`

Current workflow:

1. Upload card images.
2. Choose Single Image or Front / Back Pair mode.
3. Generate English eBay-ready titles.
4. Review confidence: `HIGH`, `MEDIUM`, `LOW`, or `FAILED`.
5. Copy individual titles or the V1.2 Batch Generated Titles list.

## Local Development

```bash
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

If `OPENAI_API_KEY` is empty, the app uses filename fallback so upload, pairing, and copy flows can still be tested locally.

## Environment Variables

Required for local and Vercel environments:

```text
METAVERSE_USERNAME=listing
METAVERSE_PASSWORD=change-me
METAVERSE_AUTH_SECRET=replace-with-a-long-random-secret
OPENAI_API_KEY=
OPENAI_LISTING_MODEL=gpt-4.1-mini
```

## Validation

Run the full check suite:

```bash
npm run check
```

Useful direct commands:

```bash
node --check api/listing-copilot-title.js
node --check scripts/listing-confidence-audit.test.mjs
node scripts/listing-confidence-audit.test.mjs
node scripts/upload-safety-layer.test.mjs
```

## Documentation

Start with:

- [docs/README.md](docs/README.md) — documentation index
- [docs/sports-card-title-standard-v1.md](docs/sports-card-title-standard-v1.md) — sports card title source-of-truth
- [docs/architecture-decisions-v1.md](docs/architecture-decisions-v1.md) — approved V1.x architecture decisions
- [docs/listing-copilot-roadmap-v1.md](docs/listing-copilot-roadmap-v1.md) — phased implementation roadmap
- [docs/spec-v1.md](docs/spec-v1.md) — original MVP product spec

Training and calibration notes remain in `docs/training-*.md`.

## Prompt Files

OpenAI title generation loads prompt files at runtime:

```text
prompts/listing-intelligence-v1.md
prompts/examples/
```

Prompt edits can change generation behavior without frontend changes, so validate with `node scripts/listing-confidence-audit.test.mjs` after any prompt or title-standard change.

## Deployment

This repo should remain an independent Vercel project.

```text
Production domain: listing.lyncafei.team
Root Directory: ./
```

Configure the same environment variables listed above in Vercel.
