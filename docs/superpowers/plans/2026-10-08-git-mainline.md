# Git Mainline Consolidation Implementation Plan

> For agentic workers: use superpowers:executing-plans for inline execution and a final review.

**Goal:** Establish a complete, tested local and GitHub `main` without losing existing history or local files.

**Architecture:** Import the current working platform into an isolated branch based on remote main. Keep old branch tips and dates as history, merge the reviewed baseline through a PR, then switch the original checkout to main only after preserving its changes and verifying identical application content.

**Tech Stack:** Git, GitHub, Python inventory scripts, Node test runner, Docker Compose source files.

**Spec:** User requests consolidation of both local and GitHub mainline; previous discussion selects main as stable baseline, short-lived feature branches, and tags for versions.

## Global Constraints

- Preserve `/index.html` as entry and existing production file contents.
- Preserve all old branches, local ignored/untracked files, and current fixes; no force push, branch deletion, history rewrite, or recursive filesystem deletion.
- Upload source, required runtime assets, tests, deployment files, and documentation only. Exclude copied bundles, interview transcripts/audio, machine secrets, experiment exports and temporary caches.
- Main remains a baseline with disclosed preexisting limitations, not a claim that every optional cloud/GPU feature was live tested.
- Do not change GitHub Pages source or deploy Alibaba as part of Git consolidation.

## Review Focus

- Missing lazy-loaded runtime/vendor files: compare inventory and local asset references.
- Secret or private files entering a public repository: scan candidate paths/content without exposing values.
- Old worker branch fixes absent in learning: compare worker source against deployment branch and preserve relevant source.
- Loss of current uncommitted fixes: retain source SHA manifest and a local backup branch before switching.
- Wrong remote/upstream: fetch without pruning, compare remote main, use expected PR head SHA, and verify main tracks origin/main.

## Tasks

- [ ] Inventory local/remote branches, uncommitted files, old worker source, candidate asset sizes, Pages source, and required references. Save audit evidence locally under ignored `tmp/git-mainline-20261008`.
- [ ] Import a selected complete working tree into managed isolation based on origin/main. Add portable README, Git workflow instructions, ignore rules, and PR template.
- [ ] Verify application SHA continuity, secret exclusions, full JavaScript suite, deployment tests and necessary baseline Python tests. Disclose existing TypeScript/dependency errors without rewriting application behavior.
- [ ] Commit reviewed baseline, push feature branch, create/attach PR, review and merge using the expected head. User explicitly authorized local and GitHub mainline organization; do not stop at a draft PR unless approval tooling blocks integration.
- [ ] Preserve old local working state on a named backup branch, fetch merged main, switch original checkout safely, set upstream correctly, verify clean source tree and local/remote SHA agreement.
- [ ] Add a baseline tag and workflow document; report PR, version, preserved historical branches, excluded local artifacts and any remaining limitations.
