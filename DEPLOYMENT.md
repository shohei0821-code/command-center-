# COMMAND CENTER — 公開手順

このZIPはGitHub Pagesへ公開できる静的PWAのデプロイ用パッケージです。

## GitHub Pagesで公開する手順

1. ZIPを展開します。
2. 展開したファイルと `.github` フォルダーの中身を、対象リポジトリの**ルート**に配置します。`index.html` がリポジトリ直下にある状態にしてください。
3. 変更を `main` ブランチへ push します。
4. GitHubリポジトリの **Settings → Pages** を開き、Build and deployment の Source を **GitHub Actions** に設定します。
5. **Actions** タブで `Deploy COMMAND CENTER to GitHub Pages` の実行が完了するのを待ちます。
6. デプロイされた `https://<owner>.github.io/<repository>/` をSafariで開きます。
7. iPhoneではSafariの共有メニューから「ホーム画面に追加」を選びます。

## 注意点

- このパッケージを作成しただけでは公開されません。GitHubへのアップロードとPagesの有効化が必要です。
- このバージョンは静的なPWAです。サンプル予定・タスクを表示します。localStorageは端末・ブラウザごとの保存であり、端末間同期ではありません。
- iCloud Calendar / Google Tasksの認証・同期、通知、チャッピーによる外部操作は未実装です。
- 秘密鍵、APIキー、パスワードを静的ファイルに入れないでください。
- Pagesの公開URLはリポジトリの公開範囲とGitHubの設定に依存します。
