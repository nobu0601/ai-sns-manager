# TODO

完了した Phase の詳細は README の「ロードマップと未実装機能」を参照。

## 次にやること（Phase 1 の動作確認後）

- [ ] Phase 1 を実環境（ローカル Windows / Docker）で動作確認してもらう
- [ ] ヘルスチェック（Web の `/api/health` と Worker の死活監視）

## Phase 1 の残り（開発順序 Step 11〜13）

- [ ] Step 11：XAdapter（公式ドキュメントで OAuth 2.0 / 投稿 API / 料金プラン / レート制限を確認してから）
- [ ] Step 12：InstagramAdapter（Graph API の Media Container・必要な権限・ビジネスアカウント要件を確認）
- [ ] Step 13：ThreadsAdapter（Threads API の OAuth・投稿フローを確認）
- [ ] トークン期限切れ前の自動 refresh（Worker から `adapter.refreshToken` を呼ぶ）

## Phase 2：AI 投稿生成

- [ ] `lib/ai/`（AIService / OpenAIProvider）と `prompts/`
- [ ] 5 案生成（ブランド紹介型・共感型・ストーリー型・ノウハウ型・質問型）と採用・編集・再生成・削除
- [ ] SNS 別最適化、Brand Voice、禁止ワード・品質チェック
- [ ] `POST /api/posts/:id/generate` の実装（現在 501）

## Phase 3 / 4

- [ ] 画像・動画生成（fal.ai Provider、Media モデル）
- [ ] AI Agent・投稿カレンダー自動生成・完全自動モード
- [ ] 分析・AI 分析・複数ブランドの本格対応
