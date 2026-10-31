import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(page: Page) {
  await page.getByLabel("이메일", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}
async function openNewJournal(page: Page, siteId: string) {
  await page.getByLabel("작업 현장").selectOption(siteId);
  await page.getByRole("button", { name: "현장 홈 ↗", exact: true }).click();
  await page.getByRole("button", { name: "안전업무일지 ↗", exact: true }).click();
  await page.getByRole("button", { name: "새 안전업무일지", exact: true }).click();
}
test("offline journal draft: encrypted on device, restorable after reload, cleared on logout", async ({ page, context }) => {
  await page.goto("/");
  await login(page);
  const s = await (await page.request.get("/api/session")).json();
  const site = await (await page.request.post("/api/sites", { headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() }, data: { name: "오프라인 합성 " + randomUUID() } })).json();
  await page.reload();
  await openNewJournal(page, site.id);
  await page.getByLabel("일지 날짜 (저장 후 고정)").fill("2026-10-30");
  await page.getByLabel("작업 요약 · 보관 시 필수").fill("통신 두절 중 작성한 합성 요약");
  await page.waitForTimeout(1200); // autosave debounce
  await context.setOffline(true);
  await page.getByRole("button", { name: "일지 초안 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이 기기에 암호화해 7일간 보관합니다");
  await context.setOffline(false);
  // The device copy is ciphertext, not the typed text.
  const stored = await page.evaluate(() => new Promise<string>((done) => {
    const r = indexedDB.open("yweb-offline-drafts");
    r.onsuccess = () => { const g = r.result.transaction("drafts").objectStore("drafts").getAll(); g.onsuccess = () => { done(JSON.stringify(g.result.map((x: { data: ArrayBuffer }) => Array.from(new Uint8Array(x.data))))); r.result.close(); }; };
  }));
  expect(stored.length).toBeGreaterThan(10);
  expect(stored).not.toContain("통신");
  page.once("dialog", (d) => d.accept()); // leave-page guard for the unsaved form
  await page.reload();
  await openNewJournal(page, site.id);
  await expect(page.getByText(/이 기기에 저장 안 된 초안이 있습니다/)).toBeVisible();
  await page.getByRole("button", { name: "기기 초안 복원" }).click();
  await expect(page.getByLabel("작업 요약 · 보관 시 필수")).toHaveValue("통신 두절 중 작성한 합성 요약");
  await expect(page.getByLabel("일지 날짜 (저장 후 고정)")).toHaveValue("2026-10-30");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "일지 목록으로", exact: true }).click();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await login(page);
  await openNewJournal(page, site.id);
  await expect(page.getByLabel("작업 요약 · 보관 시 필수")).toHaveValue("");
  await expect(page.getByText(/이 기기에 저장 안 된 초안이 있습니다/)).toHaveCount(0);
});
