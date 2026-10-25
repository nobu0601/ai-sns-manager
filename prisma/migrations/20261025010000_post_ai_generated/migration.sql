-- AI が作った案を採用した投稿かどうか
ALTER TABLE "Post" ADD COLUMN "aiGenerated" BOOLEAN NOT NULL DEFAULT false;
