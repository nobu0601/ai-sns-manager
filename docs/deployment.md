# デプロイ

AI SNS Manager の本番運用には次の 4 つが必要です。

| 構成要素 | 役割 | 起動コマンド |
| --- | --- | --- |
| Web | 画面と API（Next.js） | `npm run start` |
| Worker | 予約投稿・画像/動画の生成・AI Agent の実行・分析（BullMQ） | `npm run worker` |
| PostgreSQL | データ保存 | マネージドDBを推奨 |
| Redis | ジョブキュー | マネージドRedisを推奨 |

**Worker は Web とは別の常駐プロセスです。** Worker が止まっていると、予約した投稿は実行されません。画像・動画の生成と、AI Agent の実行（毎週の自動実行を含む）も止まります。分析（数値の取得・AI 分析）も止まります。

### Worker の構成

`npm run worker` は次の4つを1プロセスで起動します。

| Worker | 単独で起動するコマンド | 担当 |
| --- | --- | --- |
| post | `npm run worker:post` | 予約投稿の実行 |
| media | `npm run worker:media` | 画像・動画の生成 |
| ai | `npm run worker:ai` | AI Agent（ボタンからの実行と毎週の自動実行） |
| analytics | `npm run worker:analytics` | 投稿の数値の取得（6 時間ごと・「数値を更新」）と AI 分析 |

分けて動かす場合も、各 Worker に Web と同じ環境変数を設定してください。

## 必須の環境変数

`.env.example` を参照してください。本番では少なくとも次を設定します。

| 変数 | 内容 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 接続文字列 |
| `REDIS_URL` | Redis 接続文字列 |
| `AUTH_SECRET` | `openssl rand -base64 32` で生成 |
| `AUTH_URL` | 公開URL（例 `https://sns.example.com`） |
| `AUTH_TRUST_HOST` | リバースプロキシ配下（Render / Railway 等）では `true` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` で生成。**運用開始後に変更しない**（保存済みの SNS APIキーが復号できなくなる） |
| `SOCIAL_PROVIDER_MODE` | `live` で実際に投稿する（`mock` は投稿しない）。SNS の APIキーは画面から登録する |
| `ANTHROPIC_API_KEY` | Claude の APIキー（AI 投稿生成で使用。未設定なら AI は Mock で動作） |

分析（Phase 4）で新しく追加した環境変数はありません。

Web と Worker には**同じ値**を設定してください（特に `DATABASE_URL`、`REDIS_URL`、`ENCRYPTION_KEY`、`SOCIAL_PROVIDER_MODE`）。AI・画像生成の設定（下の表）も両方で揃えてください。

### AI・画像生成の環境変数

| 変数 | 内容 |
| --- | --- |
| `AI_PROVIDER_MODE` | `claude` / `mock`。未設定なら `ANTHROPIC_API_KEY` があれば claude、なければ mock |
| `ANTHROPIC_MODEL` | 使うモデル。未設定なら `claude-sonnet-5-5` |
| `ANTHROPIC_EFFORT` | 考える深さ（`low` / `medium` / `high`）。未設定なら `medium`。上げると品質は上がるが、時間と料金が増える |
| `MEDIA_PROVIDER_MODE` | `fal` / `mock`。未設定なら `FAL_KEY` があれば fal、なければ mock。`fal` のときに `FAL_KEY` がないと生成は失敗する |
| `FAL_KEY` | fal.ai の API キー（画像・動画の生成） |
| `FAL_IMAGE_MODEL` | 画像モデル。未設定なら `fal-ai/flux-1/schnell` |
| `FAL_VIDEO_MODEL` | 動画モデル。未設定なら `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` |

Mock の画像はプレースホルダー、Mock の動画は再生できない架空の URL です。本番の投稿には使わないでください。

## ビルドとリリース手順

```bash
npm ci
npm run build        # prisma generate + next build
npm run db:deploy    # マイグレーション適用（リリースごとに1回）
```

その後、Web（`npm run start`）と Worker（`npm run worker`）を起動します。
`npm run db:seed` は開発用のサンプルデータ投入です。**本番環境（`NODE_ENV=production`）では実行されません。**

## デプロイ先の構成例

### Render / Railway

どちらも「Web サービス + バックグラウンドワーカー + PostgreSQL + Redis」を同じプロジェクト内に用意できます。

- Web サービス：Build `npm ci && npm run build`、Start `npm run db:deploy && npm run start`
- ワーカー：Build `npm ci && npm run build`、Start `npm run worker`（1つで投稿・画像生成・Agent・分析をすべて処理する）
- PostgreSQL と Redis を追加し、接続文字列を `DATABASE_URL` / `REDIS_URL` に設定

料金プラン・無料枠・スリープの有無などは変わるため、各サービスの公式ドキュメントで確認してください。
無料プランで Web がスリープしても予約投稿は Worker が実行しますが、**Worker がスリープするプランでは予約投稿が遅れます**。

### Vercel

Vercel で Web を動かすことはできますが、常駐する Worker は動かせません。
Worker は Render / Railway / 自前サーバーなど別の場所で動かし、同じ PostgreSQL・Redis に接続してください。

## 動作確認

- Web：ログイン画面（`/login`）が表示されること
- Worker：起動ログに `worker.ready` が4回（`post-publish` / `media-generate` / `agent-run` / `analytics`）出ること
- 投稿を「今すぐ投稿」し、数秒で「投稿済み」になること（live モードではテスト用アカウントで確認する）

専用のヘルスチェックAPIはまだありません（TODO.md に記載）。

## ログ

アプリのログは1行1JSONで標準出力に出ます（`lib/logging/logger.ts`）。トークン・パスワード等のキーは自動でマスクされます。
投稿ごとの履歴は DB の `PostLog` にも残り、投稿詳細画面で確認できます。

## トラブルシューティング

| 症状 | 確認すること |
| --- | --- |
| 予約した投稿が実行されない | Worker が起動しているか、Web と同じ `REDIS_URL` を使っているか |
| 「予約処理を開始できませんでした」 | Web から Redis に接続できるか |
| ログイン後すぐログイン画面に戻る | `AUTH_SECRET`、`AUTH_URL`、`AUTH_TRUST_HOST` |
| 「アカウントが接続されていません」 | Web と Worker の `SOCIAL_PROVIDER_MODE` が同じか（Mock と live のアカウントは混在不可） |
| トークンの復号エラー | `ENCRYPTION_KEY` が Web と Worker で同じか、変更していないか |
| 画像・動画が「生成中」のまま | Worker（`npm run worker`）が起動しているか。FAILED のときは `errorMessage` の理由を確認し、`FAL_KEY` / `MEDIA_PROVIDER_MODE` を見直す |
| AI Agent の計画が「実行中」のまま | Worker が起動しているか（`worker:ai` が担当） |
| 毎週の自動実行が動かない | Worker が起動しているか。設定を保存したときに「毎週の自動実行を登録できませんでした」と出ていないか（出たら時間をおいて保存し直す） |
| 分析の数値が「-」のまま・取得できない | 分析画面のアカウントに表示された理由を確認する。Threads は `threads_manage_insights`、Instagram は `instagram_business_manage_insights` の権限が必要 |
| AI 分析が「実行中」のまま | Worker が起動しているか（`worker:analytics` が担当） |
| AI 分析が失敗する | 数値のある公開済みの投稿が直近 90 日で3件以上必要 |

Redis のデータが消えても、Worker の再起動時に DB 上の「予約中」の投稿がキューへ再登録されます。
