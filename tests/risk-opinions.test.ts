import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";

const origin = "http://127.0.0.1:3000";
async function setup() {
  const db = openDatabase(":memory:"),
    manager = randomUUID(),
    site = randomUUID(),
    password = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    manager,
    "synthetic@example.test",
    "Synthetic",
    await argon2.hash(password),
  );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
    site,
    "Synthetic site",
  );
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    site,
    manager,
    "manager",
  );
  const app = await createApp(db, {
      origin,
      secret: "synthetic-business-only".repeat(3),
    }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "synthetic@example.test", password });
  assert.equal(r.status, 200);
  const csrf = r.body.csrf,
    base = `/api/sites/${site}`;
  const send = (
    method: "post" | "put",
    path: string,
    body: object,
    key = randomUUID(),
  ) =>
    agent[method](base + path)
      .set("Origin", origin)
      .set("x-csrf-token", csrf)
      .set("idempotency-key", key)
      .send(body);
  return { db, manager, site, agent, base, send };
}
const criteria = {
  name: "Synthetic human criteria",
  method: "product" as const,
  likelihood: ["L1", "L2", "L3", "L4", "L5"],
  severity: ["S1", "S2", "S3", "S4"],
  rationale: "Synthetic arithmetic test, not operational standard",
  bands: [
    { min: 1, max: 5, label: "Synthetic A", criterionAcceptable: true },
    { min: 6, max: 20, label: "Synthetic B", criterionAcceptable: false },
  ],
};
const hazard = () => ({
  id: randomUUID(),
  task: "Synthetic task",
  location: "Test location",
  category: "Human text",
  accidentType: "Human text",
  scenario: "Synthetic scenario",
  harm: "Synthetic harm",
  exposedGroup: "Generic group",
  reference: "No legal claim",
  currentControls: "Human note",
  likelihood: null as number | null,
  severity: null as number | null,
  judgmentReason: "",
  plans: [] as {
    action: string;
    controlType: "미정";
    ownerNote: string;
    due: null;
    priorityNote: string;
    preconditions: string;
  }[],
});
const draft = () => ({
  title: "Synthetic assessment",
  date: "2026-10-28",
  timing: "수시" as const,
  trigger: "Synthetic change",
  workScope: "Synthetic scope",
  method: "product" as const,
  hazards: [hazard()],
});
function complete() {
  const body = draft();
  body.hazards[0].likelihood = 5;
  body.hazards[0].severity = 4;
  body.hazards[0].judgmentReason = "Synthetic basis";
  body.hazards[0].plans = [
    {
      action: "Human plan",
      controlType: "미정",
      ownerNote: "Group",
      due: null,
      priorityNote: "",
      preconditions: "",
    },
  ];
  return body;
}
async function acceptedSource() {
  const f = await setup(),
    reviewer = randomUUID(),
    password = randomUUID();
  f.db
    .prepare("INSERT INTO users VALUES(?,?,?,?)")
    .run(
      reviewer,
      "action-reviewer@example.test",
      "Synthetic reviewer",
      await argon2.hash(password),
    );
  f.db
    .prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(f.site, reviewer, "manager");
  const app = await createApp(f.db, {
      origin,
      secret: "synthetic-business-only".repeat(3),
    }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "action-reviewer@example.test", password });
  const csrf = r.body.csrf,
    send = (path: string, body: object, key = randomUUID()) =>
      agent
        .post(f.base + path)
        .set("Origin", origin)
        .set("x-csrf-token", csrf)
        .set("idempotency-key", key)
        .send(body);
  r = await f.send("post", "/risk-criteria", criteria);
  const cid = r.body.id;
  r = await f.send("post", `/risk-criteria/${cid}/confirm`, {
    version: 1,
    reason: "Synthetic",
    confirmHumanCriteria: true,
  });
  assert.equal(r.status, 200);
  const body = complete();
  Object.assign(body.hazards[0].plans[0], {
    controlType: "관리적",
    due: "2026-11-01",
  });
  body.hazards[0].plans.push({
    ...body.hazards[0].plans[0],
    action: "Second human plan",
  });
  r = await f.send("post", "/risk-assessments", { body, criteriaId: cid });
  const id = r.body.id;
  r = await f.send("post", `/risk-assessments/${id}/submit`, {
    version: 1,
    reason: "Document only",
    confirmRecordOnly: true,
  });
  assert.equal(r.status, 200);
  r = await send(`/risk-assessments/${id}/review`, {
    version: 2,
    decision: "accepted",
    reason: "Record review",
    confirmRecordOnly: true,
  });
  assert.equal(r.status, 200);
  return {
    ...f,
    reviewer,
    reviewAgent: agent,
    reviewSend: send,
    doc: r.body.record,
    body,
  };
}
test("account opinions preserve original, amendments and responses without changing frozen assessment", async () => {
  const f = await acceptedSource();
  try {
    const path = `/risk-assessments/${f.doc.id}/opinions`,
      value = {
        submissionHash: f.doc.submission_hash,
        hazardId: f.body.hazards[0].id,
        text: "Original account feedback",
        confirmAccountOpinion: true,
      },
      key = randomUUID();
    let r = await f.send("post", path, value, key);
    assert.equal(r.status, 200);
    const id = r.body.id,
      original = r.body.original_hash;
    assert.equal((await f.send("post", path, value, key)).body.id, id);
    r = await f.reviewSend(`/risk-opinions/${id}/respond`, {
      version: 1,
      outcome: "planned",
      note: "Human plan, not applied automatically",
      reason: "Initial response",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "responded");
    r = await f.send("post", `/risk-opinions/${id}/amend`, {
      version: 2,
      text: "Amended account feedback",
      reason: "Clarification",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.response, null);
    assert.equal(r.body.original_hash, original);
    assert.equal(r.body.original.text, value.text);
    r = await f.reviewSend(`/risk-opinions/${id}/respond`, {
      version: 3,
      outcome: "needs_information",
      note: "More detail requested",
      reason: "New response",
    });
    assert.equal(r.status, 200);
    const events = await f.agent.get(f.base + `/risk-opinions/${id}/events`);
    assert.equal(events.body.items.length, 4);
    assert.match(events.body.items[1].snapshot, /Human plan/);
    const doc = await f.agent.get(f.base + `/risk-assessments/${f.doc.id}`);
    assert.equal(doc.body.submission_hash, f.doc.submission_hash);
    assert.equal(doc.body.version, f.doc.version);
    assert.throws(() =>
      f.db.prepare("UPDATE risk_opinions SET original='{}' WHERE id=?").run(id),
    );
    const race = await Promise.all(
      ["a", "b"].map((text) =>
        f.send("post", `/risk-opinions/${id}/amend`, {
          version: 4,
          text,
          reason: "Concurrent clarification",
        }),
      ),
    );
    assert.deepEqual(race.map((v) => v.status).sort(), [200, 409]);
    r = await f.reviewSend(`/risk-assessments/${f.doc.id}/revise`, {
      version: f.doc.version,
      reason: "New document",
      authorId: f.manager,
    });
    assert.equal(r.status, 200);
    assert.equal((await f.send("post", path, value)).status, 409);
    r = await f.send("post", `/risk-opinions/${id}/amend`, {
      version: 5,
      text: "Historical source clarification",
      reason: "Keep old source trace",
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.sourceDocument.successorId);
    assert.equal(r.body.source.assessmentId, f.doc.id);
  } finally {
    f.db.close();
  }
});
test("account opinion business visibility, transactional rollback and schema migration", async () => {
  const f = await acceptedSource();
  try {
    const path = `/risk-assessments/${f.doc.id}/opinions`,
      value = {
        submissionHash: f.doc.submission_hash,
        hazardId: null,
        text: "Private account feedback",
        confirmAccountOpinion: true,
      };
    const r = await f.send("post", path, value);
    assert.equal(r.status, 200);
    const id = r.body.id;
    f.db
      .prepare(
        "UPDATE memberships SET role='editor' WHERE site_id=? AND user_id=?",
      )
      .run(f.site, f.reviewer);
    assert.equal(
      (
        await f.reviewSend(`/risk-opinions/${id}/respond`, {
          version: 1,
          outcome: "planned",
          note: "Note",
          reason: "Reason",
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.reviewAgent.get(f.base + `/risk-opinions/${id}`)).status,
      404,
    );
    assert.equal(
      (await f.reviewAgent.get(f.base + `/risk-opinions/${id}/events`)).status,
      404,
    );
    assert.equal(
      (await f.reviewAgent.get(f.base + "/risk-opinions")).body.items.length,
      0,
    );
    f.db
      .prepare(
        "UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?",
      )
      .run(f.site, f.manager);
    assert.equal(
      (await f.agent.get(f.base + `/risk-opinions/${id}`)).status,
      200,
    );
    assert.equal((await f.send("post", path, value)).status, 403);
    assert.equal(
      (
        await f.send("post", `/risk-opinions/${id}/amend`, {
          version: 1,
          text: "No",
          reason: "No",
        })
      ).status,
      403,
    );
    f.db
      .prepare(
        "UPDATE memberships SET role='manager' WHERE site_id=? AND user_id=?",
      )
      .run(f.site, f.manager);
    f.db.exec(
      "CREATE TRIGGER opinion_failure BEFORE INSERT ON risk_opinion_events BEGIN SELECT RAISE(ABORT,'synthetic event failure'); END;",
    );
    assert.equal((await f.send("post", path, value)).status, 500);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM risk_opinions").get()?.n,
      1,
    );
    f.db.exec(
      "DROP TRIGGER opinion_failure; DROP TABLE risk_opinion_events; DROP TABLE risk_opinions; PRAGMA user_version=25",
    );
    const { migrateRiskOpinions } =
      await import("../server/risk-opinion-schema.js");
    migrateRiskOpinions(f.db);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM risk_opinions").get()?.n,
      0,
    );
    assert.equal(
      f.db
        .prepare("SELECT submission_hash FROM risk_assessments WHERE id=?")
        .get(f.doc.id)?.submission_hash,
      f.doc.submission_hash,
    );
  } finally {
    f.db.close();
  }
});
