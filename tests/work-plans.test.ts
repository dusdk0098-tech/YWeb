import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  workPlanBody,
  planMinutes,
  type WorkPlanBody,
} from "../server/work-plan-validation.js";
const body: WorkPlanBody = {
  title: "자체 계획 <script>",
  date: "2026-10-28",
  startTime: "09:00",
  endTime: "10:00",
  location: "합성",
  workDescription: "직접 작성",
  emergencyProcedure: "직접 대응",
  verificationNote: "증명 아님",
  steps: [{ task: "작업", procedure: "절차", precaution: "주의" }],
  equipmentIds: [],
  duties: [],
};
test("own general plan strict same-day clock,10-reference/20-step bounds and no engineering fields", () => {
  assert.equal(planMinutes(body), 60);
  for (const invalid of [
    { ...body, startTime: "25:00" },
    { ...body, endTime: "09:00" },
    { ...body, startTime: "23:00", endTime: "01:00" },
    { ...body, date: "2025-02-29" },
    { ...body, riskScore: 1 },
    { ...body, steps: Array.from({ length: 21 }, () => body.steps[0]) },
    { ...body, equipmentIds: Array.from({ length: 11 }, () => randomUUID()) },
    {
      ...body,
      duties: Array.from({ length: 11 }, () => ({
        workerId: randomUUID(),
        duty: "manual",
      })),
    },
  ])
    assert.equal(workPlanBody.safeParse(invalid).success, false);
  const same = randomUUID();
  assert.equal(
    workPlanBody.safeParse({ ...body, equipmentIds: [same, same] }).success,
    false,
  );
  assert.equal(
    workPlanBody.safeParse({
      ...body,
      steps: Array.from({ length: 20 }, () => body.steps[0]),
      equipmentIds: Array.from({ length: 10 }, () => randomUUID()),
      duties: Array.from({ length: 10 }, () => ({
        workerId: randomUUID(),
        duty: "manual",
      })),
    }).success,
    true,
  );
});
test("actual10 equipment+10 duties+20 steps explicit capture freshness and immutable archival", async () => {
  const db = openDatabase(":memory:"),
    site = randomUUID(),
    id = randomUUID(),
    origin = "http://127.0.0.1:3000",
    password = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    id,
    "plan@example.test",
    "synthetic",
    await argon2.hash(password),
  );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
    site,
    "site <script>",
  );
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, id, "manager");
  const equipmentIds: string[] = [],
    duties: { workerId: string; duty: string }[] = [];
  for (let i = 0; i < 10; i++) {
    const equipment = randomUUID(),
      worker = randomUUID();
    equipmentIds.push(equipment);
    duties.push({ workerId: worker, duty: "담당 메모 " + i });
    db.prepare(
      "INSERT INTO equipment VALUES(?,?,?,?,'active',1,'now','now')",
    ).run(
      equipment,
      site,
      "",
      JSON.stringify({
        assetCode: "",
        name: "equipment" + i,
        typeLabel: "manual",
        model: "",
        serial: "",
        ownerCompany: "",
        notes: "",
      }),
    );
    db.prepare(
      "INSERT INTO workers VALUES(?,?,?,'affiliation','worker',1,1,'now','now')",
    ).run(worker, site, "worker" + i);
  }
  const app = await createApp(db, { origin, secret: "p".repeat(48) }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "plan@example.test", password });
  const csrf = r.body.csrf,
    base = `/api/sites/${site}/work-plans`;
  const post = (path: string, value: object) =>
    agent
      .post(base + path)
      .set("Origin", origin)
      .set("x-csrf-token", csrf)
      .set("idempotency-key", randomUUID())
      .send(value);
  const details = {
    ...body,
    equipmentIds,
    duties,
    steps: Array.from({ length: 20 }, () => body.steps[0]),
  };
  r = await post("", { body: details });
  assert.equal(r.status, 200, r.text);
  let plan = r.body;
  assert.equal(plan.source_capture, null);
  assert.equal(
    (await post(`/${plan.id}/archive`, { version: plan.version })).status,
    409,
  );
  r = await post(`/${plan.id}/capture`, { version: plan.version });
  assert.equal(r.status, 200, r.text);
  plan = r.body;
  assert.equal(plan.source_capture.facts.equipment.length, 10);
  assert.equal(plan.source_capture.facts.duties.length, 10);
  db.prepare(
    "UPDATE workers SET name='renamed',version=version+1 WHERE id=?",
  ).run(duties[0].workerId);
  assert.equal(
    (await post(`/${plan.id}/archive`, { version: plan.version })).status,
    409,
  );
  r = await post(`/${plan.id}/capture`, { version: plan.version });
  assert.equal(r.status, 200);
  plan = r.body;
  r = await post(`/${plan.id}/archive`, { version: plan.version });
  assert.equal(r.status, 200, r.text);
  plan = r.body;
  const print = await agent.get(`${base}/${plan.id}/print`);
  assert.equal(print.status, 200);
  assert.ok(print.text.includes("&lt;script&gt;"));
  assert.ok(!print.text.includes("<script>"));
  assert.ok(print.text.includes("작업허가"));
  db.prepare(
    "UPDATE equipment SET status='retired',version=version+1 WHERE id=?",
  ).run(equipmentIds[0]);
  db.prepare("UPDATE sites SET name='changed' WHERE id=?").run(site);
  assert.equal((await agent.get(`${base}/${plan.id}/print`)).text, print.text);
  r = await post(`/${plan.id}/revise`, {
    version: plan.version,
    reason: "새 검토",
    authorId: id,
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.source_capture, null);
  assert.equal(r.body.parent_id, plan.id);
  assert.equal(
    (await post(`/${r.body.id}/capture`, { version: r.body.version })).status,
    409,
  );
  assert.equal(
    (
      await post(`/${plan.id}/revise`, {
        version: plan.version,
        reason: "duplicate",
        authorId: id,
      })
    ).status,
    409,
  );
  db.close();
});
