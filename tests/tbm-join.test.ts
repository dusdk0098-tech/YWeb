import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { TBM_SIGNATURE_CONSENT } from "../server/consent-text.js";
const origin = "http://127.0.0.1:3000";
const details = { title: "합성 TBM", date: "2026-10-31", time: "08:00", location: "합성 장소", facilitator: "담당", work: "정리", topics: "안전" };
test("TBM link participation: name + birth date of a roster worker, hashed values only, expiry/revoke/change, no login", async () => {
  const db = openDatabase(":memory:"), site = randomUUID(), password = randomUUID(), hash = await argon2.hash(password), ids: Record<string, string> = {};
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성");
  for (const role of ["manager", "editor"]) {
    ids[role] = randomUUID();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(ids[role], role + "@example.test", role, hash);
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, ids[role], role);
  }
  try {
    const app = await createApp(db, { origin, secret: "synthetic-tbm-join-secret-".repeat(2) });
    const login = async (name: string) => {
      const agent = request.agent(app);
      let r = await agent.get("/api/session");
      r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: name + "@example.test", password });
      return { agent, csrf: r.body.csrf as string };
    };
    const m = await login("manager"), e = await login("editor"), base = `/api/sites/${site}`;
    const send = (a: { agent: ReturnType<typeof request.agent>; csrf: string }, method: "post" | "put", path: string, body: object, key = randomUUID()) =>
      a.agent[method](path).set("Origin", origin).set("x-csrf-token", a.csrf).set("idempotency-key", key).send(body);
    const worker = (await send(m, "post", base + "/workers", { name: "김 철수", affiliation: "합성", kind: "worker" })).body.id;
    const twin = (await send(m, "post", base + "/workers", { name: "김철수", affiliation: "다른 소속", kind: "worker" })).body.id; // same name, no birth date
    assert.equal((await send(e, "put", `${base}/workers/${worker}/identity`, { birthDate: "1990-05-06" })).status, 403); // manager only
    assert.equal((await send(m, "put", `${base}/workers/${worker}/identity`, { birthDate: "1990-02-30" })).status, 400);
    assert.equal((await send(m, "put", `${base}/workers/${worker}/identity`, { birthDate: "1990-05-06" })).status, 200);
    assert.deepEqual((await m.agent.get(`${base}/worker-identities`)).body, { workerIds: [worker] });
    const stored = JSON.stringify(db.prepare("SELECT * FROM worker_identities").all()) + JSON.stringify(db.prepare("SELECT request,response FROM idempotency").all());
    assert.doesNotMatch(stored, /1990-05-06/); // only a salted hash, also not in idempotency receipts
    let t = (await send(e, "post", base + "/tbm", details)).body;
    const url = `${base}/tbm/${t.id}`;
    for (const w of [worker, twin]) t = (await send(e, "post", url + "/participants", { workerId: w, version: t.version })).body;
    let r = await send(e, "post", url + "/invitations", {});
    assert.equal(r.status, 200, r.text);
    const token = r.body.token as string;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM activity_invitations").all()), new RegExp(token)); // only its hash is stored
    const anon = request.agent(app), csrf = (await anon.get("/api/session")).body.csrf;
    const join = (body: object) => anon.post("/api/join").set("Origin", origin).set("x-csrf-token", csrf).send({ consentVersion: TBM_SIGNATURE_CONSENT.version, decision: "deny", ...body });
    assert.deepEqual((await anon.post("/api/join/info").set("Origin", origin).set("x-csrf-token", csrf).send({ token })).body, { title: "합성 TBM", date: "2026-10-31", location: "합성 장소" });
    assert.equal((await anon.post("/api/join").set("Origin", origin).send({ token, name: "김철수", birthDate: "1990-05-06" })).status, 403); // CSRF still applies
    assert.equal((await join({ token, name: "김철수", birthDate: "1990-05-07" })).status, 400);
    r = await join({ token, name: "김철수", birthDate: "1990-05-06" }); // spacing differs from the roster name
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.name, r.body.already], ["김 철수", false]);
    assert.equal((await join({ token, name: "김 철수", birthDate: "1990-05-06" })).body.already, true);
    const list = (await e.agent.get(url + "/invitations")).body;
    assert.deepEqual(list.events.map((x: { worker_id: string }) => x.worker_id), [worker]);
    assert.equal((await e.agent.get(url)).body.participants.find((p: { worker_id: string }) => p.worker_id === worker).state, "pending"); // roster not changed automatically
    // TBM content changes invalidate the link.
    t = (await e.agent.get(url)).body;
    assert.equal((await send(e, "put", url, { ...details, title: "바뀐 제목", version: t.version })).status, 200);
    assert.equal((await join({ token, name: "김 철수", birthDate: "1990-05-06" })).status, 410);
    // Revoked and expired links fail; a fresh link works again.
    const fresh = (await send(e, "post", url + "/invitations", {})).body;
    assert.equal((await send(e, "post", `${url}/invitations/${fresh.invitations[0].id}/revoke`, {})).status, 200);
    assert.equal((await join({ token: fresh.token, name: "김 철수", birthDate: "1990-05-06" })).status, 410);
    const expiredToken = "A".repeat(43);
    db.prepare("INSERT INTO activity_invitations VALUES(?,?,'tbm',?,?,?,?,NULL,?,?)").run(randomUUID(), site, t.id, createHash("sha256").update(expiredToken).digest("hex"), "x", "2000-01-01T00:00:00.000Z", ids.editor, "2000-01-01T00:00:00.000Z");
    assert.equal((await join({ token: expiredToken, name: "김 철수", birthDate: "1990-05-06" })).status, 410);
    assert.throws(() => db.prepare("DELETE FROM participation_events").run());
    assert.throws(() => db.prepare("UPDATE activity_invitations SET revoked_at=NULL").run());
    // Repeated wrong birth dates on one link are rate limited.
    const limited = (await send(e, "post", url + "/invitations", {})).body.token;
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await join({ token: limited, name: "김 철수", birthDate: `1990-01-${String(i + 1).padStart(2, "0")}` })).status;
    assert.equal(last, 429);
  } finally {
    db.close();
  }
});
