# AI SNS Manager - Database Schema

## 概要

PostgreSQL を使用。Prisma ORM で管理。

マイグレーションコマンド:
```bash
npm run db:migrate    # ローカル開発用（マイグレーション作成＋実行）
npm run db:deploy     # 本番環境（既存マイグレーション実行）
npm run db:seed       # テストデータ投入
npm run db:studio     # GUI でデータ閲覧・編集
```

---

## Enum

### Platform

```
X, INSTAGRAM, THREADS
```

### PostStatus

投稿全体の状態（SNS 別の状態から集計）。

```
DRAFT       # 下書き
GENERATING  # 未使用（現在どの処理も設定しない）
READY       # 完成・承認待ち
SCHEDULED   # 予約済み
POSTING     # 投稿処理中
PUBLISHED   # 投稿済み
FAILED      # 失敗
CANCELLED   # キャンセル済み
```

### PostPlatformStatus

SNS 別の投稿状態。

```
DRAFT       # 下書き
SCHEDULED   # 予約済み
POSTING     # 投稿処理中
PUBLISHED   # 投稿済み
FAILED      # 失敗
CANCELLED   # キャンセル済み
```

### ApprovalStatus

投稿の承認状態。

```
PENDING      # 承認待ち
APPROVED     # 承認済み
REJECTED     # 却下
NOT_REQUIRED # 承認不要（自動投稿など）
```

### ApprovalMode

ユーザーの承認モード設定。

```
ALWAYS   # 常に投稿前に承認（手動承認必須）
AI_ONLY  # AI 生成後のみ承認（手動投稿は自動）
AUTO     # 完全自動（承認なし）
```

### SocialAccountStatus

SNS アカウント接続状態。

```
CONNECTED    # 接続中
EXPIRED      # トークン期限切れ
DISCONNECTED # 切断済み
```

### PostLogEvent

ログイベント種別。

```
POST_CREATED    # 投稿作成
POST_UPDATED    # 投稿編集
AI_GENERATED    # AI 生成案の採用（作成時）
APPROVED        # 承認
REJECTED        # 却下
SCHEDULED       # 予約
CANCELLED       # キャンセル
POST_STARTED    # 投稿開始
POST_SUCCESS    # 投稿成功
POST_FAILED     # 投稿失敗
RETRY           # リトライ
```

### LogStatus

ログレベル。

```
INFO
SUCCESS
WARNING
ERROR
```

### 画像・動画・AI Agent の enum

| Enum | 値 |
|------|----|
| MediaType | `IMAGE`, `VIDEO` |
| MediaProvider | `FAL_AI`, `MOCK` |
| MediaStatus | `PENDING`, `GENERATING`, `READY`, `FAILED` |
| AgentRunTrigger | `MANUAL`（ボタン）, `SCHEDULED`（毎週の自動実行） |
| AgentRunStatus | `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED` |

---

## Models

### User

ユーザーアカウント。Email でユニーク。

| Column | Type | 説明 |
|--------|------|------|
| id | String (cuid) | Primary Key |
| email | String | ユニーク。ログイン用 |
| name | String? | 表示名 |
| passwordHash | String | bcrypt ハッシュ。平文は保存しない |
| approvalMode | ApprovalMode | デフォルト: ALWAYS |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**Relations:**
- `brands`: Brand[]
- `socialAccounts`: SocialAccount[]
- `posts`: Post[]
- `media`: Media[] / `agentConfigs`: AgentConfig[] / `agentRuns`: AgentRun[]

**Indexes:**
- `email` (UNIQUE)

---

### Brand

ブランド（トーン・ガイドライン）。

| Column | Type | 説明 |
|--------|------|------|
| id | String (cuid) | Primary Key |
| userId | String (fk) | ユーザー ID |
| name | String | ブランド名 |
| description | String | 説明（最大 2000 字） |
| targetAudience | String | ターゲット層 |
| brandImage | String | ロゴ URL |
| tone | String | トーン・ボイス |
| objective | String | ブランド目的 |
| avoidExpressions | String | 避ける表現 |
| keywords | String[] | キーワード（最大 50 個） |
| prohibitedWords | String[] | 禁止用語 |
| contentPillars | String[] | コンテンツの柱 |
| isSample | Boolean | サンプルデータ（seed で作成） |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**Relations:**
- `user`: User
- `posts`: Post[]
- `socialAccounts`: SocialAccount[]

