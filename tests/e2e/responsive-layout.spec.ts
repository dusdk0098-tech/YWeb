import { test, expect } from "@playwright/test";

test("desktop content starts at the top and mobile navigation leaves the task visible", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByLabel("이메일", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "현장 관리 ↗", exact: true }).click();
  await page.getByLabel("현장 이름", { exact: true }).fill("합성 반응형 검증 현장");
  await page.getByRole("button", { name: "현장 만들기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "합성 반응형 검증 현장", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "회의록 ↗", exact: true }).click();
  const heading = page.getByRole("heading", { name: "회의록", exact: true });
  await expect(heading).toBeVisible();
  expect((await page.locator("main.workspace").boundingBox())!.y).toBeLessThan(80);
  expect((await heading.boundingBox())!.y).toBeLessThan(300);

  await page.setViewportSize({ width: 320, height: 800 });
  const menu = page.getByRole("button", { name: "업무 메뉴 열기", exact: true });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeHidden();
  expect((await heading.boundingBox())!.y).toBeLessThan(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-menu-collapsed.png"), fullPage: true });

  await menu.press("Enter");
  await expect(page.getByRole("button", { name: "업무 메뉴 닫기", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  await page.getByRole("button", { name: "현장 홈 ↗", exact: true }).click();
  await expect(page.getByRole("button", { name: "업무 메뉴 열기", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: /오늘의 기록을/ })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  await expect(page.getByRole("button", { name: "업무 메뉴 열기", exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("desktop-content-top.png"), fullPage: true });
});
