import { expect, test } from "@playwright/test";

// Phase 1 の基本操作：登録・ログイン → SNS接続（Mock）→ 投稿作成 → 承認 → 今すぐ投稿 → 予約 → カレンダー
test("登録から投稿・予約まで一通り操作できる", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  // 登録（登録後そのままログインされる）
  await page.goto("/register");
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

  // SNSアカウントを接続（Mock OAuth）
  await page.goto("/accounts");
  for (const name of ["X", "Threads"]) {
    await page.getByRole("row", { name: new RegExp(`^${name}`) }).getByRole("button", { name: "接続" }).click();
    await expect(page.getByText(`${name}を接続しました`)).toBeVisible();
  }

  // 投稿作成 → 下書き保存（承認待ち）
  await page.goto("/posts/new");
  await page.getByLabel(/投稿タイトル/).fill("E2E 投稿");
  await page.getByLabel("投稿テーマ").fill("Lounge+の紹介");
  await page.getByLabel("投稿内容").fill("大阪で、仕事も休憩も。Lounge+");
  await page.getByRole("button", { name: "下書き保存" }).click();
  await expect(page.getByText("下書きを保存しました", { exact: true })).toBeVisible();
  await expect(page.getByText("この投稿は承認待ちです。")).toBeVisible();

  // 承認 → 今すぐ投稿 → Worker が処理して投稿済みになる
  await page.getByRole("button", { name: "承認する" }).click();
  await expect(page.getByText("承認済み")).toBeVisible();
  await page.getByRole("button", { name: "今すぐ投稿" }).click();
  await expect(page.getByText("投稿済み").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("投稿に成功しました").first()).toBeVisible();

  // 別の投稿を予約 → カレンダーに表示される
  await page.goto("/posts/new");
  await page.getByLabel(/投稿タイトル/).fill("E2E 予約投稿");
  await page.getByLabel("投稿内容").fill("来週の営業時間のお知らせ");
  await page.getByRole("button", { name: "予約する" }).click();
  await expect(page.getByText("投稿を予約しました", { exact: true })).toBeVisible();
  await expect(page.getByText("予約済み").first()).toBeVisible();

  await page.goto("/calendar");
  await expect(page.getByRole("link", { name: /E2E 予約投稿/ })).toBeVisible();

  // 失敗表示：内容エラーを Mock で再現
  await page.goto("/posts/new");
  await page.getByLabel(/投稿タイトル/).fill("E2E 失敗投稿");
  await page.getByLabel("投稿内容").fill("失敗させる #mock-content-error");
  await page.getByRole("button", { name: "今すぐ投稿" }).click();
  await expect(page.getByText(/投稿ルールに合わない内容です/).first()).toBeVisible({ timeout: 30_000 });
});
