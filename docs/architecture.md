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

BullMQ (Redis) で予約投稿・画像/動画生成・AI Agent を管理する。Worker（`workers/`）が各キューを処理する（詳細は「Worker の構成」）。

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

## AI 投稿生成

テーマとブランド情報から X / Instagram / Threads 向けの投稿案を作る。案は DB に保存せず、採用した時点で通常の投稿（`Post.aiGenerated = true`）として保存する。

```
lib/ai/
  ai-service.ts      ← generateDrafts(): 生成・品質チェック・作り直し
  registry.ts        ← getAIProvider(): Claude / Mock の選択
  claude-provider.ts / mock-provider.ts
  schema.ts          ← 構造化出力用の zod スキーマ（draftSetSchema）
  prompts.ts         ← prompts/ の読み込みと、ユーザー入力のプロンプト組み立て
  quality.ts         ← checkDraft() / findDuplicates()
  types.ts / errors.ts
```

### Provider

```typescript
interface AIProvider {
  readonly name: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  mediaPrompt(request: MediaPromptRequest): Promise<MediaPromptResult>; // 画像・動画の生成プロンプト
  planWeek(request: PlanRequest): Promise<PlanResult>; // AI Agent の投稿テーマ計画
}
```

- **ClaudeProvider** (`claude`): `client.beta.messages.parse()` に `betaZodOutputFormat(draftSetSchema)` を渡し、JSON を構造化出力で受け取る
  - モデル: `ANTHROPIC_MODEL`（未設定なら `claude-sonnet-5-5`）
  - 思考の深さ: `ANTHROPIC_EFFORT`（未設定なら `medium`）→ `output_config.effort`
  - `fallbacks: "default"` と beta `server-side-fallback-2026-07-01` でサーバー側フォールバックを有効化
  - `max_tokens` は 16000。SDK の再試行は `maxRetries: 2`
  - 件数や文字数はスキーマでは縛らず、受け取った後に品質チェックで確認する
- **MockAIProvider** (`mock`): AI を呼ばず決まった案を返す。テーマに `#mock-prohibited` を含めると禁止ワード入りの案を返す（品質チェックの確認用）

### Registry

`AI_PROVIDER_MODE`（`claude` / `mock`）で選ぶ。未指定なら、`ANTHROPIC_API_KEY` があれば `claude`、なければ `mock`。

### プロンプト

`prompts/post-generation/system.md` と `prompts/{x,instagram,threads}/guidelines.md` を連結し、初回に読み込んでキャッシュする。`process.cwd()` 基準で読むため、リポジトリのルートで起動する前提。テーマやブランド情報はユーザーメッセージとして別に渡す。

### 品質チェックと作り直し

`generateDrafts()` の流れ:

1. 依頼された型（既定は5型）で Provider を呼ぶ。依頼した型に合わない案は捨て、残りを型の順に並べる
2. `checkDraft()` が各 SNS の文章を確認する
   - errors（作り直し対象）: 空の文章、文字数超過、禁止キーワード、Instagram のハッシュタグ30個超
   - warnings（表示のみ）: URL を含む、ハッシュタグが目安を超える
3. `findDuplicates()`: X の文章が他の案と同じなら errors
4. errors のある案だけ、問題点を `feedback` として渡して作り直す。作り直しは最大 `MAX_REGENERATIONS`（2）回（呼び出しは最大3回）
5. 作り直しても直らなかった問題は `errors` に残して返す

文字数: X は `xWeightedLength()`（`lib/social/text-length.ts`）で数える。U+0000〜U+10FF など一部の範囲は1、それ以外（日本語・絵文字など）は2、URL は一律23として数え、上限280と比べる。他の SNS はコードポイント数で数える。

### 保存と承認

- 案は保存しない。`POST /api/ai/drafts` は結果を返すだけ
- 投稿フォームが採用した案を `POST /api/posts` に `aiGenerated: { model, style }` 付きで送ると、`Post.aiGenerated = true` と `AI_GENERATED` ログが残る
- 承認モード `AI_ONLY` では AI 由来の投稿が承認待ちになる（`initialApprovalStatus()`）

## 画像・動画生成

```
lib/media/
  types.ts          ← MediaGenerationProvider / AspectRatio
  registry.ts       ← getMediaProvider(): fal / mock の選択
  fal-provider.ts   ← FalAIProvider（fal.ai）
  mock-provider.ts  ← MockMediaProvider
  media-service.ts  ← requestMedia() / processMedia() / 投稿への添付
  errors.ts         ← MediaGenerationError（ユーザー向けの文を持つ）
```

- **FalAIProvider**（`FAL_KEY` が必要）: 画像は `fal-ai/flux-1/schnell`（`FAL_IMAGE_MODEL` で変更）、動画は `fal-ai/kling-video/v2.5-turbo/pro/text-to-video`（`FAL_VIDEO_MODEL`）。動画は10秒。返された公開 URL をそのまま保存する。HTTP 401/403 → AUTH、429 → RATE_LIMIT、400/422 → REJECTED、その他 → UNAVAILABLE
- **MockMediaProvider**: 画像はプレースホルダー画像、動画は架空の URL（再生できない）
- **registry**: `MEDIA_PROVIDER_MODE`（`fal` / `mock`）。未指定なら `FAL_KEY` があれば fal、なければ mock
- **生成プロンプトは AI が作る**: `AIProvider.mediaPrompt()` が `prompts/image/system.md` または `prompts/video/system.md` を使い、英語のプロンプトを作る（動画は日本語の構成メモ `script` も）。作成済みのプロンプトは再試行時に再利用する

