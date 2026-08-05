# Production frontend journey audit — 2026-08-02

## Result

The production frontend is served at `https://listing.lyncafei.team` and its
authenticated HTML/JS path is connected to the thin CSM route.

| Check | Evidence |
| --- | --- |
| Login page | HTTP 200; `data-testid="login-form"`, username, password, submit controls present |
| Authenticated workbench | HTTP 200 after the real production session; title “把卡片变成可发布标题” rendered |
| Upload intent | `data-testid="image-upload-input"`, multi-file image input and “添加图片” label present |
| Old start action | `data-testid="start-recognition"` remains in the DOM but is `hidden`, `aria-hidden="true"`, disabled, and removed from keyboard order |
| Automatic recognition | deployed `app/listing-copilot.js` calls `requestRecognitionContinuation()` after each prepared asset and at batch end; it calls `processTitles()` without a user button click |
| Append behavior | non-empty batches retain `state.assetLifecycleGeneration` and `state.backgroundRecognitionBatchId`; the code explicitly says additional selections inherit the original recognition intent |
| Production API | one real asset completed HTTP 200, `CSM_THIN_DIRECT`, `PERSISTED`; CSM persistence was atomic |

The app keeps the visible `添加图片` control and the file input, while the old
`开始识别` button is inert/hidden. This matches the product intent: uploading
is the recognition action, and later selections continue the same workspace
intent rather than starting a second old workflow.

## Browser note

The in-app browser navigation to the production login page timed out twice in
this environment before returning a DOM snapshot. That is a tool-level
verification limitation, not evidence of a frontend failure: the same
production session was verified with HTTP login plus the served HTML/JS, and
the actual authenticated CSM request was verified separately. A future browser
run should still check the visual layout and file chooser interaction when the
browser transport is responsive.
