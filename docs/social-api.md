# AI SNS Manager - Social Platform Integration

## Mock Mode（開発・テスト用）

### 概要

`MockSocialAdapter` は本物の SNS API を呼ばず、シミュレーション応答を返す。

**有効化:**
```bash
SOCIAL_PROVIDER_MODE=mock  # デフォルト
```

### Mock キー認証

1. `/api/social/{platform}/connect` で API キーを入力
2. Mock は入力値をハッシュしてアカウント ID を生成
3. 同じキーなら同じアカウント、違うキーなら別アカウント

**キーに "invalid" を含むと認証エラーになります:**

```json
POST /api/social/X/connect
{
  "credentials": {
    "apiKey": "invalid_key",
    "apiSecret": "...",
    "accessToken": "...",
    "accessTokenSecret": "..."
  }
}
→ 400 INVALID_CREDENTIALS
```

### 失敗シミュレーション

投稿本文の特殊タグで失敗を再現：

```typescript
export const MOCK_TRIGGERS = {
  authError: "#mock-auth-error",          // AUTH エラー
  contentError: "#mock-content-error",    // CONTENT エラー
  transientError: "#mock-transient-error" // TRANSIENT エラー（リトライ対象）
};
```

**使用例:**
```
投稿内容: "Hello #mock-auth-error world"
→ SocialPublishError("AUTH") → token expired simulation
```

### 確率的失敗テスト

```bash
MOCK_TRANSIENT_FAILURE_RATE=0.3  # 30% の確率で一時失敗
```

リトライ動作の検証に使用。

### Mock の分析用の数値

`fetchPostMetrics()` / `fetchFollowerCount()` は、投稿ごとに決まった擬似の数値を返す。返す項目は実際の API と同じ（Threads の保存は `null`、リーチは Instagram のみ）。キーに `nometrics` を含めると、分析で「権限がない」場合の動作を再現できる。

### Mock の過去投稿

`fetchRecentPosts()` は、アカウントごとに決まった架空の過去投稿を 2 件返す。

---

## Live Mode（本番・Step 11 以降）

ユーザーが UI からアカウント登録時に API キーを入力。Adapter が実際の SNS API を呼び出す。

### 実装済みアダプター

- **Step 11**: X API v2（OAuth 1.0a）
- **Step 12**: Instagram Graph API（アクセストークン）
- **Step 13**: Threads API（アクセストークン）

### 各アダプターで使用される API

#### X Adapter (`lib/social/x/x-adapter.ts`)

参考: X 公式 SDK（@xdevplatform/xdk）

- `GET /2/users/me` - アカウント確認
- `POST /2/tweets` - テキスト投稿

#### Threads Adapter (`lib/social/threads/threads-adapter.ts`)

参考: Meta 公式サンプル（github.com/fbsamples/threads_api）

- `GET me?fields=id,username` - アカウント確認
- `POST me/threads` - 投稿コンテナ作成
- `POST me/threads_publish` - 投稿確定
- `GET {id}?fields=status` - コンテナ状態確認
- `GET {id}?fields=permalink` - 投稿 URL 取得

#### Instagram Adapter (`lib/social/instagram/instagram-adapter.ts`)

参考: Meta 公式ドキュメント（Content Publishing / Media Publish）

- `GET me?fields=user_id,username` - アカウント確認
- `POST {ig-user-id}/media` - 画像コンテナ作成
- `GET {container-id}?fields=status_code` - コンテナ状態確認
- `POST {ig-user-id}/media_publish` - 投稿確定
- `GET {id}?fields=permalink` - 投稿 URL 取得

### 分析（数値の取得）

Adapter の `fetchPostMetrics()`（投稿の数値）と `fetchFollowerCount()`（フォロワー数）で取得する。どちらも `callApi`（`lib/social/http.ts`）を通す。SNS が返さない指標は `null`（0 にしない）。呼び出しは Worker だけが行う（`docs/architecture.md` の「分析」）。

