import { LiveAdapterBase } from "../live-adapter-base";

// Instagram Graph API（Media Container 作成 → 公開）。Step 12 で公式ドキュメントを確認して実装する。
export class InstagramAdapter extends LiveAdapterBase {
  constructor() {
    super("INSTAGRAM", "Step 12");
  }
}
