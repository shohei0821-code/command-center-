# COMMAND CENTER

暗色のSF風デザインを採用した、予定・タスク管理用のPWAフロントエンドです。

## UIでできること
- ホーム / カレンダー / タスク / 連携 / 設定の画面切替
- サンプルタスクの完了チェック、絞り込み、追加
- 予定追加フォーム
- ダーク / ライト表示切替
- localStorageを使った同じブラウザ内での状態保存
- PWAマニフェストとサービスワーカーによるアプリ表示・シェルキャッシュ
- iPhone / Mac向けレスポンシブ表示

## 公開
GitHub Pagesの手順は [`DEPLOYMENT.md`](./DEPLOYMENT.md) を参照してください。`.github/workflows/pages.yml` がActions経由のデプロイを行います。

## 未実装
- iCloud Calendar / Google Tasksの実認証・同期
- 端末間のデータ同期とサーバー保存
- プッシュ通知・定時通知
- ChatGPT API連携

画面の予定・タスクはサンプルデータです。実際の予定として扱わないでください。APIキーなどの秘密情報はこの静的アプリへ入れないでください。