**Indexes:**
- `userId`

---

### SocialAccount

SNS アカウント。API キー類は暗号化。パスワード・秘密情報は未保存。

| Column | Type | 説明 |
|--------|------|------|
| id | String (cuid) | Primary Key |
| userId | String (fk) | ユーザー ID |
| brandId | String? (fk) | ブランド ID（省略可。複数アカウント対応） |
| platform | Platform | X / INSTAGRAM / THREADS |
| accountName | String | @ユーザー名など |
| label | String | ユーザーが付ける管理用名前（任意） |
| externalAccountId | String | SNS 側の ID |
| credentialsEncrypted | String | API キー/トークン（JSON を AES-256-GCM で暗号化） |
| credentialHint | String | 画面表示用のキー末尾 4 文字（例: "••••abcd"） |
| tokenExpiresAt | DateTime? | トークン期限 |
| status | SocialAccountStatus | デフォルト: CONNECTED |
| isMock | Boolean | Mock API を使用中か |
| lastCheckedAt | DateTime? | 最後に検証した日時 |
| lastError | String? | 直近のエラーメッセージ（ユーザー向け） |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**Relations:**
- `user`: User
- `brand`: Brand?
- `postPlatforms`: PostPlatform[]

**Unique Constraints:**
- `(userId, platform, externalAccountId)`

**Indexes:**
- `(userId, platform)`

---


### Post

投稿（複数 SNS 対応）。

| Column | Type | 説明 |
|--------|------|------|
| id | String (cuid) | Primary Key |
| userId | String (fk) | ユーザー ID |
| brandId | String? (fk) | ブランド ID |
| title | String | 投稿タイトル（1-200 字） |
| topic | String | 投稿テーマ |
| status | PostStatus | 集計状態。デフォルト: DRAFT |
| approvalStatus | ApprovalStatus | 承認状態。デフォルト: PENDING |
| scheduledAt | DateTime? | 予約日時 |
| aiGenerated | Boolean | AI が作った案を採用した投稿か。デフォルト: false |
| agentRunId | String? (fk) | AI Agent が作った投稿の実行 ID（実行記録が消えたら null） |
| contentPillar | String? | Agent が割り当てた投稿テーマの柱 |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**Relations:**
- `user`: User
- `brand`: Brand?
- `agentRun`: AgentRun?
- `platforms`: PostPlatform[]
- `media`: Media[]

**Indexes:**
- `(userId, status)`
- `(userId, scheduledAt)`

**aiGenerated のマイグレーション:** `prisma/migrations/20261025010000_post_ai_generated`。`ALTER TABLE "Post" ADD COLUMN "aiGenerated" BOOLEAN NOT NULL DEFAULT false;` で追加する。既存の投稿は `false` になる。
一度 `true` になった値は PATCH で `false` に戻らない（`updatePost()` は `post.aiGenerated || input.aiGenerated` で更新）。

**画像・動画と AI Agent のマイグレーション:** `prisma/migrations/20261025020000_media_and_agent`。enum 5 種、テーブル `Media` / `AgentConfig` / `AgentRun` を作り、`Post.agentRunId` / `Post.contentPillar` / `PostPlatform.mediaType` を追加する。既存のデータは変更しない（追加した列は NULL か既定値）。

---

### PostPlatform

SNS アカウント別の投稿内容・状態。同じ Post を複数アカウントに投稿可能。

