# COMMAND CENTER — 公開と更新

このリポジトリはルートの静的ファイルをGitHub ActionsからGitHub Pagesへ公開します。

## 初回公開

1. GitHubリポジトリの **Settings → Pages** を開きます。
2. Build and deployment の Source を **GitHub Actions** に設定します。
3. `main` ブランチへ変更をpushするか、Actionsタブから `Deploy COMMAND CENTER to GitHub Pages` を手動実行します。
4. Actionsの実行が成功したら、`https://shohei0821-code.github.io/command-center-/` を開きます。
5. iPhoneではSafariの共有メニューから「ホーム画面に追加」を選びます。

## 更新後の確認

- `pages.yml` のActions実行が成功したことを確認します。
- 公開画面を再読み込みし、レイアウト・追加操作が動くことを確認します。
- 古いアプリ表示が残る場合は一度オンラインで開いて更新を待ちます。Service Workerは新しいシェルへ切り替わります。

## 保存について

データは利用中のブラウザのlocalStorageに保存され、同じブラウザではオフラインでも閲覧・編集できます。端末間の同期はないため、設定画面のJSONバックアップを定期的に保存してください。カレンダーはICSで入出力できます。

公開設定やドメインの状態によって、PagesのURLが利用できないことがあります。その場合はリポジトリのSettings → PagesとActionsのエラーを確認してください。
