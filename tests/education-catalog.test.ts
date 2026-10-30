import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { catalogBody } from "../server/education-catalog-model.js";
import { catalogSchedule } from "../server/education-catalog.js";
const body = {
  title: "자체 내용 <script>",
  categoryLabel: "사용자 분류",
  objectives: "직접 목표",
  contents: "권리 있는 직접 내용",
  referenceNote: "사용자 메모",
};
const schedule = {
  date: "2026-10-28",
  startTime: "09:00",
  endTime: "10:00",
  breakMinutes: 0,
  instructor: "수기 강사",
  location: "수기 장소",
};
test("catalog strict content/schedule rejects legal certificates and derived fields", () => {
  assert.equal(
    catalogBody.safeParse({ ...body, legalCourseCode: "x" }).success,
    false,
  );
  assert.equal(
    catalogBody.safeParse({ ...body, contents: "x".repeat(10001) }).success,
    false,
  );
  for (const value of [
    { ...schedule, instructor: "" },
    { ...schedule, endTime: "09:00" },
    { ...schedule, date: "2025-02-29" },
    { ...schedule, breakMinutes: 60 },
    { ...schedule, scheduledMinutes: 60 },
  ])
    assert.equal(catalogSchedule.safeParse(value).success, false);
});
test("published catalog privacy, transactional journal provenance and edited-content indication", async () => {
  const db = openDatabase(":memory:"),
    site = randomUUID(),
    manager = randomUUID(),
    editor = randomUUID(),
    password = randomUUID(),
    origin = "http://127.0.0.1:3000",
    hash = await argon2.hash(password);
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
    site,
    "catalog site",
  );
  for (const [id, name] of [
    [manager, "manager"],
    [editor, "editor"],
  ]) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      name + "@example.test",
      name,
      hash,
    );
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, id, name);
  }
  const app = await createApp(db, { origin, secret: "c".repeat(48) });
  async function login(name: string) {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", r.body.csrf)
      .send({ email: name + "@example.test", password });
    return { agent, csrf: r.body.csrf as string };
  }
  const m = await login("manager"),
    e = await login("editor"),
    base = `/api/sites/${site}/education-catalog`,
    edu = `/api/sites/${site}/education`;
  const post = (
    actor: typeof m,
    path: string,
    value: object,
    key = randomUUID(),
  ) =>
    actor.agent
      .post(path)
      .set("Origin", origin)
      .set("x-csrf-token", actor.csrf)
      .set("idempotency-key", key)
      .send(value);
  let r = await post(m, base, { body });
  assert.equal(r.status, 200, r.text);
  let catalog = r.body;
  assert.equal((await e.agent.get(base + "/" + catalog.id)).status, 404);
  assert.equal(
    (
      await post(e, base + "/" + catalog.id + "/journals", {
        version: catalog.version,
        schedule,
      })
    ).status,
    404,
  );
  r = await post(m, base + "/" + catalog.id + "/publish", {
    version: catalog.version,
  });
  assert.equal(r.status, 200);
  catalog = r.body;
  const oldPrint = await e.agent.get(base + "/" + catalog.id + "/print");
  assert.ok(oldPrint.text.includes("&lt;script&gt;"));
  const child = await post(m, base + "/" + catalog.id + "/revise", {
    version: catalog.version,
    reason: "내용 개정",
  });
  assert.equal(child.status, 200);
  assert.equal(
    (await e.agent.get(base + "/" + catalog.id)).body.successorId,
    null,
  );
  assert.equal(
    JSON.stringify((await e.agent.get(base)).body).includes(child.body.id),
    false,
  );
  assert.equal(
    (await m.agent.get(base + "/" + catalog.id)).body.successorId,
    child.body.id,
  );
  const key = randomUUID();
  r = await post(
    e,
    base + "/" + catalog.id + "/journals",
    { version: catalog.version, schedule },
    key,
  );
  assert.equal(r.status, 200, r.text);
  let journal = r.body;
  assert.equal(journal.participants.length, 0);
  assert.equal(journal.catalogSource.modified, false);
  assert.equal(journal.catalogSource.snapshot.id, catalog.id);
  assert.equal(
    (
      await post(
        e,
        base + "/" + catalog.id + "/journals",
        { version: catalog.version, schedule },
        key,
      )
    ).body.id,
    journal.id,
  );
  const edit = async (value: object) =>
    e.agent
      .put(edu + "/" + journal.id)
      .set("Origin", origin)
      .set("x-csrf-token", e.csrf)
      .set("idempotency-key", randomUUID())
      .send(value);
  r = await edit({
    ...journal.body,
    version: journal.version,
    instructor: "다른 강사",
  });
  assert.equal(r.status, 200, r.text);
  journal = r.body;
  assert.equal(journal.catalogSource.modified, false);
  r = await edit({
    ...journal.body,
    version: journal.version,
    contents: "교육일지에서 수정한 내용",
  });
  assert.equal(r.status, 200, r.text);
  journal = r.body;
  assert.equal(journal.catalogSource.modified, true);
  assert.equal(journal.catalogSource.snapshot.body.contents, body.contents);
  const worker = randomUUID();
  db.prepare(
    "INSERT INTO workers VALUES(?,?,?,'company','worker',1,1,'now','now')",
  ).run(worker, site, "manual participant");
  db.prepare(
    "INSERT INTO education_participants VALUES(?,?,?,?,?,'attended',30,?,'now')",
  ).run(journal.id, worker, "manual participant", "company", "worker", editor);
  r = await post(m, edu + "/" + journal.id + "/archive", {
    version: journal.version,
  });
  assert.equal(r.status, 200, r.text);
  journal = r.body;
  assert.equal(journal.snapshot.body.catalogSource.modified, true);
  const printed = await e.agent.get(edu + "/" + journal.id + "/print");
  assert.ok(printed.text.includes("출처에서 수정되었습니다"));
  assert.ok(printed.text.includes(body.contents));
  r = await post(m, edu + "/" + journal.id + "/revise", {
    version: journal.version,
    authorId: editor,
    reason: "일지 정정",
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.catalogSource.snapshot.id, catalog.id);
  assert.equal(r.body.catalogSource.modified, true);
  assert.equal(r.body.participants[0].state, "pending");
  assert.equal(r.body.participants[0].attended_minutes, 0);
  assert.equal(
    (await e.agent.get(base + "/" + catalog.id + "/print")).text,
    oldPrint.text,
  );
  db.close();
});