| Column | Type | 説明 |
|--------|------|------|
| id | String (cuid) | Primary Key |
| postId | String (fk) | 投稿 ID |
| platform | Platform | X / INSTAGRAM / THREADS |
| socialAccountId | String? (fk) | SNS アカウント ID（切断後は null） |
| accountName | String | 投稿時点のアカウント名（切断後も履歴で表示） |
| content | String | 投稿本文（最大 10000 字） |
| mediaUrls | String[] | 添付する画像・動画の URL（1件まで。Instagram は必須） |
| mediaType | MediaType? | 添付の種類（IMAGE / VIDEO）。`mediaUrls` が空なら null |
| status | PostPlatformStatus | デフォルト: DRAFT |
| idempotencyKey | String | 二重投稿防止（`${postId}:${socialAccountId}`） |
| attempts | Int | 試行回数。デフォルト: 0 |
| publishedAt | DateTime? | 投稿日時 |
| externalPostId | String? | SNS 側の投稿 ID |
| externalUrl | String? | SNS 側の投稿 URL |
| errorMessage | String? | ユーザー向けエラーメッセージ |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**Relations:**
- `post`: Post
- `socialAccount`: SocialAccount?
- `logs`: PostLog[]

**Unique Constraints:**
- `idempotencyKey` (BullMQ jobId としても使用)
- `(postId, socialAccountId)`

**Indexes:**
- `status` (POSTING / SCHEDULED の検索)

---

### PostLog

投稿の操作履歴・ログ。

| Column | Type | 説明 |
|--------|------|------|
| id | String (cuid) | Primary Key |
| postPlatformId | String (fk) | PostPlatform ID |
| event | PostLogEvent | 操作種別 |
| status | LogStatus | ログレベル |
| message | String | ユーザー向けメッセージ |
| metadata | Json? | 技術詳細（API レスポンス・エラーなど） |
| createdAt | DateTime | 作成日時 |

**Relations:**
- `postPlatform`: PostPlatform

**Indexes:**
- `(postPlatformId, createdAt)`

**AI_GENERATED の記録:** `POST /api/posts` で `aiGenerated` 付きの投稿を作成したとき、投稿の PostPlatform ごとに1件ずつ `event = AI_GENERATED`、`status = INFO`、`message = "AIが作った投稿案を採用しました"`、`metadata = { model, style }` を残す（`POST_CREATED` と同じトランザクション）。PATCH では記録しない。

---

### Media

生成した画像・動画（fal.ai など）。`status = READY` のものが画面に出る。`id` / `createdAt` / `updatedAt` は省略。

| Column | Type | 説明 |
|--------|------|------|
| userId | String (fk) | 所有者 |
| postId | String? (fk) | 添付先の投稿（投稿削除で null） |
| type / provider | MediaType / MediaProvider | 種類 / 生成元（FAL_AI・MOCK） |
| idea | String | ユーザーが書いたイメージ（日本語） |
| prompt / script | String | AI が作った生成プロンプト（英語）/ 動画の構成メモ（日本語） |
| aspectRatio / model | String | 縦横比（既定 "1:1"）/ 使ったモデル名 |
| url / status / errorMessage | String? / MediaStatus / String? | 公開 URL / 状態 / ユーザー向けエラー |

**Indexes:** `(userId, createdAt)`

---

### AgentConfig

ブランドごとの AI Agent 設定（1ブランドに1つ。`brandId` は UNIQUE）。`id` / `createdAt` / `updatedAt` / `userId` は省略。

| Column | Type | 説明 |
|--------|------|------|
| brandId | String (fk, UNIQUE) | 対象ブランド（削除で一緒に削除） |
| weeklyEnabled | Boolean | 毎週の自動実行。デフォルト: false |
| runWeekday / runTime | Int / String | 自動実行の曜日（0=日〜6=土）と時刻 HH:mm（日本時間）。既定 1 / "09:00" |
| postsPerWeek / preferredWeekdays / preferredTime | Int / Int[] / String | 投稿枠の数（既定 3）、優先曜日（既定 [1,3,5]）、時刻（既定 "12:00"） |
| targetAccountIds | String[] | 投稿先の SocialAccount ID |
| generateImages | Boolean | 投稿ごとに画像を作るか。デフォルト: false |

---

### AgentRun

AI Agent の実行記録。`trigger` が `SCHEDULED` なら毎週の自動実行。

