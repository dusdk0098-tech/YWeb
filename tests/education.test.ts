import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../server/app.js";
import { openDatabase } from "../server/db.js";
import {
  educationInput,
  educationParticipation,
  scheduledMinutes,
} from "../server/education-validation.js";
import type { EducationFull } from "../src/education-types.js";
const origin = "http://127.0.0.1:3000",
  details = {
    title: "교육 <script>",
    courseLabel: "자체 과정",
    instructor: "수기 강사",
    date: "2026-10-28",
    startTime: "09:00",
    endTime: "10:30",
    breakMinutes: 10,
    location: "회의실",
    objectives: "목표",
    contents: "독립 작성 내용",
  };
test("education strict local schedule and manual participation validation", () => {
  assert.equal(scheduledMinutes(details), 80);
  for (const change of [
    { date: "2026-02-30" },
    { startTime: "9:00" },
    { endTime: "24:00" },
    { startTime: "23:30", endTime: "01:00" },
    { endTime: "09:00" },
    { breakMinutes: 90 },
    { breakMinutes: -1 },
    { breakMinutes: 1.5 },
    { scheduledMinutes: 80 },
    { certificate: true },
  ])
    assert.equal(
      educationInput.safeParse({ ...details, ...change }).success,
      false,
    );
  assert.equal(
    educationInput.safeParse({
      ...details,
      startTime: "00:00",
      endTime: "23:59",
      breakMinutes: 1438,
    }).success,
    true,
  );
  for (const input of [
    { state: "pending", attendedMinutes: 1 },
    { state: "absent", attendedMinutes: 1 },
    { state: "attended", attendedMinutes: 0 },
    { state: "attended", attendedMinutes: 1.1 },
    { state: "attended", attendedMinutes: 1, recorded_by: "fake" },
  ])
    assert.equal(
      educationParticipation.safeParse({ version: 1, ...input }).success,
      false,
    );
});
test("v6 education migration preserves records and atomically refuses collision/future schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-education-migration-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  try {
    db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE IF EXISTS work_stop_events; DROP TABLE IF EXISTS work_stops; DROP TRIGGER IF EXISTS cost_split_active_source_frozen; DROP TRIGGER IF EXISTS cost_split_undone_child_restore; DROP TABLE IF EXISTS cost_split_children; DROP TABLE IF EXISTS cost_splits; DROP TABLE IF EXISTS education_catalog_links; DROP TABLE IF EXISTS education_catalog_revision_notes; DROP TABLE IF EXISTS education_catalog; DROP TABLE IF EXISTS work_plan_events; DROP TABLE IF EXISTS work_plan_snapshots; DROP TABLE IF EXISTS work_plans; DROP TRIGGER IF EXISTS account_auth_on_user; DROP TABLE IF EXISTS account_events; DROP TABLE IF EXISTS account_auth; DROP TABLE IF EXISTS equipment_due; DROP TABLE IF EXISTS stock_events; DROP TABLE IF EXISTS stock_movements; DROP TABLE IF EXISTS stock_items; DROP TABLE IF EXISTS cost_events; DROP TABLE IF EXISTS cost_expenses; DROP TABLE IF EXISTS cost_closures; DROP TABLE IF EXISTS cost_periods; DROP TABLE IF EXISTS daily_journal_events; DROP TABLE IF EXISTS daily_journal_snapshots; DROP TABLE IF EXISTS daily_journals; DROP TABLE IF EXISTS inspection_task_links; DROP TABLE IF EXISTS inspection_task_events; DROP TABLE IF EXISTS inspection_tasks; DROP TABLE IF EXISTS hazard_attachments; DROP TABLE IF EXISTS equipment_use_events; DROP TABLE IF EXISTS equipment_uses; DROP TABLE IF EXISTS equipment_events; DROP TABLE IF EXISTS equipment; DROP TABLE IF EXISTS notice_events; DROP TABLE IF EXISTS notice_acknowledgements; DROP TABLE IF EXISTS notice_snapshots; DROP TABLE IF EXISTS notice_targets; DROP TABLE IF EXISTS notices; DROP TABLE education_snapshots;DROP TABLE education_participants;DROP TABLE education_sessions;PRAGMA user_version=6;INSERT INTO users VALUES('u','u@example.test','preserved','hash')",
    );
    db.close();
    db = openDatabase(path);
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      CURRENT_SCHEMA_VERSION,
    );
    assert.equal(
      (db.prepare("SELECT name FROM users").get() as { name: string }).name,
      "preserved",
    );
    db.exec("DROP TABLE education_sessions;PRAGMA user_version=6");
    db.close();
    assert.throws(() => openDatabase(path), /already exists/);
    db = new DatabaseSync(path);
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      6,
    );
    assert.equal(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='education_sessions'",
        )
        .get(),
      undefined,
    );
    db.exec(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION + 1}`);
    db.close();
    assert.throws(() => openDatabase(path), /newer/);
    db = new DatabaseSync(path);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("education manual time, author ownership, immutable archive and fresh revision preserve record semantics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-education-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  const password = randomUUID(),
    hash = await argon2.hash(password),
    ids = {
      manager: randomUUID(),
      editor: randomUUID(),
      viewer: randomUUID(),
      other: randomUUID(),
    };
  for (const [n, id] of Object.entries(ids))
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      n + "@example.test",
      n,
      hash,
    );
  const config = {
    secret: randomUUID() + randomUUID(),
    origin,
    adsEnabled: true,
  };
  let app = await createApp(db, config);
  async function login(n: keyof typeof ids) {
    const c = request.agent(app),
      s = await c.get("/api/session"),
      r = await c
        .post("/api/login")
        .set("Origin", origin)
        .set("x-csrf-token", s.body.csrf)
        .send({ email: n + "@example.test", password });
    assert.equal(r.status, 200);
    return { c, csrf: r.body.csrf as string };
  }
  const m = await login("manager"),
    ed = await login("editor"),
    viewer = await login("viewer"),
    other = await login("other");
  function write(
    w: typeof m,
    method: "post" | "put" | "delete",
    url: string,
    body: object,
    key = randomUUID(),
  ) {
    return w.c[method](url)
      .set("Origin", origin)
      .set("x-csrf-token", w.csrf)
      .set("idempotency-key", key)
      .send(body);
  }
  try {
    const site = (await write(m, "post", "/api/sites", { name: "교육 현장" }))
        .body.id as string,
      base = `/api/sites/${site}`;
    for (const [name, role] of [
      ["editor", "editor"],
      ["viewer", "viewer"],
    ])
      await write(m, "put", base + "/members", {
        email: name + "@example.test",
        role,
      });
    const w = (
      await write(m, "post", base + "/workers", {
        name: "참가자 <script>",
        affiliation: "업체",
        kind: "worker",
      })
    ).body;
    let r = (await write(ed, "post", base + "/education", details))
      .body as EducationFull;
    const url = base + "/education/" + r.id;
    assert.equal(r.scheduledMinutes, 80);
    assert.equal(r.participants.length, 0);
    assert.equal(
      (await write(m, "put", url, { ...details, version: r.version })).status,
      403,
    );
    assert.equal(
      (await write(viewer, "post", base + "/education", details)).status,
      403,
    );
    assert.equal((await other.c.get(url + "/print")).status, 403);
    assert.equal(
      (await write(m, "post", url + "/archive", { version: r.version })).status,
      409,
    );
    assert.equal(
      (
        await write(ed, "post", url + "/participants", {
          version: r.version,
          workerId: randomUUID(),
        })
      ).status,
      404,
    );
    r = (
      await write(ed, "post", url + "/participants", {
        version: r.version,
        workerId: w.id,
      })
    ).body;
    assert.equal(r.participants[0].state, "pending");
    assert.equal(r.participants[0].attended_minutes, 0);
    assert.equal(
      (await write(m, "post", url + "/archive", { version: r.version })).status,
      409,
    );
    assert.equal(
      (
        await write(ed, "put", url + "/participants/" + w.id, {
          version: r.version,
          state: "attended",
          attendedMinutes: 81,
        })
      ).status,
      400,
    );
    r = (
      await write(ed, "put", url + "/participants/" + w.id, {
        version: r.version,
        state: "attended",
        attendedMinutes: 70,
      })
    ).body;
    assert.equal(r.participants[0].recorded_by, ids.editor);
    assert.equal(
      (
        await write(ed, "put", url, {
          ...details,
          endTime: "09:30",
          version: r.version,
        })
      ).status,
      409,
    );
    assert.equal(
      (await write(ed, "post", url + "/archive", { version: r.version }))
        .status,
      403,
    );
    db.prepare("UPDATE workers SET active=0 WHERE id=?").run(w.id);
    assert.equal(
      (
        await write(ed, "put", url + "/participants/" + w.id, {
          version: r.version,
          state: "attended",
          attendedMinutes: 60,
        })
      ).status,
      409,
    );
    const archived = await write(m, "post", url + "/archive", {
      version: r.version,
    });
    assert.equal(archived.status, 200);
    r = archived.body;
    assert.equal(r.status, "archived");
    assert.equal(r.snapshot!.body.scheduledMinutes, 80);
    assert.equal(r.snapshot!.body.participants[0].attended_minutes, 70);
    assert.equal(r.snapshot!.body.author.id, ids.editor);
    const raw = db
      .prepare("SELECT body,hash FROM education_snapshots WHERE session_id=?")
      .get(r.id) as { body: string; hash: string };
    assert.equal(createHash("sha256").update(raw.body).digest("hex"), raw.hash);
    assert.throws(
      () =>
        db
          .prepare("UPDATE education_sessions SET body=? WHERE id=?")
          .run("{}", r.id),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            "UPDATE education_participants SET attended_minutes=1 WHERE session_id=?",
          )
          .run(r.id),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare("DELETE FROM education_snapshots WHERE session_id=?")
          .run(r.id),
      /immutable/,
    );
    assert.equal(
      (await write(ed, "put", url, { ...details, version: r.version })).status,
      409,
    );
    const print = (await viewer.c.get(url + "/print")).text;
    assert(!print.includes("<script>"));
    assert(!print.includes("ad-slot"));
    assert(print.includes("이수증"));
    db.prepare("UPDATE users SET name=? WHERE id=?").run(
      "changed",
      ids.manager,
    );
    db.prepare("UPDATE sites SET name=? WHERE id=?").run("changed", site);
    db.prepare("UPDATE workers SET name=? WHERE id=?").run("changed", w.id);
    assert.equal((await viewer.c.get(url + "/print")).text, print);
    db.prepare(
      "UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?",
    ).run(site, ids.editor);
    assert.equal(
      (
        await write(m, "post", url + "/revise", {
          version: r.version,
          reason: "correct",
          authorId: ids.editor,
        })
      ).status,
      400,
    );
    const key = randomUUID(),
      nextResponse = await write(
        m,
        "post",
        url + "/revise",
        { version: r.version, reason: "correct", authorId: ids.manager },
        key,
      );
    assert.equal(nextResponse.status, 200);
    const next = nextResponse.body as EducationFull;
    assert.equal(next.author_id, ids.manager);
    assert.equal(next.parent_id, r.id);
    assert.equal(next.participants[0].name, "참가자 <script>");
    assert.equal(next.participants[0].state, "pending");
    assert.equal(next.participants[0].attended_minutes, 0);
    assert.equal(next.participants[0].recorded_by, null);
    assert.equal(
      (
        await write(
          m,
          "post",
          url + "/revise",
          { version: r.version, reason: "correct", authorId: ids.manager },
          key,
        )
      ).body.id,
      next.id,
    );
    assert.equal(
      (
        await write(m, "post", url + "/revise", {
          version: r.version,
          reason: "different",
          authorId: ids.manager,
        })
      ).status,
      409,
    );
    assert.equal((await viewer.c.get(url + "/print")).text, print);
    db.close();
    db = openDatabase(path);
    app = await createApp(db, config);
    const again = await login("viewer");
    assert.equal((await again.c.get(url + "/print")).text, print);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
