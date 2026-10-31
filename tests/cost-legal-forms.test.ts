import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { closeReadySettings } from "./fixtures/cost-close-ready.js";
const origin = "http://127.0.0.1:3000";
async function fixture() {
  const db = openDatabase(":memory:"), site = randomUUID(), other = randomUUID(), user = randomUUID(), password = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(user, "forms@example.test", "합성", await argon2.hash(password));
  for (const s of [site, other]) {
    db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(s, "합성 현장");
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(s, user, "manager");
  }
  const app = await createApp(db, { origin, secret: "synthetic-legal-forms-secret-".repeat(2) }), agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: "forms@example.test", password });
  assert.equal(r.status, 200);
  const csrf = r.body.csrf as string,
    send = (method: "post" | "put", path: string, body: object) =>
      agent[method](path).set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID()).send(body);
  return { db, site, other, agent, send };
}
test("legal forms reproduce original SC order and values: cover, 집계표 without 8번, 갑, 총괄", async () => {
  const { db, site, other, agent, send } = await fixture();
  try {
    const base = `/api/sites/${site}/cost-periods`;
    let r = await send("post", base, {
      month: "2026-10", openingNote: "합성",
      categories: Array.from({ length: 9 }, (_, i) => ({ label: `<항목${i + 1}>`, plan: "1000", opening: i === 0 ? "100" : "0", scCode: i + 1 })),
    });
    assert.equal(r.status, 200, r.text);
    let p = r.body;
    const print = () => agent.get(`${base}/${p.id}/legal-forms/print`);
    assert.equal((await print()).status, 409); // 현장 설정 required
    r = await send("put", `${base}/${p.id}/settings`, { version: p.version, settings: { ...closeReadySettings, cumulativeProgress: "50", coverProgress: "40" } });
    assert.equal(r.status, 200, r.text);
    p = r.body;
    for (const [code, quantity, price] of [[1, "1", "1000"], [8, "1", "500"], [2, "0.5", "3"]] as const) {
      r = await send("post", `${base}/${p.id}/expenses`, { version: p.version, expense: { categoryId: p.categories[code - 1].id, spendDate: "2026-10-02", description: "합성", quantity, unitPriceWon: price } });
      assert.equal(r.status, 200, r.text);
      p = r.body.period;
    }
    const html = (await print()).text;
    const order = ["산업안전보건관리비 사용내역</h1>", "사용 내역 집계표", "[별지 제1호 서식]", "사용금액 총괄현황"].map((t) => html.indexOf(t));
    assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
    assert.match(html, /표지공정률 40%/);
    assert.match(html, /사용내역서\(26년 10월\)/);
    // 집계표 row: codes 1,2,3,4,5,6,7,9 → 1000, 1.5, 0…; 8번 500 excluded with a visible note.
    assert.match(html, /<tr><th>2026년 10월<\/th><td>1,000<\/td><td>1.5<\/td>(<td>0<\/td>){6}<td>1,001.5<\/td><\/tr>/);
    assert.match(html, /8번 사용액 500원은 이 표의 합계에 포함되지 않습니다/);
    assert.match(html, /<th>안전관리비사용률<\/th><td>0.0%<\/td>/); // 1,001.5 / 30,000,000, truncated
    assert.match(html, /사용기준금액\(전체\)<\/th><td>15,000,000<\/td>/); // 30,000,000 × 50%
    assert.match(html, /<tr><th>계<\/th><td>100<\/td><td>1,501.5<\/td><td>0.0%<\/td><td>1,601.5<\/td><\/tr>/);
    assert.match(html, /<th>1\. &lt;항목1&gt;<\/th><td>1,000<\/td><td>100<\/td><td>1,000<\/td><td>1,100<\/td><td>-100<\/td>/);
    assert.match(html, /작성자 · 안전관리자 · 성명 : 작 성 \(인\)/); // original spacedName
    // 2단계: 사용내역(을) and 항목 1~9 상세 follow the original order and row capacity.
    const stage2 = ["2026년 10월 항목별 사용내역", "1. 안전관리자의 임금 등 지급현황", "2. 안전시설비 등 사용현황", "3. 보호구 등 사용현황", "4. 안전보건진단비 등 사용현황",
      "5. 안전보건교육비 등 사용현황", "6. 근로자 건강장해예방비 등 사용현황", "7. 건설재해예방 기술지도비 사용현황", "8. 본사 전담조직 근로자 임금 등 사용현황", "9. 위험성평가 등에 따른 소요비용"].map((t) => html.indexOf(t));
    assert.ok(stage2.every((v, i) => v > order[3] && (i === 0 || v > stage2[i - 1])), JSON.stringify(stage2));
    assert.match(html, /<th rowspan="7">1\. &lt;항목1&gt;<\/th><td>2026-10-02<\/td><td>합성<\/td><td>1<\/td><td>1,000<\/td><td>1,000<\/td><td rowspan="7">1,000<\/td>/);
    assert.match(html, /<tr><th>계<\/th><td colspan="4"><\/td><td>1,501.5<\/td><td>1,501.5<\/td><\/tr>/); // 을 includes 8번
    assert.match(html, /<tr><td>안전관리자<\/td><td><\/td><td>합성건설<\/td><td><\/td><td>10월<\/td><td>1,000<\/td><td>합성<\/td><\/tr>/);
    assert.match(html, /<tr><td>합성<\/td><td><\/td><td>2026-10-02<\/td><td><\/td><td>0.5<\/td><td><\/td><td><\/td><td>3<\/td><td>1.5<\/td>/);
    assert.equal((html.match(/<h1>1\. 안전관리자의 임금 등 지급현황<\/h1>/g) ?? []).length, 1); // 1 row < 22 capacity → 1 page
    assert.match(html, /2026 년 10월 31일/);
    // A ledger without SC codes is refused instead of dropping money.
    r = await send("post", `/api/sites/${other}/cost-periods`, { month: "2026-10", openingNote: "합성", categories: [{ label: "자체", plan: "1", opening: "0" }] });
    const refused = await agent.get(`/api/sites/${other}/cost-periods/${r.body.id}/legal-forms/print`);
    assert.equal(refused.status, 409);
    assert.match(refused.text, /SC 9개 항목/);
  } finally {
    db.close();
  }
});
