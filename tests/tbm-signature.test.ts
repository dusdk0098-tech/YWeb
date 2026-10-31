import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { TBM_SIGNATURE_CONSENT } from "../server/consent-text.js";
const origin = "http://127.0.0.1:3000", png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const details = { title: "서명 TBM", date: "2026-10-31", time: "08:00", location: "합성", facilitator: "담당", work: "정리", topics: "안전" };
test("TBM signature: consent version, grant needs a PNG, deny has none, append-only, 3-year retention, served as PNG", async () => {
  const db = openDatabase(":memory:"), site = randomUUID(), user = randomUUID(), password = randomUUID();
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성");
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(user, "m@example.test", "관리", await argon2.hash(password));
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, user, "manager");
  try {
    const app = await createApp(db, { origin, secret: "synthetic-signature-secret-".repeat(2) }), m = request.agent(app);
    let r = await m.get("/api/session");
    r = await m.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: "m@example.test", password });
    const csrf = r.body.csrf, base = `/api/sites/${site}`;
    const send = (method: "post" | "put", path: string, body: object) => m[method](path).set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID()).send(body);
    const workers = [];
    for (const name of ["가서명", "나거부"]) {
      const w = (await send("post", base + "/workers", { name, affiliation: "합성", kind: "worker" })).body.id;
      await send("put", `${base}/workers/${w}/identity`, { birthDate: "1991-01-01" });
      workers.push(w);
    }
    let t = (await send("post", base + "/tbm", details)).body;
    const url = `${base}/tbm/${t.id}`;
    for (const w of workers) t = (await send("post", url + "/participants", { workerId: w, version: t.version })).body;
    const token = (await send("post", url + "/invitations", {})).body.token;
    const anon = request.agent(app), ac = (await anon.get("/api/session")).body.csrf;
    const join = (body: object) => anon.post("/api/join").set("Origin", origin).set("x-csrf-token", ac).send({ token, birthDate: "1991-01-01", consentVersion: TBM_SIGNATURE_CONSENT.version, ...body });
    assert.equal((await join({ name: "가서명", decision: "grant", consentVersion: "old" })).status, 400);
    assert.equal((await join({ name: "가서명", decision: "grant" })).status, 400); // no signature drawn
    assert.equal((await join({ name: "가서명", decision: "grant", signature: "data:image/png;base64," + Buffer.from("not a png").toString("base64") })).status, 400);
    assert.equal((await join({ name: "나거부", decision: "deny", signature: "data:image/png;base64," + png.toString("base64") })).status, 400);
    assert.equal(db.prepare("SELECT count(*) n FROM participation_events").get()!.n, 0); // failed tries record nothing
    r = await join({ name: "가서명", decision: "grant", signature: "data:image/png;base64," + png.toString("base64") });
    assert.deepEqual([r.status, r.body.signed], [200, true]);
    r = await join({ name: "나거부", decision: "deny" });
    assert.deepEqual([r.status, r.body.signed], [200, false]);
    const list = (await m.get(url + "/invitations")).body.events as { id: string; worker_name: string; decision: string; signed: number; current: number }[];
    assert.deepEqual(list.map((e) => [e.worker_name, e.decision, e.signed, e.current]), [["가서명", "grant", 1, 1], ["나거부", "deny", 0, 1]]);
    const sig = await m.get(`${url}/participation/${list[0].id}/signature`);
    assert.deepEqual([sig.status, sig.headers["content-type"], Buffer.compare(sig.body, png)], [200, "image/png", 0]);
    assert.equal((await m.get(`${url}/participation/${list[1].id}/signature`)).status, 404);
    assert.equal((await anon.get(`${url}/participation/${list[0].id}/signature`)).status, 401); // login required
    const consent = db.prepare("SELECT text_version,at,retain_until FROM consent_records WHERE decision='grant'").get() as { text_version: string; at: string; retain_until: string };
    assert.equal(consent.text_version, "tbm-signature-v1");
    assert.equal(Number(consent.retain_until.slice(0, 4)) - Number(consent.at.slice(0, 4)), 3);
    assert.throws(() => db.prepare("INSERT INTO signature_records VALUES('x',?,?,'h',11,'s',?,'t','t')").run(list[1].id, site, png)); // deny cannot get a signature
    assert.throws(() => db.prepare("DELETE FROM signature_records").run());
    assert.throws(() => db.prepare("UPDATE consent_records SET decision='deny'").run());
  } finally {
    db.close();
  }
});
