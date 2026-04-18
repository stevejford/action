# screenshotsmcp/action — Visual Diff for Pull Requests

A GitHub Action that captures two URLs through ScreenshotsMCP, pixel-diffs them, and posts (or updates) a sticky PR comment with the result. Fails the check when the change percentage exceeds your configured threshold.

```yaml
- uses: stevejford/action@v1
  with:
    api-key: ${{ secrets.SCREENSHOTSMCP_API_KEY }}
    baseline-url: https://your-app.com
    preview-url: ${{ steps.deploy.outputs.preview_url }}
    fail-on-change-percent: "1.0"
```

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `api-key` | **yes** | — | ScreenshotsMCP API key (`sk_live_...`). Store as a repo secret. |
| `baseline-url` | **yes** | — | URL captured as the baseline (typically your production / main deployment). |
| `preview-url` | **yes** | — | URL captured as the candidate (typically the PR preview deployment). |
| `width` | no | `1280` | Viewport width in pixels. |
| `height` | no | `800` | Viewport height in pixels. |
| `threshold` | no | `0.1` | pixelmatch color-difference threshold (0 = exact, 1 = lenient). |
| `fail-on-change-percent` | no | `1.0` | Maximum % of pixels that may change before this check fails. Set to `100` to always pass. |
| `comment-on-pr` | no | `true` | Post / update a sticky PR comment with the diff. |
| `github-token` | no | `${{ github.token }}` | Token used to post the PR comment. The default `GITHUB_TOKEN` is enough for same-repo PRs. |
| `api-base` | no | `https://screenshotsmcp-api-production.up.railway.app` | Override for self-hosted or staging APIs. |

## Outputs

| Name | Description |
| --- | --- |
| `diff-url` | Public URL of the diff overlay image. |
| `before-url` | Public URL of the baseline capture. |
| `after-url` | Public URL of the preview capture. |
| `changed-percent` | Percentage of pixels that differ. |
| `match-score` | 100 - changed-percent. |
| `passed` | `true` if changed-percent is at or below fail-on-change-percent. |

## Example: Vercel preview vs. production

```yaml
name: Visual Diff
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  pull-requests: write
  contents: read
jobs:
  visual-diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: deploy
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
      - uses: stevejford/action@v1
        with:
          api-key: ${{ secrets.SCREENSHOTSMCP_API_KEY }}
          baseline-url: https://your-app.com
          preview-url: ${{ steps.deploy.outputs.preview-url }}
          fail-on-change-percent: "1.0"
```

> **Counts toward your monthly quota** — Each invocation counts as one screenshot against your ScreenshotsMCP plan, regardless of how many captures the diff requires internally. Reruns of the same workflow + commit are deduped via `Idempotency-Key` so you never double-pay for retries.

## Local development

```bash
cd packages/github-action
npm install
npm run build   # emits dist/index.js (commit this)
```

The action's runtime is a single bundled CJS file under `dist/`. Commit the bundle along with `action.yml` so consumers can pull `stevejford/action@v1` without `npm install`.

See the [Webhooks docs](https://www.screenshotmcp.com/docs/api/webhooks) and [Ops Headers reference](https://www.screenshotmcp.com/docs/api/webhooks) for related primitives.
