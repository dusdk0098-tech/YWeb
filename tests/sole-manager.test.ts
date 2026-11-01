import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import { SOLE_MANAGER_NOTE } from "../server/sole-manager.js";
// 관리자 1명 현장 (결정 11): the only manager's submit also does the "another manager" step, with the note on the
// record; a second manager restores the two-person rule. The fixture site has two managers, so a second site with
// one manager is made here.
const origin = "http://127.0.0.1:3000";
const criteria = {
  name: "Synthetic human criteria", method: "product" as const,
  likelihood: ["L1", "L2", "L3", "L4", "L5"], severity: ["S1", "S2", "S3", "S4"],
  rationale: "Synthetic arithmetic test, not operational standard",
  bands: [{ min: 1, max: 5, label: "Synthetic A", criterionAcceptable: true }, { min: 6, max: 20, label: "Synthetic B", criterionAcceptable: false }],
};
const assessment = () => ({
  title: "Synthetic assessment", date: "2026-10-28", timing: "수시" as const, trigger: "Synthetic change", workScope: "Synthetic scope", method: "product" as const,
  hazards: [{
    id: randomUUID(), task: "Synthetic task", location: "Test location", category: "Human text", accidentType: "Human text", scenario: "Synthetic scenario",
    harm: "Synthetic harm", exposedGroup: "Generic group", reference: "No legal claim", currentControls: "Human note", likelihood: 5, severity: 4,
    judgmentReason: "Synthetic basis", plans: [{ action: "Human plan", controlType: "관리적", ownerNote: "Group", due: "2026-11-01", priorityNote: "", preconditions: "" }],
  }],
});
const minutes = {
  title: "Synthetic minutes", type: "안전보건협의체", date: "2026-10-28", time: "09:00", location: "Synthetic room", attendees: "Synthetic participant entry",
  agenda: "Synthetic agenda", discussion: "Synthetic discussion", decisions: "Synthetic decision",
  actions: [{ task: "Synthetic action", owner: "Free-text owner", due: "2026-11-01", status: "완료" }],
};
test("the only manager finishes inspection, hazard, work stop, follow-up and risk document in one step, marked on the record", async () => {
  const f = await methodFixture();
  try {
    const site = randomUUID();
    f.db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "Sole manager site");
    f.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, f.manager, "manager");
    const csrf = (await f.agent.get("/api/session")).body.csrf as string, base = `/api/sites/${site}`;
    const send = (path: string, body: object) =>
      f.agent.post(base + path).set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID()).send(body);
    const ok = async (path: string, body: object) => { const r = await send(path, body); assert.equal(r.status, 200, `${path}: ${r.text}`); return r.body; };
    const sites = (await f.agent.get("/api/sites")).body as { id: string; managers: number }[];
    assert.equal(sites.find((s) => s.id === site)?.managers, 1);

    // inspection: submit by the only manager is accepted at once
    let t = await ok("/inspection-templates", { title: "Sole template", instructions: "manual", items: ["clear route"] });
    t = await ok(`/inspection-templates/${t.id}/publish`, { version: t.version });
    const answers = (t.body.items as { id: string }[]).map((i) => ({ itemId: i.id, result: "pass", comment: "" }));
    const inspection = async () => ok("/inspections", { templateId: t.id, body: { date: "2026-10-28", location: "gate", performedBy: "direct input", answers } });
    let r = await inspection();
    r = await ok(`/inspections/${r.id}/submit`, { version: r.version });
    assert.equal(r.status, "accepted");
    assert.equal(r.review.reason, SOLE_MANAGER_NOTE);
    assert.equal(r.review.selfProcessed, true);
    assert.equal(r.review.actor.id, f.manager);

    // hazard: the manager's own remediation closes the report
    r = await ok("/hazards", { title: "Sole hazard", observedDate: "2026-10-28", location: "route", description: "material on route" });
    r = await ok(`/hazards/${r.id}/submit`, { version: r.version });
    r = await ok(`/hazards/${r.id}/assign`, { version: r.version, assigneeId: f.manager, dueDate: "2026-10-29", reason: "self assignment" });
    r = await ok(`/hazards/${r.id}/remediate`, { version: r.version, text: "moved the material" });
    assert.equal(r.status, "closed");
    const events = (await f.agent.get(`${base}/hazards/${r.id}/events`)).body.items as { event: string; note: string }[];
    assert.ok(events.some((e) => e.event === "closed" && e.note === SOLE_MANAGER_NOTE));

    // work stop: the requester records the resumption themselves, noted
    r = await ok("/work-stops", { work: "synthetic", location: "test", reason: "manual test only", observedLocal: "2026-10-28T23:50" });
    const stop = `/work-stops/${r.id}`;
    await ok(stop + "/acknowledge", { version: 1, reason: "ack", assigneeId: f.manager });
    await ok(stop + "/record-stop", { version: 2, reason: "claim", recordedLocal: "2026-10-28T23:00" });
    await ok(stop + "/request-review", { version: 3, reason: "review", improvements: "human text", conditions: "manual conditions" });
    r = await ok(stop + "/record-resumption", { version: 4, reason: "self", conditions: "x", recordedLocal: "2026-10-29T00:15" });
    assert.equal(r.status, "resumption_recorded");
    assert.equal(r.resumption_record.selfProcessed, true);
    assert.equal(r.resumption_record.note, SOLE_MANAGER_NOTE);

    // minutes follow-up: the assignee's report is verified at once
    let doc = await ok("/minutes", minutes);
    doc = await ok(`/minutes/${doc.id}/finalize`, { version: doc.version, confirmRecordOnly: true });
    let follow = await ok(`/minutes/${doc.id}/followups`, { version: doc.version, snapshotHash: doc.snapshot.hash, actionIndex: 0, assigneeId: f.manager, due: "2026-11-02", reason: "tracking", confirmManualTracking: true });
    follow = await ok(`/minutes-followups/${follow.id}/report`, { version: follow.version, text: "done by hand", claimedLocalDate: "2026-11-01", reason: "report", confirmHumanReport: true });
    assert.equal(follow.status, "verified");
    assert.equal(follow.verification.note, SOLE_MANAGER_NOTE);
    assert.equal(follow.verification.selfProcessed, true);

    // risk document: the author's submit is accepted at once
    const c = await ok("/risk-criteria", criteria);
    await ok(`/risk-criteria/${c.id}/confirm`, { version: 1, reason: "Synthetic", confirmHumanCriteria: true });
    const a = await ok("/risk-assessments", { body: assessment(), criteriaId: c.id });
    r = await ok(`/risk-assessments/${a.id}/submit`, { version: 1, reason: "Document only", confirmRecordOnly: true });
    assert.equal(r.status, "accepted");
    assert.equal(r.decision.reason, SOLE_MANAGER_NOTE);
    assert.equal(r.decision.selfProcessed, true);

    // a second manager restores the two-person rule
    const second = randomUUID();
    f.db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(second, "second@example.test", "Second", await argon2.hash(randomUUID()));
    f.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, second, "manager");
    r = await inspection();
    r = await ok(`/inspections/${r.id}/submit`, { version: r.version });
    assert.equal(r.status, "submitted");
    assert.equal(r.review, null);
    assert.equal((await send(`/inspections/${r.id}/accept`, { version: r.version, reason: "self" })).status, 403);
  } finally {
    f.db.close();
  }
});
