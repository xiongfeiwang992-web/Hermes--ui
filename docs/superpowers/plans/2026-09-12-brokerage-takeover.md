# Open Real Estate Brokerage System Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development for isolated delivery work; integrate existing branches sequentially. Track completed work and verification here.

**Goal:** Deliver the existing real-estate brokerage application with its outstanding local business features integrated, the requested product name, and a verified Windows/browser launch path.

**Architecture:** Retain Electron, the TypeScript domain API, SQLite migrations, and the existing Chinese operational UI. Preserve the upstream main branch and recover the independent Cursor feature changes into an integration branch. Keep real third-party services disabled until actual provider credentials and integration specifications exist.

**Tech Stack:** TypeScript, Electron, SQLite/better-sqlite3, Vite, Node.js.

**Spec:** `docs/自研中介系统-开发总文档.md`, `docs/MVP需求规格.md`, and the user's requested product name.

## Global Constraints

- Product display name: `Open Real Estate Brokerage System`.
- GitHub repository slug: `Open-Real-Estate-Brokerage-System`.
- Keep Chinese business labels, four roles, store isolation, private customers, confidential listings, approval separation, and audit history.
- Preserve all recovered source branches and existing user files.
- Public GitHub rename/push requires an authenticated repository owner; never claim a remote change without verification.
- Do not claim provider services, legal electronic signatures, production security certification, or unattended upgrades that have not been implemented and tested.

## Task 1: Recover Independent Feature Changes

Files: existing `server/domain/`, `server/route/dispatch.ts`, `renderer/app/main.ts`, migrations, feature smoke scripts, package scripts, and implementation documentation.

- [x] Clone all 224 Cursor branches and inspect their merge bases.
- [x] Create local `codex/complete-brokerage-system` from `origin/main`.
- [ ] Integrate independent feature deltas. Skip the historical setup/theme branches and already-squashed MVP/payment history after recording why.
- [ ] Resolve overlapping source edits deliberately; retain each feature's focused smoke test.
- [ ] Consolidate package scripts structurally and run every feature smoke script, not only the old `health` command.
- [ ] Compile server, Electron, and renderer; fix actual integration failures.

Verification: `npm run build`; run `tsx` on each `scripts/*smoke.ts` plus `scripts/smoke.ts` against its isolated test database. Record exit status and assertion totals, not the stale totals from upstream documentation.

## Task 2: Working Local Delivery and Branding

Files: `server/http.ts`, HTTP server helper, `scripts/dev.ts`, new web launcher script, Electron entrypoints, `renderer/index.html`, branding strings, package metadata, and startup tests.

Interfaces: preserve POST `/api/call` JSON `{ action, payload }` and Bearer token authentication; keep `/health`; preserve legacy `WEILAIJIA_*` settings when adding new naming.

- [ ] Give the app the requested name without changing Chinese business copy.
- [ ] Make the built web application serve UI and API together on loopback with a configurable port.
- [ ] Make the desktop launch start its backend and close owned resources on exit.
- [ ] Replace fixed startup delays with actual readiness and useful failure output.
- [ ] Provide explicit demonstration data initialization; never overwrite an existing database.
- [ ] Verify health, a real login, static assets, shutdown, and port conflict behavior.

## Task 3: Acceptance and Handoff

- [ ] Exercise login, property/customer recording, viewing, transaction approval and collection with role boundaries.
- [ ] Inspect desktop and narrow browser layouts, resolve overlapping controls and long product text.
- [ ] Publish accurate installation, verification, external-dependency and feature-integration records.
- [ ] Rename the GitHub repository after owner login; update `origin` only after successful rename.
- [ ] Commit reviewable work, retain source recovery artifacts, and provide a working local URL.

## Execution Record

2026-09-12: main is `bfde1ba`; it has five squashed commits. There are 222 open PRs and 224 Cursor branches. Most feature branches contain independent edits from the same main commit, so one branch does not include the others. GitHub web and CLI were signed out at initial check. User is completing web sign-in while local implementation continues.