流れ:
1. `POST /api/media/generate` が `Media`（PENDING）を作り、`media-generate` キューに登録する（jobId `media_{id}`、最大2回試行、失敗から30秒後に再試行）
2. media worker の `processMedia()` が GENERATING にし、プロンプトを作って生成し、READY で `url` を保存する
3. 再試行対象（RATE_LIMIT / UNAVAILABLE）は PENDING に戻す。それ以外は FAILED と `errorMessage` を残す
4. READY かつ `postId` があれば `onMediaReadyForPost()`：DRAFT の投稿先のうち、その種類を投稿できるものに `mediaUrls` / `mediaType` を設定し、`POST_UPDATED` ログを残す

## SNS への画像・動画投稿

`lib/social/media.ts` の `primaryMedia()` が1投稿1メディアを決める（`mediaType` が無ければ URL の拡張子で推定）。各 Adapter が呼ぶ API（ファイル冒頭のコメントより）:

- **X**（`x/x-adapter.ts`）: 画像は `POST /2/media/upload`。動画は `upload/initialize` → `upload/{id}/append`（4MB ずつ）→ `finalize` → `STATUS` で処理完了を待つ。投稿は `POST /2/tweets` の `media.media_ids`
- **Threads**（`threads/threads-adapter.ts`）: `POST me/threads`（`media_type` = IMAGE / VIDEO、`image_url` / `video_url`）でコンテナを作る → `GET {id}?fields=status,error_message` で状態確認 → `POST me/threads_publish`
- **Instagram**（`instagram/instagram-adapter.ts`）: 画像は `POST {ig-user-id}/media`（`image_url`）。動画は `media_type=REELS`（`video_url`）。`status_code` が FINISHED になるまで待ち、`POST {ig-user-id}/media_publish`。画像・動画が必須

## AI Agent

`lib/agent/`（`agent-service.ts` / `slots.ts` / `plan-check.ts`）が、ブランドごとに今後7日間の投稿を作る。**日時はコードで決め、AI はテーマ・型・画像のアイデアだけを決める。**

1. 直近30件の投稿履歴と、今後の予定を読む
2. `computeSlots()`: 1時間後から7日以内に `postsPerWeek` 件の枠を作る。`preferredWeekdays` の曜日を優先し、予定のある日は避け、間隔を均等にする（JST）
3. `planWeek()` → `checkPlan()`: 枠の欠落・重複、型、投稿テーマの柱（登録済みか、偏りすぎていないか）を確認する。違反があれば指摘を付けて作り直す（計2回まで。`PLAN_ATTEMPTS`）。直らなければ run は FAILED
4. 枠ごとに `generateDrafts()`（その枠の型で1案。品質チェック込み）→ `createPost()`（`aiGenerated` に model / style、投稿先は実行時の対象アカウント）→ `scheduledAt` / `agentRunId` / `contentPillar` を設定
5. 画像：`generateImages` が true か Instagram が対象なら `requestMedia(IMAGE)`（Instagram を含むと 4:5、それ以外は 1:1、`postId` 付き）
6. 承認：承認モードが `AUTO` なら、画像なしは作成直後に `schedulePost()`、画像ありは画像完成時に予約する（画像の生成に失敗した投稿は DRAFT のまま残る）。それ以外は承認待ち（PENDING）
7. 結果を `AgentRun.summary` に書く。1件も作れなければ FAILED

- **承認**：`approveAgentRun()`（`POST /api/agent/runs/{id}/approve`）が対象の投稿を計画日時で `schedulePost(approve: true)` する
- **毎週の自動実行**：`AgentConfig.weeklyEnabled` が true のとき `upsertWeeklyAgent()` が `agent-run` キューに job scheduler（ID `agent-weekly-{configId}`、cron `m h * * 曜日`、`tz: Asia/Tokyo`）を登録する。発火すると `startWeeklyRun()` が `trigger = SCHEDULED` の AgentRun を作る。ai worker の起動時に `reconcileWeeklySchedules()` が DB の設定に合わせて登録し直す

## Worker の構成

`workers/index.ts`（`npm run worker`）は下の3つを1プロセスで起動する。各ファイルは `npm run worker:post` などで単独でも起動できる。`run.ts` が起動と終了（SIGINT / SIGTERM）を共通化する。

| Worker | ファイル | キュー | 同時実行 | 役割 |
|--------|----------|--------|----------|------|
| post | `post-worker.ts` | `post-publish` | 5 | 予約投稿の実行（起動時に予約中の投稿を再登録） |
| media | `media-worker.ts` | `media-generate` | 2 | 画像・動画の生成 |
| ai | `ai-worker.ts` | `agent-run` | 1 | AI Agent の実行（手動と毎週） |

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
      jobs.ts           ← 画像・動画 / AI Agent のキュー
      retry.ts
      connection.ts
    ai/                 ← 投稿案・計画・生成プロンプト（claude-provider / mock-provider）
    media/              ← 画像・動画生成（fal-provider / mock-provider / media-service）
    agent/              ← AI Agent（agent-service / slots / plan-check）
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
    index.ts            ← 3つの Worker を1プロセスで起動
    post-worker.ts / media-worker.ts / ai-worker.ts
    run.ts
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
