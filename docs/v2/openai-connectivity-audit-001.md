# OpenAI Connectivity Audit #001

Status: Audit Only
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

## Scope

This audit covers the local Visual Review Prototype #001 script:

- `scripts/v2-visual-review-prototype.mjs`

No runtime title generation code, registry code, resolver code, or prompt files were modified.

## Findings

### 1. OpenAI SDK / Library Used

No OpenAI SDK is used by the visual review script.

The script uses Node's global `fetch` implementation through a local helper named `fetchWithRetry`.

Relevant code:

```js
async function fetchWithRetry(url, options, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(1000 * attempt);
      }
    }
  }

  throw lastError;
}
```

### 2. Endpoint Called

The visual review script calls:

```text
https://api.openai.com/v1/responses
```

Relevant code:

```js
const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    authorization: `Bearer ${openAiKey}`,
    "content-type": "application/json"
  },
  signal: AbortSignal.timeout(60000),
  body: JSON.stringify({
    model: process.env.OPENAI_VISUAL_REVIEW_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...images.map((image) => ({
            type: "input_image",
            image_url: image.data_url,
            detail: image.side === "front" ? "high" : "low"
          }))
        ]
      }
    ],
    max_output_tokens: 500
  })
});
```

### 3. Model Called

The script uses:

```text
process.env.OPENAI_VISUAL_REVIEW_MODEL || "gpt-4.1-mini"
```

If `OPENAI_VISUAL_REVIEW_MODEL` is not set, the model is:

```text
gpt-4.1-mini
```

### 4. Exact Request Code Path

The full code path is:

1. `.env.local` is loaded by `loadDotEnv(path.join(repoRoot, ".env.local"))`.
2. `OPENAI_API_KEY` is read into `openAiKey`.
3. Candidate images are downloaded with `downloadImage(...)`.
4. Downloaded images are converted to base64 data URLs.
5. `runVisionReview({ candidate, example, images })` builds the visual review prompt.
6. `runVisionReview(...)` calls `fetchWithRetry("https://api.openai.com/v1/responses", options)`.
7. `fetchWithRetry(...)` calls native `fetch(url, options)` up to 3 times.
8. If `fetch(...)` throws, the final thrown error is caught by the candidate-level `catch`.
9. The report records `Prototype review failed: fetch failed`.

Relevant call sites:

```js
const review = await runVisionReview({
  candidate,
  example,
  images
});
```

```js
async function runVisionReview({ candidate, example, images }) {
  ...
  const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${openAiKey}`,
      "content-type": "application/json"
    },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: process.env.OPENAI_VISUAL_REVIEW_MODEL || "gpt-4.1-mini",
      input: [...],
      max_output_tokens: 500
    })
  });
  ...
}
```

### 5. Failure Classification

Observed error:

```text
fetch failed
```

The failure occurs after request options are constructed and when native `fetch(...)` attempts the OpenAI request.

Classification:

| Layer | Classification | Reason |
| --- | --- | --- |
| Before request | No | The script reaches `runVisionReview(...)` and calls `fetchWithRetry(...)`. |
| During request creation | No | The request options and JSON body are constructed before the failure. |
| TLS/network layer | Yes, likely | Native `fetch(...)` throws `fetch failed` before an HTTP response object is returned. |
| Proxy layer | Likely proxy bypass / not wired into Node fetch | The script does not configure a proxy dispatcher. Node's native `fetch` does not automatically use `HTTP_PROXY` / `HTTPS_PROXY` in this code path. |
| SDK layer | No | No OpenAI SDK is used. |
| Response parsing | No | The script never reaches `response.ok`, `response.text()`, `response.json()`, or JSON parsing for failed Vision calls. |

## Conclusion

The visual review failure is not an OpenAI SDK problem and not a response parsing problem.

The failure is in the native Node `fetch` network path before an HTTP response is returned. Given that `curl` can reach `api.openai.com` through the proxy, but the script uses native `fetch` without proxy dispatcher configuration, the most likely cause is that the visual review script's Node fetch request is not using the proxy even when `HTTP_PROXY` and `HTTPS_PROXY` are present in the environment.

