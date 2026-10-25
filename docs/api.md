# AI SNS Manager - API Reference

## 共通仕様

### 認証

全エンドポイント（`/api/register` / `/api/auth/login` を除く）は JWT トークン（Auth.js セッション）が必須。

### エラーレスポンス

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "ユーザー向けのメッセージ",
    "details": ["詳細1", "詳細2"]
  }
}
```

### HTTP ステータスコード

- `200 OK`: 成功
- `201 Created`: リソース作成成功
- `204 No Content`: 削除成功
- `400 Bad Request`: 入力検証エラー (code: `VALIDATION_ERROR`)
- `401 Unauthorized`: 認証なし
- `403 Forbidden`: 権限なし
- `404 Not Found`: リソース未検出
- `409 Conflict`: 状態遷移エラー (例: 投稿中は編集不可)
- `500 Internal Server Error`: サーバーエラー (code: `INTERNAL_ERROR`)
- `501 Not Implemented`: 未実装機能（画像・動画生成。Phase 3）

---

## 認証 API

### POST /api/register

ユーザー登録（Email + Password）。

**Request:**
```json
{
  "name": "John Doe",           // optional
  "email": "user@example.com",
  "password": "securepass123"   // min 8 chars
}
```

**Response (201):**
```json
{
  "user": {
    "id": "...",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

### POST /api/auth/callback/credentials

ログイン（Auth.js 標準フロー）。通常はフロントエンド SDK で処理。

---

## 投稿 API

### GET /api/posts

投稿一覧取得。クエリパラメータで状態フィルタ。

**Query:**
- `status`: Optional. PostStatus (DRAFT / READY / SCHEDULED / POSTING / PUBLISHED / FAILED / CANCELLED)

**Response (200):**
```json
{
  "posts": [
    {
      "id": "...",
      "userId": "...",
      "brandId": null,
      "title": "投稿タイトル",
      "topic": "話題",
      "status": "SCHEDULED",
      "approvalStatus": "PENDING",
      "scheduledAt": "2025-01-15T10:00:00Z",
      "createdAt": "...",
      "updatedAt": "...",
      "brand": null,
      "platforms": [
        {
          "id": "...",
          "postId": "...",
          "platform": "X",
          "socialAccountId": "account123",
          "accountName": "@example",
          "content": "投稿内容",
          "mediaUrls": [],
          "status": "SCHEDULED",
          "idempotencyKey": "...",
          "attempts": 0,
          "publishedAt": null,
          "externalPostId": null,
          "externalUrl": null,
          "errorMessage": null,
          "createdAt": "...",
          "updatedAt": "..."
        }
      ]
    }
  ]
}
```

### POST /api/posts

投稿作成（複数 SNS アカウント対応）。

**Request:**
```json
{
  "title": "投稿タイトル",
  "topic": "話題 (optional)",
  "brandId": null,
  "targets": [
    {
      "socialAccountId": "account123",
      "content": "280字以内のテキスト",
      "mediaUrls": []
    },
    {
      "socialAccountId": "account456",
      "content": "2200字以内のテキスト",
      "mediaUrls": ["https://..."]
    }
  ]
}
```

`aiGenerated`（任意）は、`POST /api/ai/drafts` の案を採用したときに `{ "model": "claude-sonnet-5-5", "style": "howto" }` を渡す（`model` 100字以内、`style` 50字以内。型の列挙は検証しない）。指定すると `Post.aiGenerated = true` になり、作成時に `AI_GENERATED` の PostLog（metadata に model / style）が残る。省略・`null` は手動作成。承認モードが `AI_ONLY` のとき、AI 由来の投稿は承認待ち（PENDING）になる。

**Response (201):**
```json
{
  "post": { /* 投稿オブジェクト */ }
}
```

### GET /api/posts/{id}

投稿詳細取得（ログ履歴含む）。

**Response (200):**
```json
{
  "post": {
    "id": "...",
    "platforms": [
      {
        "id": "...",
        "logs": [
          {
            "id": "...",
            "postPlatformId": "...",
            "event": "POST_CREATED",
            "status": "INFO",
            "message": "投稿を作成しました",
            "metadata": null,
            "createdAt": "..."
          }
        ]
      }
    ],
    "..."
  }
}
```

### PATCH /api/posts/{id}

投稿編集。投稿中・投稿済みは編集不可。

**Request:**
```json
{
  "title": "新しいタイトル",
  "topic": "新しい話題",
  "targets": [
    { "socialAccountId": "account123", "content": "新しい内容", "mediaUrls": [] }
  ]
}
```

`aiGenerated` も POST と同じ形式で指定できる。一度 `true` になった投稿は PATCH で `false` に戻らない。`AI_GENERATED` のログは作成時のみ残り、PATCH では追加されない。

**Response (200):**
```json
{
  "post": { /* 更新済み投稿オブジェクト */ }
}
```

### DELETE /api/posts/{id}

投稿削除。予約済みはキャンセルされる。投稿中は削除不可。

**Response (204):** No Content

### POST /api/posts/{id}/approve

投稿承認。

**Request:**
```json
{}  // No body
```

**Response (200):**
```json
{
  "post": { /* 承認済み投稿オブジェクト */ }
}
```

### POST /api/posts/{id}/reject

投稿却下。

**Request:**
```json
{}  // No body
```

**Response (200):**
```json
{
  "post": { /* 却下済み投稿オブジェクト */ }
}
```

### POST /api/posts/{id}/schedule

予約（スケジュール）投稿。リトライで承認も可能。

**Request:**
```json
{
  "scheduledAt": "2025-01-15T10:00:00Z",
  "approve": true  // optional: 予約と同時に承認
}
```

**Response (200):**
```json
{
  "post": { /* 予約済み投稿オブジェクト */ }
}
```

### POST /api/posts/{id}/cancel

予約取消。

**Request:**
```json
{}  // No body
```

**Response (200):**
```json
{
  "post": { /* 予約取消済み投稿オブジェクト */ }
}
```

### POST /api/posts/{id}/publish

今すぐ投稿する。Web リクエスト内では投稿せず、即時実行のジョブとしてキューに登録する（実際の投稿は Worker が行う）。中身は `scheduledAt` を現在時刻にした予約と同じ。

**Request（任意）:**
```json
{ "approve": true }
```
`approve: true` を付けると、承認待ちの投稿を作成者の承認として扱ってから登録する。

**Response (200):**
```json
{
  "post": { /* 予約済み（すぐ実行される）投稿オブジェクト */ }
}
```

エラーは予約（`/schedule`）と同じ（`APPROVAL_REQUIRED`、`VALIDATION_ERROR` など）。

### POST /api/posts/{id}/generate

既存の投稿の `topic`（なければ `title`）と `brandId` で投稿案を作る。投稿自体は変更しない。他人の投稿は 404。

**Request（任意）:** `POST /api/ai/drafts` と同じ項目。指定すると既存値より優先する（body 省略可。不正な JSON は無視）。

**Response (200):** `POST /api/ai/drafts` と同じ（`drafts` / `model` / `provider`）。

---

## AI API

### POST /api/ai/drafts

テーマとブランドから投稿案を作る。**案は保存しない**。採用する案は `POST /api/posts` に `aiGenerated` を付けて保存する。

**Request:**
```json
{
  "topic": "新メニューの紹介",
  "objective": "来店促進",
  "brandId": "brand123",
  "styles": ["brand_intro", "empathy"]
}
```

- `topic`: 1000字以内。省略時は空（ブランドの投稿テーマの柱から選ばれる）
- `objective`: 500字以内（任意）
- `brandId`: 任意。自分のブランドのみ（他人のブランドは 404）
- `styles`: `brand_intro` / `empathy` / `story` / `howto` / `question` から最大5件。省略・空配列なら5型すべて

**Response (200):**
```json
{
  "drafts": [
    {
      "id": "uuid",
      "style": "empathy",
      "title": "...",
      "summary": "...",
      "x": { "text": "..." },
      "instagram": { "caption": "...", "hashtags": ["#..."] },
      "threads": { "text": "..." },
      "errors": [],
      "warnings": ["Xの文章にURLが含まれています。..."]
    }
  ],
  "model": "claude-sonnet-5-5",
  "provider": "claude"
}
```

- `drafts`: 依頼した型の順。`PostDraft`（`style` / `title` / `summary` / `x` / `instagram` / `threads`）に `id` / `errors` / `warnings` を加えた `CheckedDraft`
- `errors`: 作り直しても直らなかった問題（禁止キーワード、文字数超過など）。保存時には検証されず、予約・投稿時の投稿前チェックで確認される
- `warnings`: 注意のみ（URL、ハッシュタグの多さなど）
- `provider`: `claude` または `mock`（mock のときの `model` は `"mock"`）

AI のエラーは `AI_*` コード（下の一覧）で返す。

---

## SNS 連携 API

### GET /api/social/accounts

接続済み SNS アカウント一覧。

**Response (200):**
```json
{
  "accounts": [
    {
      "id": "...",
      "platform": "X",
      "accountName": "@example",
      "label": "メインアカウント",
      "credentialHint": "••••abcd",
      "status": "CONNECTED",
      "isMock": true,
      "lastCheckedAt": "2025-01-01T00:00:00Z",
      "lastError": null,
      "brandId": null,
      "createdAt": "..."
    }
  ],
  "mode": "mock"  // "mock" | "live"
}
```

### POST /api/social/{platform}/connect

API キーを入力してアカウントを連携。`platform`: X / INSTAGRAM / THREADS

**Request:**
```json
{
  "label": "メインアカウント (optional)",
  "brandId": null,
  "credentials": {
    "apiKey": "...",
    "apiSecret": "...",
    "accessToken": "...",
    "accessTokenSecret": "..."
  }
}
```

**Response (201):**
```json
{
  "account": { /* SocialAccount */ }
}
```

### PATCH /api/social/accounts/{id}

アカウントの表示名、ブランド割り当て、キーを更新。キーの値が別のアカウントのものなら 400 (ACCOUNT_MISMATCH)。

**Request:**
```json
{
  "label": "新しい名前 (optional)",
  "brandId": null,
  "credentials": { /* 新しいキー (optional) */ }
}
```

**Response (200):**
```json
{
  "account": { /* 更新済み SocialAccount */ }
}
```

### POST /api/social/accounts/{id}/verify

保存済みのキーが今も有効か確認。

**Request:**
```json
{}  // No body
```

**Response (200):**
```json
{
  "account": { /* 検証済み SocialAccount */ }
}
```

### DELETE /api/social/accounts/{id}

SNS アカウント切断。

**Response (204):** No Content

---

## ブランド管理 API

### GET /api/brands

ブランド一覧。

**Response (200):**
```json
{
  "brands": [
    {
      "id": "...",
      "userId": "...",
      "name": "Brand Name",
      "description": "説明",
      "targetAudience": "ターゲット層",
      "brandImage": "URL",
      "tone": "トーン",
      "objective": "目的",
      "avoidExpressions": "避ける表現",
      "keywords": ["キーワード1"],
      "prohibitedWords": ["禁止語1"],
      "contentPillars": ["柱1"],
      "isSample": false,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### POST /api/brands

ブランド作成。

**Request:**
```json
{
  "name": "Brand Name",
  "description": "説明 (optional)",
  "targetAudience": "ターゲット層 (optional)",
  "brandImage": "URL (optional)",
  "tone": "トーン (optional)",
  "objective": "目的 (optional)",
  "avoidExpressions": "避ける表現 (optional)",
  "keywords": ["キーワード1"],
  "prohibitedWords": ["禁止語1"],
  "contentPillars": ["柱1"]
}
```

**Response (201):**
```json
{
  "brand": { /* ブランドオブジェクト */ }
}
```

### PATCH /api/brands/{id}

ブランド編集。

**Request:** (同上)

**Response (200):**
```json
{
  "brand": { /* 更新済みブランドオブジェクト */ }
}
```

### DELETE /api/brands/{id}

ブランド削除。

**Response (204):** No Content

---

## 設定 API

### GET /api/settings

ユーザー設定取得。

**Response (200):**
```json
{
  "settings": {
    "approvalMode": "ALWAYS"  // "ALWAYS" | "AI_ONLY" | "AUTO"
  }
}
```

### PATCH /api/settings

ユーザー設定更新。

**Request:**
```json
{
  "approvalMode": "ALWAYS"
}
```

**Response (200):**
```json
{
  "settings": { /* 更新済み設定 */ }
}
```

---

## カレンダー API

### GET /api/calendar

予約済み投稿をカレンダー形式で取得。

**Query:**
- `month`: "YYYY-MM" 形式

**Response (200):**
```json
{
  "events": [
    {
      "date": "2025-01-15",
      "posts": [
        {
          "id": "...",
          "title": "投稿タイトル",
          "scheduledAt": "2025-01-15T10:00:00Z",
          "platforms": ["X", "INSTAGRAM"]
        }
      ]
    }
  ]
}
```

---

## メディア生成 API（Phase 3）

### POST /api/media/generate

テキストから画像を AI 生成。

**Response (501):** Not Implemented

---

## エラーコード一覧

| Code | 説明 | HTTP |
|------|------|------|
| VALIDATION_ERROR | 入力検証失敗 | 400 |
| INVALID_STATE | 状態遷移エラー | 409 |
| INVALID_SCHEDULE | スケジュール日時が過去 | 400 |
| NOT_EDITABLE | 編集・削除不可な状態 | 409 |
| APPROVAL_REQUIRED | 承認待ち | 409 |
| QUEUE_UNAVAILABLE | ジョブキュー利用不可 | 503 |
| NOT_FOUND | リソース未検出 | 404 |
| INTERNAL_ERROR | サーバーエラー | 500 |
| NOT_IMPLEMENTED | 未実装 | 501 |
| AI_NOT_CONFIGURED | AI の APIキーが未設定 | 503 |
| AI_AUTH | AI の APIキーが不正、または権限なし | 502 |
| AI_RATE_LIMIT | AI のレート制限 | 429 |
| AI_REFUSAL | モデルが内容を断った | 422 |
| AI_INVALID_OUTPUT | 出力が形式どおりにならない・途中で打ち切り・リクエスト不正・案が1つも作れなかった | 502 |
| AI_UNAVAILABLE | AI に接続できない（通信エラー・5xx など） | 503 |
