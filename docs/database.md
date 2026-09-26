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
GENERATING  # AI 生成中（Phase 2）
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
AI_GENERATED    # AI 生成完了
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
- `oauthStates`: OAuthState[]

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

SNS アカウント。トークンは暗号化。パスワード未保存。

| Column | Type | 説明 |
|--------|------|------|
| id | String (cuid) | Primary Key |
| userId | String (fk) | ユーザー ID |
| brandId | String? (fk) | ブランド ID（省略可。複数アカウント対応） |
| platform | Platform | X / INSTAGRAM / THREADS |
| accountName | String | @ユーザー名など |
| externalAccountId | String | SNS 側の ID |
| accessTokenEncrypted | String | OAuth access token（AES-256-GCM） |
| refreshTokenEncrypted | String? | OAuth refresh token（暗号化） |
| tokenExpiresAt | DateTime? | トークン期限 |
| scopes | String[] | OAuth スコープ |
| status | SocialAccountStatus | デフォルト: CONNECTED |
| isMock | Boolean | Mock API を使用中か |
| lastCheckedAt | DateTime? | 最後に検証した日時 |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**Relations:**
- `user`: User
- `brand`: Brand?

**Unique Constraints:**
- `(userId, platform, externalAccountId)`

**Indexes:**
- `(userId, platform)`

---

### OAuthState

OAuth フロー中の一時状態（CSRF state + PKCE code_verifier）。

| Column | Type | 説明 |
|--------|------|------|
| id | String (cuid) | Primary Key |
| state | String | CSRF state（ユニーク） |
| userId | String (fk) | ユーザー ID |
| platform | Platform | 連携中の SNS |
| codeVerifier | String? | PKCE code_verifier（暗号化） |
| expiresAt | DateTime | 有効期限（10 分） |
| createdAt | DateTime | 作成日時 |

**Relations:**
- `user`: User

**Unique Constraints:**
- `state`

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
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**Relations:**
- `user`: User
- `brand`: Brand?
- `platforms`: PostPlatform[]

**Indexes:**
- `(userId, status)`
- `(userId, scheduledAt)`

---

### PostPlatform

SNS 別の投稿内容・状態。

| Column | Type | 説明 |
|--------|------|------|
| id | String (cuid) | Primary Key |
| postId | String (fk) | 投稿 ID |
| platform | Platform | X / INSTAGRAM / THREADS |
| content | String | 投稿本文（最大 10000 字） |
| status | PostPlatformStatus | デフォルト: DRAFT |
| idempotencyKey | String | 二重投稿防止（`${postId}:${platform}`） |
| attempts | Int | 試行回数。デフォルト: 0 |
| publishedAt | DateTime? | 投稿日時 |
| externalPostId | String? | SNS 側の投稿 ID |
| externalUrl | String? | SNS 側の投稿 URL |
| errorMessage | String? | ユーザー向けエラーメッセージ |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**Relations:**
- `post`: Post
- `logs`: PostLog[]

**Unique Constraints:**
- `idempotencyKey` (BullMQ jobId としても使用)
- `(postId, platform)`

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

OAuth トークン（`accessTokenEncrypted` / `refreshTokenEncrypted`）:
- **Algorithm**: AES-256-GCM
- **Format**: `v1.<iv>.<authTag>.<ciphertext>` (全て base64)
- **Key**: 環境変数 `ENCRYPTION_KEY`（32 バイト base64）

実装: `lib/encryption/crypto.ts`

### 二重投稿防止

`PostPlatform.idempotencyKey = "${postId}:${platform}"` で原子性確保。

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

### Phase 2 で追加予想

- Media モデル（生成画像・ビデオ）
- AIGenerationJob モデル（生成タスク追跡）
- Analytics モデル（投稿成績）

### Phase 3 で追加予想

- Comment / Like モデル（コミュニティ機能）
- Hashtag / ContentTag モデル（タグ管理）
