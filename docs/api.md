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

`targets[].mediaType`（任意）は `"IMAGE"` / `"VIDEO"` / `null`。`mediaUrls` が空のときは保存されず `null` になる。PATCH も同じ形式。

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
      "tiktok": { "text": "..." },
      "errors": [],
      "warnings": ["Xの文章にURLが含まれています。..."]
    }
  ],
  "model": "claude-sonnet-5-5",
  "provider": "claude"
}
```

- `drafts`: 依頼した型の順。`PostDraft`（`style` / `title` / `summary` / `x` / `instagram` / `threads` / `tiktok`）に `id` / `errors` / `warnings` を加えた `CheckedDraft`
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

API キーを入力してアカウントを連携。`platform`: X / INSTAGRAM / THREADS（TikTok は下の OAuth 連携を使い、このルートでは連携しない）

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

### GET /api/social/tiktok/authorize

「TikTokでログインして連携」のボタンが開くルート。ランダムな `state` を httpOnly Cookie `tiktok_oauth_state` に保存し、TikTok の認可画面（`https://www.tiktok.com/v2/auth/authorize/`）へリダイレクトする。送るパラメータ：`client_key`、`response_type=code`、`scope=user.info.basic,video.publish`、`redirect_uri`、`state`。

- Mock モード（`SOCIAL_PROVIDER_MODE=mock`）では TikTok を呼ばず、架空のアカウントを作る

### GET /api/social/tiktok/callback

TikTok が認可後に戻すルート。`state` が Cookie と一致するか確認し、`code` をアクセストークンに交換する（`POST https://open.tiktokapis.com/v2/oauth/token/`、`grant_type=authorization_code`）。付与されたスコープに `video.publish` が無い場合は失敗する。成功するとアカウントを保存し、`/accounts?tiktok=…` にリダイレクトして画面にバナーを出す。

| `tiktok` の値 | 意味 |
| --- | --- |
| `connected` | 連携できた |
| `denied` | TikTok の許可画面で許可されなかった |
| `not_configured` | TikTok の設定（`TIKTOK_CLIENT_KEY` など）がない |
| `failed` | 連携に失敗した（`state` の不一致、`video.publish` の不足など） |

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

## 画像・動画 API

生成は Worker が行う（数十秒〜数分）。`POST` は `PENDING` の Media を返すので、`GET /api/media/{id}` で `status` を確認する。

### POST /api/media/generate

画像または動画の生成を登録する。**Response (202):** `{ "media": { "id": "...", "status": "PENDING", ... } }`

**Request:** `{ "type": "IMAGE", "idea": "店内の窓際で作業する人の後ろ姿", "aspectRatio": "4:5", "brandId": null, "postId": null }`

- `type`: `IMAGE` / `VIDEO`。`aspectRatio`: `1:1`（既定）/ `4:5` / `9:16` / `16:9`
- `idea`: 日本語のイメージ（1〜500字）。英語の生成プロンプトは AI が作り、`Media.prompt`（動画は `script` も）に保存する
- `brandId` / `postId`: 任意。他人のものは 404。`postId` を指定すると、完成時に同じ投稿の、その種類を投稿できる DRAFT の投稿先に自動で添付される

キューに登録できなければ 503（`QUEUE_UNAVAILABLE`）。生成の失敗は API のエラーではなく、`Media.status = FAILED` と `errorMessage` に残る。

### GET /api/media

最近できあがった（`status = READY`）画像・動画を最大12件。**Response (200):** `{ "media": [ ... ] }`

### GET /api/media/{id}

1件の状態と URL。**Response (200):** `{ "media": { "status": "READY", "url": "https://...", "prompt": "...", ... } }`。`status`: `PENDING` / `GENERATING` / `READY` / `FAILED`

---

## AI Agent API

ブランドごとの設定と、今後7日間の投稿計画を作る Agent の API。計画の作成は Worker が行う。

### GET /api/agent/config?brandId=…

設定を取得（未設定なら `{ "config": null }`）。**PUT /api/agent/config?brandId=…** で保存する。`brandId` を省略すると 400。

**Request（PUT）:** `{ "weeklyEnabled": true, "runWeekday": 1, "runTime": "09:00", "postsPerWeek": 3, "preferredWeekdays": [1, 3, 5], "preferredTime": "12:00", "targetAccountIds": ["account123"], "generateImages": false }`