| SNS | 投稿の数値 | フォロワー数 | 必要な権限 |
|-----|-----------|-------------|-----------|
| X（`x/x-adapter.ts`） | `GET /2/tweets?ids=…&post.fields=public_metrics`（1 回で最大 100 件）。表示 = `impression_count`、いいね = `like_count`、コメント = `reply_count`、シェア = `repost_count` + `quote_count`、保存 = `bookmark_count` | `GET /2/users/me?user.fields=public_metrics` の `followers_count` | API プランによっては使えない（HTTP 402 / 403 は「X の現在の API プランでは…」と表示） |
| Threads（`threads/threads-adapter.ts`） | `GET {id}/insights?metric=views,likes,replies,reposts,quotes,shares`。表示 = `views`、コメント = `replies`、シェア = `reposts` + `quotes` + `shares`。保存は取得しない | `GET me/threads_insights?metric=followers_count` | `threads_manage_insights` |
| Instagram（`instagram/instagram-adapter.ts`） | `GET {media-id}/insights?metric=views,reach,likes,comments,shares,saved`。保存 = `saved` | `GET me?fields=followers_count` | `instagram_business_manage_insights`（フォロワー数は `instagram_business_basic` も必要） |

- リーチは Instagram のみ。X と Threads は `null`
- Instagram の `impressions` は使わない（メディアでは 2024-07-02 以降非推奨のため）
- クリック数は、どの SNS からも取得しない（API が確認できないため）。`PostMetric.clicks` は常に `null`
- 確認元：X は公式ドキュメント（Get Posts by IDs）と公式 SDK（@xdevplatform/xdk）、Threads は Meta 公式サンプル（github.com/fbsamples/threads_api）、Instagram は公式ドキュメント（Instagram Media Insights / IG User）
- 本物のキーでの数値取得は未確認（開発環境にキーがない）

### 過去投稿の読み取り（AI の参考用）

Adapter の `fetchRecentPosts(credentials, account, limit)` が返す（型は `RecentPost`、`lib/social/types.ts`）。分析の数値取得と同じ Worker の処理で呼ぶ。

| SNS | 読み取り | 注意 |
|-----|---------|------|
| X | 読まない（空を返す） | 読み取りに料金がかかるため |
| Threads（`threads/threads-adapter.ts`） | `GET me/threads?fields=id,text,timestamp,permalink&limit=…` | 本文のない投稿は飛ばす。Meta 公式サンプル（github.com/fbsamples/threads_api、ルート `/threads`）で確認 |
| Instagram（`instagram/instagram-adapter.ts`） | `GET me/media?fields=id,caption,timestamp,permalink&limit=…` | 公式の IG Media のリファレンスでは、caption は Facebook ログインの Instagram API でのみ取得できるとされている。取得できない（エラーまたは空）場合は、エラーにせず Instagram を飛ばす。本物のアカウントでは未確認 |

### 環境変数

Meta Graph API のバージョン指定（任意）：

```bash
THREADS_API_VERSION=
INSTAGRAM_API_VERSION=
```

API キーの設定：ユーザーが UI からアカウント登録時に入力（環境変数不要）

---

## Platform Capabilities（機能制約表）

`lib/social/capabilities.ts` に定義。**数値は概算のため、実装時に公式ドキュメントで再確認必須。**

| Feature | X | Instagram | Threads |
|---------|---|-----------|---------|
| **textPost** | ✓ | ✗ | ✓ |
| **imagePost** | ✓ | ✓ | ✓ |
| **videoPost** | ✓ | ✓ | ✓ |
| **scheduledPost** (native) | ✗ | ✗ | ✗ |
| **analytics** | ✓ | ✓ | ✓ |
| **deletePost** | ✓ | ✗ | ✓ |
| **requiresMedia** | ✗ | ✓ | ✗ |
| **maxTextLength** | 280 | 2200 | 500 |

### 注記

- **X**: 280 字制限。画像なしテキスト投稿可能。削除 API あり。
- **Instagram**: テキストのみ投稿は不可。画像 or ビデオが必須。ビジネスアカウント用 Graph API で連携。削除 API なし（Web UI のみ）。
- **Threads**: 500 字制限。テキストのみ投稿可能。X の兄弟サービス API。削除あり。

---

## Adapter インターフェース

