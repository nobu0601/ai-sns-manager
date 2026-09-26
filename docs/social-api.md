# AI SNS Manager - Social Platform Integration

## Mock Mode（開発・テスト用）

### 概要

`MockSocialAdapter` は本物の SNS API を呼ばず、シミュレーション応答を返す。

**有効化:**
```bash
SOCIAL_PROVIDER_MODE=mock  # デフォルト
```

### Mock OAuth フロー

1. `/api/social/{platform}/connect` で Mock 認可 URL を取得
2. ブラウザが `/api/social/{platform}/callback` へリダイレクト
3. Mock コールバック処理で認可完了

```
getAuthorizationUrl() → URL を即座に callback へ改変
  ↓
handleCallback() → mock アカウント情報返却
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

---

## Live Mode（本番・Step 11 以降）

現在 **未実装**。以下は実装時の参照。

### 実装ステップ

- **Step 11**: X API
- **Step 12**: Instagram Graph API
- **Step 13**: Threads API

### Adapter 実装チェックリスト

各 SNS 実装時に必ず確認すること：

#### 1. OAuth フロー（公式ドキュメント確認）

- [ ] Authorization endpoint URL
- [ ] Token endpoint URL
- [ ] Required scopes
- [ ] Code flow vs PKCE
- [ ] Refresh token support
- [ ] Token expiration handling
- [ ] Rate limit on auth endpoints

#### 2. Post 作成 API（公式ドキュメント確認）

- [ ] Endpoint URL
- [ ] Request body format
- [ ] Text content constraints (max length, character encoding)
- [ ] Media upload support (endpoint, format, size limits)
- [ ] Required vs optional fields
- [ ] Idempotency key support
- [ ] Response format (ID extraction)
- [ ] Error codes and messages

#### 3. Post 削除 API（公式ドキュメント確認）

- [ ] Delete endpoint availability
- [ ] Required permissions
- [ ] Response format

#### 4. Rate Limits & Quotas（公式ドキュメント確認）

- [ ] Posts per day / month
- [ ] Requests per hour / minute
- [ ] Media upload limits
- [ ] Burst vs sustained rate limits
- [ ] Reset timing
- [ ] Rate limit headers in responses

#### 5. Pricing（確認事項）

- [ ] Free tier usage limits
- [ ] Paid plan requirements
- [ ] Cost per API call
- [ ] Media hosting costs

#### 6. テスト

- [ ] Sandbox / Development environment available
- [ ] Test credentials setup
- [ ] Error case testing (4xx, 5xx)
- [ ] Token expiration / refresh flow
- [ ] Media upload edge cases
- [ ] Concurrent request handling

### Redirect URI 形式

```
https://{HOST}/api/social/{platform}/callback
```

**例:**
- `https://example.com/api/social/X/callback`
- `https://example.com/api/social/INSTAGRAM/callback`
- `https://example.com/api/social/THREADS/callback`

### 環境変数

各 SNS ごとに OAuth クライアント認証情報を `.env` に設定：

```bash
X_CLIENT_ID=<from twitter developer portal>
X_CLIENT_SECRET=<secret>

INSTAGRAM_CLIENT_ID=<from facebook app>
INSTAGRAM_CLIENT_SECRET=<secret>

THREADS_CLIENT_ID=<from threads app>
THREADS_CLIENT_SECRET=<secret>
```

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

  // OAuth フロー
  getAuthorizationUrl(input: { state: string; redirectUri: string }): 
    Promise<AuthorizationRequest>;
  
  handleCallback(input: { 
    code: string; 
    redirectUri: string; 
    codeVerifier?: string 
  }): Promise<ConnectedAccount>;

  // Token 管理
  refreshToken(account: ConnectedAccount): Promise<ConnectedAccount>;

  // 投稿操作
  createPost(post: PlatformPost, account: ConnectedAccount): Promise<PublishedPost>;
  
  deletePost?(externalPostId: string, account: ConnectedAccount): Promise<void>;

  // 検証
  validatePost(post: PlatformPost): Promise<ValidationResult>;
}
```

### 型定義

```typescript
export interface ConnectedAccount {
  platform: Platform;
  accountName: string;
  externalAccountId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scopes?: string[];
}

export interface PlatformPost {
  platform: Platform;
  content: string;
  mediaUrls?: string[];
  idempotencyKey: string;  // postId:platform
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

- **トークン保存**: 必ず暗号化（AES-256-GCM）。平文保存厳禁。
- **API キー**: `.env` から読み込み。コードに埋め込まない。
- **Scope 最小化**: 最小限の権限のみリクエスト。
- **HTTPS 必須**: OAuth callback は HTTPS のみ。
- **State 検証**: CSRF state を必ず検証。
- **Refresh token**: 利用可能な場合は積極的に更新。

---

## テスト戦略

### Mock Mode テスト

```typescript
// Mock で常に成功
const adapter = new MockSocialAdapter("X");
const result = await adapter.createPost({
  platform: "X",
  content: "Hello world",
  idempotencyKey: "post1:X"
}, account);
// → success

// Mock で失敗を再現
const failResult = await adapter.createPost({
  platform: "X",
  content: "Hello #mock-auth-error world",
  idempotencyKey: "post2:X"
}, account);
// → SocialPublishError("AUTH")
```

### Live Mode テスト（Step 11 以降）

- Sandbox API エンドポイント使用
- Test アカウント作成
- Token expiration / refresh フロー検証
- Error case (401, 403, 429, 5xx) 確認
