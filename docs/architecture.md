# AI SNS Manager - アーキテクチャ

## 概要

AI SNS Manager は Next.js / React ベースの Web アプリで、X / Instagram / Threads への投稿を生成・予約・管理します。

### システム構成

```
┌─────────────────────────────────────────┐
│         Frontend (Next.js + React)      │
│  - pages/components/app          │
│  - Authentication (Auth.js JWT)         │
└──────────────┬──────────────────────────┘
               │ HTTP / JSON
               ▼
┌──────────────────────────────────────────┐
│      API Route Handlers (App Router)     │
│  - /api/posts, /api/social, etc.        │
│  - Error handling & Validation (Zod)    │
└──────────┬──────────────┬────────────────┘
           │ Sync         │ Job Queue
           ▼              ▼
┌──────────────┐   ┌───────────────────┐
│Service Layer │   │   BullMQ Queue    │
│  (lib/*)     │   │   (Post Schedule) │
└──────────────┘   └─────────┬─────────┘
     │                       │
     │                  ┌────▼──────┐
     │                  │  Worker   │
     │                  │ (separate │
     │                  │ process)  │
     └──────────────────┼───────────┘
                        │ Service Layer
                        ▼
            ┌──────────────────────┐
            │   Prisma ORM         │
            │  (PostgreSQL client) │
            └──────────┬───────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       PostgreSQL   Redis      SNS APIs
       (Data)      (Queue)     (Mock/Live)
```

## レイヤー構造

### 1. Frontend (pages/components)

React アプリ。ユーザーの操作・投稿管理・SNS アカウント連携をハンドル。JWT トークンで認証。

### 2. API Route Handlers (app/api/)

Next.js App Router の API エンドポイント。

- リクエスト/レスポンスの変換
- Zod による入力検証
- `requireUserId()` で認証チェック
- エラーハンドリング (`withErrorHandling`)

### 3. Service Layer (lib/)

ビジネスロジックの集約。

```
lib/
  posts/
    post-service.ts       ← 投稿 CRUD・状態管理
    publish-service.ts    ← 実際の投稿実行
    status.ts             ← 状態遷移・計算
  social/
    account-service.ts    ← SNS アカウント管理
    registry.ts           ← Adapter 選択（Mock/Live）
    types.ts              ← インターフェース定義
    capabilities.ts       ← SNS ごとの機能制約
    errors.ts             ← エラー分類・リトライ判定
    **/\*-adapter.ts      ← SNS API 実装
  queue/
    post-queue.ts         ← BullMQ スケジュール管理
    retry.ts              ← リトライポリシー
  encryption/
    crypto.ts             ← AES-256-GCM トークン暗号化
  logging/
    logger.ts             ← ログ・秘密情報マスキング
```

### 4. Queue & Worker

BullMQ (Redis) で予約投稿を管理。Worker プロセスが定時に `publishPostPlatform()` を実行。

### 5. Database (Prisma + PostgreSQL)

User / Post / SocialAccount などのモデルを永続化。

## 投稿フロー

```
1. POST /api/posts (Create)
   ↓ [Service]
   createPost() → Post (DRAFT) + PostPlatform (DRAFT) 作成
   ↓
2. POST /api/posts/{id}/schedule (Schedule)
   ↓ [Validation]
   - SNS ごとのコンテンツ検証
   - アカウント接続確認
   ↓ [Database]
   Post.status = SCHEDULED, PostPlatform.status = SCHEDULED
   ↓ [Queue]
   BullMQ に遅延ジョブ登録
   ↓
3. [Worker] (定時に起動)
   ↓ [Service]
   publishPostPlatform(postPlatformId, attempt) → 実行
   ↓ [Adapter]
   adapter.createPost() → SNS API 呼び出し（Mock/Live）
   ↓
4. Success: PostPlatform.status = PUBLISHED
   Failure: PostPlatform.status = FAILED, リトライをスケジュール
   ↓
5. Max 3 回まで自動リトライ（30s → 2min 間隔）
```

## Adapter パターン

各 SNS は `SocialPlatformAdapter` を実装。API キー（または OAuth 1.0a トークン）で認証。

```typescript
interface SocialPlatformAdapter {
  readonly platform: Platform;
  readonly capabilities: SocialPlatformCapabilities;

  // ユーザーが入力したキーを検証。有効ならアカウント情報を返す
  verifyCredentials(credentials: PlatformCredentials): Promise<VerifiedAccount>;

  // 投稿を作成
  createPost(post: PlatformPost, credentials: PlatformCredentials, account: VerifiedAccount): Promise<PublishedPost>;

  // 投稿内容を検証（テキスト長など）
  validatePost(post: PlatformPost): Promise<ValidationResult>;
}
```

### Mode: Mock vs Live

