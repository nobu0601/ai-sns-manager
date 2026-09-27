# TODO

完了した Phase の詳細は README の「ロードマップと未実装機能」を参照。

## 次にやること（Phase 1 の動作確認後）

- [ ] Phase 1 を実環境（ローカル Windows / Docker）で動作確認してもらう
- [ ] ヘルスチェック（Web の `/api/health` と Worker の死活監視）

## SNS 連携（APIキー方式・複数アカウント）

- [x] APIキー入力による連携、同じ SNS の複数アカウント、アカウント単位の投稿先選択
- [x] X / Threads / Instagram の実投稿（live モード）
- [ ] **本物のキーで各 SNS に1件ずつ投稿して確認する**（開発環境からは SNS の API に接続できず未確認）
- [ ] Threads / Instagram の長期トークンの自動更新（現在は期限切れ時に「キーを更新」で入れ直す）
- [ ] 画像のアップロード（現在は Instagram の画像 URL 指定のみ）、X・Threads の画像付き投稿

## Phase 2：AI 投稿生成

- [ ] `lib/ai/`（AIService / ClaudeProvider。キーは `ANTHROPIC_API_KEY`）と `prompts/`
- [ ] 5 案生成（ブランド紹介型・共感型・ストーリー型・ノウハウ型・質問型）と採用・編集・再生成・削除
- [ ] SNS 別最適化、Brand Voice、禁止ワード・品質チェック
- [ ] `POST /api/posts/:id/generate` の実装（現在 501）

## Phase 3 / 4

- [ ] 画像・動画生成（fal.ai Provider、Media モデル）
- [ ] AI Agent・投稿カレンダー自動生成・完全自動モード
- [ ] 分析・AI 分析・複数ブランドの本格対応
