import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { openDatabase, type Db } from "../server/db.js";
import { HttpError, type SiteOperations } from "../server/site-operations.js";
import { readRiskOverview, registerRiskOverview, riskOverviewQuery, type RiskOverviewMethod } from "../server/risk-overview.js";
const day = "2026-10-28";
function setup() {
  const db = openDatabase(":memory:");
  db.exec("INSERT INTO users VALUES('overview-user','overview@example.test','Synthetic','unused-hash')");
  const site = randomUUID(), other = randomUUID();
  for (const id of [site, other]) db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(id, "Synthetic site");
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, "overview-user", "viewer");
  return { db, site, other };
}
function document(db: Db, site: string, method: RiskOverviewMethod, status = "draft", parent: string | null = null) {
  const id = randomUUID();
  db.prepare("INSERT INTO risk_assessments(id,site_id,author_id,version,body,status,parent_id,created_at,updated_at) VALUES(?,?,'overview-user',1,?,?,?,'synthetic','synthetic')").run(id, site, JSON.stringify({ method }), status, parent);
  return id;
}
function action(db: Db, site: string, doc: string, status: string, due: string) {
  const id = randomUUID();
  db.prepare("INSERT INTO risk_actions(id,site_id,assessment_id,hazard_id,plan_index,source,source_hash,status,assignee_id,due,version,created_at,updated_at) VALUES(?,?,?,?,0,'{}','synthetic',?,'overview-user',?,1,'synthetic','synthetic')").run(id, site, doc, randomUUID(), status, due);
  return id;
}
// Direct synthetic rows test aggregate semantics only, not domain submission validity.
test("risk overview current leaf and prior documents retain unresolved old actions and split methods", () => {
  const { db, site, other } = setup();
  try {
    const root = document(db, site, "product", "accepted");
    const child = document(db, site, "product", "draft", root);
    db.prepare("UPDATE risk_assessments SET successor_id=? WHERE id=?").run(child, root);
    const three = document(db, site, "three_level", "submitted");
    const checklist = document(db, site, "checklist", "returned");
    action(db, site, root, "assigned", "2026-10-27");
    action(db, site, root, "reported", day);
    action(db, site, root, "verified", "2026-10-29");
    action(db, site, three, "reported", "2026-10-27");
    action(db, site, checklist, "assigned", day);
    const hidden = document(db, other, "product", "submitted");
    action(db, other, hidden, "reported", "2026-10-27");
    const before = db.prepare("SELECT total_changes() n").get();
    let authorizations = 0;
    const report = readRiskOverview(db, site, { asOfDate: day }, () => { authorizations++; });
    assert.equal(authorizations, 1);
    assert.equal(report.groups.length, 4);
    const [p, t, c] = report.groups;
    assert.equal(p.documents.currentLeaf.draft, 1);
    assert.equal(p.documents.currentLeaf.accepted, 0);
    assert.equal(p.documents.currentLeaf.submitted, 0);
    assert.equal(p.documents.priorWithSuccessor.accepted, 1);
    assert.deepEqual(p.actions.priorWithSuccessor.assigned, { beforeDate: 1, onDate: 0, afterDate: 0 });
    assert.equal(p.actions.priorWithSuccessor.reported.onDate, 1);
    assert.equal(p.actions.priorWithSuccessor.verified.afterDate, 1);
    assert.equal(t.documents.currentLeaf.submitted, 1);
    assert.equal(t.actions.currentLeaf.reported.beforeDate, 1);
    assert.equal(c.documents.currentLeaf.returned, 1);
    assert.equal(c.actions.currentLeaf.assigned.onDate, 1);
    const earlier = readRiskOverview(db, site, { asOfDate: "2026-10-26", method: "product" }, () => {});
    assert.equal(earlier.groups.length, 1);
    assert.deepEqual(earlier.groups[0].documents, p.documents); // Date does not reconstruct historical state.
    assert.equal(earlier.groups[0].actions.priorWithSuccessor.assigned.afterDate, 1);
    assert.deepEqual(db.prepare("SELECT total_changes() n").get(), before);
    db.prepare("UPDATE risk_assessments SET status='accepted' WHERE id=?").run(child);
    const next = readRiskOverview(db, site, { asOfDate: day }, () => {});
    assert.equal(next.groups[0].documents.currentLeaf.accepted, 1);
    assert.equal(next.groups[0].actions.priorWithSuccessor.assigned.beforeDate, 1);
  } finally { db.close(); }
});
test("risk overview dates, empty groups and malformed relevant data never silently produce partial counts", () => {
  for (const input of [{}, { asOfDate: "2025-02-29" }, { asOfDate: "2026-02-30" }, { asOfDate: day, method: "unknown" }, { asOfDate: day, offset: 0 }]) assert.equal(riskOverviewQuery.safeParse(input).success, false);
  assert.equal(riskOverviewQuery.safeParse({ asOfDate: "2028-02-29" }).success, true);
  const { db, site } = setup();
  try {
    const empty = readRiskOverview(db, site, { asOfDate: day }, () => {});
    assert.equal(empty.groups.length, 4);
    assert.equal(empty.groups[0].documents.currentLeaf.submitted, 0);
    const doc = document(db, site, "product");
    const id = action(db, site, doc, "assigned", "2026-02-30");
    assert.throws(() => readRiskOverview(db, site, { asOfDate: day }, () => {}), /일부 자료를 제외하지 않고/);
    db.prepare("UPDATE risk_actions SET due=? WHERE id=?").run("2028-02-29", id);
    assert.equal(readRiskOverview(db, site, { asOfDate: "2028-02-29" }, () => {}).groups[0].actions.currentLeaf.assigned.onDate, 1);
    db.prepare("UPDATE risk_assessments SET body=? WHERE id=?").run('{"method":"unknown"}', doc);
    assert.throws(() => readRiskOverview(db, site, { asOfDate: day, method: "checklist" }, () => {}), /불완전/);
    db.prepare("UPDATE risk_assessments SET body=? WHERE id=?").run("bad-json", doc);
    assert.throws(() => readRiskOverview(db, site, { asOfDate: day }, () => {}), /불완전/);
  } finally { db.close(); }
});
test("risk overview route delegates current site read access and read transaction rolls back on denial", async () => {
  const { db, site, other } = setup();
  try {
    const app = express();
    // Bounded route harness uses synthetic caller identity, not production login/session verification.
    const access: SiteOperations["access"] = (req) => {
      const row = db.prepare("SELECT role FROM memberships WHERE site_id=? AND user_id=?").get(String(req.params.siteId), "overview-user") as { role: string } | undefined;
      if (!row) throw new HttpError(403, "Synthetic scope denial");
      return row.role;
    };
    registerRiskOverview(app, db, { access, mutate: (() => { throw new Error("read-only route must not mutate"); }) as SiteOperations["mutate"] });
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      res.status(error instanceof HttpError ? error.status : 400).json({ error: String(error) });
    });
    assert.equal((await request(app).get(`/api/sites/${site}/risk-overview?asOfDate=${day}`)).status, 200);
    assert.equal((await request(app).get(`/api/sites/${other}/risk-overview?asOfDate=${day}`)).status, 403);
    assert.equal((await request(app).get(`/api/sites/${site}/risk-overview`)).status, 400);
    assert.throws(() => readRiskOverview(db, site, { asOfDate: day }, () => { throw new HttpError(403, "deny"); }), /deny/);
    assert.equal(readRiskOverview(db, site, { asOfDate: day }, () => {}).groups.length, 4);
  } finally { db.close(); }
});

