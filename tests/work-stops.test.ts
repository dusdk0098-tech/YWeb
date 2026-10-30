import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  localRecordedTime,
  workStopInput,
} from "../server/work-stop-validation.js";
const body = {
  work: "<script>synthetic</script>",
  location: "test",
  reason: "manual test only",
  observedLocal: "2026-10-28T23:50",
};
test("work-stop local clock validation neither infers timezone nor silently rolls invalid dates", () => {
  for (const value of [
    "2026-02-29T12:00",
    "2026-01-01T24:00",
    "2026-01-01T01:60",
    "2026-01-01T01:00Z",
    "2026-1-01T01:00",
  ])
    assert.equal(localRecordedTime.safeParse(value).success, false);
  assert.equal(localRecordedTime.safeParse("2028-02-29T00:00").success, true);
  assert.equal(
    workStopInput.safeParse({ ...body, riskScore: 3 }).success,
    false,
  );
});
test("work-stop manual transition policy, independent reviewer, atomic history and unbounded correction at print cap", async () => {
  const db = openDatabase(":memory:"),
    origin = "http://127.0.0.1:3000",
    site = randomUUID(),
    foreign = randomUUID(),
    password = randomUUID(),
    hash = await argon2.hash(password);
  const ids = {
    manager: randomUUID(),
    second: randomUUID(),
    editor: randomUUID(),
    viewer: randomUUID(),
  };
  for (const id of Object.values(ids))
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      id + "@example.test",
      id,
      hash,
    );
  for (const id of [site, foreign])
    db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(id, "Synthetic");
  for (const [key, id] of Object.entries(ids))
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
      site,
      id,
      key === "second" ? "manager" : key,
    );
  const app = await createApp(db, {
    origin,
    secret: "synthetic-only".repeat(5),
  });
  async function login(id: string) {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", r.body.csrf)
      .send({ email: id + "@example.test", password });
    assert.equal(r.status, 200);
    return { agent, csrf: r.body.csrf };
  }
  const m = await login(ids.manager),
    second = await login(ids.second),
    ed = await login(ids.editor),
    viewer = await login(ids.viewer),
    base = `/api/sites/${site}/work-stops`;
  const post = (u: typeof m, path: string, value: object, key = randomUUID()) =>
    u.agent
      .post(path)
      .set("Origin", origin)
      .set("x-csrf-token", u.csrf)
      .set("idempotency-key", key)
      .send(value);
  try {
    assert.equal((await post(viewer, base, body)).status, 403);
    assert.equal(
      (await post(ed, `/api/sites/${foreign}/work-stops`, body)).status,
      403,
    );
    const key = randomUUID();
    let r = await post(ed, base, body, key);
    assert.equal(r.status, 200, r.text);
    const id = r.body.id,
      path = base + "/" + id,
      original = r.body.original_hash;
    assert.equal((await post(ed, base, body, key)).body.id, id);
    assert.equal(
      (
        await post(ed, path + "/acknowledge", {
          version: 1,
          reason: "x",
          assigneeId: ids.manager,
        })
      ).status,
      403,
    );
    r = await post(m, path + "/acknowledge", {
      version: 1,
      reason: "human acknowledgment",
      assigneeId: ids.manager,
    });
    assert.equal(r.status, 200);
    r = await post(m, path + "/record-stop", {
      version: 2,
      reason: "human claim",
      recordedLocal: "2026-10-28T23:00",
    });
    assert.equal(r.status, 200); // Earlier than request observation allowed.
    r = await post(m, path + "/request-review", {
      version: 3,
      reason: "review please",
      improvements: "human text",
      conditions: "manual conditions",
    });
    assert.equal(r.status, 200);
    assert.equal(
      (
        await post(m, path + "/record-resumption", {
          version: 4,
          reason: "self",
          conditions: "x",
          recordedLocal: "2026-10-29T00:15",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post(second, path + "/record-resumption", {
          version: 4,
          reason: "too early",
          conditions: "x",
          recordedLocal: "2026-10-28T22:59",
        })
      ).status,
      400,
    );
    const resumed = await post(second, path + "/record-resumption", {
      version: 4,
      reason: "independent human record",
      conditions: "manual conditions",
      recordedLocal: "2026-10-29T00:15",
    });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.original_hash, original);
    assert.throws(() =>
      db.prepare("UPDATE work_stops SET original=? WHERE id=?").run("{}", id),
    );
    assert.throws(() =>
      db.prepare("DELETE FROM work_stop_events WHERE record_id=?").run(id),
    );
    assert.equal(
      (
        await post(m, path + "/record-stop", {
          version: 5,
          reason: "overwrite",
          recordedLocal: "2026-10-29T01:00",
        })
      ).status,
      409,
    );
    const annotated = await post(m, path + "/annotate", {
      version: 5,
      reason: "correction preserves originals",
    });
    assert.equal(annotated.status, 200);
    assert.equal(annotated.body.status, "resumption_recorded");
    const printed = await viewer.agent.get(path + "/print");
    assert.equal(printed.status, 200);
    assert.match(printed.text, /&lt;script&gt;/);
    assert.doesNotMatch(printed.text, /<script>|ad-slot/);
    db.exec(
      "CREATE TRIGGER test_work_stop_event_fail BEFORE INSERT ON work_stop_events BEGIN SELECT RAISE(ABORT,'synthetic fault'); END;",
    );
    const count = db.prepare("SELECT count(*) n FROM work_stops").get()!.n;
    assert.equal((await post(ed, base, body)).status, 500);
    assert.equal(
      db.prepare("SELECT count(*) n FROM work_stops").get()!.n,
      count,
    );
    db.exec("DROP TRIGGER test_work_stop_event_fail");
    const event = db
      .prepare("SELECT * FROM work_stop_events WHERE record_id=? LIMIT 1")
      .get(id)!;
    const insert = db.prepare(
      "INSERT INTO work_stop_events(record_id,version,event,actor_id,actor_name,at,note,snapshot) VALUES(?,?,?,?,?,?,?,?)",
    );
    for (let version = 7; version <= 1001; version++)
      insert.run(
        id,
        version,
        "synthetic cap fixture",
        ids.manager,
        "manager",
        String(event.at),
        "fixture",
        String(event.snapshot),
      );
    db.prepare("UPDATE work_stops SET version=1001 WHERE id=?").run(id);
    assert.equal((await viewer.agent.get(path + "/print")).status, 400);
    r = await post(m, path + "/annotate", {
      version: 1001,
      reason: "correction still permitted beyond print cap",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.version, 1002);
    assert.equal(
      (await viewer.agent.get(path + "/history?offset=1000")).body.items.length,
      2,
    );
    // Requester-manager cannot review their own original even when another user submitted improvements.
    r = await post(m, base, body);
    const own = base + "/" + r.body.id;
    await post(m, own + "/acknowledge", {
      version: 1,
      reason: "assign",
      assigneeId: ids.editor,
    });
    await post(m, own + "/record-stop", {
      version: 2,
      reason: "record",
      recordedLocal: "2026-10-28T20:00",
    });
    await post(ed, own + "/request-review", {
      version: 3,
      reason: "submit",
      improvements: "manual",
      conditions: "manual",
    });
    assert.equal(
      (
        await post(m, own + "/record-resumption", {
          version: 4,
          reason: "selfrequest",
          conditions: "manual",
          recordedLocal: "2026-10-29T00:00",
        })
      ).status,
      403,
    );
    r = await post(second, own + "/reassign", {
      version: 4,
      reason: "reassign review resets",
      assigneeId: ids.second,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "stop_recorded");
    assert.equal(r.body.review_record, null);
    db.prepare("DELETE FROM memberships WHERE site_id=? AND user_id=?").run(
      site,
      ids.editor,
    );
    assert.equal((await post(ed, base, body, key)).status, 403);
  } finally {
    db.close();
  }
});
test("work-stop schema19 to20 migration preserves prior accounts and rejects future21", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pedit-workstop-migrate-")),
    path = join(dir, "db.sqlite");
  let db = openDatabase(path);
  try {
    const id = randomUUID();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      "synthetic@example.test",
      "Synthetic",
      "not-a-real-hash",
    );
    db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE work_stop_events;DROP TABLE work_stops;PRAGMA user_version=19",
    );
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, CURRENT_SCHEMA_VERSION);
    assert.equal(db.prepare("SELECT id FROM users").get()?.id, id);
    db.exec(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION + 1}`);
    db.close();
    assert.throws(() => openDatabase(path));
  } finally {
    try {
      db.close();
    } catch {
      /*closed*/
    }
    await rm(dir, { recursive: true, force: true });
  }
});
