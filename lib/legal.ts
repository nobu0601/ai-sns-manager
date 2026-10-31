// 利用規約・プライバシーポリシーに表示する運営者の情報（環境変数で設定。未設定なら一般的な表記）
export function legalInfo() {
  return {
    operator: process.env.LEGAL_OPERATOR_NAME?.trim() || "本アプリの運営者",
    contact: process.env.LEGAL_CONTACT_EMAIL?.trim() || null,
    updated: "2026年10月31日",
  };
}
