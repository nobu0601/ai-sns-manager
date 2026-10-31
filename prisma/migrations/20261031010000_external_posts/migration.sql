-- CreateTable
CREATE TABLE "ExternalPost" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalPostId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "permalink" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalPost_socialAccountId_publishedAt_idx" ON "ExternalPost"("socialAccountId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPost_socialAccountId_externalPostId_key" ON "ExternalPost"("socialAccountId", "externalPostId");

-- AddForeignKey
ALTER TABLE "ExternalPost" ADD CONSTRAINT "ExternalPost_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

