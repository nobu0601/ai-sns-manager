import { LiveAdapterBase } from "../live-adapter-base";

// X API（OAuth 2.0 + PKCE / 投稿API）。Step 11 で公式ドキュメントを確認して実装する。
export class XAdapter extends LiveAdapterBase {
  constructor() {
    super("X", "Step 11");
  }
}
