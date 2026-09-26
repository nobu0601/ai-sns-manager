import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // BullMQ / ioredis はサーバー専用。バンドルせず Node から直接読み込む
  serverExternalPackages: ["bullmq", "ioredis", "bcryptjs"],
};

export default nextConfig;
