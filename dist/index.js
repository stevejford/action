"use strict";

// src/index.ts
var import_node_fs = require("node:fs");
var COMMENT_MARKER = "<!-- screenshotsmcp:visual-diff -->";
function getInput(name, required = false) {
  const value = process.env[`INPUT_${name.replace(/-/g, "_").toUpperCase()}`] ?? "";
  if (required && !value) {
    throw new Error(`Missing required input: ${name}`);
  }
  return value.trim();
}
function getInputNumber(name, fallback) {
  const raw = getInput(name);
  if (!raw) return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  (0, import_node_fs.appendFileSync)(file, `${name}<<__SMCP_EOF__
${String(value)}
__SMCP_EOF__
`);
}
function setSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  (0, import_node_fs.appendFileSync)(file, `${markdown}
`);
}
function readPrContext() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return null;
  const [owner, repoName] = repo.split("/", 2);
  const ref = process.env.GITHUB_REF ?? "";
  const match = ref.match(/^refs\/pull\/(\d+)\//);
  if (match) {
    return { owner, repo: repoName, prNumber: Number(match[1]) };
  }
  const eventPr = process.env.GITHUB_EVENT_PR_NUMBER;
  if (eventPr) {
    return { owner, repo: repoName, prNumber: Number(eventPr) };
  }
  return null;
}
async function findExistingComment(ctx, token) {
  let page = 1;
  while (page <= 10) {
    const res = await fetch(
      `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.prNumber}/comments?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "screenshotsmcp-action"
        }
      }
    );
    if (!res.ok) {
      console.warn(`[screenshotsmcp] failed to list PR comments: HTTP ${res.status}`);
      return null;
    }
    const items = await res.json();
    if (items.length === 0) return null;
    const found = items.find((c) => c.body?.includes(COMMENT_MARKER));
    if (found) return { id: found.id };
    if (items.length < 100) return null;
    page += 1;
  }
  return null;
}
async function upsertComment(ctx, token, body) {
  const existing = await findExistingComment(ctx, token);
  const url = existing ? `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/issues/comments/${existing.id}` : `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.prNumber}/comments`;
  const method = existing ? "PATCH" : "POST";
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "screenshotsmcp-action"
    },
    body: JSON.stringify({ body })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[screenshotsmcp] failed to ${method} comment: HTTP ${res.status} ${text}`);
  }
}
function buildCommentBody(diff, passed, failThreshold, baselineUrl, previewUrl) {
  const verdict = passed ? "\u2705 Pass" : "\u274C Fail";
  const pct = diff.changedPercent.toFixed(2);
  return [
    COMMENT_MARKER,
    "## ScreenshotsMCP visual diff",
    "",
    `**${verdict}** \u2014 ${pct}% of pixels changed (threshold: ${failThreshold}%)`,
    "",
    `| | URL | Preview |`,
    `| --- | --- | --- |`,
    `| Baseline | ${baselineUrl} | <img src="${diff.beforeUrl}" width="240" /> |`,
    `| Preview  | ${previewUrl} | <img src="${diff.afterUrl}" width="240" /> |`,
    `| Diff     | \u2014 | <img src="${diff.diffUrl}" width="240" /> |`,
    "",
    `Resolution: ${diff.width}\xD7${diff.height} \xB7 pixelmatch threshold: ${diff.threshold} \xB7 changed pixels: ${diff.changedPixels.toLocaleString()} / ${diff.totalPixels.toLocaleString()}`,
    "",
    `<sub>\u{1F916} Visual diff by [ScreenshotsMCP](https://www.screenshotmcp.com/?ref=github-action) \xB7 [Wire it into your AI agent](https://www.screenshotmcp.com/dashboard/install?ref=github-action) \xB7 Free for public repos</sub>`
  ].join("\n");
}
async function main() {
  const apiKey = getInput("api-key", true);
  const baselineUrl = getInput("baseline-url", true);
  const previewUrl = getInput("preview-url", true);
  const width = getInputNumber("width", 1280);
  const height = getInputNumber("height", 800);
  const threshold = getInputNumber("threshold", 0.1);
  const failThreshold = getInputNumber("fail-on-change-percent", 1);
  const commentOnPr = (getInput("comment-on-pr") || "true").toLowerCase() === "true";
  const githubToken = getInput("github-token");
  const apiBase = getInput("api-base") || "https://screenshotsmcp-api-production.up.railway.app";
  const idempotencyKey = `${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_SHA ?? Date.now()}`;
  console.log(`[screenshotsmcp] diff baseline=${baselineUrl} preview=${previewUrl}`);
  const res = await fetch(`${apiBase}/v1/screenshot/diff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": idempotencyKey,
      "X-Request-ID": idempotencyKey
    },
    body: JSON.stringify({ urlA: baselineUrl, urlB: previewUrl, width, height, threshold })
  });
  const requestId = res.headers.get("x-request-id") ?? "(none)";
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Diff request failed: HTTP ${res.status} (request ${requestId}): ${text}`);
  }
  const diff = await res.json();
  const passed = diff.changedPercent <= failThreshold;
  setOutput("diff-url", diff.diffUrl);
  setOutput("before-url", diff.beforeUrl);
  setOutput("after-url", diff.afterUrl);
  setOutput("changed-percent", diff.changedPercent.toFixed(4));
  setOutput("match-score", diff.matchScore.toFixed(4));
  setOutput("passed", passed ? "true" : "false");
  setSummary(buildCommentBody(diff, passed, failThreshold, baselineUrl, previewUrl));
  if (commentOnPr) {
    const ctx = readPrContext();
    if (ctx && githubToken) {
      await upsertComment(ctx, githubToken, buildCommentBody(diff, passed, failThreshold, baselineUrl, previewUrl));
    } else if (!ctx) {
      console.log("[screenshotsmcp] not a pull_request event \u2014 skipping PR comment.");
    } else if (!githubToken) {
      console.log("[screenshotsmcp] no github-token provided \u2014 skipping PR comment.");
    }
  }
  if (!passed) {
    process.exitCode = 1;
    console.error(
      `[screenshotsmcp] FAILED: ${diff.changedPercent.toFixed(2)}% changed exceeds threshold ${failThreshold}%`
    );
  } else {
    console.log(
      `[screenshotsmcp] OK: ${diff.changedPercent.toFixed(2)}% changed (threshold ${failThreshold}%)`
    );
  }
}
main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
