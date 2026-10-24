# Pseudo CFG

Python 風の疑似コードから制御フローグラフ (CFG) を作る Web アプリです。

- 左: CodeMirror 6 のエディタ。キーバインドとマウス操作は VS Code / Monaco に合わせています。
- 右: ドラッグで編集できるダイアグラム。手で動かしたノードの位置は、コードを編集しても保たれます。
- グラフは PNG としてクリップボードにコピーでき、PNG / SVG でも保存できます。

## 使い方

| 操作                           | 内容                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| ノードをドラッグ               | 位置を調整 (位置はブラウザに保存されます)                          |
| 空白をドラッグ                 | 範囲選択                                                           |
| スクロール / Space + ドラッグ  | パン                                                               |
| ⌘/Ctrl + スクロール            | ズーム                                                             |
| ノードをクリック               | 対応するソース行をハイライト                                       |
| ノードをダブルクリック         | 対応するソース行へ移動                                             |
| ⌘/Ctrl + Z, ⌘/Ctrl + Shift + Z | レイアウトの取り消し / やり直し (キャンバスにフォーカスがあるとき) |
| Tidy up                        | 手動配置を破棄して自動レイアウト                                   |
| Blocks / Statements            | 基本ブロック単位 / 文単位のノード                                  |
| Tab → Enter                    | ノードにフォーカスし、対応するソース行へ移動                       |
| ? (ヘルプ)                     | キャンバスの操作一覧                                               |

エディタ上部の Examples からサンプルを読み込めます。🔗 ボタンは、いまのコードを開くリンクをコピーします (コードは URL のフラグメントに入るので、サーバーには送られません)。
エディタ下部のステータスバーには構文上の問題の件数が出ます。クリックすると一覧が開き、該当行へ移動できます。問題のある行のノードには警告マークが付きます。

グラフでは True / `next` の出口を緑、False / `done` / `raise` の出口を赤のラベルで示し、ループの戻りエッジは破線で描きます。

対応している構文は `def`, `if` / `elif` / `else`, `while` (`else` 付きも可), `for ... in ...` (`else` 付きも可), `break`, `continue`, `return`, `raise` です。
それ以外の行は普通の文として扱います。三重引用符の文字列の中身はコードとして扱いません。
`def` はそれぞれ別のグラフになり、横に並べて配置されます。

### エディタのキーバインド (Monaco 互換)

`⌘D` (次の一致を選択), `⌘⇧L` (一致をすべて選択), `⌥Click` (カーソル追加), `⇧⌥Drag` (矩形選択), `⌘⌥↑/↓` (上下にカーソル追加), `⌥↑/↓` (行移動), `⇧⌥↑/↓` (行複製), `⌘⇧K` (行削除), `⌘/` (コメント切り替え), `⌘K ⌘C` / `⌘K ⌘U`, `⌘Enter` / `⌘⇧Enter`, `⌘]` / `⌘[`, `⌘L`, `⌃⇧⌘→` (選択範囲の拡大), `⌘U` (カーソル操作の取り消し), `⇧⌥I`, `⌘⌥[` / `⌘⌥]` (折りたたみ), `⌘K ⌘0` / `⌘K ⌘J`, `⌘F` / `⌘⌥F` (検索 / 置換), `⌃G` (行へ移動), `⌘I` / `⌃Space` (補完)。

## レイアウトの仕組み

1. ソースを解析して CFG を作ります ([build-cfg.ts](src/features/cfg/build-cfg.ts))。
2. 直前のグラフとノードを対応付け、ID を引き継ぎます ([reconcile.ts](src/features/cfg/reconcile.ts))。同じ内容のノードは最長共通部分列で対応付け、その間に残った同じ種類のノードは「編集されたノード」とみなします。
3. 引き継いだノードは元の位置のまま動かしません。新しいノードは自動レイアウト (dagre) の位置に、隣接ノードが動かされた分のずれを足して置きます。新しいノードや大きくなったノードと重なるノードは、テキストに行を挿入したときのように下へずらします ([layout.ts](src/features/diagram/layout.ts))。

## 開発

```bash
pnpm install
pnpm dev
pnpm check   # format, lint, typecheck, test, react-doctor
```

ディレクトリは機能ごとにまとめています (`src/features/{cfg,editor,diagram,workspace}`)。テストは対象ファイルの隣に置きます。
`src/components/ui` は shadcn/ui の CLI が生成するコンポーネントです。

## セキュリティ

- `pnpm-workspace.yaml` で pnpm のサプライチェーン対策を有効にしています。公開から 7 日未満のバージョンはインストールしない (`minimumReleaseAge`)、provenance が以前より弱くなったパッケージを拒否する (`trustPolicy`)、推移的依存の git / tarball 参照を禁止する (`blockExoticSubdeps`)、許可していない install スクリプトをエラーにする (`strictDepBuilds`, `allowBuilds`) の 4 つです。
- 依存はすべて固定バージョンです。Dependabot も 7 日のクールダウンを置いて更新します。
- GitHub Actions はコミット SHA で固定し、`permissions: {}` を既定にしています。ワークフローは zizmor で検査します。デプロイジョブでは依存キャッシュを使いません。
- 配信は静的アセットのみです (Worker スクリプトなし)。`scripts/write-headers.ts` がビルド時にインラインスクリプトのハッシュを計算し、`'unsafe-inline'` を使わない CSP を `_headers` に書き出します。

## デプロイ (Cloudflare Workers Static Assets)

`main` に push すると [deploy.yml](.github/workflows/deploy.yml) が CI を通したうえでデプロイします。事前に次の設定が必要です。

1. Cloudflare ダッシュボードで「Edit Cloudflare Workers」テンプレートから API トークンを作成します (対象アカウントのみに限定)。
2. GitHub の `production` environment を作り、デプロイ元のブランチを `main` に限定します。
3. 値を登録します。

```bash
gh secret set CLOUDFLARE_API_TOKEN --env production
gh variable set CLOUDFLARE_ACCOUNT_ID --body <account-id>
```

手元からデプロイする場合は `pnpm exec wrangler login` のあと `pnpm cf:deploy` を実行します。
