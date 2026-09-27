import { expect, test, type Page } from "@playwright/test";

// 基本操作：登録・ログイン → APIキーでアカウント連携（Mock・同じSNSに複数）→ 投稿作成 → 承認 → 今すぐ投稿 → 予約 → カレンダー

async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

function platformSection(page: Page, name: string) {
  return page.locator("section", { has: page.getByRole("heading", { name: new RegExp(`^${name}\\s*\\d+アカウント`) }) });
}

async function addAccount(page: Page, platform: string, label: string, keys: Record<string, string>) {
  const section = platformSection(page, platform);
  await section.getByRole("button", { name: "＋ アカウントを追加" }).click();
  for (const [field, value] of Object.entries(keys)) {
    await section.getByLabel(field, { exact: true }).fill(value);
  }
  await section.getByLabel("表示名（任意）").fill(label);
  await section.getByRole("button", { name: "連携する" }).click();
  await expect(section.getByText(`${label}（`)).toBeVisible();
}

async function newPost(page: Page, title: string, content: string, accounts: RegExp[]) {
  await go(page, "/posts/new");
  await page.getByLabel(/投稿タイトル/).fill(title);
  for (const account of accounts) await page.getByRole("checkbox", { name: account }).check();
  await page.getByLabel("投稿内容").fill(content);
}

test("APIキーで複数アカウントを連携し、投稿・予約まで一通り操作できる", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  // 登録（登録後そのままログインされる）
  await go(page, "/register");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel(/パスワード/).fill("e2e-password");
  await page.getByRole("button", { name: "登録してはじめる" }).click();
  await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

  // ログアウト → ログイン
  await page.getByRole("button", { name: "ログアウト" }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill("e2e-password");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

  // APIキーを入力してアカウントを連携（X は2アカウント）
  await go(page, "/accounts");
  const xKeys = (s: string) => ({ "API Key": `key-${s}`, "API Key Secret": "secret", "Access Token": `token-${s}`, "Access Token Secret": "ts" });
  await addAccount(page, "X", "店舗A", xKeys("a"));
  await addAccount(page, "X", "店舗B", xKeys("b"));
  await addAccount(page, "Threads", "Lounge+", { アクセストークン: "threads-token" });
  await expect(platformSection(page, "X").getByRole("heading")).toContainText("2アカウント");

  // 無効なキーはエラー表示され、登録されない
  const threads = platformSection(page, "Threads");
  await threads.getByRole("button", { name: "＋ アカウントを追加" }).click();
  await threads.getByLabel("アクセストークン", { exact: true }).fill("invalid-token");
  await threads.getByRole("button", { name: "連携する" }).click();
  await expect(threads.getByText("Threadsのキーを確認できませんでした", { exact: false })).toBeVisible();
  await threads.getByRole("button", { name: "キャンセル" }).click();
  await expect(threads.getByRole("heading")).toContainText("1アカウント");

  // 投稿作成（X の2アカウント）→ 下書き保存（承認待ち）
  await newPost(page, "E2E 投稿", "大阪で、仕事も休憩も。Lounge+", [/^X 店舗A/, /^X 店舗B/]);
  await page.getByRole("button", { name: "下書き保存" }).click();
  await expect(page.getByText("下書きを保存しました", { exact: true })).toBeVisible();
  await expect(page.getByText("この投稿は承認待ちです。")).toBeVisible();

  // 承認 → 今すぐ投稿 → Worker が2アカウントとも投稿する
  await page.getByRole("button", { name: "承認する" }).click();
  await expect(page.getByText("承認済み")).toBeVisible();
  await page.getByRole("button", { name: "今すぐ投稿" }).click();
  await expect(page.getByText(/に投稿しました/)).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /^X 店舗A|^X @mock_x_/ }).first()).toBeVisible();

  // 別の投稿を予約 → カレンダーに表示される
  await newPost(page, "E2E 予約投稿", "来週の営業時間のお知らせ", [/^Threads Lounge\+/]);
  await page.getByRole("button", { name: "予約する" }).click();
  await expect(page.getByText("投稿を予約しました", { exact: true })).toBeVisible();
  await expect(page.getByText("予約済み").first()).toBeVisible();

  await go(page, "/calendar");
  await expect(page.getByRole("link", { name: /E2E 予約投稿/ })).toBeVisible();

  // 失敗表示：内容エラーを Mock で再現
  await newPost(page, "E2E 失敗投稿", "失敗させる #mock-content-error", [/^X 店舗A/]);
  await page.getByRole("button", { name: "今すぐ投稿" }).click();
  await expect(page.getByText(/投稿ルールに合わない内容です/).first()).toBeVisible({ timeout: 30_000 });
});
