import type { Platform } from "@prisma/client";
import { PLATFORM_CAPABILITIES } from "./capabilities";
import { SocialPublishError } from "./errors";
import { validateAgainstCapabilities } from "./validate";
import type {
  AuthorizationRequest,
  ConnectedAccount,
  PlatformPost,
  PublishedPost,
  SocialPlatformAdapter,
  ValidationResult,
} from "./types";

// 公式APIを呼ぶ Adapter の共通土台。
// Phase 1 では Mock のみ対応。各SNSの実装は公式ドキュメントを確認したうえで
// Step 11（X）/ 12（Instagram）/ 13（Threads）で行う。推測で API を呼ぶ実装はしない。
export abstract class LiveAdapterBase implements SocialPlatformAdapter {
  readonly capabilities;

  protected constructor(
    readonly platform: Platform,
    private readonly plannedStep: string,
  ) {
    this.capabilities = PLATFORM_CAPABILITIES[platform];
  }

  protected notImplemented(): never {
    throw new SocialPublishError(
      "NOT_IMPLEMENTED",
      this.platform,
      `${this.platform} の公式API連携は未実装です（${this.plannedStep}で実装予定）。SOCIAL_PROVIDER_MODE=mock を使用してください。`,
    );
  }

  async getAuthorizationUrl(_input: { state: string; redirectUri: string }): Promise<AuthorizationRequest> {
    return this.notImplemented();
  }

  async handleCallback(_input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<ConnectedAccount> {
    return this.notImplemented();
  }

  async refreshToken(_account: ConnectedAccount): Promise<ConnectedAccount> {
    return this.notImplemented();
  }

  async createPost(_post: PlatformPost, _account: ConnectedAccount): Promise<PublishedPost> {
    return this.notImplemented();
  }

  async validatePost(post: PlatformPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }
}
