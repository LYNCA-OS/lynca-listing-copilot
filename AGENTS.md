# Listing Copilot repository contract

## Source of truth

- GitHub `origin/main` is the only production source of truth.
- Production releases must run from the exact current `origin/main` commit through `.github/workflows/deploy-production.yml`.
- Never deploy Vercel or Cloud Run from a feature branch, a detached checkout, or a dirty working tree.
- A deployed artifact is evidence of runtime state, not an alternative source repository. Reconcile it back to GitHub before further development.

## Before changing code

Run and inspect all of the following before editing:

```sh
git remote -v
git fetch --prune origin
git status --short --branch
git worktree list --porcelain
git rev-parse HEAD origin/main
```

If the checkout is dirty, treat its changes as user-owned. Do not reset, overwrite, merge, or deploy them. Move the task to a clean worktree based on `origin/main`.

## Branch and worktree discipline

- Keep the canonical `main` checkout clean and fast-forwarded to `origin/main`.
- Maintain at most one active algorithm-integration branch. Consolidate new algorithm commits there before starting another algorithm branch.
- Use a dedicated `codex/*` branch and registered Git worktree for unmerged work.
- A branch is not complete until its PR is merged or explicitly retained as the one active next branch.
- After merge, remove its worktree and delete its local and remote branch.
- Before removing an unmerged worktree, compare both commits and working-tree content against `origin/main`. Preserve only genuinely newer behavior.
- Do not retain damaged clones, duplicate checkouts, stale Preview branches, or untracked dependency directories as informal backups.

## Architecture boundaries

- Strategy and execution-chain changes are separate scopes. Do not let a strategy experiment silently change queueing, authentication, storage, provider concurrency, or deployment behavior.
- Chain/infrastructure fixes must not change SEM weights, title policy, or evaluation semantics unless the task explicitly includes both scopes.
- Reusable catalog, SEM, and OCR contracts belong in stable server-side modules, not one-off evaluation scripts or frontend toggles.

## Release gates

- Stage explicit files; do not use broad staging in a mixed worktree.
- Run the relevant focused tests and the offline CI suite before pushing.
- Require a PR and green CI before merging to `main`.
- Verify database migrations separately from CI; do not infer applied schema from committed SQL.
- Verify Vercel, Cloud Run workers, authentication, and production health separately after deployment.
- Never treat a successful deploy as accuracy proof. Card-pool evaluation remains a separate strategy gate.


## CSM is the authority (founder ruling, 2026-08-03)

When behaviour and a gate disagree, ask first whether the behaviour is correct
**by CSM**. If it is, the gate yields — amend the gate and cite the rule. If it
is not, fix the behaviour. Never rewrite a gate's meaning to keep a green light,
and never change correct behaviour to keep a gate quiet.

The ruling came from a real case. `Lot*n` freed four characters; on one card the
reclaimed budget went to two more subjects and pushed `Refractor` past the
80-character limit. That flipped another mechanism's promotion gate, which
required zero lost reference tokens. But COS-8 ranks Subject `*` above Print
Finish `**`, so the drop order was correct and the gate was stricter than the
contract it served. A gate stricter than its contract raises alarms nobody can
act on, until everyone learns to ignore it.

Two boundaries:

* **Fabrication is never excused.** Nothing in CSM authorises inventing a fact
  absent from the card, so `cards_with_unbacked_new_tokens` stays absolute
  regardless of what the drop order explains.
* **A coincidental match is not a contract drop.** One card "lost" the token
  `card` because the writer's "Card Shop Promo" happened to match the old
  `2 Card Lot` wording. We never identified that shop. Forgiving it would mean
  forgiving every accidental match, so it stays counted.

If CSM itself is wrong, change CSM through a Decision Proposal. Do not route
around it in the application layer — see COS-23 and COS-27.