test("risk overview actual app login and site-reader route expose aggregate records only", async () => {
  const { createApp } = await import("../server/app.js"),
    argon2 = await import("argon2"),
    { db, site, other } = setup(),
    origin = "http://127.0.0.1:3107",
    password = "synthetic-risk-overview-test";
  try {
    db.prepare("UPDATE users SET password_hash=? WHERE id='overview-user'").run(await argon2.hash(password));
    document(db, site, "checklist", "submitted");
    document(db, other, "product", "submitted");
    const app = await createApp(db, { origin, secret: "synthetic-overview-only".repeat(3) });
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);
    await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", session.body.csrf).send({ email: "overview@example.test", password }).expect(200);
    const response = await agent.get(`/api/sites/${site}/risk-overview?asOfDate=${day}`).expect(200);
    assert.equal(response.body.groups[2].documents.currentLeaf.submitted, 1);
    assert.equal(response.body.groups[0].documents.currentLeaf.submitted, 0);
    const content = JSON.stringify(response.body);
    for (const name of ["author_id", "assignee_id", "password", "snapshot", "source_hash", "overview@example.test"]) assert.ok(!content.includes(name));
    await agent.get(`/api/sites/${other}/risk-overview?asOfDate=${day}`).expect(403);
    await request(app).get(`/api/sites/${site}/risk-overview?asOfDate=${day}`).expect(401);
    await agent.get(`/api/sites/${site}/risk-overview?asOfDate=2026-02-30`).expect(400);
    db.prepare("DELETE FROM memberships WHERE site_id=? AND user_id='overview-user'").run(site);
    await agent.get(`/api/sites/${site}/risk-overview?asOfDate=${day}`).expect(403);
  } finally { db.close(); }
});
