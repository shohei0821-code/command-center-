# 外部連携の実現方法

現在のPWAは静的サイトです。ローカル保存、JSONバックアップ、ICS入出力を実装していますが、Google Tasks、iCloud、ChatGPTとのサーバー連携はまだ接続していません。

## Google Tasks

Google Tasks APIはOAuth 2.0を使い、読み取り専用の `tasks.readonly` または追加・更新ができる `tasks` スコープを選びます。アプリの公開利用では同意画面やスコープ審査が必要になる場合があります。[Google Tasksの認証スコープ](https://developers.google.com/workspace/tasks/auth)

### 無料枠で始める構成案

GitHub Pagesをフロントに残し、Cloudflare WorkerをHTTPS APIとOAuthコールバック、D1をユーザー・タスク・イベントの保存先にします。OAuthクライアントシークレットはWorker Secretsに置き、ユーザーごとの更新トークンは暗号化してD1に保存します。Workerでログイン状態、本人のデータだけを返す認可、CSRF対策、厳密なCORSを実装します。[Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

2026年10月時点の公表枠では、Workers Freeは1日100,000リクエスト、D1 Freeは1日500万行読み取り・10万行書き込み、合計5GBの保存枠です。日次上限を超えると利用できなくなるため、小規模な個人利用の試作向けであり、将来の料金や枠は変わる可能性があります。[Workers制限](https://developers.cloudflare.com/workers/platform/limits/)、[D1料金と上限](https://developers.cloudflare.com/d1/platform/pricing/)

Google Tasksの読み書きは、必要な権限だけを要求するOAuthでWorkerからAPIを呼び出します。公開アプリではOAuth同意画面やスコープの検証が必要になる場合があります。GoogleのOAuthクライアントシークレットや更新トークンをPWAへ配布しません。

## iCloud Calendar

このCodex環境ではiCloud Calendarコネクタが利用可能ですが、それはChatGPT側の接続であり、このPWAへ認証済みアクセスを渡すものではありません。PWA単体ではApple Accountの資格情報を受け取らず、ICSファイル入出力を提供します。Appleは対応するサードパーティアプリの認可と、非対応アプリ向けのアプリ用パスワードを案内しています。[Appleのサードパーティアプリ設定](https://support.apple.com/en-us/121539)、[アプリ用パスワード](https://support.apple.com/en-us/102654)

自動同期を追加する場合は、Appleがサポートする認可方式を調査したうえでCalDAVを扱うバックエンドを設計し、安全に保管するユーザー認証情報が必要です。アプリ用パスワードが必要な方式では、静的サイトへ入れずサーバー側で暗号化して保護してください。Cloudflareの無料枠でもAPIと小規模データ保存を試作できますが、Apple側の認証・連携制限を先に確認してください。まずはICS手動同期を使い、自動同期を作る段階で認証と同期競合の処理を追加してください。

## ChatGPT

ChatGPTからPWAのデータを直接読むことはできません。将来の連携案は、認証付きのAPIを用意し、ChatGPTのGPT ActionなどからそのAPIを呼ぶ方法です。GPT ActionsにはOpenAPIスキーマと認証方式が必要です。[GPT Actionsの設定](https://help.openai.com/en/articles/9442513-gpt-actions-domain-settings-chatgpt-enterprise)

別案として、OpenAI APIをPWAから直接呼ぶことは避け、サーバー側APIを介します。APIキーをクライアントへ公開しないでください。どちらの場合も、アクセスできるタスク・予定、ユーザー認証、読み書きの確認方法を設計してから実装します。

## 現在の接続状況

- iCloud Calendar：Codex側コネクタが利用可能。PWAの自動同期は未接続。
- Google Tasks：専用コネクタは現在利用可能な接続一覧で確認できず。APIでの独自連携は可能。
- ChatGPT：API連携は未接続。認証付きバックエンドとAction用APIが必要。
- Google Calendar：ChatGPT用コネクタは未接続。PWAはICSによる予定の移動に対応。
