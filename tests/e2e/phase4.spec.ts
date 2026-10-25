import { expect, test, type Page } from "@playwright/test";

// Phase 4：投稿の数値の取得 → AI 分析（根拠データ付き）→ ダッシュボードの AI おすすめ投稿 → 5案生成（SNS・AI はすべて Mock）
async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

function section(page: Page, name: string) {
  return page.locator("section", { has: page.getByRole("heading", { name: new RegExp(`^${name}\\s*\\d+アカウント`) }) });
}

async function addX(page: Page, label: string, token: string) {
  const x = section(page, "X");
  await x.getByRole("button", { name: "＋ アカウントを追加" }).click();
  for (const [f, v] of Object.entries({ "API Key": `k-${token}`, "API Key Secret": "s", "Access Token": token, "Access Token Secret": "t" })) {
    await x.getByLabel(f, { exact: true }).fill(v);
  }
  await x.getByLabel("表示名（任意）").fill(label);
  await x.getByRole("button", { name: "連携する" }).click();
  await expect(x.getByText(`${label}（`)).toBeVisible();
}

test("投稿の数値を取得し、AIで分析して、おすすめの投稿案から5案を作れる", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  await go(page, "/register");
  await page.getByLabel("メールアドレス").fill(`e2e4-${stamp}@example.com`);
  await page.getByLabel(/パスワード/).fill("e2e-password");
  await page.getByRole("button", { name: "登録してはじめる" }).click();
  await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
  await expect(page.getByText("投稿の数値をAIが分析すると")).toBeVisible();

  await go(page, "/settings");
  await page.getByLabel("ブランド名").fill("Lounge+");
  await page.getByLabel(/投稿テーマの柱/).fill("カフェ、ラウンジ");
  await page.getByRole("button", { name: "ブランドを追加" }).click();
  await expect(page.getByText("テーマの柱：カフェ・ラウンジ")).toBeVisible();

  // 数値を取得できるアカウントと、プラン不足で取得できないアカウント（キーに nometrics を含める）
  await go(page, "/accounts");
  await addX(page, "本店", `e2e4-${stamp}`);
  await addX(page, "プラン不足", `e2e4-nometrics-${stamp}`);

  // 3件投稿する
  for (const title of ["朝のコーヒー", "夜のラウンジ", "大阪の雨の日"]) {
    await go(page, "/posts/new");
    await page.getByLabel(/投稿タイトル/).fill(title);
    await page.getByRole("checkbox", { name: /^X 本店/ }).check();
    await page.getByLabel("投稿内容").fill(`${title}をお知らせします`);
    await page.getByRole("button", { name: "今すぐ投稿" }).click();
    await expect(page.getByText(/に投稿しました/)).toHaveCount(1, { timeout: 30_000 });
  }

  // 分析画面：数値を更新すると、投稿ごとの数値が入る。取得できないアカウントには理由が出る
  await go(page, "/analytics");
  await expect(page.getByText("まだ数値を取得していません")).toHaveCount(3);
  await page.getByRole("button", { name: "数値を更新" }).click();
  await expect(page.getByText("まだ数値を取得していません")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/X の現在の API プランでは/)).toBeVisible();
  await expect(page.getByText(/うち数値を取得できた投稿 3件/)).toBeVisible();

  // AI で分析 → 根拠付きの結果と、AI に渡した実績が並ぶ
  await page.getByRole("button", { name: "AIで分析する" }).click();
  await expect(page.getByRole("heading", { name: "次回の投稿案" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/根拠：P\d/).first()).toBeVisible();
  await expect(page.getByText("根拠データ（AIに渡した実績）")).toBeVisible();
  await expect(page.getByRole("cell", { name: "P3", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "この案で投稿を作る" })).toHaveCount(3);

  // ダッシュボード：AI おすすめ投稿 → 5案生成（テーマが入った状態で5案ができる）
  await go(page, "/dashboard");
  await expect(page.getByRole("heading", { name: "AIおすすめ投稿" })).toBeVisible();
  await expect(page.getByText("今週の投稿")).toBeVisible();
  await page.getByRole("link", { name: "5案生成" }).first().click();
  await expect(page).toHaveURL(/\/posts\/new\?/);
  await expect(page.getByLabel("投稿テーマ")).toHaveValue(/カフェ：反応が良かった投稿の続き/);
  const cards = page.locator("#ai-panel-title").locator("xpath=ancestor::section").getByRole("listitem");
  await expect(cards).toHaveCount(5, { timeout: 30_000 });
});
