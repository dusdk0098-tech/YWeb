import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
const origin = "http://127.0.0.1:3000", pdf = Buffer.from("%PDF-1.7\nSYNTHETIC");
test("site library: manager upload with rights check, members download, withdraw not delete, other sites blocked", async () => {
  const db = openDatabase(":memory:"), site = randomUUID(), other = randomUUID(), password = randomUUID(), hash = await argon2.hash(password), ids: Record<string, string> = {};
  for (const s of [site, other]) db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(s, "합성");
  for (const role of ["manager", "viewer"]) {
    ids[role] = randomUUID();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(ids[role], role + "@example.test", role === "manager" ? "김관리" : "보기", hash);
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, ids[role], role);
  }
  try {
    const app = await createApp(db, { origin, secret: "synthetic-library-secret-".repeat(2) });
    const login = async (name: string) => {
      const agent = request.agent(app);
      let r = await agent.get("/api/session");
      r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: name + "@example.test", password });
      return { agent, csrf: r.body.csrf as string };
    };
    const m = await login("manager"), v = await login("viewer"), base = `/api/sites/${site}/library`;
    const upload = (a: typeof m, revision: number, headers: Record<string, string> = {}) => {
      let q = a.agent.post(base).set("Origin", origin).set("x-csrf-token", a.csrf).set("content-type", "application/octet-stream").set("idempotency-key", randomUUID())
        .set("x-file-name", encodeURIComponent("지침.pdf")).set("x-file-type", "application/pdf").set("x-library-revision", String(revision))
        .set("x-library-title", encodeURIComponent("<안전 지침>")).set("x-library-edition", encodeURIComponent("2026-10판")).set("x-rights-confirmed", "1");
      for (const [k, val] of Object.entries(headers)) q = q.set(k, val);
      return q.send(pdf);
    };
    assert.equal((await upload(v, 1)).status, 403); // manager only
    assert.equal((await upload(m, 1, { "x-rights-confirmed": "0" })).status, 400);
    assert.equal((await upload(m, 1, { "x-library-title": "" })).status, 400);
    assert.equal((await upload(m, 3)).status, 409); // stale revision
    let r = await upload(m, 1);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.revision, r.body.items[0].title, r.body.items[0].rights_checked_by, r.body.items[0].uploader], [1, "<안전 지침>", "김관리", "김관리"]);
    const id = r.body.items[0].id;
    const list = (await v.agent.get(base)).body;
    assert.equal(list.items.length, 1); // viewers can see
    const dl = await v.agent.get(`${base}/${id}/download`);
    assert.deepEqual([dl.status, dl.headers["content-type"], dl.headers["x-attachment-scan"]], [200, "application/octet-stream", "UNSCANNED"]);
    assert.equal((await v.agent.get(`/api/sites/${other}/library`)).status, 403);
    const withdraw = (a: typeof m, body: object) => a.agent.post(`${base}/${id}/withdraw`).set("Origin", origin).set("x-csrf-token", a.csrf).set("idempotency-key", randomUUID()).send(body);
    assert.equal((await withdraw(v, { reason: "x" })).status, 403);
    assert.equal((await withdraw(m, { reason: " " })).status, 400);
    r = await withdraw(m, { reason: "개정판으로 대체" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.items[0].withdrawn_reason, "개정판으로 대체");
    assert.equal((await withdraw(m, { reason: "again" })).status, 404);
    assert.equal((await v.agent.get(`${base}/${id}/download`)).status, 410);
    assert.throws(() => db.prepare("DELETE FROM library_files").run());
    assert.throws(() => db.prepare("UPDATE library_files SET title='x'").run());
  } finally {
    db.close();
  }
});