```typescript
interface SocialPlatformAdapter {
  readonly platform: Platform;
  readonly capabilities: SocialPlatformCapabilities;

  // ユーザーが入力したキーを SNS に問い合わせて確認
  verifyCredentials(credentials: PlatformCredentials): Promise<VerifiedAccount>;

  // 投稿を作成
  createPost(post: PlatformPost, credentials: PlatformCredentials, account: VerifiedAccount): Promise<PublishedPost>;

  // 投稿内容を検証（テキスト長など）
  validatePost(post: PlatformPost): Promise<ValidationResult>;
}
```

### 型定義

```typescript
// ユーザーが入力するキー（平文。保存時は暗号化）
export type XCredentials = { 
  apiKey: string; 
  apiSecret: string; 
  accessToken: string; 
  accessTokenSecret: string 
};
export type TokenCredentials = { accessToken: string };
export type PlatformCredentials = XCredentials | TokenCredentials;

// キー確認で分かったアカウント情報
export interface VerifiedAccount {
  accountName: string;
  externalAccountId: string;
  tokenExpiresAt?: Date;
}

export interface PlatformPost {
  platform: Platform;
  content: string;
  mediaUrls?: string[];
  idempotencyKey: string;  // postId:socialAccountId
}

export interface PublishedPost {
  externalPostId: string;
  externalUrl?: string;
  publishedAt: Date;
  raw?: unknown;  // Debug 用 API レスポンス
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
```

---

## エラー分類

`lib/social/errors.ts` で定義。

```typescript
type SocialErrorKind = 
  | "AUTH"          // トークン切れ・無効
  | "PERMISSION"    // 権限不足
  | "CONTENT"       // 投稿内容がルール違反
  | "RATE_LIMIT"    // レート制限
  | "TRANSIENT"     // ネットワーク・5xx（リトライ可能）
  | "NOT_IMPLEMENTED"
  | "UNKNOWN";
```

### 分類の注意（Meta・HTTP 402）

Meta の権限エラー（エラーコード 10 と 200〜299）と HTTP 402 は `PERMISSION` に分類する（`lib/social/http.ts`）。Meta は権限エラーを HTTP 400 で返すため、先に判定する。

### リトライ可否判定

**リトライしない:**
```
AUTH, PERMISSION, CONTENT, NOT_IMPLEMENTED
```
→ エラー内容からユーザーアクション（再認証・再承認・本文修正）が必要

**リトライする:**
```
RATE_LIMIT, TRANSIENT, UNKNOWN
```
→ 一時的と判断。自動リトライ実施（最大 3 回、30s → 2min）

---

## セキュリティ事項

- **キー保存**: 必ず暗号化（AES-256-GCM）。平文保存厳禁。
- **キー入力**: HTTPS 通信のみ。API キーは画面で直接入力し、ブラウザの履歴に保存されないよう注意。
- **権限最小化**: SNS 側で設定可能な場合は、最小限の権限のみを有効にしておく。
- **キーの保護**: SocialAccount.credentialHint は末尾 4 文字のみ表示。完全なキーは画面に表示しない。

---

## テスト戦略

### Mock Mode テスト

```typescript
// Mock でキー検証
const adapter = new MockSocialAdapter("X");
const verified = await adapter.verifyCredentials({
  apiKey: "key1",
  apiSecret: "secret1",
  accessToken: "token1",
  accessTokenSecret: "secret_token1"
});
// → { accountName: "@mock_x_xxxx", externalAccountId: "mock-xxxxx" }

// Mock で常に成功
const result = await adapter.createPost({
  platform: "X",
  content: "Hello world",
  idempotencyKey: "post1:account123"
}, credentials, verified);
// → success

// Mock で失敗を再現
const failResult = await adapter.createPost({
  platform: "X",
  content: "Hello #mock-auth-error world",
  idempotencyKey: "post2:account123"
}, credentials, verified);
// → SocialPublishError("AUTH")
```

### Live Mode テスト（Step 11 以降）

- 実際のテストアカウント作成
- API キーを `/api/social/{platform}/connect` で登録
- `POST /api/social/accounts/{id}/verify` でキー検証
- `POST /api/posts` で投稿実行
- Error case (401, 403, 429, 5xx) 確認
