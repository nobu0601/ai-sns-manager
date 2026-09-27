# AI SNS Manager

X・Instagram・Threads への投稿を一元管理する Web アプリです。
最終的には「SNS 運用そのものを AI が支援・自動化するプラットフォーム」を目指します。

> **現在の状態：Phase 1（MVP）完了＋SNS 実投稿に対応。** 各 SNS の APIキーを登録すると、X・Instagram・Threads へ実際に投稿できます（`SOCIAL_PROVIDER_MODE=live`）。
> 初期設定は **Mock モード**（実際の SNS には投稿しない）です。
> AI による投稿生成は Phase 2、画像・動画生成は Phase 3 で実装予定です（→ [ロードマップ](#ロードマップと未実装機能)）。

---

## 概要

| 項目 | 内容 |
| --- | --- |
| Frontend | Next.js 15（App Router）/ React 19 / TypeScript / Tailwind CSS 4 |
| Backend | Next.js Route Handlers / TypeScript |
| DB | PostgreSQL 16 + Prisma 6 |
| 認証 | Auth.js v5（メールアドレス + パスワード。パスワードは bcrypt でハッシュ化） |
| ジョブキュー | Redis + BullMQ（投稿は必ず Worker が非同期で実行） |
| テスト | Vitest（単体・統合）/ Playwright（E2E） |

基本操作は 5 ステップです：**① 投稿を作る → ②（Phase 2）AI に案を作らせる → ③ 採用・承認 → ④ 投稿日時を決める → ⑤ 投稿する**

## 機能（Phase 1）

- **ログイン / ユーザー登録**（メールアドレス + パスワード）
- **ダッシュボード**：接続 SNS、今日の投稿、予約投稿、今月の投稿、投稿成功率、最近の投稿
- **SNS アカウント管理**：APIキーを入力して連携。**同じ SNS に複数アカウント**を登録可能。キーの確認・更新・切断（SNS のパスワードは不要・保存しない。キーは AES-256-GCM で暗号化保存し、画面には末尾4文字のみ表示）
- **複数アカウントへの投稿**：投稿ごとに投稿先アカウントを選択。アカウントごとに本文を変えることも可能
- **投稿作成・編集**：タイトル、テーマ、ブランド、対象 SNS、SNS ごとの本文、文字数チェック
- **承認**：投稿モード「常に承認（初期値）/ AI 生成後のみ承認 / 完全自動」。承認・却下
- **予約投稿 / 今すぐ投稿**：BullMQ の遅延ジョブで実行。Web リクエスト内では投稿しない
- **自動リトライ**：一時的なエラーは 30 秒後 → 2 分後に再試行（最大 3 回）。認証・権限・内容エラーは再試行しない
- **二重投稿防止**：`postId:platform` を冪等キーにしてジョブ ID と状態遷移で保護
- **カレンダー**：月表示（月曜始まり・日本時間）
- **投稿一覧・履歴**：状態で絞り込み、SNS 別の成功/失敗表示
- **投稿ログ**：作成・承認・予約・投稿開始・成功・失敗・リトライを記録（秘密情報はマスク）
- **ブランド設定**：ブランド名、説明、ターゲット、トーン、キーワード、禁止ワード、投稿テーマの柱など（Phase 2 の AI 生成で使用）
- **Mock モード**：SNS API を呼ばずに、キー確認・投稿成功・失敗をシミュレーション

## スクリーンショット

| ダッシュボード | 投稿作成 |
| --- | --- |
| ![ダッシュボード](docs/screenshots/dashboard.png) | ![投稿作成](docs/screenshots/post-new.png) |

| 投稿一覧・履歴 | カレンダー |
| --- | --- |
| ![投稿一覧](docs/screenshots/posts.png) | ![カレンダー](docs/screenshots/calendar.png) |

| SNS アカウント | 設定 |
| --- | --- |
| ![SNSアカウント](docs/screenshots/accounts.png) | ![設定](docs/screenshots/settings.png) |

リトライ中の投稿詳細（ユーザーには分かりやすいエラー文、詳細はログへ）：

![リトライ中の投稿](docs/screenshots/post-retry.png)

## セットアップ

必要なもの：Node.js 20 以上、PostgreSQL、Redis（Docker があれば `docker compose` で両方起動できます）。

```bash
git clone <このリポジトリ>
cd ai-sns-manager
npm install

# 環境変数
cp .env.example .env
# AUTH_SECRET と ENCRYPTION_KEY を生成して .env に書く
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → ENCRYPTION_KEY
```

Windows（PowerShell）で `openssl` が無い場合：

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

## 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL 接続文字列 |
| `REDIS_URL` | ✅ | Redis 接続文字列 |
| `AUTH_SECRET` | ✅ | Auth.js のセッション署名キー |
| `AUTH_URL` | 本番 | 公開 URL |
| `AUTH_TRUST_HOST` | 本番 | リバースプロキシ配下なら `true` |
| `ENCRYPTION_KEY` | ✅ | SNS の APIキーを暗号化するキー（32 バイトの base64） |
| `SOCIAL_PROVIDER_MODE` | | `mock`（初期値・実際には投稿しない）/ `live`（登録した APIキーで実際に投稿） |
| `MOCK_TRANSIENT_FAILURE_RATE` | | Mock で一時失敗させる割合（0〜1）。リトライ確認用 |
| `ANTHROPIC_API_KEY` | | Claude の APIキー。AI 投稿生成（Phase 2）で使用。設定状況は「設定」画面で確認できる |
| `THREADS_API_VERSION` / `INSTAGRAM_API_VERSION` | | Meta Graph API のバージョン指定（任意。空ならアプリの既定） |
| `FAL_KEY` | | 画像・動画生成（Phase 3）で使用予定 |
| `TEST_DATABASE_URL` | | 設定すると DB を使う統合テストが実行される |

`.env` は Git 管理対象外です。API キーをソースコードに書かないでください。

## DB 構築

```bash
docker compose up -d        # PostgreSQL と Redis を起動（Docker を使う場合）
npm run db:migrate          # マイグレーション適用 + Prisma Client 生成
npm run db:seed             # 開発用サンプル（demo@example.com / demo-password、ブランド「Lounge+」）
```

サンプルデータは `isSample` フラグ付きで作成され、本番環境（`NODE_ENV=production`）では投入されません。
テーブル設計は [docs/database.md](docs/database.md) を参照してください。

## Redis

予約投稿は BullMQ（Redis）の遅延ジョブで実行します。**Web サーバーとは別に Worker プロセスが必要です。**

```bash
npm run worker
```

Worker は起動時に「DB では予約中なのにキューにジョブが無い」投稿を再登録します（Redis のデータ消失対策）。

## SNS API 設定

SNS のキーは `.env` ではなく、アプリの **「SNSアカウント」画面**からアカウントごとに登録します。
「連携する」を押すと、入力したキーで SNS に問い合わせてアカウント名を取得し、確認できたものだけを暗号化して保存します。
同じ SNS に複数のアカウントを登録でき、投稿作成画面で投稿先のアカウントを選べます。

| SNS | 入力するキー | 取得場所・条件 |
| --- | --- | --- |
| X | API Key / API Key Secret / Access Token / Access Token Secret | X 開発者ポータルのアプリの「Keys and tokens」。アプリの権限を **Read and Write** にしてから Access Token を発行する。投稿 API の利用には X API の有料プランが必要な場合がある（最新の料金・上限は開発者ポータルで確認） |
| Threads | アクセストークン（長期） | Meta for Developers で Threads のユースケースを持つアプリを作成し、`threads_basic`・`threads_content_publish` の権限でトークンを発行 |
| Instagram | アクセストークン（長期） | プロアカウント（ビジネス／クリエイター）のみ。「Instagram ログインを使った Instagram API」でアプリを作成し、`instagram_business_basic`・`instagram_business_content_publish` の権限でトークンを発行 |

- Threads・Instagram の長期アクセストークンには有効期限があります。期限が切れると投稿が「接続が切れています」で失敗し、アカウントが「再認証が必要」になります。新しいトークンを発行して「キーを更新」で入れ直してください
- Instagram は画像なしでは投稿できません。投稿作成画面で **https:// の公開画像 URL** を入力してください（画像のアップロード機能は Phase 3 で対応予定）
- 実際に投稿するには `.env` の `SOCIAL_PROVIDER_MODE=live` にして、Web と Worker を再起動します。Mock モードで登録したアカウントは live では使えないため、live で登録し直してください

各 SNS の API の呼び出し方と確認元は [docs/social-api.md](docs/social-api.md) を参照してください。

### Mock モード（開発・テスト用）

- キーには任意の文字列を入力できます（`invalid` を含めると「無効なキー」として扱われます）。同じキーは同じアカウント、違うキーは別アカウントになります
- 投稿本文に次のタグを入れると失敗を再現できます
  - `#mock-auth-error`：接続切れ（再試行せず失敗、アカウントは「再認証が必要」に）
  - `#mock-content-error`：投稿内容エラー（再試行せず失敗）
  - `#mock-transient-error`：一時的な障害（30 秒 → 2 分と再試行し、3 回目で失敗）

## AI API 設定

Phase 2 で Claude（Anthropic）による投稿生成を実装予定です。`.env` の `ANTHROPIC_API_KEY` にキーを設定してください（設定済みかどうかは「設定」画面に表示されます）。
現在 `POST /api/posts/:id/generate` は 501 を返します。プロンプトは `prompts/` に分離して管理します。

## 開発方法

```bash
npm run dev      # http://localhost:3000
npm run worker   # 別ターミナルで Worker を起動
```

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run worker` | 投稿 Worker |
| `npm run lint` | ESLint |
| `npm run typecheck` | 型チェック |
| `npm test` | 単体・統合テスト（Vitest） |
| `npm run test:e2e` | E2E テスト（Playwright） |
| `npm run build` | 本番ビルド |
| `npm run db:studio` | Prisma Studio で DB を確認 |

設計の詳細：[アーキテクチャ](docs/architecture.md) / [API](docs/api.md) / [DB](docs/database.md)。
開発ルールは [CLAUDE.md](CLAUDE.md) にまとめています。

## テスト

```bash
npm test
```

- **単体テスト**：キー暗号化、各 SNS の Adapter（X の OAuth 署名・Threads・Instagram の呼び出し手順を偽のサーバーで確認）、Mock SNS Adapter、投稿バリデーション、予約日時・カレンダー計算、リトライ間隔、状態集計、ログのマスク
- **統合テスト**（`TEST_DATABASE_URL` / `REDIS_URL` が設定されているとき）：投稿作成 → 承認 → 予約 → 投稿、二重投稿防止、リトライ、失敗時の状態、他ユーザーからのアクセス拒否、キュー登録・取消
- **E2E**：`npm run build` 後に `npm run test:e2e`。アプリと Worker を起動し、登録 → ログイン → APIキーで複数アカウント連携 → 投稿作成 → 承認 → 今すぐ投稿 → 予約 → カレンダー → 失敗表示までを確認します
  - Playwright のブラウザ：`npx playwright install chromium`（インストール済みのものを使う場合は `PLAYWRIGHT_CHROMIUM_EXECUTABLE` にパスを指定）

テスト用 DB は開発用と分けてください（例：`ai_sns_manager_test` を作成し `DATABASE_URL=<テスト用> npx prisma migrate deploy`）。

## デプロイ

Web サーバー・Worker・PostgreSQL・Redis の 4 つが必要です。Render や Railway なら
「Web Service + Background Worker + PostgreSQL + Redis」の構成で動かせます。
Vercel だけでは常駐 Worker を動かせないため、Worker は別ホストが必要です。
手順は [docs/deployment.md](docs/deployment.md)。

```bash
npm run build && npm run db:deploy
npm run start     # Web
npm run worker    # Worker（別プロセス）
```

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| 予約した投稿がいつまでも「予約済み」のまま | Worker（`npm run worker`）が起動しているか確認してください |
| 「予約処理を開始できませんでした」 | Redis に接続できていません。`REDIS_URL` と Redis の起動を確認してください |
| 「◯◯のキーを確認できませんでした」 | キーの値（前後の空白・コピー漏れ）と、投稿の権限（X は Read and Write、Threads/Instagram は content_publish）を確認してください |
| 「◯◯ は再接続が必要です」 | トークンの期限切れなどです。SNSアカウント画面で新しいキーを「キーを更新」から入れ直すか、「接続確認」を押してください。モードを切り替えた場合も登録し直しが必要です（Mock と live のアカウントは混在できません） |
| `ENCRYPTION_KEY は32バイト…` | `openssl rand -base64 32` で生成した値を設定してください。**運用開始後に変更すると保存済みの APIキーが復号できなくなります**（キーの再登録が必要） |
| ログインできない | `AUTH_SECRET` が設定されているか、本番では `AUTH_URL` / `AUTH_TRUST_HOST` を確認してください |
| Prisma のエラー | `npm run db:migrate` を実行し、`DATABASE_URL` を確認してください |

## ロードマップと未実装機能

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 1 | ログイン、Dashboard、ブランド、SNS アカウント（APIキー連携・複数アカウント・実投稿）、投稿作成・編集・承認・予約、キュー・リトライ、カレンダー、履歴、ログ | ✅ 完了 |
| 2 | AI 投稿生成（5 案）、SNS 別最適化、Brand Voice、禁止ワードチェック、再生成 | 未着手 |
| 3 | 画像・動画生成（fal.ai）、AI スケジュール、AI Agent、完全自動モード | 未着手 |
| 4 | 分析、AI 分析、複数ブランド・SNS 拡張 | 未着手 |

Phase 1 時点で実装していないもの（理由）：

- **本物の SNS での動作確認**：開発環境から各 SNS の API に接続できず、実際のキーでの投稿は未確認です。リクエスト形式は公式 SDK・公式サンプル・公式ドキュメントに合わせ、偽のサーバーを使ったテストで確認しています。最初の本番利用時は、テスト用アカウントで1件投稿して確認してください
- **画像のアップロード・X と Threads への画像付き投稿**：Instagram の画像 URL 指定のみ対応。アップロードは Phase 3 で対応予定
- **動画投稿**：Phase 3 で対応予定
- **カレンダーのドラッグ＆ドロップ**：Phase 1 は日時指定で予約する方針のため
- **Threads / Instagram のトークン自動更新**：期限切れ時は「キーを更新」で入れ直す運用。自動更新は今後の対応
- **パスワードリセット・メール認証**：メール送信基盤が未導入のため
