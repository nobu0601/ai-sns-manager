import { LiveAdapterBase } from "../live-adapter-base";

// Threads API。Step 13 で公式ドキュメントを確認して実装する。
export class ThreadsAdapter extends LiveAdapterBase {
  constructor() {
    super("THREADS", "Step 13");
  }
}
