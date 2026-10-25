import { expect, test, type Page } from "@playwright/test";

// Phase 3：AI エージェント（計画 → 承認 → 予約）と、AI での画像生成・添付（AI・画像生成・SNS はすべて Mock）
async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

function section(page: Page, name: string) {
  return page.locator("section", { has: page.getByRole("heading", { name: new RegExp(`^${name}\\s*\\d+アカウント`) }) });
}

test("AIエージェントで今後7日間の投稿を作り、まとめて承認して予約できる。画像をAIで作って添付できる", async ({ page }) => {
  test.setTimeout(150_000);
  const email = `e2e3-${Date.now()}@example.com`;
  await go(page, "/register");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel(/パスワード/).fill("e2e-password");
  await page.getByRole("button", { name: "登録してはじめる" }).click();
  await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

  // ブランド（投稿テーマの柱つき）
  await go(page, "/settings");
  await page.getByLabel("ブランド名").fill("Lounge+");
  await page.getByLabel(/投稿テーマの柱/).fill("カフェ、ラウンジ、大阪情報");
  await page.getByRole("button", { name: "ブランドを追加" }).click();
  await expect(page.getByText("テーマの柱：カフェ・ラウンジ・大阪情報")).toBeVisible();

  // アカウント（X と Instagram）
  await go(page, "/accounts");
  const x = section(page, "X");
  await x.getByRole("button", { name: "＋ アカウントを追加" }).click();
  for (const [f, v] of Object.entries({ "API Key": "k3", "API Key Secret": "s", "Access Token": "e2e3-token", "Access Token Secret": "t" })) {
    await x.getByLabel(f, { exact: true }).fill(v);
  }
  await x.getByRole("button", { name: "連携する" }).click();
  await expect(x.getByRole("heading")).toContainText("1アカウント");
  const ig = section(page, "Instagram");
  await ig.getByRole("button", { name: "＋ アカウントを追加" }).click();
  await ig.getByLabel("アクセストークン", { exact: true }).fill("e2e3-ig");
  await ig.getByRole("button", { name: "連携する" }).click();
  await expect(ig.getByRole("heading")).toContainText("1アカウント");

  // AIエージェント：設定 → 実行 → 計画ができる（Instagram があるので画像も作られる）
  await go(page, "/agent");
  await page.getByRole("checkbox", { name: /^X / }).check();
  await page.getByRole("checkbox", { name: /^Instagram / }).check();
  await page.getByLabel("投稿頻度").selectOption("2");
  await page.getByRole("button", { name: "設定を保存" }).click();
  await expect(page.getByText("保存しました")).toBeVisible();
  await page.getByRole("button", { name: "今後7日間の投稿を作る" }).click();
  await expect(page.getByText(/投稿を2件作りました/)).toBeVisible({ timeout: 60_000 });
  // 画像の生成が終わり、自動で添付される
  await expect(page.locator("main img")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByText("承認待ち").first()).toBeVisible();

  // まとめて承認して予約
  await page.getByRole("button", { name: /2件をまとめて承認して予約/ }).click();
  await expect(page.getByText("2件を予約しました")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("予約済み")).toHaveCount(2);

  // ダッシュボードに AIエージェントの結果が出る
  await go(page, "/dashboard");
  await expect(page.getByText(/最新の計画（Lounge\+/)).toBeVisible();

  // 投稿作成画面：AIで画像を作って添付し、Instagram に予約
  await go(page, "/posts/new");
  await page.getByLabel(/投稿タイトル/).fill("画像つき投稿");
  await page.getByRole("checkbox", { name: /^Instagram / }).check();
  await page.getByLabel("投稿内容").fill("窓際の席で、ゆっくりと。");
  await page.getByRole("button", { name: "AIで画像を作る" }).click();
  await page.getByLabel("作りたい画像のイメージ").fill("窓際の席でコーヒーを飲む様子");
  await page.getByRole("button", { name: "画像を生成" }).click();
  await expect(page.getByAltText("添付する画像")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "予約する" }).click();
  await expect(page.getByText("投稿を予約しました", { exact: true })).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(1);
});
