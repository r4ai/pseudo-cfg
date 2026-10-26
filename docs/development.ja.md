# Development & Deployment Guide

[English](development.md) | 日本語

本ガイドでは `Pseudo CFG` のディレクトリ構成、ローカル開発手順、サプライチェーンおよび実行時のセキュリティ対策、Cloudflare Workers Static Assets へのデプロイ手順を解説する。

## Repository Structure

```text
src/
  features/
    cfg/
      parse.ts                # インデントベースの寛容な疑似コードパーサー
      build-cfg.ts            # スコープ別 CFG 構築・到達不能コード検出
      reconcile.ts            # LCS とギャップペアリングによるノード ID 照合
    diagram/
      structured-layout.ts    # スコープごとのスパイン構造化自動レイアウト
      layout.ts               # ノードサイズ計算・複数スコープ配置・差分レイアウト
      edge-route.ts           # 障害物回避の直交エッジルーター・ジャンプ弧・ラベル配置
      geometry.ts             # スコープ別バウンディングボックス計算・ルーティング統合
      shapes.ts               # ひし形・六角形・矩形ノードの SVG 図形定義
      export-image.ts         # 独立ライトテーマ SVG 生成・2倍解像度 PNG ラスタライズ
      cfg-canvas.tsx          # React Flow キャンバス・キーボード移動・Undo / Redo
      cfg-node.tsx            # 診断バッジ付きカスタムノード描画
      cfg-edge.tsx            # カスタム直交エッジ・色分けラベル描画
      diagram-toolbar.tsx     # 粒度切り替え・Tidy up・PNG コピー・SVG / PNG 保存 UI
    editor/
      code-editor.tsx         # CodeMirror 6 ラッパー・Lint ガター・行ハイライト同期
      monaco-keymap.ts        # VS Code / Monaco 互換キーマップ・マルチカーソルマウス操作
      line-highlight.ts       # 選択ノードに対応するソース行のハイライト拡張
      editor-theme.ts         # ライト / ダーク対応エディタテーマ
    workspace/
      workspace.tsx           # リサイズ可能な左右分割ペイン・Examples・共有リンクボタン
      workspace-state.ts      # 編集・ノード移動・粒度変更・Undo / Redo の状態 Reducer
      use-workspace.ts        # Reducer の配線と、変更を開いているファイルへ渡す処理
      files.ts                # 保存ファイルの純粋な操作（作成・名前変更・削除・更新順）
      use-files.ts            # ファイルの localStorage 永続化・共有リンクをファイルとして開く処理
      file-menu.tsx           # ファイルの切り替え・新規作成・名前変更・削除メニュー
      share.ts                # `#code=...` 共有 URL の Base64url エンコード / デコード
      problems-status.tsx     # 構文エラー・到達不能コードを表示する下部ステータスバー
      sample.ts               # 組み込みサンプル疑似コード集
  components/ui/              # shadcn/ui コンポーネント群 (Base UI + Tailwind CSS v4)
  pages/                      # Waku 静的ページエントリ (`_root.tsx`, `_layout.tsx`, `index.tsx`)
scripts/
  write-headers.ts            # インラインスクリプトの SHA-256 ハッシュ計算と `_headers` CSP 生成
```

単体テスト（`*.test.ts`）は `src/features/` 内の各対象ファイルの隣に配置する。

## Local Development

### Prerequisites

- Node.js `>= 24.0.0`（`.node-version` 参照）
- pnpm `>= 12.14.0`

### Commands

```bash
pnpm install
pnpm dev       # Waku 開発サーバーを起動
pnpm check     # 全チェックを一括実行 (format, lint, typecheck, test, react-doctor)
```

| コマンド            | 説明                                                                   |
| :------------------ | :--------------------------------------------------------------------- |
| `pnpm dev`          | ローカル開発サーバーを起動                                             |
| `pnpm build`        | Waku で静的アセットをビルドし、`dist/public/_headers` を生成           |
| `pnpm test`         | Vitest 単体テストを実行（ウォッチモードは `pnpm test:watch`）          |
| `pnpm format`       | `oxfmt` でコードを整形（検査のみは `pnpm format:check`）               |
| `pnpm lint`         | `oxlint --deny-warnings` で静的解析（自動修正は `pnpm lint:fix`）      |
| `pnpm typecheck`    | TypeScript の型チェック（`tsc`）を実行                                 |
| `pnpm react-doctor` | `react-doctor` による React コンポーネント診断を実行                   |
| `pnpm check`        | `format:check`・`lint`・`typecheck`・`test`・`react-doctor` を連続実行 |

## Security Hardening

### pnpm Supply-Chain Policy (`pnpm-workspace.yaml`)

- **公開経過日数の制限（`minimumReleaseAge: 10080`）**
  - 公開から7日未満のパッケージバージョンのインストールを拒否
- **来歴証明のダウングレード防止（`trustPolicy: no-downgrade`）**
  - 過去バージョンより provenance / trusted-publisher の信頼性が低下したパッケージを拒否
- **外部参照の禁止（`blockExoticSubdeps: true`）**
  - 推移的依存パッケージにおける git リポジトリや tarball URL の直接参照を禁止
- **インストールスクリプトの厳格化（`strictDepBuilds: true`）**
  - `allowBuilds`（`esbuild`・`workerd`）で明示許可していない install スクリプトをエラーとして拒否
- **バージョンの完全固定（`savePrefix: ""`）**
  - 全依存パッケージを固定バージョンで管理し、Dependabot も7日間のクールダウン後に更新

### CI / GitHub Actions Hardening

- すべての GitHub Actions をコミット SHA で固定
- ワークフローの既定権限を `permissions: {}` とし、`zizmor` で静的検査を実施
- 本番デプロイジョブでは依存キャッシュを無効化し、キャッシュ汚染による認証情報の漏洩を防止

### Static Delivery & Hash-Based CSP (`scripts/write-headers.ts`)

- サーバーサイドの Worker スクリプトを持たず、Cloudflare Workers Static Assets から静的アセットのみを配信
- `pnpm build` 時に `scripts/write-headers.ts` が `dist/public` 内の全 HTML を走査し、インライン `<script>` の SHA-256 ハッシュを算出して `script-src` に `'unsafe-inline'` を使わない厳格な CSP を `dist/public/_headers` に出力

## Deployment (Cloudflare Workers Static Assets)

`main` ブランチへ push すると [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) が CI 通過後に自動デプロイを実行する。

### Initial Repository Setup

1. Cloudflare ダッシュボードで **Edit Cloudflare Workers** テンプレートから対象アカウント限定の API トークンを作成
2. GitHub リポジトリに `main` ブランチ限定の `production` Environment を作成
3. シークレットと変数を登録

```bash
gh secret set CLOUDFLARE_API_TOKEN --env production
gh variable set CLOUDFLARE_ACCOUNT_ID --body <account-id>
```

### Manual Local Deployment

```bash
pnpm exec wrangler login
pnpm cf:deploy
```
