import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  lineAmount,
  moneyUnits,
  quantityUnits,
  unitPrice,
  decimalText,
  MAX_MONEY,
} from "../server/cost-money.js";
import { costTotals } from "../server/cost-model.js";
test("exact decimal money contract rejects ambiguous inputs and never rounds", () => {
  assert.equal(decimalText(moneyUnits("0.1") + moneyUnits("0.2")), "0.3");
  assert.equal(lineAmount("0.25", "3"), "0.75");
  assert.equal(lineAmount("0.000001", "1000000000000"), "1000000");
  assert.equal(decimalText(MAX_MONEY), "1000000000000000");
  for (const value of [
    "-0",
    "-1",
    "1e2",
    "01",
    "+1",
    " 1",
    "1,000",
    "NaN",
    ".5",
    "1.",
    "0.0000001",
  ])
    assert.throws(() => moneyUnits(value));
  for (const value of ["0", "0.0", "-1", "0.5", "1,000"])
    assert.throws(() => unitPrice(value));
  assert.throws(() => quantityUnits("0"));
  assert.throws(() => lineAmount("1000000000", "1000000000000"));
  assert.equal(decimalText(-moneyUnits("0.5")), "-0.5");
  assert.throws(() =>
    costTotals(
      [
        { id: "a", label: "a", plan: "1000000000000000", opening: "0" },
        { id: "b", label: "b", plan: "0.000001", opening: "0" },
      ],
      [],
    ),
  );
});
test("manager ledger exact carry, retained rows, closures and rollback", async () => {
  const db = openDatabase(":memory:"),
    origin = "http://127.0.0.1:3000",
    site = randomUUID(),
    manager = randomUUID(),
    editor = randomUUID(),
    password = randomUUID(),
    hash = await argon2.hash(password);
  for (const [id, name] of [
    [manager, "manager"],
    [editor, "editor"],
  ])
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      name + "@example.test",
      name,
      hash,
    );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "<ledger>");
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    site,
    manager,
    "manager",
  );
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    site,
    editor,
    "editor",
  );
  const app = await createApp(db, { origin, secret: "c".repeat(48) });
  async function login(name: string) {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", r.body.csrf)
      .send({ email: name + "@example.test", password });
    assert.equal(r.status, 200);
    return { agent, csrf: r.body.csrf as string };
  }
  const m = await login("manager"),
    ed = await login("editor"),
    base = `/api/sites/${site}/cost-periods`;
  const post = (path: string, body: object, key = randomUUID()) =>
    m.agent
      .post(base + path)
      .set("Origin", origin)
      .set("x-csrf-token", m.csrf)
      .set("idempotency-key", key)
      .send(body);
  let r = await post("", {
    month: "2026-02",
    openingNote: "independent opening",
    categories: [
      { label: "a", plan: "0", opening: "0" },
      { label: "b", plan: "1", opening: "0" },
    ],
  });
  assert.equal(r.status, 200, r.text);
  let p = r.body;
  const id = p.id;
  assert.equal((await ed.agent.get(base)).status, 403);
  for (const c of p.categories) {
    r = await post(`/${id}/expenses`, {
      version: p.version,
      expense: {
        categoryId: c.id,
        spendDate: "2026-01-31",
        description: "<script>",
        quantity: "0.5",
        unitPriceWon: "1",
      },
    });
    assert.equal(r.status, 200, r.text);
    p = r.body.period;
  }
  assert.equal(p.totals.total.current, "1");
  assert.equal(p.totals.byCategory[0].remaining, "-0.5");
  const detail = await m.agent.get(`${base}/${id}/expenses?categoryId=${p.categories[1].id}`);
  assert.deepEqual(detail.body.items.map((e: { category_id: string }) => e.category_id), [p.categories[1].id]);
  assert.equal((await m.agent.get(`${base}/${id}/expenses?categoryId=x&bogus=1`)).status, 400);
  const before = db.prepare("SELECT COUNT(*) n FROM cost_events").get()!.n;
  r = await post(`/${id}/expenses`, {
    version: p.version,
    expense: {
      categoryId: p.categories[0].id,
      spendDate: "2026-03-01",
      description: "future",
      quantity: "1",
      unitPriceWon: "1",
    },
  });
  assert.equal(r.status, 400);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM cost_events").get()!.n,
    before,
  );
  const settings = {
    writtenDate: "2026-02-27", projectName: "<합성> 공사", contractor: "합성건설", location: "", representative: "",
    client: "", projectStart: "2026-01-01", projectEnd: "2026-12-31", summarySameAsProject: true, summaryStart: "",
    summaryEnd: "", contractAmountWon: "1000000000", coverProgress: "12.5", cumulativeProgress: "100",
    safetyBudgetWon: "30000000", author: "작성", reviewer: "확인",
  };
  const putSettings = (body: object) =>
    m.agent.put(`${base}/${id}/settings`).set("Origin", origin).set("x-csrf-token", m.csrf).set("idempotency-key", randomUUID()).send(body);
  for (const bad of [{ projectEnd: "2025-12-31" }, { projectEnd: "" }, { safetyBudgetWon: "1.5" }, { coverProgress: "101" }, { writtenDate: "2026-02-30" }])
    assert.equal((await putSettings({ version: p.version, settings: { ...settings, ...bad } })).status, 400, JSON.stringify(bad));
  r = await putSettings({ version: p.version, settings });
  assert.equal(r.status, 200, r.text);
  p = r.body;
  assert.equal(p.settings.summaryStart, "2026-01-01"); // same-as-project copied on the server
  assert.equal((await putSettings({ version: p.version - 1, settings })).status, 409);
  const close = await post(`/${id}/close`, {
    version: p.version,
    reason: "record close",
  });
  assert.equal(close.status, 200, close.text);
  p = close.body;
  const print = await m.agent.get(`${base}/${id}/closures/${p.currentClosure.id}/print`);
  assert.equal(print.status, 200);
  assert.ok(print.text.includes("&lt;script&gt;"));
  assert.ok(!print.text.includes("<script>"));
  assert.ok(print.text.includes("&lt;합성&gt; 공사") && print.text.includes("30000000"));
  assert.equal((await putSettings({ version: p.version, settings })).status, 409);
  assert.throws(() => db.prepare("UPDATE cost_period_settings SET body='{}' WHERE period_id=?").run(id));
  const carry = await post(`/${id}/carry`, { version: p.version });
  assert.equal(carry.status, 200, carry.text);
  assert.equal(carry.body.month, "2026-03");
  assert.deepEqual(
    carry.body.categories.map((c: { opening: string }) => c.opening),
    ["0.5", "0.5"],
  );
  assert.equal(carry.body.totals.total.opening, "1");
  assert.deepEqual(carry.body.settings, { ...p.settings, writtenDate: "2026-03-31" });
  assert.equal(
    (
      await post(`/${id}/reopen`, {
        version: p.version,
        reason: "blocked derived",
      })
    ).status,
    409,
  );
  assert.equal((await m.agent.get(`${base}/${id}/closures/${p.currentClosure.id}/print`)).text, print.text);
  // Fill retained rows cheaply with genuine small amounts; cancelled rows still occupy the cap.
  const child = carry.body;
  const insert = db.prepare(
    "INSERT INTO cost_expenses VALUES(?,?,?,?,?,?,?,?,'cancelled',1,?,?,?)",
  );
  db.exec("BEGIN");
  for (let i = 0; i < 1000; i++)
    insert.run(
      randomUUID(),
      child.id,
      child.categories[0].id,
      "2026-03-01",
      "synthetic",
      "0.000001",
      "1",
      "0.000001",
      manager,
      "now",
      "now",
    );
  db.exec("COMMIT");
  assert.equal(
    (
      await post(`/${child.id}/expenses`, {
        version: child.version,
        expense: {
          categoryId: child.categories[0].id,
          spendDate: "2026-03-01",
          description: "over cap",
          quantity: "1",
          unitPriceWon: "1",
        },
      })
    ).status,
    409,
  );
  assert.equal(
    (await m.agent.get(`${base}/${child.id}/expenses?offset=950`)).body.items
      .length,
    50,
  );
  db.close();
});
