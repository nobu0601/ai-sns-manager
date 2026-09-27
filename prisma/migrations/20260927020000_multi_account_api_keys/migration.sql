-- SNS 連携を OAuth から「APIキー入力」方式に変更し、同じSNSで複数アカウントを扱えるようにする。
-- 既存データは消さずに移行する。

-- OAuth の一時状態は使わなくなったため削除
ALTER TABLE "OAuthState" DROP CONSTRAINT "OAuthState_userId_fkey";
DROP TABLE "OAuthState";

-- SocialAccount: キー一式を暗号化JSONで1列に保存する。
-- 既存の暗号化アクセストークンはそのまま引き継ぐ（アプリ側で JSON でない値は { accessToken } として読む）
ALTER TABLE "SocialAccount" RENAME COLUMN "accessTokenEncrypted" TO "credentialsEncrypted";
ALTER TABLE "SocialAccount" DROP COLUMN "refreshTokenEncrypted",
DROP COLUMN "scopes",
ADD COLUMN     "credentialHint" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "label" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastError" TEXT;

-- PostPlatform: 投稿先を「SNS」から「SNSアカウント」単位にする
DROP INDEX "PostPlatform_postId_platform_key";
ALTER TABLE "PostPlatform" ADD COLUMN     "accountName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "socialAccountId" TEXT;

-- 既存の投稿先は、投稿者の同じSNSのアカウント（最も新しく更新されたもの）に紐付ける
UPDATE "PostPlatform" AS pp
SET "socialAccountId" = (
  SELECT s."id" FROM "SocialAccount" AS s
  JOIN "Post" AS p ON p."userId" = s."userId"
  WHERE p."id" = pp."postId" AND s."platform" = pp."platform"
  ORDER BY s."updatedAt" DESC LIMIT 1
);
UPDATE "PostPlatform" AS pp
SET "accountName" = s."accountName"
FROM "SocialAccount" AS s
WHERE s."id" = pp."socialAccountId";

CREATE UNIQUE INDEX "PostPlatform_postId_socialAccountId_key" ON "PostPlatform"("postId", "socialAccountId");
ALTER TABLE "PostPlatform" ADD CONSTRAINT "PostPlatform_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