| Column | Type | 説明 |
|--------|------|------|
| userId / brandId | String (fk) | 所有者 / 対象ブランド |
| trigger / status | AgentRunTrigger / AgentRunStatus | 起動元 / 状態 |
| periodStart / periodEnd | DateTime? | 計画の対象期間（先頭と末尾の投稿枠） |
| plan | Json? | 投稿枠ごとの計画（テーマ・型・柱・理由・画像案・予定日時） |
| summary / errorMessage | String? | 結果の説明（作成数・確認が必要な点）/ 失敗理由 |
| finishedAt | DateTime? | 完了・失敗日時 |

**Relations:** `posts`: Post[]（作られた投稿）。**Indexes:** `(userId, createdAt)`

---

## 状態遷移ルール

### Post.status の遷移

```
DRAFT
  ↓ (コンテンツ完成)
READY
  ↓ (AI 生成開始・スケジュール)
GENERATING / SCHEDULED / POSTING
  ↓ (投稿成功 or 全部キャンセル)
PUBLISHED / CANCELLED
  ↓ (一部失敗)
FAILED
```

詳細は `lib/posts/status.ts` の `computePostStatus()` 参照。

### PostPlatform.status の遷移

```
DRAFT
  ↓ (schedule() 呼び出し)
SCHEDULED
  ↓ (定時・Worker 開始)
POSTING
  ↓ (成功)
PUBLISHED
  ↓ (失敗)
FAILED → SCHEDULED (自動リトライ)
  ↓ (最大試行数達成)
FAILED (確定)
```

### ApprovalStatus の遷移

```
PENDING
  ↓ (approve() 呼び出し)
APPROVED
  ↓ (スケジュール・発行OK)
SCHEDULED / POSTING
```

または

```
PENDING
  ↓ (reject())
REJECTED
```

---

## 設計パターン

### 暗号化

API キー（`SocialAccount.credentialsEncrypted`）:
- **内容**: キー類を JSON フォーマットで格納（X: `{apiKey, apiSecret, accessToken, accessTokenSecret}` / Threads & Instagram: `{accessToken}`）
- **Algorithm**: AES-256-GCM
- **Format**: `v1.<iv>.<authTag>.<ciphertext>` (全て base64)
- **Key**: 環境変数 `ENCRYPTION_KEY`（32 バイト base64）

実装: `lib/encryption/crypto.ts` / `lib/social/account-service.ts`

### 二重投稿防止

`PostPlatform.idempotencyKey = "${postId}:${socialAccountId}"` で原子性確保。

BullMQ にも同じキーを jobId として登録。同じ jobId は重複登録されない。

DB 側は `PostPlatform.updateMany` で CLAIMED 状態を取得。

### ログの粒度

各操作（作成・編集・承認・投稿開始・成功・失敗・リトライ）で `PostLog` を記録。

最大 50 件の最新ログを `getPost()` で返す。

---

## マイグレーション例

```bash
# マイグレーション作成＆実行（dev）
npm run db:migrate -- --name add_field_name

# 本番環境へデプロイ
npm run db:deploy

# 逆操作（開発時のみ）
npm run db:migrate -- --skip-generate
npx prisma migrate resolve --rolled-back <migration-name>
```

---

## データベース初期化（Docker）

```bash
docker compose up -d

# マイグレーション実行
npm run db:migrate

# テストデータ投入
npm run db:seed

# DB 確認
npm run db:studio
# → ブラウザで http://localhost:5555 が開く
```

---

## パフォーマンス考慮

- `PostPlatform` の `status` インデックス：POSTING / SCHEDULED 検索頻度が高い
- `Post` の `(userId, status)` インデックス：ユーザーごと・状態別フィルタ
- `Post` の `(userId, scheduledAt)` インデックス：予約済み投稿の時間順検索
- `PostLog` の `(postPlatformId, createdAt)` インデックス：ログ履歴取得時の順序付け

複合インデックスを選択し、単純なクエリを高速化。

---

## 今後の拡張

### Phase 4 で追加予定

- 分析用のモデル（SNS から取得できる範囲の投稿成績）
