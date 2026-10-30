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
  equipmentInput,
  equipmentUseCreate,
} from "../server/equipment-validation.js";
import type {
  EquipmentRecord,
  EquipmentUseRecord,
} from "../server/equipment-model.js";
const origin = "http://127.0.0.1:3000",
  details = {
    assetCode: " eq-1 ",
    name: "장비 <script>",
    typeLabel: "직접 입력 종류",
    model: "model",
    serial: " Serial-a ",
    ownerCompany: "업체",
    notes: "수기 등록",
  };
test("equipment identifiers normalize deliberately; no engineering/personal extras", () => {
  const v = equipmentInput.parse(details);
  assert.equal(v.assetCode, "EQ-1");
  assert.equal(v.serial, "Serial-a");
  assert.equal(
    equipmentInput.parse({ ...details, assetCode: "ｅｑ-１" }).assetCode,
    "EQ-1",
  );
  for (const change of [
    { assetCode: "ß" },
    { assetCode: "eq 1" },
    { assetCode: "a".repeat(61) },
    { capacity: 10 },
    { operatorNationalId: "x" },
    { safe: true },
  ])
    assert.equal(
      equipmentInput.safeParse({ ...details, ...change }).success,
      false,
    );
  assert.equal(
    equipmentUseCreate.safeParse({
      equipmentId: randomUUID(),
      body: { date: "2026-02-30", location: "x", workSummary: "x" },
    }).success,
    false,
  );
});
test("v8 equipment migration preserves records and rejects future schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-equipment-migration-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  try {
    db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE IF EXISTS work_stop_events; DROP TABLE IF EXISTS work_stops; DROP TRIGGER IF EXISTS cost_split_active_source_frozen; DROP TRIGGER IF EXISTS cost_split_undone_child_restore; DROP TABLE IF EXISTS cost_split_children; DROP TABLE IF EXISTS cost_splits; DROP TABLE IF EXISTS education_catalog_links; DROP TABLE IF EXISTS education_catalog_revision_notes; DROP TABLE IF EXISTS education_catalog; DROP TABLE IF EXISTS work_plan_events; DROP TABLE IF EXISTS work_plan_snapshots; DROP TABLE IF EXISTS work_plans; DROP TRIGGER IF EXISTS account_auth_on_user; DROP TABLE IF EXISTS account_events; DROP TABLE IF EXISTS account_auth; DROP TABLE IF EXISTS equipment_due; DROP TABLE IF EXISTS stock_events; DROP TABLE IF EXISTS stock_movements; DROP TABLE IF EXISTS stock_items; DROP TABLE IF EXISTS cost_events; DROP TABLE IF EXISTS cost_expenses; DROP TABLE IF EXISTS cost_closures; DROP TABLE IF EXISTS cost_periods; DROP TABLE IF EXISTS daily_journal_events; DROP TABLE IF EXISTS daily_journal_snapshots; DROP TABLE IF EXISTS daily_journals; DROP TABLE IF EXISTS inspection_task_links; DROP TABLE IF EXISTS inspection_task_events; DROP TABLE IF EXISTS inspection_tasks; DROP TABLE IF EXISTS hazard_attachments; DROP TABLE equipment_use_events;DROP TABLE equipment_uses;DROP TABLE equipment_events;DROP TABLE equipment;PRAGMA user_version=8;INSERT INTO users VALUES('u','u@example.test','preserved','hash')",
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
    db.exec(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION + 1}`);
    db.close();
    assert.throws(() => openDatabase(path), /newer/);
    db = new DatabaseSync(path);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("equipment register and manual use preserve history with retirement and scoped authorization", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-equipment-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  const password = randomUUID(),
    hash = await argon2.hash(password),
    ids = {
      manager: randomUUID(),
      editor: randomUUID(),
      second: randomUUID(),
      viewer: randomUUID(),
      outside: randomUUID(),
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
    second = await login("second"),
    viewer = await login("viewer"),
    out = await login("outside");
  function write(
    w: typeof m,
    method: "post" | "put",
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
    const site = (
        await write(m, "post", "/api/sites", { name: "equipment site" })
      ).body.id as string,
      base = `/api/sites/${site}`;
    for (const [n, role] of [
      ["editor", "editor"],
      ["second", "editor"],
      ["viewer", "viewer"],
    ])
      await write(m, "put", base + "/members", {
        email: n + "@example.test",
        role,
      });
    assert.equal(
      (await write(ed, "post", base + "/equipment", details)).status,
      403,
    );
    let eq = (await write(m, "post", base + "/equipment", details))
      .body as EquipmentRecord;
    const equrl = base + "/equipment/" + eq.id;
    assert.equal(
      (
        await write(m, "post", base + "/equipment", {
          ...details,
          assetCode: "ＥＱ-１",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await write(m, "post", base + "/equipment", {
          ...details,
          assetCode: "",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await write(m, "post", base + "/equipment", {
          ...details,
          assetCode: "",
        })
      ).status,
      200,
    );
    assert.equal((await out.c.get(equrl + "/print")).status, 403);
    const body = {
      date: "2026-10-28",
      location: "구역",
      workSummary: "수기 사용 <script>",
    };
    assert.equal(
      (
        await write(viewer, "post", base + "/equipment-uses", {
          equipmentId: eq.id,
          body,
        })
      ).status,
      403,
    );
    let use = (
      await write(ed, "post", base + "/equipment-uses", {
        equipmentId: eq.id,
        body,
      })
    ).body as EquipmentUseRecord;
    const useurl = base + "/equipment-uses/" + use.id,
      snapshot = use.equipment_snapshot;
    assert.equal(
      (
        await write(second, "put", useurl, {
          body,
          status: "cancelled",
          version: use.version,
          reason: "other",
        })
      ).status,
      403,
    );
    eq = (
      await write(m, "put", equrl, {
        ...eq.body,
        name: "renamed",
        version: eq.version,
        reason: "표시 수정",
      })
    ).body;
    assert.deepEqual(
      (await viewer.c.get(useurl)).body.equipment_snapshot,
      snapshot,
    );
    eq = (
      await write(m, "post", equrl + "/status", {
        version: eq.version,
        status: "retired",
        reason: "퇴역 표시",
      })
    ).body;
    assert.equal(
      (
        await write(ed, "post", base + "/equipment-uses", {
          equipmentId: eq.id,
          body,
        })
      ).status,
      409,
    );
    use = (
      await write(ed, "put", useurl, {
        body: { ...body, workSummary: "과거 기록 정정" },
        status: "recorded",
        version: use.version,
        reason: "과거 입력 수정",
      })
    ).body;
    use = (
      await write(ed, "put", useurl, {
        body: use.body,
        status: "cancelled",
        version: use.version,
        reason: "취소",
      })
    ).body;
    assert.equal(use.status, "cancelled");
    assert.equal(
      (
        await write(ed, "put", useurl, {
          body: use.body,
          status: "recorded",
          version: use.version,
          reason: "복원",
        })
      ).status,
      409,
    );
    eq = (
      await write(m, "post", equrl + "/status", {
        version: eq.version,
        status: "active",
        reason: "등록 재활성화",
      })
    ).body;
    const key = randomUUID(),
      value = {
        body: use.body,
        status: "recorded",
        version: use.version,
        reason: "복원",
      };
    use = (await write(ed, "put", useurl, value, key)).body;
    assert.equal(use.status, "recorded");
    assert.equal(
      (await write(ed, "put", useurl, value, key)).body.version,
      use.version,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE equipment_uses SET equipment_snapshot=? WHERE id=?")
          .run("{}", use.id),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare("DELETE FROM equipment_use_events WHERE use_id=?")
          .run(use.id),
      /immutable/,
    );
    const events = (await viewer.c.get(useurl + "/events")).body.items;
    assert.equal(events.length, 4);
    assert.equal(events[0].snapshot.body.workSummary, body.workSummary);
    assert(
      (await viewer.c.get(useurl + "/print")).text.includes("&lt;script&gt;"),
    );
    assert(!(await viewer.c.get(useurl + "/print")).text.includes("<script>"));
    assert.equal(
      (await viewer.c.get(useurl + "/events?offset=-1")).status,
      400,
    );
    const counts = () =>
        ["equipment_uses", "equipment_use_events", "idempotency", "audit"].map(
          (t) =>
            (db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number })
              .n,
        ),
      before = counts();
    db.exec(
      "CREATE TRIGGER synthetic_use_failure BEFORE INSERT ON equipment_use_events BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
    );
    assert.equal(
      (
        await write(ed, "post", base + "/equipment-uses", {
          equipmentId: eq.id,
          body,
        })
      ).status,
      500,
    );
    assert.deepEqual(counts(), before);
    db.exec("DROP TRIGGER synthetic_use_failure");
    const races = await Promise.all([
      write(m, "post", base + "/equipment", { ...details, assetCode: "race" }),
      write(m, "post", base + "/equipment", {
        ...details,
        assetCode: "ＲＡＣＥ",
      }),
    ]);
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
    db.prepare(
      "UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?",
    ).run(site, ids.editor);
    assert.equal((await write(ed, "put", useurl, value, key)).status, 403);
    const print = (await viewer.c.get(useurl + "/print")).text;
    db.close();
    db = openDatabase(path);
    app = await createApp(db, config);
    const again = await login("viewer");
    assert.equal((await again.c.get(useurl + "/print")).text, print);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
