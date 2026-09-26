# CLAUDE.md

Claude Code が `ai-sns-manager` を開発するときに必ず従うルールです。
README.md は利用者向け、CLAUDE.md は開発エージェント向けです。未完了の作業は `TODO.md` にあります。

## 1. プロジェクト目的

X・Instagram・Threads への投稿を一元管理し、AI による投稿生成・画像/動画生成・予約投稿・結果管理・分析まで行う。
最終目標は「SNS 運用を AI が支援・自動化するプラットフォーム」。
Phase 1（MVP）→ 2（AI 生成）→ 3（メディア生成・Agent）→ 4（分析）の順に進め、**Phase を飛ばさない**。

## 2. アーキテクチャ

```
app/ (pages, app/api Route Handlers)   HTTP・画面。ロジックを書きすぎない
  ↓
lib/* サービス層                        posts/ social/ brands/ dashboard/ queue/ …
  ↓
Prisma (lib/database/prisma.ts)        DB アクセス
  ↓
PostgreSQL

workers/post-worker.ts                 BullMQ Worker。投稿の実行は必ずここ
```

- SNS は `lib/social/types.ts` の `SocialPlatformAdapter` を実装する。呼び出し側は `getAdapter(platform)` だけを使う
- SNS ごとの差（文字数、メディア必須など）は `lib/social/capabilities.ts` の `SocialPlatformCapabilities` で表す。`if (platform === "X")` のような分岐を増やさない
- AI（Phase 2）は `lib/ai/`（AIService + Provider）、メディア（Phase 3）は `lib/media/`（MediaGenerationService + Provider）に置き、**SNS 投稿処理と分離する**
- 画面は `app/(app)/`（ログイン必須）と `app/(auth)/`。共通 UI は `components/common/`
- ページ（Server Component）はサービス層を直接呼んでよい。クライアントからは `lib/client/api.ts` の `apiFetch` で API を呼ぶ

## 3. 開発ルール

- 作業開始時：現在のコード → README → CLAUDE.md → TODO.md を確認し、既存実装との整合を取ってから設計する
- 作業完了時：`npm run lint` / `npm run typecheck` / `npm test` / `npm run build` を通し、README を更新する
- UI の文言は日本語。技術的なエラー（例：`OAuthException code 190`）を画面に出さない。`lib/errors/user-messages.ts` で「次に何をすればよいか」が分かる文にし、元エラーは `PostLog.metadata` とサーバーログへ
- 投稿は Web リクエスト内で実行しない。`schedulePost()` → キュー → Worker → `publishPostPlatform()`
- 状態は `Post.status`（全体）と `PostPlatform.status`（SNS 別）。全体は `computePostStatus()` で SNS 別から集計する。直接書き換えない
- 投稿・承認・予約・失敗・リトライは `writePostLog()` で必ず記録する
- 実装できない機能は TODO を放置せず、README の「未実装機能」に理由を書く
- DB 変更は `prisma migrate dev --name <内容>` でマイグレーションを作る（`db push` は使わない）

## 4. 命名規則

- ファイル：サービスは `kebab-case.ts`（`post-service.ts`）、React コンポーネントは `PascalCase.tsx`
- Adapter：`<Platform>Adapter`（`XAdapter`）を `lib/social/<platform>/<platform>-adapter.ts` に
- enum 値・定数：`UPPER_SNAKE_CASE`。Prisma の enum を正とし、TS 側で別の文字列表現を作らない
- API：REST。`/api/<resource>/[id]/<action>`（例 `/api/posts/[id]/approve`）
- エラー：業務エラーは `ServiceError(status, message, code)`、SNS エラーは `SocialPublishError(kind, …)`

## 5. セキュリティルール

- SNS のログイン情報・パスワードを保存しない。接続は OAuth のみ
- OAuth トークンは `lib/encryption/crypto.ts`（AES-256-GCM, `ENCRYPTION_KEY`）で暗号化して保存。画面・API レスポンスに出さない（`SocialAccountView` を使う）
- API キー・秘密情報はすべて環境変数。`.env` はコミットしない。新しい変数は `.env.example` と README に追記する
- ログ出力は `lib/logging/logger.ts` を使う（token / secret / password 等のキーは自動マスク）。`console.log` を直接使わない
- すべての API で `requireUserId()` を呼び、クエリは必ず `userId` で絞る（他ユーザーのデータは 404）
- OAuth の `state` は一度きり・10 分で失効。PKCE の `code_verifier` も暗号化して保存

## 6. テストルール

- テストは `tests/unit`（DB 不要）、`tests/integration`（`TEST_DATABASE_URL` / `REDIS_URL` があれば実行）、`tests/e2e`（Playwright）
- 新しいサービス関数・Adapter には単体テストか統合テストを追加する
- 統合テストはキューを `setPublishScheduler()` で差し替えてよい。開発用 DB を使わない
- テストを skip・削除して通すことはしない

## 7. SNS API ルール

- 公式 API を使う。**非公式スクレイピングやブラウザ自動操作で投稿しない**
- 実装前に必ず公式ドキュメント → 公式 SDK → 公式 GitHub の順で現行仕様を確認する。**推測で実装しない**
- 文字数・メディア要件・レート制限などは変わりうるので `capabilities.ts` で管理し、実装時に再確認して更新する
- `SOCIAL_PROVIDER_MODE=mock` で API を呼ばずに開発・テストできる状態を維持する
- エラーは `SocialErrorKind` に分類する。AUTH / PERMISSION / CONTENT は再試行しない（無限リトライ禁止）
- 二重投稿防止：冪等キー `postId:platform`。Worker は `updateMany` による状態の取得（claim）後にのみ投稿する
- 新しい SNS の追加：Prisma の `Platform` enum に追加 → Adapter 実装 → `registry.ts` と `capabilities.ts` に登録 → `PLATFORM_LABELS` に表示名

## 8. AI ルール（Phase 2 以降）

- プロンプトはコードに直書きせず `prompts/`（post-generation / x / instagram / threads / image / video）に置く
- AI の出力は Structured Output / JSON Schema で受け、zod で検証してから保存する。検証失敗時はリトライ
- 生成後に文字数・禁止ワード・ブランドルール・重複・URL・ハッシュタグ・SNS 仕様をチェックし、問題があれば再生成
- AI が生成した投稿は `initialApprovalStatus(mode, "ai")` で承認状態を決める。初期モードは「常に承認」
- AI 生成内容はユーザーが編集できること。AI 分析の結果は「参考情報」として根拠データと並べて表示する
