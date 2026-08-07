# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single product, **Hermes UI**: a vanilla TypeScript + Vite theme system and demo chat shell. There is no backend, database, or auth — settings persist in the browser `localStorage`. The npm package lives in `ui/`; the root `package.json` only proxies scripts into `ui/` via `--prefix ui`.

Run everything from the repo root (scripts delegate to `ui/`):

- Dev server: `npm run dev` → Vite on `http://localhost:5173/`.
- Tests: `npm test` → Vitest (`vitest run`), Node env, no server needed.
- Build: `npm run build` → outputs to `ui/dist/`.
- Preview built assets (optional): `npm run preview` → Vite preview on port `4173`.

Non-obvious gotchas:

- There is **no lint or typecheck script**. The quality gates are `npm test` and `npm run build`.
- Do **not** rely on a bare `npx tsc --noEmit` as a check: the source imports modules with explicit `.ts` extensions (resolved by Vite's bundler), so `tsc` reports `TS5097 allowImportingTsExtensions` and DOM `dataset` errors even though the app builds and runs fine. This is expected, not a regression.
- The full implementation historically lived on a feature branch; if `main` only contains `README.md`, the code has not been merged yet. The update script guards against `ui/package.json` being absent so it stays safe on the current repo state.
