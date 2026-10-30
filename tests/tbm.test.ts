import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import request from "supertest";
import argon2 from "argon2";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  tbmInput,
  tbmFinalDetails,
  participantRecord,
} from "../server/tbm-validation.js";
import type { TbmFull } from "../src/tbm-types.js";
const origin = "http://127.0.0.1:3000";
const details = {
  title: "TBM <script>alert(1)</script>",
  date: "2026-10-28",
  time: "08:30",
  location: "작업 전 회의실",
  facilitator: "담당자",
  work: "자재 이동",
  topics: "동선 분리\n작업 전 점검",
};
test("TBM draft/final strict validation and provisional policy fields", () => {
  assert.equal(
    tbmInput.safeParse({
      ...details,
      topics: "",
      work: "",
      facilitator: "",
      location: "",
    }).success,
    true,
  );
  assert.equal(
    tbmFinalDetails.safeParse({ ...details, topics: "" }).success,
    false,
  );
  for (const change of [
    { date: "2026-02-30" },
    { time: "24:00" },
    { title: " " },
    { participants: [] },
    { status: "finalized" },
    { source: "self" },
    { topics: "x".repeat(10001) },
  ])
    assert.equal(tbmInput.safeParse({ ...details, ...change }).success, false);
  assert.equal(
    participantRecord.safeParse({
      version: 1,
      state: "present",
      recorded_by: "other",
    }).success,
    false,
  );
});
test("v2 migration preserves attendance; atomic failure and future schema guard", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-tbm-migration-")),
    path = join(dir, "v2.sqlite");
  let db = openDatabase(path);
  try {
    db.exec(`DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE IF EXISTS work_stop_events; DROP TABLE IF EXISTS work_stops; DROP TRIGGER IF EXISTS cost_split_active_source_frozen; DROP TRIGGER IF EXISTS cost_split_undone_child_restore; DROP TABLE IF EXISTS cost_split_children; DROP TABLE IF EXISTS cost_splits; DROP TABLE IF EXISTS education_catalog_links; DROP TABLE IF EXISTS education_catalog_revision_notes; DROP TABLE IF EXISTS education_catalog; DROP TABLE IF EXISTS work_plan_events; DROP TABLE IF EXISTS work_plan_snapshots; DROP TABLE IF EXISTS work_plans; DROP TRIGGER IF EXISTS account_auth_on_user; DROP TABLE IF EXISTS account_events; DROP TABLE IF EXISTS account_auth; DROP TABLE IF EXISTS equipment_due; DROP TABLE IF EXISTS stock_events; DROP TABLE IF EXISTS stock_movements; DROP TABLE IF EXISTS stock_items; DROP TABLE IF EXISTS cost_events; DROP TABLE IF EXISTS cost_expenses; DROP TABLE IF EXISTS cost_closures; DROP TABLE IF EXISTS cost_periods; DROP TABLE IF EXISTS daily_journal_events; DROP TABLE IF EXISTS daily_journal_snapshots; DROP TABLE IF EXISTS daily_journals; DROP TABLE IF EXISTS inspection_task_links; DROP TABLE IF EXISTS inspection_task_events; DROP TABLE IF EXISTS inspection_tasks; DROP TABLE IF EXISTS hazard_attachments; DROP TABLE IF EXISTS equipment_use_events; DROP TABLE IF EXISTS equipment_uses; DROP TABLE IF EXISTS equipment_events; DROP TABLE IF EXISTS equipment; DROP TABLE IF EXISTS notice_events; DROP TABLE IF EXISTS notice_acknowledgements; DROP TABLE IF EXISTS notice_snapshots; DROP TABLE IF EXISTS notice_targets; DROP TABLE IF EXISTS notices; DROP TABLE IF EXISTS education_snapshots; DROP TABLE IF EXISTS education_participants; DROP TABLE IF EXISTS education_sessions; DROP TABLE IF EXISTS inspection_hazard_links; DROP TABLE IF EXISTS inspection_events; DROP TABLE IF EXISTS inspections; DROP TABLE IF EXISTS inspection_templates; DROP TRIGGER IF EXISTS hazard_event_no_update; DROP TRIGGER IF EXISTS hazard_event_no_delete; DROP TRIGGER IF EXISTS hazard_original_immutable; DROP TRIGGER IF EXISTS hazard_submitted_body_immutable; DROP TABLE IF EXISTS hazard_events; DROP TABLE IF EXISTS hazard_reports; DROP TRIGGER tbm_snapshot_no_update;DROP TRIGGER tbm_snapshot_no_delete;DROP TABLE tbm_snapshots;DROP TABLE tbm_participants;DROP TABLE tbm_sessions;PRAGMA user_version=2;
  INSERT INTO users VALUES('u','u@example.test','u','hash');INSERT INTO sites VALUES('s','site',1);INSERT INTO workers VALUES('w','s','name','company','worker',1,1,'now','now');INSERT INTO attendance VALUES('a','s','w','2026-10-28','name','company','worker','present','manual','first',1,'u','now','now');INSERT INTO attendance_history(attendance_id,version,status,reason,actor_id,at) VALUES('a',1,'present','first','u','now');`);
    db.close();
    db = openDatabase(path);
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      CURRENT_SCHEMA_VERSION,
    );
    assert.equal(
      (
        db.prepare("SELECT reason FROM attendance_history").get() as {
          reason: string;
        }
      ).reason,
      "first",
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE IF EXISTS work_stop_events; DROP TABLE IF EXISTS work_stops; DROP TRIGGER IF EXISTS cost_split_active_source_frozen; DROP TRIGGER IF EXISTS cost_split_undone_child_restore; DROP TABLE IF EXISTS cost_split_children; DROP TABLE IF EXISTS cost_splits; DROP TABLE IF EXISTS education_catalog_links; DROP TABLE IF EXISTS education_catalog_revision_notes; DROP TABLE IF EXISTS education_catalog; DROP TABLE IF EXISTS work_plan_events; DROP TABLE IF EXISTS work_plan_snapshots; DROP TABLE IF EXISTS work_plans; DROP TRIGGER IF EXISTS account_auth_on_user; DROP TABLE IF EXISTS account_events; DROP TABLE IF EXISTS account_auth; DROP TABLE IF EXISTS equipment_due; DROP TABLE IF EXISTS stock_events; DROP TABLE IF EXISTS stock_movements; DROP TABLE IF EXISTS stock_items; DROP TABLE IF EXISTS cost_events; DROP TABLE IF EXISTS cost_expenses; DROP TABLE IF EXISTS cost_closures; DROP TABLE IF EXISTS cost_periods; DROP TABLE IF EXISTS daily_journal_events; DROP TABLE IF EXISTS daily_journal_snapshots; DROP TABLE IF EXISTS daily_journals; DROP TABLE IF EXISTS inspection_task_links; DROP TABLE IF EXISTS inspection_task_events; DROP TABLE IF EXISTS inspection_tasks; DROP TABLE IF EXISTS hazard_attachments; DROP TABLE IF EXISTS equipment_use_events; DROP TABLE IF EXISTS equipment_uses; DROP TABLE IF EXISTS equipment_events; DROP TABLE IF EXISTS equipment; DROP TABLE IF EXISTS notice_events; DROP TABLE IF EXISTS notice_acknowledgements; DROP TABLE IF EXISTS notice_snapshots; DROP TABLE IF EXISTS notice_targets; DROP TABLE IF EXISTS notices; DROP TABLE IF EXISTS education_snapshots; DROP TABLE IF EXISTS education_participants; DROP TABLE IF EXISTS education_sessions; DROP TABLE IF EXISTS inspection_hazard_links; DROP TABLE IF EXISTS inspection_events; DROP TABLE IF EXISTS inspections; DROP TABLE IF EXISTS inspection_templates; DROP TRIGGER IF EXISTS hazard_event_no_update; DROP TRIGGER IF EXISTS hazard_event_no_delete; DROP TRIGGER IF EXISTS hazard_original_immutable; DROP TRIGGER IF EXISTS hazard_submitted_body_immutable; DROP TABLE IF EXISTS hazard_events; DROP TABLE IF EXISTS hazard_reports; DROP TRIGGER tbm_snapshot_no_update;DROP TRIGGER tbm_snapshot_no_delete;DROP TABLE tbm_participants;DROP TABLE tbm_sessions;PRAGMA user_version=2;",
    );
    db.close();
    assert.throws(() => openDatabase(path), /already exists/);
    db = new DatabaseSync(path);
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      2,
    );
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='tbm_sessions'")
        .get(),
      undefined,
    );
    db.exec(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION + 1}`);
    db.close();
    assert.throws(() => openDatabase(path), /newer/);
    db = new DatabaseSync(path);
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM attendance").get() as {
          n: number;
        }
      ).n,
      1,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("TBM participation is manual, final snapshots immutable, revisions reset pending", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-tbm-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  const password = randomUUID(),
    hash = await argon2.hash(password);
  for (const id of ["manager", "editor", "viewer", "outsider"])
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      id + "@example.test",
      id,
      hash,
    );
  const config = {
    secret: randomUUID() + randomUUID(),
    origin,
    adsEnabled: true,
  };
  let app = await createApp(db, config);
  async function login(id: string) {
    const client = request.agent(app),
      s = await client.get("/api/session");
    const r = await client
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", s.body.csrf)
      .send({ email: id + "@example.test", password });
    assert.equal(r.status, 200);
    return {
      client,
      csrf: r.body.csrf as string,
      cookie: r.headers["set-cookie"][0].split(";")[0],
    };
  }
  const m = await login("manager"),
    e = await login("editor"),
    v = await login("viewer"),
    o = await login("outsider");
  function write(
    who: typeof m,
    method: "post" | "put" | "delete",
    url: string,
    body: object,
    key = randomUUID(),
  ) {
    return who.client[method](url)
      .set("Origin", origin)
      .set("x-csrf-token", who.csrf)
      .set("idempotency-key", key)
      .send(body);
  }
  try {
    const site = (await write(m, "post", "/api/sites", { name: "원 현장" }))
        .body.id as string,
      base = `/api/sites/${site}`;
    for (const role of ["editor", "viewer"])
      await write(m, "put", base + "/members", {
        email: role + "@example.test",
        role,
      });
    const worker = (
      await write(m, "post", base + "/workers", {
        name: "참가 <img src=x>",
        affiliation: "원 소속",
        kind: "worker",
      })
    ).body as { id: string };
    const second = (
      await write(m, "post", base + "/workers", {
        name: "미확인 대상",
        affiliation: "원 소속",
        kind: "visitor",
      })
    ).body as { id: string };
    await write(e, "post", base + "/attendance", {
      workerId: worker.id,
      date: details.date,
    });
    let t = (await write(e, "post", base + "/tbm", details)).body as TbmFull;
    const url = base + "/tbm/" + t.id;
    assert.deepEqual(t.participants, []);
    assert.equal((await write(v, "post", base + "/tbm", details)).status, 403);
    assert.equal((await o.client.get(base + "/tbm")).status, 403);
    for (const suffix of ["", "/print"]) {
      assert.equal((await o.client.get(url + suffix)).status, 403);
      assert.equal((await request(app).get(url + suffix)).status, 401);
    }
    assert.equal(
      (await write(e, "post", url + "/finalize", { version: t.version }))
        .status,
      403,
    );
    assert.equal(
      (await write(m, "post", url + "/finalize", { version: t.version }))
        .status,
      409,
    );
    t = (
      await write(e, "post", url + "/participants", {
        workerId: worker.id,
        version: t.version,
      })
    ).body as TbmFull;
    assert.equal(t.participants[0].state, "pending");
    assert.equal(t.participants[0].recorded_by, null);
    assert.equal(
      (await write(m, "post", url + "/finalize", { version: t.version }))
        .status,
      409,
    );
    t = (
      await write(e, "put", url + "/participants/" + worker.id, {
        version: t.version,
        state: "present",
      })
    ).body as TbmFull;
    assert.equal(t.participants[0].recorded_by, "editor");
    assert.ok(t.participants[0].recorded_at);
    t = (
      await write(e, "post", url + "/participants", {
        workerId: second.id,
        version: t.version,
      })
    ).body as TbmFull;
    assert.equal(
      (await write(m, "post", url + "/finalize", { version: t.version }))
        .status,
      409,
    );
    t = (
      await write(e, "put", url + "/participants/" + second.id, {
        version: t.version,
        state: "absent",
      })
    ).body as TbmFull;
    const finalVersion = t.version,
      finalKey = randomUUID();
    const finalized = await write(
      m,
      "post",
      url + "/finalize",
      { version: finalVersion },
      finalKey,
    );
    assert.equal(finalized.status, 200);
    t = finalized.body as TbmFull;
    assert.equal(t.status, "finalized");
    assert.equal(
      (
        await write(
          m,
          "post",
          url + "/finalize",
          { version: finalVersion },
          finalKey,
        )
      ).body.snapshot.hash,
      t.snapshot?.hash,
    );
    assert.equal(
      (await write(m, "post", url + "/finalize", { version: finalVersion }))
        .status,
      409,
    );
    const raw = db
      .prepare("SELECT body,hash FROM tbm_snapshots WHERE session_id=?")
      .get(t.id) as { body: string; hash: string };
    assert.equal(createHash("sha256").update(raw.body).digest("hex"), raw.hash);
    assert.throws(
      () =>
        db
          .prepare("UPDATE tbm_snapshots SET hash=? WHERE session_id=?")
          .run("bad", t.id),
      /immutable/,
    );
    assert.throws(
      () =>
        db.prepare("DELETE FROM tbm_snapshots WHERE session_id=?").run(t.id),
      /immutable/,
    );
    for (const [method, suffix, payload] of [
      ["put", "", { ...details, version: t.version }],
      [
        "put",
        "/participants/" + worker.id,
        { version: t.version, state: "absent" },
      ],
      ["delete", "/participants/" + worker.id, { version: t.version }],
      ["post", "/participants", { version: t.version, workerId: worker.id }],
    ] as const)
      assert.equal((await write(e, method, url + suffix, payload)).status, 409);
    const before = (await v.client.get(url + "/print")).text;
    assert.ok(before.includes("&lt;script&gt;"));
    assert.ok(!before.includes("<script>"));
    assert.ok(!before.includes("광고"));
    assert.ok(
      before.includes(
        "대상자 본인 확인·전자서명·법정 교육 이수 증명이 아닙니다",
      ),
    );
    await write(m, "put", base + "/workers/" + worker.id, {
      name: "바뀐 이름",
      affiliation: "바뀐 소속",
      kind: "visitor",
      active: false,
      version: 1,
    });
    db.prepare("UPDATE sites SET name=? WHERE id=?").run("바뀐 현장", site);
    db.prepare("UPDATE users SET name=? WHERE id=?").run(
      "바뀐 관리자",
      "manager",
    );
    assert.equal((await v.client.get(url + "/print")).text, before);
    assert.equal(
      (
        await write(e, "post", url + "/revise", {
          version: t.version,
          reason: "정정",
        })
      ).status,
      403,
    );
    const revised = await Promise.all([
      write(m, "post", url + "/revise", {
        version: t.version,
        reason: "작업 내용 정정",
      }),
      write(m, "post", url + "/revise", {
        version: t.version,
        reason: "작업 내용 정정",
      }),
    ]);
    assert.deepEqual(revised.map((r) => r.status).sort(), [200, 409]);
    let child = revised.find((r) => r.status === 200)!.body as TbmFull;
    assert.equal(child.parent_id, t.id);
    assert.ok(
      child.participants.every(
        (p) =>
          p.state === "pending" &&
          p.recorded_by === null &&
          p.recorded_at === null,
      ),
    );
    assert.equal(
      child.participants.find((p) => p.worker_id === worker.id)?.name,
      "참가 <img src=x>",
    );
    assert.equal((await v.client.get(url)).body.successorId, child.id);
    const childUrl = base + "/tbm/" + child.id;
    assert.equal(
      (
        await write(e, "put", childUrl + "/participants/" + worker.id, {
          version: child.version,
          state: "present",
        })
      ).status,
      409,
    );
    child = (
      await write(e, "put", childUrl + "/participants/" + worker.id, {
        version: child.version,
        state: "absent",
      })
    ).body as TbmFull;
    child = (
      await write(e, "put", childUrl + "/participants/" + second.id, {
        version: child.version,
        state: "present",
      })
    ).body as TbmFull;
    const competition = await Promise.all([
      write(e, "put", childUrl, {
        ...details,
        title: "정정 제목",
        version: child.version,
      }),
      write(m, "post", childUrl + "/finalize", { version: child.version }),
    ]);
    assert.deepEqual(competition.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await v.client.get(url + "/print")).text, before);
    await write(m, "delete", base + "/members/editor", {});
    assert.equal((await e.client.get(childUrl)).status, 403);
    db.close();
    db = openDatabase(path);
    app = await createApp(db, config);
    assert.equal(
      (
        await request(app)
          .get(url + "/print")
          .set("Cookie", v.cookie)
      ).text,
      before,
    );
    assert.equal(
      (
        db
          .prepare("SELECT hash FROM tbm_snapshots WHERE session_id=?")
          .get(t.id) as { hash: string }
      ).hash,
      raw.hash,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
