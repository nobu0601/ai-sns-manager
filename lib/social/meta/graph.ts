import type { Platform } from "@prisma/client";
import { SocialPublishError } from "../errors";
import { callApi, type FetchLike } from "../http";

// Meta Graph API（Threads / Instagram）の共通処理。
// GET はクエリ、POST はフォーム形式でパラメータとアクセストークンを送る
export class GraphClient {
  constructor(
    private readonly platform: Platform,
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }

  get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams({ ...params, access_token: this.accessToken });
    return callApi<T>(this.platform, this.fetchImpl, `${this.url(path)}?${qs}`, { method: "GET" });
  }

  post<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    return callApi<T>(this.platform, this.fetchImpl, this.url(path), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, access_token: this.accessToken }),
    });
  }

  // メディアコンテナの処理完了を待つ。statusField は Threads が "status"、Instagram が "status_code"
  async waitForContainer(
    containerId: string,
    statusField: "status" | "status_code",
    { attempts = 10, intervalMs = 3000, sleep = defaultSleep }: { attempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      const res = await this.get<Record<string, string | undefined>>(containerId, {
        fields: statusField === "status" ? "status,error_message" : "status_code",
      });
      const status = res[statusField];
      if (status === "FINISHED" || status === "PUBLISHED") return;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new SocialPublishError("CONTENT", this.platform, `container ${status}: ${res.error_message ?? ""}`, res);
      }
      await sleep(intervalMs);
    }
    throw new SocialPublishError("TRANSIENT", this.platform, "container not ready in time");
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function withVersion(host: string, version: string | undefined): string {
  return version ? `${host}/${version}` : host;
}