- `runWeekday`（0=日〜6=土）と `runTime`（HH:mm）は毎週の自動実行の日時（日本時間）。`weeklyEnabled: false` にすると登録を解除する
- `postsPerWeek`: 1〜7。`preferredWeekdays` / `preferredTime`: 投稿枠の優先曜日・時刻
- `targetAccountIds`: 自分の SNS アカウントのみ（他人のものは 404）。最大20件。TikTok のアカウントは指定できない（`AGENT_UNSUPPORTED_PLATFORM`）
- `generateImages`: `true` なら投稿ごとに画像を生成する。Instagram を投稿先に含む場合は、この値にかかわらず生成する

**Response (200):** `{ "config": { ... } }`（`AgentConfig` のフィールド）

### POST /api/agent/run

`{ "brandId": "brand123" }` で、今後7日間の投稿を作る実行を登録する。**Response (202):** `{ "run": { "id": "...", "status": "QUEUED", ... } }`

- 投稿先が未設定なら 400（`AGENT_NOT_CONFIGURED`）。同じブランドが実行中なら 409（`AGENT_RUNNING`）

### GET /api/agent/runs?brandId=…

実行記録の一覧（新しい順、最大10件）。`brandId` 省略時はすべてのブランド。**Response (200):** `{ "runs": [ ... ] }`（各 run は `brand` と `posts` を含む）

### GET /api/agent/runs/{id}

1件の実行記録。`plan`（投稿枠ごとのテーマ・型・理由）と `summary` を含む。**Response (200):** `{ "run": { ... } }`

### POST /api/agent/runs/{id}/approve

実行で作られた投稿をまとめて承認し、計画した日時で予約する。**Response (200):** `{ "results": [ { "postId": "...", "title": "...", "ok": true }, { "postId": "...", "title": "...", "ok": false, "message": "計画した日時を過ぎています…" } ] }`

対象は `DRAFT` / `READY` の投稿のみ。承認モードが `AUTO` の投稿は作成時に予約済みのため対象外。

---

## 分析 API

投稿の数値・フォロワー数の表示、数値の取得、AI 分析の API。SNS からの取得と AI 分析は Worker が行う。

### GET /api/analytics?brandId=…&days=7|30|90

分析画面の内容（投稿の数値・集計・フォロワー数）を返す。`days` は 7 / 30 / 90 のいずれか（省略・それ以外は 30）。`brandId` は自分のブランドのみ（他人のものは 404）。

### POST /api/analytics/refresh

自分の SNS アカウントの数値を今すぐ取り直す。処理は Worker。**Response (202):** `{ "ok": true }`

### POST /api/analytics/analyze

AI 分析を登録する。**Request:** `{ "brandId": "brand123" }`。**Response (202):** `{ "report": { "id": "...", "status": "QUEUED", ... } }`

- 同じブランドの分析が実行中なら 409（`ANALYSIS_RUNNING`）
- 結果は `GET /api/analytics/reports` で確認する（`status` が `COMPLETED` になれば完了）

### GET /api/analytics/reports?brandId=…

分析結果の一覧（新しい順、最大 5 件）。`brandId` を省略すると 400（`VALIDATION_ERROR`）。**Response (200):** `{ "reports": [ ... ] }`

### GET /api/analytics/reports/{id}

1件の分析結果（`result` と根拠の `evidence` を含む）。他人のものは 404。**Response (200):** `{ "report": { ... } }`

---

## 公開ページ（ログイン不要）

| パス | 内容 |
| --- | --- |
| `/terms` | 利用規約 |
| `/privacy` | プライバシーポリシー |

運営者名と連絡先は `LEGAL_OPERATOR_NAME` / `LEGAL_CONTACT_EMAIL` を表示する。文面は草案で、運営者が確認してから使う。ログイン不要の公開パス（`auth.config.ts`）。TikTok のアプリ登録では両方の URL が必要。

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
| AGENT_NOT_CONFIGURED | AI Agent の投稿先が未設定 | 400 |
| AGENT_RUNNING | 同じブランドの計画を作成中 | 409 |
| AGENT_UNSUPPORTED_PLATFORM | AI Agent の投稿先に、対応していない SNS（TikTok）を指定した | 400 |
| ANALYSIS_RUNNING | 同じブランドの分析を実行中 | 409 |
| AI_NOT_CONFIGURED | AI の APIキーが未設定 | 503 |
| AI_AUTH | AI の APIキーが不正、または権限なし | 502 |
| AI_RATE_LIMIT | AI のレート制限 | 429 |
| AI_REFUSAL | モデルが内容を断った | 422 |
| AI_INVALID_OUTPUT | 出力が形式どおりにならない・途中で打ち切り・リクエスト不正・案が1つも作れなかった | 502 |
| AI_UNAVAILABLE | AI に接続できない（通信エラー・5xx など） | 503 |
