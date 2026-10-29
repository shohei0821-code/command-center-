# COMMAND CENTER

予定とタスクをまとめるGitHub Pages向けのPWAです。通常はタスクと予定をブラウザ内に保存し、任意でCloudflareの同期APIへ接続できます。

## できること

- ホーム、カレンダー、タスク、連携、設定の画面
- タスクの追加、編集、削除、期限、優先度、完了状態の管理
- 予定の追加、編集、削除とICSファイルの読み込み・書き出し
- JSONによる全データのバックアップと復元
- テーマ設定、タスク、予定のlocalStorage保存
- PWAシェルのキャッシュとオフライン時の画面表示
- Cloudflare Worker + D1による端末間同期
- OAuthで保護したChatGPT MCPプラグインAPI（会話からタスク・予定の追加、編集、削除）

Cloudflare同期をセットアップすると、他端末やChatGPT MCPプラグインからタスク・予定を共有できます。Google Tasks・iCloud Calendarへの直接同期は未実装です。サンプル予定は初回データとして追加されます。

## 公開

GitHub Pagesの公開・確認手順は [DEPLOYMENT.md](./DEPLOYMENT.md) を参照してください。連携方式の調査結果は [INTEGRATIONS.md](./INTEGRATIONS.md) に記載しています。

## セキュリティ

Google OAuthのクライアントシークレット、iCloudのアプリ用パスワード、ChatGPT/OpenAIのAPIキーをHTMLやJavaScriptへ記述しないでください。API同期とChatGPT MCP接続の設定は [INTEGRATIONS.md](./INTEGRATIONS.md) を参照してください。