- **Mock Mode** (開発・テスト用)
  - `MockSocialAdapter`: 本物の API 呼び出し不要
  - `#mock-auth-error` など投稿内容のタグで失敗シミュレーション
  - `MOCK_TRANSIENT_FAILURE_RATE` で確率的失敗テスト

- **Live Mode** (本番・Step 11-13 以降)
  - `XAdapter`, `InstagramAdapter`, `ThreadsAdapter`
  - 実際の SNS API を呼び出し（X API v2、Meta Graph API）

### Registry (platform 選択)

```typescript
export function getAdapter(platform: Platform): SocialPlatformAdapter {
  return isMockMode() ? new MockSocialAdapter(platform) : liveAdapters[platform]();
}
```

環境変数 `SOCIAL_PROVIDER_MODE` で制御。

## 認証・セキュリティ

### 認証フロー

1. `/login` で Email + Password
2. bcrypt で検証（平文パスワード DB に保存しない）
3. Auth.js が JWT セッション発行
4. 各 API で `requireUserId()` で UUID 取得

### API キー保存

SNS のキー（API キー / OAuth 1.0a トークン など）を DB に保存する際は AES-256-GCM で暗号化。
保存形式: `v1.<iv>.<authTag>.<ciphertext>`（全て base64）
`SocialAccount.credentialsEncrypted` に JSON フォーマットで格納。

### ログ・秘密情報マスク

`logger.ts` の `redact()` で token / password / authorization など含むフィールドを `[REDACTED]` に置換。

## 状態遷移

### Post.status

```
DRAFT
  ↓ (コンテンツ入力完了)
READY
  ↓ (承認待ち / AI 生成中)
GENERATING / (承認処理中)
  ↓
SCHEDULED
  ↓ (投稿時刻到達)
POSTING
  ↓
PUBLISHED / FAILED / CANCELLED
```

### PostPlatform.status

各 SNS ごと独立。

```
DRAFT
  ↓
SCHEDULED
  ↓
POSTING
  ↓
PUBLISHED / FAILED / CANCELLED
```

Post.status は `computePostStatus()` で PostPlatform 状態から集計・更新される。

## リトライ戦略

### リトライ可否判定

`SocialErrorKind` で分類。

```typescript
// リトライしない（ユーザー対応が必要）
NON_RETRYABLE: ["AUTH", "PERMISSION", "CONTENT", "NOT_IMPLEMENTED"]

// リトライする
RETRYABLE: ["RATE_LIMIT", "TRANSIENT", "UNKNOWN"]
```

### リトライスケジュール

- 1 回目失敗: 30 秒後
- 2 回目失敗: 2 分後
- 3 回目で最大試行数に達し、失敗確定

失敗時は `PostPlatform.errorMessage` にユーザー向けメッセージを記録。

## 二重投稿防止（Idempotency）

各 `PostPlatform` に一意キー: `idempotencyKey = "${postId}:${socialAccountId}"`

- BullMQ の `jobId` として使用（同じ jobId は重複登録されない）
- DB の `PostPlatform.idempotencyKey` でも UNIQUE 制約
- `publishPostPlatform()` 呼び出し時は `updateMany` で原子的に CLAIMED 取得

## ディレクトリ構造

```
ai-sns-manager/
  app/
    api/
      posts/              ← 投稿 API
      social/             ← SNS 連携 API
      brands/             ← ブランド管理 API
      settings/           ← ユーザー設定 API
      ...
    (app/)                ← Frontend ページ
  lib/
    posts/
      post-service.ts
      publish-service.ts
      status.ts
      post-log.ts
    social/
      account-service.ts
      registry.ts
      types.ts
      capabilities.ts
      errors.ts
      validate.ts
      mock/
        mock-adapter.ts
      x/
        x-adapter.ts      (Step 11)
      instagram/
        instagram-adapter.ts  (Step 12)
      threads/
        threads-adapter.ts    (Step 13)
    queue/
      post-queue.ts
      retry.ts
      connection.ts
    encryption/
      crypto.ts
    logging/
      logger.ts
    auth/
      session.ts
    api/
      handler.ts
      base-url.ts
    validation/
      schemas.ts
    errors/
      service-error.ts
      user-messages.ts
  workers/
    post-worker.ts
  prisma/
    schema.prisma
    seed.ts
  docs/
    architecture.md
    api.md
    database.md
    social-api.md
    deployment.md
```

## 新しい SNS の追加方法

1. `lib/social/{platform}/{platform}-adapter.ts` を作成
   - `SocialPlatformAdapter` を実装し、`verifyCredentials()` / `createPost()` / `validatePost()` を実装
2. `lib/social/{platform}/credential-fields.ts` でキー入力項目を定義
3. `lib/social/registry.ts` の `liveAdapters` に登録
4. `lib/social/capabilities.ts` で機能制約を定義
5. API リファレンスの URL と必要な権限をコメント欄に記載
