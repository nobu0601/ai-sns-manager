import { existsSync } from "node:fs";

// .env があれば読み込む（CI では環境変数を直接設定する）
if (existsSync(".env")) process.loadEnvFile(".env");

// テストでは開発用DBを汚さないよう、TEST_DATABASE_URL を使う
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

process.env.SOCIAL_PROVIDER_MODE = "mock";
process.env.MOCK_TRANSIENT_FAILURE_RATE = "0";
// テスト専用の固定キー（本番では使わない）
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
