import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { stockUnits, stockText, MAX_STOCK } from "../server/stock-quantity.js";
import { movementHash, type StockMovement } from "../server/stock-model.js";
test("stock quantity strict exact six-place policy", () => {
  assert.equal(stockText(stockUnits("0.1") + stockUnits("0.2")), "0.3");
  assert.equal(stockUnits("1000000000"), MAX_STOCK);
  assert.equal(stockText(stockUnits("0.000001")), "0.000001");
  for (const s of [
    "0",
    "-0",
    "-1",
    "1e3",
    "1,000",
    " 1",
    "01",
    ".5",
    "1.",
    "0.0000001",
    "1000000000.000001",
  ])
    assert.throws(() => stockUnits(s));
});
test("stock movements preserve chronology and full reversal, bound balance and 1000 originals with reserved1000 full reversals", async () => {
  const db = openDatabase(":memory:"),
    site = randomUUID(),
    user = randomUUID(),
    password = randomUUID(),
    origin = "http://127.0.0.1:3000";
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    user,
    "stock@example.test",
    "stock",
    await argon2.hash(password),
  );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "stock");
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    site,
    user,
    "manager",
  );
  const app = await createApp(db, { origin, secret: "s".repeat(48) }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "stock@example.test", password });
  assert.equal(r.status, 200);
  const csrf = r.body.csrf,
    base = `/api/sites/${site}/stock-items`;
  const post = (path: string, body: object) =>
    agent
      .post(base + path)
      .set("Origin", origin)
      .set("x-csrf-token", csrf)
      .set("idempotency-key", randomUUID())
      .send(body);
  r = await post("", { name: "<script>stock", unit: "개" });
  assert.equal(r.status, 200, r.text);
  let item = r.body;
  r = await post(`/${item.id}/movements`, {
    version: item.version,
    kind: "receipt",
    quantity: "1",
    effectiveDate: "2026-10-28",
    reason: "actual",
  });
  assert.equal(r.status, 200, r.text);
  item = r.body.item;
  const receipt = r.body.movement;
  r = await post(`/${item.id}/movements`, {
    version: item.version,
    kind: "issue",
    quantity: "0.5",
    effectiveDate: "2026-10-28",
    reason: "actual",
  });
  assert.equal(r.status, 200);
  item = r.body.item;
  const issue = r.body.movement;
  assert.equal(
    (
      await post(`/${item.id}/movements/${receipt.id}/reverse`, {
        version: item.version,
        effectiveDate: "2026-10-28",
        reason: "blocked",
      })
    ).status,
    409,
  );
  r = await post(`/${item.id}/movements/${issue.id}/reverse`, {
    version: item.version,
    effectiveDate: "2026-10-28",
    reason: "dependent reversal",
  });
  assert.equal(r.status, 200);
  item = r.body.item;
  r = await post(`/${item.id}/movements/${receipt.id}/reverse`, {
    version: item.version,
    effectiveDate: "2026-10-28",
    reason: "receipt error",
  });
  assert.equal(r.status, 200);
  item = r.body.item;
  assert.equal(item.balance, "0");
  assert.equal(
    (
      await post(`/${item.id}/movements`, {
        version: item.version,
        kind: "receipt",
        quantity: "1",
        effectiveDate: "2026-10-27",
        reason: "backdate",
      })
    ).status,
    409,
  );
  const exact = await post(`/${item.id}/movements`, {
    version: item.version,
    kind: "receipt",
    quantity: "1000000000",
    effectiveDate: "2026-10-29",
    reason: "synthetic exact boundary",
  });
  assert.equal(exact.status, 200);
  item = exact.body.item;
  assert.equal(
    (
      await post(`/${item.id}/movements`, {
        version: item.version,
        kind: "receipt",
        quantity: "0.000001",
        effectiveDate: "2026-10-29",
        reason: "over bound",
      })
    ).status,
    409,
  );
  const print = await agent.get(`${base}/${item.id}/print`);
  assert.equal(print.status, 200);
  assert.ok(print.text.includes("&lt;script&gt;stock"));
  assert.ok(!print.text.includes("<script>"));
  const cap = (await post("", { name: "capacity fixture", unit: "ea" })).body;
  const insert = db.prepare(
    "INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const originals: string[] = [];
  function fixture(sequence: number, target: string | null, balance: string) {
    const m: Omit<StockMovement, "hash"> = {
      id: randomUUID(),
      item_id: cap.id,
      sequence,
      kind: target ? "reversal" : "receipt",
      quantity: "0.000001",
      direction: target ? -1 : 1,
      effective_date: "2026-10-28",
      reason: "synthetic retained",
      reverses_id: target,
      actor_id: user,
      actor_name: "stock",
      recorded_at: "synthetic",
      item_snapshot: JSON.stringify({
        id: cap.id,
        siteId: site,
        name: cap.name,
        unit: cap.unit,
      }),
      balance_after: balance,
    };
    insert.run(...Object.values(m), movementHash(m));
    return m.id;
  }
  db.exec("BEGIN");
  for (let i = 1; i <= 1000; i++)
    originals.push(fixture(i, null, stockText(BigInt(i))));
  db.exec("COMMIT");
  let view = (await agent.get(`${base}/${cap.id}`)).body;
  assert.equal(view.originalCount, 1000);
  assert.equal(view.movementCount, 1000);
  assert.equal(
    (
      await post(`/${cap.id}/movements`, {
        version: 1,
        kind: "receipt",
        quantity: "1",
        effectiveDate: "2026-10-28",
        reason: "original cap",
      })
    ).status,
    409,
  );
  const correction = await post(
    `/${cap.id}/movements/${originals[0]}/reverse`,
    {
      version: 1,
      effectiveDate: "2026-10-28",
      reason: "correction remains available at original cap",
    },
  );
  assert.equal(correction.status, 200, correction.text);
  assert.equal(correction.body.item.movementCount, 1001);
  db.exec("BEGIN");
  for (let i = 1; i < 1000; i++)
    fixture(1001 + i, originals[i], stockText(BigInt(999 - i)));
  db.exec("COMMIT");
  view = (await agent.get(`${base}/${cap.id}`)).body;
  assert.equal(view.movementCount, 2000);
  assert.equal(view.reversalCount, 1000);
  assert.equal(view.balance, "0");
  assert.equal((await agent.get(`${base}/${cap.id}/print`)).status, 200);
  assert.equal(
    (await agent.get(`${base}/${cap.id}/movements?offset=1950`)).body.items
      .length,
    50,
  );
  assert.equal(
    (
      await post(`/${cap.id}/movements`, {
        version: 2,
        kind: "receipt",
        quantity: "1",
        effectiveDate: "2026-10-28",
        reason: "over original cap",
      })
    ).status,
    409,
  );
  db.close();
});
