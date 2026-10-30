import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import type { RiskAssessmentRecord } from "../server/risk-core.js";
import { emptyNarrativeQuestions } from "../server/risk-narrative-model.js";
import { riskPublicationInput } from "../server/risk-publications.js";
type Fixture = Awaited<ReturnType<typeof methodFixture>>;
function publication(f: Fixture, doc: RiskAssessmentRecord = f.doc, ids = [f.reviewer]) {
  return { assessmentId: doc.id, assessmentVersion: doc.version, submissionHash: doc.submission_hash, recipientIds: ids, statement: "Synthetic account confirmation, not a signature", reason: "Synthetic sharing", confirmAccountPublication: true };
}
async function publish(f: Fixture, doc: RiskAssessmentRecord = f.doc, ids = [f.reviewer]) {
  const r = await f.send("post", "/risk-publications", publication(f, doc, ids));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const view = await f.agent.get(f.base + `/risk-publications/${r.body.id}`);
  assert.equal(view.status, 200, JSON.stringify(view.body));
  return view.body;
}
const ackInput = (p: { version: number; publicationHash: string; publication: { source: { submissionHash: string } } }) => ({ version: p.version, publicationHash: p.publicationHash, submissionHash: p.publication.source.submissionHash, confirmOwnAccount: true });
const originalRows = (f: Fixture) => f.db.prepare("SELECT id,body,submission,submission_hash,criteria_snapshot FROM risk_assessments ORDER BY id").all();
test("risk publication exact fixed source and own viewer-account confirmation preserve original and recipient privacy", async () => {
  const f = await methodFixture();
  try {
    const before = originalRows(f);
    const p = await publish(f);
    assert.equal(p.targets.length, 1);
    assert.equal(p.ownAck, null);
    assert.equal(p.isTarget, false);
    assert.equal(p.canAcknowledge, false);
    f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site, f.reviewer);
    const recipient = await f.reviewAgent.get(f.base + `/risk-publications/${p.id}`);
    assert.equal(recipient.status, 200);
    assert.equal(recipient.body.canAcknowledge, true);
    assert.equal("targets" in recipient.body, false);
    assert.equal("acknowledgements" in recipient.body, false);
    assert.equal("targets" in recipient.body.publication, false);
    f.db.prepare("UPDATE memberships SET role='editor' WHERE site_id=? AND user_id=?").run(f.site, f.manager);
    assert.equal((await f.agent.get(f.base + `/risk-publications/${p.id}`)).status, 404);
    assert.equal((await f.agent.get(f.base + "/risk-publications")).body.items.length, 0);
    f.db.prepare("UPDATE memberships SET role='manager' WHERE site_id=? AND user_id=?").run(f.site, f.manager);
    const source = await f.reviewAgent.get(f.base + `/risk-publications/${p.id}/source`);
    assert.equal(source.status, 200);
    assert.deepEqual(source.body.submission, f.doc.submission);
    const key = randomUUID(), payload = ackInput(recipient.body);
    let r = await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, payload, key);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const recorded = r.body.ownAck;
    assert.equal(recorded.user_id, f.reviewer);
    assert.equal(recorded.submission_hash, f.doc.submission_hash);
    assert.equal(recorded.statement, p.publication.statement);
    assert.deepEqual(Object.keys(r.body).sort(), ["ownAck", "publicationId"]);
    r = await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, payload, key);
    assert.deepEqual(r.body.ownAck, recorded);
    r = await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, payload);
    assert.deepEqual(r.body.ownAck, recorded);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM risk_publication_acks").get()?.n, 1);
    assert.equal((await f.send("post", `/risk-publications/${p.id}/acknowledge`, payload)).status, 404); // Manager cannot confirm for target.
    assert.equal((await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, { ...payload, userId: f.manager })).status, 400);
    const manager = await f.agent.get(f.base + `/risk-publications/${p.id}`);
    assert.equal(manager.body.acknowledgements.length, 1);
    assert.deepEqual(originalRows(f), before);
    assert.throws(() => f.db.prepare("UPDATE risk_publication_acks SET name='different'").run(), /immutable/);
    f.db.prepare("DELETE FROM memberships WHERE site_id=? AND user_id=?").run(f.site, f.reviewer);
    assert.equal((await f.reviewAgent.get(f.base + `/risk-publications/${p.id}`)).status, 403);
    assert.equal((await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, payload, key)).status, 403);
  } finally { f.db.close(); }
});
test("publication withdrawal and document successor stop new confirmation without inheriting past acknowledgment", async () => {
  const f = await methodFixture();
  try {
    const p = await publish(f), payload = ackInput(p), key = randomUUID();
    assert.equal((await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, payload, key)).status, 200);
    assert.equal((await f.send("post", "/risk-publications", publication(f))).status, 409);
    let r = await f.send("post", `/risk-publications/${p.id}/withdraw`, { version: 1, reason: "Correct target choice" });
    assert.equal(r.status, 200);
    assert.equal((await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, payload, key)).status, 409);
    assert.equal((await f.agent.get(f.base + `/risk-publications/${p.id}`)).body.acknowledgements.length, 1);
    const replacement = await publish(f);
    assert.notEqual(replacement.id, p.id);
    assert.equal(replacement.acknowledgements.length, 0);
    assert.equal(replacement.ownAck, null);
    r = await f.reviewSend(`/risk-assessments/${f.doc.id}/revise`, { version: f.doc.version, reason: "New document", authorId: f.manager });
    assert.equal(r.status, 200);
    const next = r.body.nextDraft;
    assert.equal((await f.reviewSend(`/risk-publications/${replacement.id}/acknowledge`, ackInput(replacement))).status, 409);
    assert.equal((await f.send("post", "/risk-publications", { ...publication(f, next), submissionHash: f.doc.submission_hash })).status, 409);
    assert.equal((await f.send("post", "/risk-publications", publication(f))).status, 409);
    r = await f.send("post", `/risk-assessments/${next.id}/submit`, { version: 1, reason: "New submission", confirmRecordOnly: true });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-assessments/${next.id}/review`, { version: 2, decision: "accepted", reason: "Record only", confirmRecordOnly: true });
    assert.equal(r.status, 200);
    const newest = await publish(f, r.body.record);
    assert.equal(newest.acknowledgements.length, 0);
    assert.notEqual(newest.publication.source.submissionHash, p.publication.source.submissionHash);
    const old = (await f.agent.get(f.base + `/risk-publications/${replacement.id}`)).body;
    assert.equal(old.status, "published");
    assert.equal(old.sourceHasSuccessor, true);
    assert.equal(old.canAcknowledge, false);
    assert.equal((await f.send("post", `/risk-publications/${replacement.id}/withdraw`, { version: 1, reason: "Retain historical publication" })).status, 200);
  } finally { f.db.close(); }
});
test("publication explicit target boundaries, source mismatch and new-module event failure remain atomic", async () => {
  const f = await methodFixture();
  try {
    const input = publication(f);
    assert.equal(riskPublicationInput.safeParse({ ...input, recipientIds: [] }).success, false);
    assert.equal(riskPublicationInput.safeParse({ ...input, recipientIds: [f.reviewer, f.reviewer] }).success, false);
    assert.equal(riskPublicationInput.safeParse({ ...input, recipientIds: Array.from({ length: 201 }, () => randomUUID()) }).success, false);
    assert.equal((await f.send("post", "/risk-publications", { ...input, assessmentVersion: f.doc.version + 1 })).status, 409);
    assert.equal((await f.send("post", "/risk-publications", { ...input, submissionHash: "0".repeat(64) })).status, 409);
    assert.equal((await f.send("post", "/risk-publications", { ...input, recipientIds: [randomUUID()] })).status, 400);
    const key = randomUUID();
    f.db.exec("CREATE TRIGGER synthetic_publication_event_failure BEFORE INSERT ON risk_publication_events BEGIN SELECT RAISE(ABORT,'synthetic event failure'); END;");
    assert.equal((await f.send("post", "/risk-publications", input, key)).status, 500);
    for (const table of ["risk_publications", "risk_publication_targets", "risk_publication_events"]) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n, 0);
    f.db.exec("DROP TRIGGER synthetic_publication_event_failure");
    let r = await f.send("post", "/risk-publications", input, key);
    assert.equal(r.status, 200);
    const p = (await f.agent.get(f.base + `/risk-publications/${r.body.id}`)).body;
    assert.equal((await f.send("post", "/risk-publications", input, key)).body.id, p.id);
    assert.throws(() => f.db.prepare("UPDATE risk_publications SET snapshot='{}' WHERE id=?").run(p.id), /immutable|withdrawal only/);
    assert.throws(() => f.db.prepare("INSERT INTO risk_publication_targets VALUES(?,?,?)").run(p.id, f.manager, "Synthetic"), /immutable publication/);
    const ackKey = randomUUID(), payload = ackInput(p);
    f.db.exec("CREATE TRIGGER synthetic_publication_ack_failure BEFORE INSERT ON audit WHEN NEW.event='risk.publication.account_acknowledged' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
    assert.equal((await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, payload, ackKey)).status, 500);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM risk_publication_acks").get()?.n, 0);
    f.db.exec("DROP TRIGGER synthetic_publication_ack_failure");
    r = await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, payload, ackKey);
    assert.equal(r.status, 200);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM risk_publication_acks").get()?.n, 1);
  } finally { f.db.close(); }
});
test("all four assessment methods retain their exact submission in publication without method conversion", async () => {
  const f = await methodFixture();
  try {
    const { likelihood, severity, ...common } = f.body.hazards[0]; void likelihood; void severity;
    const levelId = randomUUID(), itemId = randomUUID();
    const methods = [
      { c: { name: "Three", method: "three_level", rationale: "Human", levels: [levelId, randomUUID(), randomUUID()].map((id, i) => ({ id, label: `Level ${i}`, description: `Definition ${i}`, criterionAcceptable: true })) }, b: { ...f.body, method: "three_level", hazards: [{ ...common, levelId }] } },
      { c: { name: "Checklist", method: "checklist", rationale: "Human", items: [{ id: itemId, prompt: "Own prompt", guidance: "Own guidance" }] }, b: { ...f.body, method: "checklist", hazards: [{ ...common, checklistItemId: itemId, outcome: "compliant" }] } },
      { c: { name: "Narrative", method: "narrative", rationale: "Human", questions: Object.fromEntries(Object.keys(emptyNarrativeQuestions()).map((key) => [key, { prompt: key, guidance: "Own guidance" }])) }, b: { ...f.body, method: "narrative", hazards: [{ ...common, exposurePath: "Own path", additionalPlanDecision: "further_review", plans: [] }] } },
    ];
    const original = await publish(f);
    assert.equal((await f.reviewAgent.get(f.base + `/risk-publications/${original.id}/source`)).body.submission.body.method, "product");
    for (const { c, b } of methods) {
      let r = await f.send("post", "/risk-criteria", c); assert.equal(r.status, 200, JSON.stringify(r.body));
      const cid = r.body.id;
      assert.equal((await f.send("post", `/risk-criteria/${cid}/confirm`, { version: 1, reason: "Own criteria", confirmHumanCriteria: true })).status, 200);
      r = await f.send("post", "/risk-assessments", { body: b, criteriaId: cid }); assert.equal(r.status, 200, JSON.stringify(r.body));
      const id = r.body.id;
      r = await f.send("post", `/risk-assessments/${id}/submit`, { version: 1, reason: "Record", confirmRecordOnly: true }); assert.equal(r.status, 200, JSON.stringify(r.body));
      r = await f.reviewSend(`/risk-assessments/${id}/review`, { version: 2, decision: "accepted", reason: "Record", confirmRecordOnly: true }); assert.equal(r.status, 200);
      const doc = r.body.record, p = await publish(f, doc);
      f.db.prepare("UPDATE memberships SET role='editor' WHERE site_id=? AND user_id=?").run(f.site, f.manager);
    assert.equal((await f.agent.get(f.base + `/risk-publications/${p.id}`)).status, 404);
    assert.equal((await f.agent.get(f.base + "/risk-publications")).body.items.length, 0);
    f.db.prepare("UPDATE memberships SET role='manager' WHERE site_id=? AND user_id=?").run(f.site, f.manager);
    const source = await f.reviewAgent.get(f.base + `/risk-publications/${p.id}/source`);
      assert.deepEqual(source.body.submission, doc.submission);
      assert.equal(source.body.submission.body.method, c.method);
      assert.equal((await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, ackInput(p))).status, 200);
    }
  } finally { f.db.close(); }
});
test("publication accepts explicit 200-account boundary and keeps publication/ack bytes through synthetic backup and migration", async () => {
  const f = await methodFixture(), { mkdtemp, rm } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path"), { backup, DatabaseSync } = await import("node:sqlite"), { openDatabase } = await import("../server/db.js"), { createBackup, restoreBackup } = await import("../scripts/local-backup.js"), dir = await mkdtemp(join(tmpdir(), "risk-publications-"));
  try {
    const ids = [f.reviewer];
    for (let i = 1; i < 200; i++) {
      const id = randomUUID(); ids.push(id);
      f.db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, `${id}@example.test`, `Synthetic target ${i}`, "not-a-real-password");
      f.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(f.site, id, "viewer");
    }
    const p = await publish(f, f.doc, ids);
    assert.equal(p.targets.length, 200);
    assert.equal((await f.reviewSend(`/risk-publications/${p.id}/acknowledge`, ackInput(p))).status, 200);
    const before = Object.fromEntries(["risk_publications", "risk_publication_targets", "risk_publication_acks", "risk_publication_events"].map((table) => [table, f.db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()]));
    const docs = originalRows(f), file = join(dir, "source.sqlite");
    await backup(f.db, file);
    await createBackup(file, join(dir, "bundle"));
    const restored = await restoreBackup(join(dir, "bundle"), join(dir, "restored"));
    const restoredDb = new DatabaseSync(restored.databasePath);
    try {
      for (const [table, expected] of Object.entries(before)) assert.deepEqual(restoredDb.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all(), expected);
      assert.equal(restoredDb.prepare("PRAGMA user_version").get()?.user_version, CURRENT_SCHEMA_VERSION);
      assert.deepEqual(restoredDb.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { restoredDb.close(); }
    const migrationFile = join(dir, "schema30.sqlite"); await backup(f.db, migrationFile);
    const old = new DatabaseSync(migrationFile);
    old.exec("PRAGMA foreign_keys=OFF; DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE risk_reuse_sources; DROP TABLE risk_publication_events; DROP TABLE risk_publication_acks; DROP TABLE risk_publication_targets; DROP TABLE risk_publications; PRAGMA user_version=30;"); old.close();
    const migrated = openDatabase(migrationFile);
    try {
      assert.deepEqual(migrated.prepare("SELECT id,body,submission,submission_hash,criteria_snapshot FROM risk_assessments ORDER BY id").all(), docs);
      assert.equal(migrated.prepare("SELECT COUNT(*) n FROM risk_publications").get()?.n, 0);
      assert.equal(migrated.prepare("SELECT COUNT(*) n FROM risk_publication_acks").get()?.n, 0);
      assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version, CURRENT_SCHEMA_VERSION);
      assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { migrated.close(); }
  } finally { f.db.close(); await rm(dir, { recursive: true, force: true }); }
});
