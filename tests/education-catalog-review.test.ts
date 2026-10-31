import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
const body = { title: "합성 교육", categoryLabel: "자체 분류", objectives: "합성 목표", contents: "합성 내용", referenceNote: "" };
test("education content review records: manager-only, exact published hash, append-only, newest first", async () => {
  const db = openDatabase(":memory:"), site = randomUUID(), manager = randomUUID(), editor = randomUUID(), password = randomUUID(), hash = await argon2.hash(password), origin = "http://127.0.0.1:3000";
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성");
  for (const [id, role] of [[manager, "manager"], [editor, "editor"]]) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, role + "@example.test", role, hash);
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, id, role);
  }
  try {
    const app = await createApp(db, { origin, secret: "synthetic-review-secret-".repeat(2) });
    const login = async (name: string) => {
      const agent = request.agent(app);
      let r = await agent.get("/api/session");
      r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: name + "@example.test", password });
      return { agent, csrf: r.body.csrf as string };
    };
    const m = await login("manager"), e = await login("editor"), base = `/api/sites/${site}/education-catalog`;
    const post = (a: typeof m, path: string, value: object, key = randomUUID()) => a.agent.post(path).set("Origin", origin).set("x-csrf-token", a.csrf).set("idempotency-key", key).send(value);
    let r = await post(m, base, { body });
    const draft = r.body;
    assert.equal((await m.agent.get(`${base}/${draft.id}/reviews`)).status, 404); // drafts have no review
    r = await post(m, `${base}/${draft.id}/publish`, { version: 1 });
    const published = r.body, path = `${base}/${published.id}/reviews`;
    const review = { sourceHash: published.published_hash, target: "전체 근로자", source: "자체 작성", rightsCheckedBy: "김확인", rightsCheckedDate: "2026-10-30", currencyCheckedDate: "2026-10-31", note: "" };
    assert.deepEqual((await e.agent.get(path)).body, { items: [] }); // editors can read
    assert.equal((await post(e, path, review)).status, 403); // manager only
    assert.equal((await post(m, path, { ...review, sourceHash: "0".repeat(64) })).status, 409); // stale/wrong version
    assert.equal((await post(m, path, { ...review, target: " " })).status, 400);
    assert.equal((await post(m, path, { ...review, rightsCheckedDate: "2026-02-30" })).status, 400);
    const key = randomUUID();
    r = await post(m, path, review, key);
    assert.equal(r.status, 200, r.text);
    assert.equal((await post(m, path, review, key)).status, 200); // idempotent replay
    r = await post(m, path, { ...review, target: "신규 채용자" });
    assert.deepEqual(r.body.items.map((x: { target: string; actorName: string }) => [x.target, x.actorName]), [["신규 채용자", "manager"], ["전체 근로자", "manager"]]);
    assert.throws(() => db.prepare("UPDATE education_catalog_reviews SET body='{}'").run());
    assert.throws(() => db.prepare("DELETE FROM education_catalog_reviews").run());
  } finally {
    db.close();
  }
});
