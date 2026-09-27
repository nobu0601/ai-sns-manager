# デプロイ

AI SNS Manager の本番運用には次の 4 つが必要です。

| 構成要素 | 役割 | 起動コマンド |
| --- | --- | --- |
| Web | 画面と API（Next.js） | `npm run start` |
| Worker | 予約投稿の実行（BullMQ） | `npm run worker` |
| PostgreSQL | データ保存 | マネージドDBを推奨 |
| Redis | ジョブキュー | マネージドRedisを推奨 |

**Worker は Web とは別の常駐プロセスです。** Worker が止まっていると、予約した投稿は実行されません。

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
| `ANTHROPIC_API_KEY` | Claude の APIキー（AI 投稿生成・Phase 2 で使用） |

Web と Worker には**同じ値**を設定してください（特に `DATABASE_URL`、`REDIS_URL`、`ENCRYPTION_KEY`、`SOCIAL_PROVIDER_MODE`）。

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
- ワーカー：Build `npm ci && npm run build`、Start `npm run worker`
- PostgreSQL と Redis を追加し、接続文字列を `DATABASE_URL` / `REDIS_URL` に設定

料金プラン・無料枠・スリープの有無などは変わるため、各サービスの公式ドキュメントで確認してください。
無料プランで Web がスリープしても予約投稿は Worker が実行しますが、**Worker がスリープするプランでは予約投稿が遅れます**。

### Vercel

Vercel で Web を動かすことはできますが、常駐する Worker は動かせません。
Worker は Render / Railway / 自前サーバーなど別の場所で動かし、同じ PostgreSQL・Redis に接続してください。

## 動作確認

- Web：ログイン画面（`/login`）が表示されること
- Worker：起動ログに `worker.ready` が出ること
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

Redis のデータが消えても、Worker の再起動時に DB 上の「予約中」の投稿がキューへ再登録されます。
