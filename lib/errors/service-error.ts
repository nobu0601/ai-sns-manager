// サービス層の業務エラー。API Route で HTTP ステータスとユーザー向けメッセージに変換する。
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = "ERROR",
    public readonly details?: string[],
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const notFound = (what = "データ") => new ServiceError(404, `${what}が見つかりません`, "NOT_FOUND");
