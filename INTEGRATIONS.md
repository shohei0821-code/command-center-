# 同期・会話操作のセットアップ

Command Centerは通常、端末内にタスクと予定を保存します。`worker/` にはCloudflare Worker + D1の個人用同期APIと、OAuthで保護したChatGPT MCP接続口を用意しています。APIを一度公開すると、複数端末のPWAとChatGPTから同じタスク・予定を読み書きできます。Google TasksとiCloud Calendarへの直接同期は別機能で、このAPIはそれらへ自動転送しません。

このリポジトリはCloudflare Workers Buildsに接続し、`main` ブランチの変更を `/worker` から `npx wrangler deploy` で反映する構成です。`worker/wrangler.toml` には本番D1データベースIDを設定済みです。`API_TOKEN` などの秘密情報はCloudflareのWorker Secretsに保存し、リポジトリには置きません。

## CloudflareへAPIを公開する

この手順はCloudflareアカウントが必要です。現行のFree枠は小規模な個人利用の試作に足ります。公表上の上限はWorkersが1日10万リクエスト、D1が1日500万行読み取り・10万行書き込み・合計5GBです。D1の日次上限を超えると、その日の残りはクエリが失敗するため、利用量はCloudflareダッシュボードで確認してください ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/))。

1. Node.jsを用意し、ターミナルで `npx wrangler login` を実行してCloudflareへログインします。
2. `npx wrangler d1 create command-center` を実行します。表示されたデータベースIDを `worker/wrangler.toml` の `database_id` に入れます。
3. リポジトリのルートから `npx wrangler d1 execute command-center --remote --file=worker/schema.sql --config worker/wrangler.toml` を実行し、保存領域を作ります。
4. 同期キーを用意します。Macなら `openssl rand -hex 32` でランダムな値を作れます。これを公開HTMLやGitHubへ貼らないでください。
5. `npx wrangler secret put API_TOKEN --config worker/wrangler.toml` を実行し、同期キーを入力してWorkerの秘密情報として保存します。これはPWAの端末同期に使います。
6. まず `npx wrangler deploy --config worker/wrangler.toml` を実行します。表示された `https://...workers.dev` のURLがAPIホストです。OAuth情報をまだ登録していないため、この時点ではMCP接続は有効になりません。
7. ChatGPT接続用に、MCP OAuth仕様に対応する既存の認証プロバイダーを用意します。プロバイダーはAuthorization Code + PKCE、`cc:read` と `cc:write` のスコープ、MCPリソースをトークンのaudienceへ反映する機能をサポートする必要があります。認証を許す利用者は自分のアカウントだけに制限してください。OpenAI公式ガイドは独自OAuth実装より既存の認証プロバイダー利用を推奨しています ([MCP authentication](https://developers.openai.com/plugins/build/auth))。
8. 認証プロバイダーから発行者URL、MCP APIのaudience（`https://<worker-host>/mcp`）、JWKS URLを確認し、次をそれぞれ実行して値をCloudflareへ保存します: `npx wrangler secret put AUTH_ISSUER --config worker/wrangler.toml`、`npx wrangler secret put AUTH_AUDIENCE --config worker/wrangler.toml`、`npx wrangler secret put AUTH_JWKS_URL --config worker/wrangler.toml`。これらはHTMLやJavaScriptに入れません。
9. `npx wrangler deploy --config worker/wrangler.toml` をもう一度実行して設定を反映します。
10. Command Centerの「設定」へAPIホストURLと同期キーを入力し、「接続を確認」を押します。続けて初回だけ「この端末から送る」か「クラウドから受け取る」を選びます。選択した側の内容で反対側を置き換える前に確認が表示されます。
11. ChatGPTのWeb画面で Plugins から「Add custom MCP server」を選び、URLに `https://<worker-host>/mcp` を登録します。表示されたOAuth callback URLを認証プロバイダーの許可リストへ加え、OAuthで接続し、`list_tasks` などの読み書きツールを有効にします。書き込み操作にはChatGPTの確認設定が適用されます ([custom MCP server setup](https://developers.openai.com/api/docs/guides/custom-mcp-server))。

同期を開始した後、PWAの変更は自動でクラウドへ保存され、他端末やChatGPT MCPプラグインからの変更は表示中に最大20秒ほどで反映されます。端末ごとにURLと同期キーを一度設定します。同期キーは設定したブラウザのlocalStorageに保存されるため、自分専用の端末でのみ使ってください。タスク・予定のJSONバックアップも継続して利用してください。

### 同期競合

複数の端末が同時に変更した場合、古い内容で新しい内容を黙って上書きしないよう同期を一時停止します。設定画面でクラウドから受け取るか、この端末から送るかを選び直してください。クラウドから受け取ると、この端末にだけ存在する変更は置き換わるため、先にJSONバックアップを保存してください。

## 会話から操作する

ChatGPT MCPプラグインはOAuthでPWA同期用のキーと分離されています。サーバーのMCPツールは次の操作を提供します:

- タスクと予定の一覧表示
- タスクと予定の追加・編集・削除
- 各アイテムの日付、時刻、優先度、分類などの指定

接続後はChatGPTの会話でCommand Centerプラグインを選び、「来週火曜までに企画書を出すタスクを追加」のように依頼します。曖昧な日付や対象を確認し、削除前に確認するようツール説明にも記載しています。ChatGPT公式ガイドによると、MCPサーバーへの書き込み操作は既定で確認を求めます。

`worker/openapi.yaml` はREST APIの説明で、GPT Actionsに対応した環境でのみ一時的な互換性に使えます。OpenAIの現行告知では、Custom GPTは移行対象で、標準の提供終了予定は2026年12月11日です。長期利用はMCPプラグインを優先してください ([Custom GPT transition](https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts))。

## 現時点で接続している外部サービス

- **iCloud Calendar**: ChatGPT/Codex側のiCloud Calendarコネクタが利用可能です。Command Center Workerとの直接同期は未実装です。PWAではICSの読み込み・書き出しを使えます。
- **Google Tasks**: ChatGPT側のTasksBoard接続からタスクリストを確認できます。Command Center Workerとの直接同期は未実装です。ChatGPT側の操作とPWAの同期は別々の接続です。
- **Command Center API**: MCPプラグインをOAuth接続すれば、会話からCommand Centerのタスク・予定を操作できます。

Google TasksやiCloudへ直接同期する場合は、Google OAuthまたはAppleがサポートするCalDAV認証を別途実装する必要があります。認証情報はWorker Secretsまたは暗号化されたサーバー側ストレージに置き、PWAのHTML/JavaScriptに埋め込みません。

## APIセキュリティ

- APIは1つの同期キーで保護する個人用構成です。キーを知る人は全データを読み書きできます。
- ブラウザからのアクセスは、このGitHub Pagesオリジンとlocalhostだけを許可します。ChatGPT MCPの認証はPWA同期キーとは別のOAuthトークンです。
- APIはBearer認証、リクエストサイズ上限、日付・時刻・優先度の検証、更新リビジョン確認を実施します。
- 同期キーを紛失した場合はWorker secretを新しい値へ変更し、各PWA端末の設定も更新します。
- 公開前にCloudflareアカウントと対象リポジトリが本人のものであることを確認してください。
