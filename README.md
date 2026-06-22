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
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

V2.0 Memory Layer uses server-side Supabase access only. `SUPABASE_SERVICE_ROLE_KEY` must stay server-side in Vercel/API environments and must not be exposed to browser code.

V2.0B uploads front/back image evidence to the private Supabase Storage bucket `listing-feedback-images` and stores stable Storage URLs in `front_image_url` and `back_image_url`.

The feedback endpoint derives `operator_id` from the existing signed internal session. If no signed user is available, it uses the documented internal placeholder `internal-operator`.

## V2.0 Memory Layer Manual Test

To verify one Supabase memory row:

1. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. Confirm Supabase has a `listing_title_feedback` table with `generated_title`, `corrected_title`, `front_image_url`, `back_image_url`, `operator_id`, and `created_at`.
3. Confirm Supabase Storage has a private bucket named `listing-feedback-images`.
4. Start the app and log in with the internal Listing Copilot credentials.
5. Upload one front image, or a front/back pair.
6. Generate a title.
7. Edit the title text.
8. Click the per-result Save button.
9. Confirm one new Supabase row exists with the generated title, corrected title, image URL fields, operator id, and timestamp.
10. Repeat Save without changing the title and confirm no extra changed-title row is required.

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
- [docs/foundation/foundation-v1.md](docs/foundation/foundation-v1.md) — foundation overview
- [docs/standards/sports-card-title-standard-v1.md](docs/standards/sports-card-title-standard-v1.md) — sports card title source-of-truth
- [docs/architecture/architecture-decisions-v1.md](docs/architecture/architecture-decisions-v1.md) — approved V1.x architecture decisions
- [docs/roadmap/listing-copilot-roadmap-v1.md](docs/roadmap/listing-copilot-roadmap-v1.md) — phased implementation roadmap
- [docs/foundation/spec-v1.md](docs/foundation/spec-v1.md) — original MVP product spec

Training and calibration docs are organized under `docs/training/`; older notes live in `docs/archive/training-legacy/`.

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
