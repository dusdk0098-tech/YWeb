import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
// 계정 발급 (결정 10): first operator from the install PC only, operator issuance and grants from the install PC only,
// issuer managers for their own site from anywhere, password resets end the account's sessions, everything logged.
const origin = "http://127.0.0.1:3000";
type Client = { a: ReturnType<typeof request.agent>; csrf: string; status: number; body: { user?: { id: string } } };
test("first operator, operator issuance and grants, issuer managers, resets and the event log", async () => {
  const db = openDatabase(":memory:");
  const app = await createApp(db, { origin, secret: "synthetic-business-only".repeat(3) });
  async function login(email: string, password: string): Promise<Client> {
    const a = request.agent(app), s = await a.get("/api/session");
    const r = await a.post("/api/login").set("Origin", origin).set("x-csrf-token", s.body.csrf).send({ email, password });
    return { a, csrf: r.body.csrf, status: r.status, body: r.body };
  }
  const send = (c: Client, method: "post" | "put", path: string, body: object, remote = false) => {
    const q = c.a[method]("/api" + path).set("Origin", origin).set("x-csrf-token", c.csrf).set("idempotency-key", randomUUID());
    return (remote ? q.set("x-forwarded-for", "203.0.113.5") : q).send(body);
  };
  const operatorInput = { name: "Op", email: "op@example.test", password: "synthetic-operator-pw" };
  const anon = request.agent(app), csrf0 = (await anon.get("/api/session")).body.csrf as string;
  assert.deepEqual((await anon.get("/api/setup")).body, { needsOperator: true, local: true });
  // a request that did not come from the install PC cannot create the operator
  assert.equal((await anon.post("/api/setup/operator").set("Origin", origin).set("x-csrf-token", csrf0).set("x-forwarded-for", "203.0.113.5").send(operatorInput)).status, 403);
  assert.equal((await anon.post("/api/setup/operator").set("Origin", origin).set("x-csrf-token", csrf0).send({ ...operatorInput, password: "short" })).status, 400);
  let r = await anon.post("/api/setup/operator").set("Origin", origin).set("x-csrf-token", csrf0).send(operatorInput);
  assert.equal(r.status, 200, r.text);
  assert.equal((await anon.get("/api/setup")).body.needsOperator, false);
  assert.equal((await anon.post("/api/setup/operator").set("Origin", origin).set("x-csrf-token", csrf0).send({ ...operatorInput, email: "second@example.test" })).status, 409);

  const op = await login(operatorInput.email, operatorInput.password);
  assert.equal(op.status, 200);
  const session = (await op.a.get("/api/session")).body;
  assert.equal(session.operator, true);
  assert.equal(session.local, true);
  // operator issues an account with the issuer right; duplicates and remote calls are refused
  r = await send(op, "post", "/accounts", { name: "Mgr", email: "mgr@example.test", password: "synthetic-manager-pw", issuer: true });
  assert.equal(r.status, 200, r.text);
  const mgrId = r.body.id as string;
  assert.equal((await send(op, "post", "/accounts", { name: "Dup", email: "mgr@example.test", password: "synthetic-manager-pw" })).status, 409);
  assert.equal((await send(op, "post", "/accounts", { name: "Far", email: "far@example.test", password: "synthetic-manager-pw" }, true)).status, 403);
  assert.equal((await op.a.get("/api/accounts").set("x-forwarded-for", "203.0.113.5")).status, 403);
  const list = (await op.a.get("/api/accounts")).body.items as { id: string; issuer: boolean; operator: boolean }[];
  assert.equal(list.find((x) => x.id === mgrId)?.issuer, true);
  assert.equal(list.length, 2);

  // the issuer makes a site and creates an editor account that joins it
  const mgr = await login("mgr@example.test", "synthetic-manager-pw");
  assert.equal(mgr.status, 200);
  assert.equal((await mgr.a.get("/api/accounts")).status, 403); // issuer, not operator
  const site = (await send(mgr, "post", "/sites", { name: "Issuer site" })).body.id as string;
  r = await send(mgr, "post", `/sites/${site}/accounts`, { name: "Ed", email: "ed@example.test", password: "synthetic-editor-pw1", role: "editor" });
  assert.equal(r.status, 200, r.text);
  const edId = r.body.id as string;
  let ed = await login("ed@example.test", "synthetic-editor-pw1");
  assert.equal(ed.status, 200);
  assert.equal((await ed.a.get("/api/sites")).body[0].role, "editor");
  assert.equal((await send(ed, "post", `/sites/${site}/accounts`, { name: "X", email: "x@example.test", password: "synthetic-editor-pw1", role: "viewer" })).status, 403);
  // without the issuer right a manager cannot issue
  assert.equal((await send(op, "put", `/accounts/${mgrId}/grants`, { operator: false, issuer: false })).status, 200);
  assert.equal((await send(mgr, "post", `/sites/${site}/accounts`, { name: "X", email: "x@example.test", password: "synthetic-editor-pw1", role: "viewer" })).status, 403);
  assert.equal((await send(op, "put", `/accounts/${mgrId}/grants`, { operator: false, issuer: true })).status, 200);

  // a reset ends the account's sessions and the old password; managers are reset by the operator only
  r = await send(mgr, "post", `/sites/${site}/accounts/${edId}/password`, { password: "synthetic-editor-pw2" });
  assert.equal(r.status, 200, r.text);
  assert.equal((await ed.a.get("/api/sites")).status, 401);
  assert.equal((await login("ed@example.test", "synthetic-editor-pw1")).status, 401);
  ed = await login("ed@example.test", "synthetic-editor-pw2");
  assert.equal(ed.status, 200);
  assert.equal((await send(mgr, "post", `/sites/${site}/accounts/${mgrId}/password`, { password: "synthetic-manager-pw2" })).status, 403);
  assert.equal((await send(op, "post", `/accounts/${mgrId}/password`, { password: "synthetic-manager-pw2" })).status, 200);
  assert.equal((await mgr.a.get("/api/sites")).status, 401);
  // the last operator keeps the right
  assert.equal((await send(op, "put", `/accounts/${session.user.id}/grants`, { operator: false, issuer: true })).status, 409);

  const events = db.prepare("SELECT event,actor_id,site_id FROM account_issuance_events ORDER BY id").all() as { event: string; actor_id: string | null; site_id: string | null }[];
  assert.ok(events.some((e) => e.event === "operator_created" && e.actor_id === null));
  assert.ok(events.some((e) => e.event === "created" && e.actor_id === mgrId && e.site_id === site));
  assert.ok(events.some((e) => e.event === "password_reset" && e.actor_id === session.user.id && e.site_id === null));
  db.close();
});
