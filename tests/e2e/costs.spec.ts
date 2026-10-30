import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Source only: browser execution blocked; no executed UI claim.
test("manager ledger keeps exact fractions through explicit close and carry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("이메일", { exact: true }).fill("test@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /오늘의 기록을/ }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  const site = await (
    await page.request.post("/api/sites", {
      headers: {
        Origin: "http://127.0.0.1:3107",
        "x-csrf-token": session.csrf,
        "idempotency-key": randomUUID(),
      },
      data: { name: "비용 합성 현장" },
    })
  ).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page
    .getByRole("button", { name: "수기 비용 원장 ↗", exact: true })
    .click();
  await page.getByRole("button", { name: "최초 원장 만들기" }).click();
  await page.getByLabel("귀속 월").fill("2026-10");
  await page.getByLabel("초기 이월 근거").fill("합성 시작");
  await page.getByLabel("항목명").fill("자체 항목");
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await page.getByRole("button", { name: "지출 행 추가" }).click();
  await page.getByLabel("내용", { exact: true }).fill("합성 비용");
  await page.getByLabel("수량 (양수, 소수 6자리까지)").fill("0.25");
  await page.getByLabel("단가 (양수 원 단위 정수)").fill("3");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText(/0.25 × 3원 = 0.75원/)).toBeVisible();
  await page.getByLabel("변경 / 마감 / 재개 사유").fill("수기 마감");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "기록 마감", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /2026-10 비용 원장 · 마감/ }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "다음 월 이월 생성" }).click();
  await expect(
    page.getByRole("heading", { name: /2026-11 비용 원장/ }),
  ).toBeVisible();
  await expect(page.getByText("0.75", { exact: true }).first()).toBeVisible();
});
