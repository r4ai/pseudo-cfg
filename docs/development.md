# Development & Deployment Guide

English | [日本語](development.ja.md)

This guide covers local development, codebase organization, supply-chain and runtime security hardening, and deployment to Cloudflare Workers Static Assets.

## Repository Structure

```text
src/
  features/
    cfg/
      parse.ts                # Forgiving indentation-based pseudocode parser
      build-cfg.ts            # Scope-based CFG builder & unreachable-code detector
      reconcile.ts            # LCS & gap-based node ID reconciliation
    diagram/
      structured-layout.ts    # Spine-based structured auto-layout per scope
      layout.ts               # Node sizing, multi-scope arrangement & incremental placement
      edge-route.ts           # Obstacle-avoiding orthogonal router, hops & label placement
      geometry.ts             # Per-scope bounding box & edge routing orchestration
      shapes.ts               # SVG polygon / rect geometry for diamond, hexagon & block nodes
      export-image.ts         # Standalone light-theme SVG generator & 2x PNG rasterizer
      cfg-canvas.tsx          # Interactive React Flow canvas, keyboard moves & undo/redo
      cfg-node.tsx            # Custom node renderer with diagnostic badges
      cfg-edge.tsx            # Custom orthogonal edge & tinted label renderer
      diagram-toolbar.tsx     # Granularity toggle, Tidy up, PNG copy & SVG/PNG export UI
    editor/
      code-editor.tsx         # CodeMirror 6 wrapper, lint gutter & bidirectional line sync
      monaco-keymap.ts        # VS Code / Monaco keyboard shortcuts & multi-cursor mouse bindings
      line-highlight.ts       # State effect for highlighting lines selected in the diagram
      editor-theme.ts         # Light / dark syntax & gutter theme
    workspace/
      workspace.tsx           # Resizable split-pane layout, Examples menu & share link button
      workspace-state.ts      # Pure reducer for edits, node moves, granularity & layout undo/redo
      use-workspace.ts        # Reducer wiring that hands each change to the open file
      files.ts                # Pure operations on saved files (create, rename, delete, recency)
      use-files.ts            # localStorage persistence of files & opening shared links as files
      file-menu.tsx           # File switcher with new / rename / delete
      share.ts                # Base64url encoding/decoding for `#code=...` share URLs
      problems-status.tsx     # Footer status bar for syntax & reachability diagnostics
      sample.ts               # Built-in example pseudocode snippets
  components/ui/              # shadcn/ui primitives (Base UI + Tailwind CSS v4)
  pages/                      # Waku static entry pages (`_root.tsx`, `_layout.tsx`, `index.tsx`)
scripts/
  write-headers.ts            # Post-build SHA-256 inline script hash calculator for `_headers` CSP
```

Unit tests (`*.test.ts`) live alongside the modules they test under `src/features/`.

## Local Development

### Prerequisites

- Node.js `>= 24.0.0` (see `.node-version`)
- pnpm `>= 12.14.0`

### Commands

```bash
pnpm install
pnpm dev       # Start Waku dev server
pnpm check     # Run all checks (format, lint, typecheck, test, react-doctor)
```

| Script              | Description                                                             |
| :------------------ | :---------------------------------------------------------------------- |
| `pnpm dev`          | Start the local Waku development server                                 |
| `pnpm build`        | Build static assets with Waku and generate `dist/public/_headers`       |
| `pnpm test`         | Run the Vitest test suite once (`pnpm test:watch` for watch mode)       |
| `pnpm format`       | Format files with `oxfmt` (`pnpm format:check` to verify)               |
| `pnpm lint`         | Lint with `oxlint --deny-warnings` (`pnpm lint:fix` to auto-fix)        |
| `pnpm typecheck`    | Run TypeScript type checking (`tsc`)                                    |
| `pnpm react-doctor` | Run `react-doctor` static checks on React components                    |
| `pnpm check`        | Execute `format:check`, `lint`, `typecheck`, `test`, and `react-doctor` |

## Security Hardening

### pnpm Supply-Chain Policy (`pnpm-workspace.yaml`)

- **Release age gate (`minimumReleaseAge: 10080`)**
  - Refuses package versions published less than 7 days ago
- **Provenance enforcement (`trustPolicy: no-downgrade`)**
  - Fails installation if a package loses provenance or trusted-publisher status compared to an earlier version
- **Exotic dependency ban (`blockExoticSubdeps: true`)**
  - Blocks git and raw tarball URLs in transitive dependencies
- **Strict install scripts (`strictDepBuilds: true`)**
  - Rejects unapproved lifecycle install scripts unless explicitly listed in `allowBuilds` (`esbuild`, `workerd`)
- **Exact version pinning (`savePrefix: ""`)**
  - Pins all dependencies to exact versions; Dependabot updates also apply a 7-day cooldown

### CI / GitHub Actions Hardening

- All GitHub Actions are pinned to full commit SHAs
- Workflows default to `permissions: {}` and are audited with `zizmor`
- The production deployment job disables dependency caching so a poisoned cache cannot reach credentials

### Static Delivery & Hash-Based CSP (`scripts/write-headers.ts`)

- Deployed as pure static files on Cloudflare Workers Static Assets with no server-side Worker script
- During `pnpm build`, `scripts/write-headers.ts` scans all generated HTML files in `dist/public`, computes SHA-256 hashes of Waku's inline bootstrap scripts, and writes a strict `Content-Security-Policy` to `dist/public/_headers` without `script-src 'unsafe-inline'`

## Deployment (Cloudflare Workers Static Assets)

Pushing to `main` triggers [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), which runs the CI suite and deploys `dist/public` to Cloudflare.

### Initial Repository Setup

1. Create a Cloudflare API token using the **Edit Cloudflare Workers** template, scoped to the target account
2. Create a GitHub Environment named `production` restricted to the `main` branch
3. Register the token and account ID in the `production` environment:

```bash
gh secret set CLOUDFLARE_API_TOKEN --env production
gh variable set CLOUDFLARE_ACCOUNT_ID --body <account-id>
```

### Manual Local Deployment

```bash
pnpm exec wrangler login
pnpm cf:deploy
```
