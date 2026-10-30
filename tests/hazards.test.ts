import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../server/app.js";
import { openDatabase } from "../server/db.js";
import {
  hazardInput,
  hazardSubmitDetails,
  hazardAssignment,
} from "../server/hazard-validation.js";
import type { HazardRecord, HazardEvent } from "../src/hazard-types.js";
const origin = "http://127.0.0.1:3000";
const details = {
  title: "신고 <script>alert(1)</script>",
  observedDate: "2026-10-28",
  location: "작업구역 통로",
  description: "통로에 자재가 놓여 있음",
};
test("hazard strict schema excludes evaluation, attachments and sensitive fields", () => {
  assert.equal(
    hazardInput.safeParse({ ...details, description: "", location: "" })
      .success,
    true,
  );
  assert.equal(
    hazardSubmitDetails.safeParse({ ...details, description: "" }).success,
    false,
  );
  for (const change of [
    { observedDate: "2026-02-30" },
    { severity: 4 },
    { likelihood: 3 },
    { riskScore: 12 },
    { attachments: [] },
    { nationalId: "not allowed" },
    { status: "closed" },
    { description: "x".repeat(10001) },
  ])
    assert.equal(
      hazardInput.safeParse({ ...details, ...change }).success,
      false,
    );
  assert.equal(
    hazardAssignment.safeParse({
      version: 1,
      reason: " ",
      assigneeId: randomUUID(),
      dueDate: "2026-10-29",
    }).success,
    false,
  );
  assert.equal(
    hazardAssignment.safeParse({
      version: 1,
      reason: "배정",
      assigneeId: randomUUID(),
      dueDate: "2026-02-30",
    }).success,
    false,
  );
});
test("v3 to v4 migration preserves TBM and rejects future version; failed migration rolls back", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-hazard-migration-")),
    path = join(dir, "v3.sqlite");
  let db = openDatabase(path);
  try {
    db.exec(
      `DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE IF EXISTS work_stop_events; DROP TABLE IF EXISTS work_stops; DROP TRIGGER IF EXISTS cost_split_active_source_frozen; DROP TRIGGER IF EXISTS cost_split_undone_child_restore; DROP TABLE IF EXISTS cost_split_children; DROP TABLE IF EXISTS cost_splits; DROP TABLE IF EXISTS education_catalog_links; DROP TABLE IF EXISTS education_catalog_revision_notes; DROP TABLE IF EXISTS education_catalog; DROP TABLE IF EXISTS work_plan_events; DROP TABLE IF EXISTS work_plan_snapshots; DROP TABLE IF EXISTS work_plans; DROP TRIGGER IF EXISTS account_auth_on_user; DROP TABLE IF EXISTS account_events; DROP TABLE IF EXISTS account_auth; DROP TABLE IF EXISTS equipment_due; DROP TABLE IF EXISTS stock_events; DROP TABLE IF EXISTS stock_movements; DROP TABLE IF EXISTS stock_items; DROP TABLE IF EXISTS cost_events; DROP TABLE IF EXISTS cost_expenses; DROP TABLE IF EXISTS cost_closures; DROP TABLE IF EXISTS cost_periods; DROP TABLE IF EXISTS daily_journal_events; DROP TABLE IF EXISTS daily_journal_snapshots; DROP TABLE IF EXISTS daily_journals; DROP TABLE IF EXISTS inspection_task_links; DROP TABLE IF EXISTS inspection_task_events; DROP TABLE IF EXISTS inspection_tasks; DROP TABLE IF EXISTS hazard_attachments; DROP TABLE IF EXISTS equipment_use_events; DROP TABLE IF EXISTS equipment_uses; DROP TABLE IF EXISTS equipment_events; DROP TABLE IF EXISTS equipment; DROP TABLE IF EXISTS notice_events; DROP TABLE IF EXISTS notice_acknowledgements; DROP TABLE IF EXISTS notice_snapshots; DROP TABLE IF EXISTS notice_targets; DROP TABLE IF EXISTS notices; DROP TABLE IF EXISTS education_snapshots; DROP TABLE IF EXISTS education_participants; DROP TABLE IF EXISTS education_sessions; DROP TABLE IF EXISTS inspection_hazard_links;DROP TABLE inspection_events;DROP TABLE inspections;DROP TABLE inspection_templates;DROP TABLE hazard_events;DROP TABLE hazard_reports;PRAGMA user_version=3;INSERT INTO users VALUES('u','u@example.test','u','hash');INSERT INTO sites VALUES('s','site',1);INSERT INTO tbm_sessions VALUES('t','s','{"title":"preserve"}','draft',2,NULL,'','u','now','now');`,
    );
    db.close();
    db = openDatabase(path);
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      CURRENT_SCHEMA_VERSION,
    );
    assert.equal(
      (
        db.prepare("SELECT body FROM tbm_sessions WHERE id=?").get("t") as {
          body: string;
        }
      ).body,
      '{"title":"preserve"}',
    );
    db.exec("DROP TABLE hazard_reports;PRAGMA user_version=3");
    db.close();
    assert.throws(() => openDatabase(path), /already exists/);
    db = new DatabaseSync(path);
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      3,
    );
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='hazard_reports'")
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
test("report assignment remediation independent review close/reopen history and protections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-hazard-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  const ids = {
    manager: randomUUID(),
    reporter: randomUUID(),
    assignee: randomUUID(),
    viewer: randomUUID(),
    outsider: randomUUID(),
  };
  const password = randomUUID(),
    hash = await argon2.hash(password);
  for (const [name, id] of Object.entries(ids))
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      name + "@example.test",
      name,
      hash,
    );
  const config = {
    secret: randomUUID() + randomUUID(),
    origin,
    adsEnabled: true,
  };
  let app = await createApp(db, config);
  async function login(name: keyof typeof ids) {
    const client = request.agent(app),
      s = await client.get("/api/session");
    const r = await client
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", s.body.csrf)
      .send({ email: name + "@example.test", password });
    assert.equal(r.status, 200);
    return {
      client,
      csrf: r.body.csrf as string,
      cookie: r.headers["set-cookie"][0].split(";")[0],
    };
  }
  const m = await login("manager"),
    reporter = await login("reporter"),
    assignee = await login("assignee"),
    viewer = await login("viewer"),
    outsider = await login("outsider");
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
    for (const [name, role] of [
      ["reporter", "editor"],
      ["assignee", "editor"],
      ["viewer", "viewer"],
    ])
      await write(m, "put", base + "/members", {
        email: name + "@example.test",
        role,
      });
    let r = (await write(reporter, "post", base + "/hazards", details))
      .body as HazardRecord;
    const url = base + "/hazards/" + r.id;
    assert.equal((await viewer.client.get(url + "/print")).status, 200);
    assert.equal(
      (await write(viewer, "post", base + "/hazards", details)).status,
      403,
    );
    assert.equal(
      (await write(m, "put", url, { ...details, version: r.version })).status,
      403,
    );
    assert.equal(
      (await write(m, "post", url + "/submit", { version: r.version })).status,
      403,
    );
    for (const suffix of ["", "/events", "/print"]) {
      assert.equal((await outsider.client.get(url + suffix)).status, 403);
      assert.equal((await request(app).get(url + suffix)).status, 401);
    }
    assert.equal((await outsider.client.get(base + "/hazards")).status, 403);
    assert.equal(
      (await reporter.client.get(base + "/hazards/assignees")).status,
      403,
    );
    const key = randomUUID(),
      submitVersion = r.version;
    const submitted = await write(
      reporter,
      "post",
      url + "/submit",
      { version: submitVersion },
      key,
    );
    r = submitted.body as HazardRecord;
    assert.equal(r.status, "reported");
    const original = JSON.stringify(r.submitted_snapshot);
    assert.equal(
      (
        await write(
          reporter,
          "post",
          url + "/submit",
          { version: submitVersion },
          key,
        )
      ).body.version,
      r.version,
    );
    assert.equal(
      (await viewer.client.get(url + "/events")).body.items.length,
      2,
    );
    assert.equal(
      (
        await write(reporter, "put", url, {
          ...details,
          title: "change",
          version: r.version,
        })
      ).status,
      409,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE hazard_reports SET submitted_snapshot=? WHERE id=?")
          .run("{}", r.id),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE hazard_reports SET body=? WHERE id=?")
          .run("{}", r.id),
      /immutable/,
    );
    assert.equal(
      (
        await write(m, "post", url + "/assign", {
          version: r.version,
          assigneeId: ids.outsider,
          dueDate: "2026-10-29",
          reason: "다른 현장",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await write(m, "post", url + "/assign", {
          version: r.version,
          assigneeId: ids.viewer,
          dueDate: "2026-10-29",
          reason: "열람자",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await write(reporter, "post", url + "/assign", {
          version: r.version,
          assigneeId: ids.assignee,
          dueDate: "2026-10-29",
          reason: "배정",
        })
      ).status,
      403,
    );
    r = (
      await write(m, "post", url + "/assign", {
        version: r.version,
        assigneeId: ids.assignee,
        dueDate: "2026-10-29",
        reason: "현장 담당 배정",
      })
    ).body as HazardRecord;
    assert.equal(
      (
        await write(reporter, "post", url + "/remediate", {
          version: r.version,
          text: "미배정 사용자",
        })
      ).status,
      403,
    );
    const remediationKey = randomUUID(),
      remediationVersion = r.version;
    r = (
      await write(
        assignee,
        "post",
        url + "/remediate",
        {
          version: r.version,
          text: "자재 이동 후 통로 표시 <img src=x onerror=alert(1)>",
        },
        remediationKey,
      )
    ).body as HazardRecord;
    assert.equal(r.status, "review_requested");
    assert.equal(r.remediator_id, ids.assignee);
    assert.equal(
      (
        await write(assignee, "post", url + "/close", {
          version: r.version,
          reason: "종결",
        })
      ).status,
      403,
    );
    const race = await Promise.all([
      write(m, "post", url + "/close", {
        version: r.version,
        reason: "독립 검토 후 기록상 종결",
      }),
      write(m, "post", url + "/reject", {
        version: r.version,
        reason: "보완 요청",
      }),
    ]);
    assert.deepEqual(race.map((v) => v.status).sort(), [200, 409]);
    r = (await viewer.client.get(url)).body as HazardRecord;
    if (r.status === "assigned") {
      r = (
        await write(assignee, "post", url + "/remediate", {
          version: r.version,
          text: "보완 조치 완료 기록",
        })
      ).body as HazardRecord;
      r = (
        await write(m, "post", url + "/close", {
          version: r.version,
          reason: "재검토 기록상 종결",
        })
      ).body as HazardRecord;
    }
    assert.equal(r.status, "closed");
    assert.equal(
      (
        await write(m, "post", url + "/assign", {
          version: r.version,
          assigneeId: ids.reporter,
          dueDate: "2026-11-01",
          reason: "직접배정 금지",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await write(assignee, "post", url + "/remediate", {
          version: r.version,
          text: "종결후 쓰기",
        })
      ).status,
      409,
    );
    const beforeEvents = (await viewer.client.get(url + "/events")).body
      .items as HazardEvent[];
    assert.ok(beforeEvents.some((e) => e.event === "closed"));
    assert.deepEqual(
      beforeEvents.map((e) => e.version),
      Array.from({ length: beforeEvents.length }, (_, i) => i + 1),
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE hazard_events SET note=? WHERE report_id=?")
          .run("tamper", r.id),
      /immutable/,
    );
    assert.throws(
      () => db.prepare("DELETE FROM hazard_events WHERE report_id=?").run(r.id),
      /immutable/,
    );
    r = (
      await write(m, "post", url + "/reopen", {
        version: r.version,
        assigneeId: ids.manager,
        dueDate: "2026-11-01",
        reason: "추가 관찰로 재개",
      })
    ).body as HazardRecord;
    assert.equal(r.remediation, "");
    assert.equal(r.remediator_id, null);
    r = (
      await write(m, "post", url + "/remediate", {
        version: r.version,
        text: "관리자가 직접 조치 기록",
      })
    ).body as HazardRecord;
    const selfClose = await write(m, "post", url + "/close", {
      version: r.version,
      reason: "본인 종결",
    });
    assert.equal(selfClose.status, 403);
    assert.ok(selfClose.body.error.includes("다른 현장 관리자"));
    // A second manager can review the first manager's submitted remediation.
    await write(m, "put", base + "/members", {
      email: "reporter@example.test",
      role: "manager",
    });
    r = (
      await write(reporter, "post", url + "/close", {
        version: r.version,
        reason: "다른 관리자 독립 검토",
      })
    ).body as HazardRecord;
    assert.equal(r.status, "closed");
    assert.equal(JSON.stringify(r.submitted_snapshot), original);
    const printed = await viewer.client.get(url + "/print");
    assert.equal(printed.status, 200);
    assert.ok(printed.text.includes("&lt;script&gt;"));
    assert.ok(!printed.text.includes("<script>"));
    assert.ok(!printed.text.includes("광고"));
    assert.ok(
      printed.text.includes("실제 위험 제거·작업 안전을 보증하지 않습니다"),
    );
    assert.match(printed.headers["cache-control"], /no-store/);
    db.prepare("UPDATE users SET name=? WHERE id=?").run(
      "changed",
      ids.manager,
    );
    db.prepare("UPDATE sites SET name=? WHERE id=?").run("changed site", site);
    assert.equal((await viewer.client.get(url + "/print")).text, printed.text);
    r = (
      await write(m, "post", url + "/reopen", {
        version: r.version,
        assigneeId: ids.assignee,
        dueDate: "2026-11-02",
        reason: "권한철회 검증",
      })
    ).body as HazardRecord;
    await write(m, "delete", base + "/members/" + ids.assignee, {});
    assert.equal(
      (
        await write(
          assignee,
          "post",
          url + "/remediate",
          {
            version: remediationVersion,
            text: "자재 이동 후 통로 표시 <img src=x onerror=alert(1)>",
          },
          remediationKey,
        )
      ).status,
      403,
    );
    r = (
      await write(m, "post", url + "/assign", {
        version: r.version,
        assigneeId: ids.reporter,
        dueDate: "2026-11-03",
        reason: "철회된 담당자 교체",
      })
    ).body as HazardRecord;
    const savedEvents = (await viewer.client.get(url + "/events")).body
      .items as HazardEvent[];
    assert.ok(savedEvents.some((e) => e.event === "reopened"));
    assert.equal(
      JSON.stringify(savedEvents.slice(0, beforeEvents.length)),
      JSON.stringify(beforeEvents),
    );
    db.close();
    db = openDatabase(path);
    app = await createApp(db, config);
    const reopened = await request(app).get(url).set("Cookie", viewer.cookie);
    assert.equal(reopened.body.version, r.version);
    assert.equal(JSON.stringify(reopened.body.submitted_snapshot), original);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
