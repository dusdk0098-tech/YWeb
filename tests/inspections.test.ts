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
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  templateInput,
  inspectionBody,
} from "../server/inspection-validation.js";
import type {
  Inspection,
  InspectionTemplate,
} from "../src/inspection-types.js";
const origin = "http://127.0.0.1:3000";
test("inspection strict inputs and limits", () => {
  assert.equal(
    templateInput.safeParse({ title: "own", instructions: "", items: [] })
      .success,
    false,
  );
  assert.equal(
    templateInput.safeParse({
      title: "own",
      instructions: "",
      items: Array(101).fill("item"),
    }).success,
    false,
  );
  assert.equal(
    templateInput.safeParse({
      title: "own",
      instructions: "",
      items: ["item"],
      riskScore: 2,
    }).success,
    false,
  );
  assert.equal(
    inspectionBody.safeParse({
      date: "2026-02-30",
      location: "",
      performedBy: "",
      answers: [],
    }).success,
    false,
  );
  assert.equal(
    inspectionBody.safeParse({
      date: "2026-10-28",
      location: "",
      performedBy: "",
      answers: [
        { itemId: randomUUID(), result: "pass", comment: "", signature: "x" },
      ],
    }).success,
    false,
  );
});
test("v4 migration preserves prior records, rolls back failed migration and refuses future schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-inspection-migration-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  try {
    db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE IF EXISTS work_stop_events; DROP TABLE IF EXISTS work_stops; DROP TRIGGER IF EXISTS cost_split_active_source_frozen; DROP TRIGGER IF EXISTS cost_split_undone_child_restore; DROP TABLE IF EXISTS cost_split_children; DROP TABLE IF EXISTS cost_splits; DROP TABLE IF EXISTS education_catalog_links; DROP TABLE IF EXISTS education_catalog_revision_notes; DROP TABLE IF EXISTS education_catalog; DROP TABLE IF EXISTS work_plan_events; DROP TABLE IF EXISTS work_plan_snapshots; DROP TABLE IF EXISTS work_plans; DROP TRIGGER IF EXISTS account_auth_on_user; DROP TABLE IF EXISTS account_events; DROP TABLE IF EXISTS account_auth; DROP TABLE IF EXISTS equipment_due; DROP TABLE IF EXISTS stock_events; DROP TABLE IF EXISTS stock_movements; DROP TABLE IF EXISTS stock_items; DROP TABLE IF EXISTS cost_events; DROP TABLE IF EXISTS cost_expenses; DROP TABLE IF EXISTS cost_closures; DROP TABLE IF EXISTS cost_periods; DROP TABLE IF EXISTS daily_journal_events; DROP TABLE IF EXISTS daily_journal_snapshots; DROP TABLE IF EXISTS daily_journals; DROP TABLE IF EXISTS inspection_task_links; DROP TABLE IF EXISTS inspection_task_events; DROP TABLE IF EXISTS inspection_tasks; DROP TABLE IF EXISTS hazard_attachments; DROP TABLE IF EXISTS equipment_use_events; DROP TABLE IF EXISTS equipment_uses; DROP TABLE IF EXISTS equipment_events; DROP TABLE IF EXISTS equipment; DROP TABLE IF EXISTS notice_events; DROP TABLE IF EXISTS notice_acknowledgements; DROP TABLE IF EXISTS notice_snapshots; DROP TABLE IF EXISTS notice_targets; DROP TABLE IF EXISTS notices; DROP TABLE IF EXISTS education_snapshots; DROP TABLE IF EXISTS education_participants; DROP TABLE IF EXISTS education_sessions; DROP TABLE IF EXISTS inspection_hazard_links;DROP TABLE inspection_events;DROP TABLE inspections;DROP TABLE inspection_templates;PRAGMA user_version=4;INSERT INTO users VALUES('u','u@example.test','test','hash');INSERT INTO sites VALUES('s','old',1);INSERT INTO hazard_reports VALUES('h','s','u','{}','draft',1,NULL,NULL,'',NULL,NULL,'now','now');",
    );
    db.close();
    db = openDatabase(path);
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      CURRENT_SCHEMA_VERSION,
    );
    assert.equal(
      (db.prepare("SELECT id FROM hazard_reports").get() as { id: string }).id,
      "h",
    );
    db.exec("DROP TABLE inspection_templates;PRAGMA user_version=4");
    db.close();
    assert.throws(() => openDatabase(path), /already exists/);
    db = new DatabaseSync(path);
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      4,
    );
    assert.equal(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='inspection_templates'",
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
test("published templates and submitted inspections preserve original, independent return creates fresh draft", async () => {
  const db = openDatabase(":memory:"),
    password = randomUUID(),
    hash = await argon2.hash(password),
    ids = {
      manager: randomUUID(),
      editor: randomUUID(),
      viewer: randomUUID(),
      other: randomUUID(),
    };
  for (const [name, id] of Object.entries(ids))
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      name + "@example.test",
      name,
      hash,
    );
  const app = await createApp(db, {
    secret: randomUUID() + randomUUID(),
    origin,
    adsEnabled: true,
  });
  async function login(name: keyof typeof ids) {
    const c = request.agent(app),
      s = await c.get("/api/session"),
      r = await c
        .post("/api/login")
        .set("Origin", origin)
        .set("x-csrf-token", s.body.csrf)
        .send({ email: name + "@example.test", password });
    assert.equal(r.status, 200);
    return { c, csrf: r.body.csrf as string };
  }
  const m = await login("manager"),
    ed = await login("editor"),
    viewer = await login("viewer"),
    other = await login("other");
  function write(
    w: typeof m,
    method: "post" | "put",
    path: string,
    body: object,
    key = randomUUID(),
  ) {
    return w.c[method](path)
      .set("Origin", origin)
      .set("x-csrf-token", w.csrf)
      .set("idempotency-key", key)
      .send(body);
  }
  try {
    const site = (
        await write(m, "post", "/api/sites", { name: "site <script>" })
      ).body.id as string,
      base = `/api/sites/${site}`;
    for (const [name, role] of [
      ["editor", "editor"],
      ["viewer", "viewer"],
    ])
      assert.equal(
        (
          await write(m, "put", base + "/members", {
            email: name + "@example.test",
            role,
          })
        ).status,
        200,
      );
    const input = {
      title: "own <script>",
      instructions: "manual",
      items: ["clear route", "guard"],
    };
    assert.equal(
      (await write(ed, "post", base + "/inspection-templates", input)).status,
      403,
    );
    let t = (await write(m, "post", base + "/inspection-templates", input))
      .body as InspectionTemplate;
    assert.equal(
      (await other.c.get(base + "/inspection-templates/" + t.id)).status,
      403,
    );
    t = (
      await write(
        m,
        "post",
        base + "/inspection-templates/" + t.id + "/publish",
        { version: t.version },
      )
    ).body;
    assert.equal(
      (
        await write(m, "put", base + "/inspection-templates/" + t.id, {
          ...input,
          version: t.version,
        })
      ).status,
      409,
    );
    let body = {
      date: "2026-10-28",
      location: "gate",
      performedBy: "direct input",
      answers: t.body.items.map((i) => ({
        itemId: i.id,
        result: "pending" as "pending" | "pass" | "fail" | "na",
        comment: "",
      })),
    };
    assert.equal(
      (
        await write(viewer, "post", base + "/inspections", {
          templateId: t.id,
          body,
        })
      ).status,
      403,
    );
    let r = (
      await write(ed, "post", base + "/inspections", { templateId: t.id, body })
    ).body as Inspection;
    const url = base + "/inspections/" + r.id;
    assert.equal(
      (await write(m, "put", url, { version: r.version, body })).status,
      403,
    );
    assert.equal(
      (await write(ed, "post", url + "/submit", { version: r.version })).status,
      400,
    );
    assert.equal(
      (
        await write(ed, "put", url, {
          version: r.version,
          body: { ...body, answers: [body.answers[0], body.answers[0]] },
        })
      ).status,
      400,
    );
    body = {
      ...body,
      answers: body.answers.map((a, i) => ({
        ...a,
        result: i ? "na" : "fail",
        comment: "explanation <script>",
      })),
    };
    r = (await write(ed, "put", url, { version: r.version, body })).body;
    r = (await write(ed, "post", url + "/submit", { version: r.version })).body;
    assert.equal(r.status, "submitted");
    assert.equal(
      (await write(ed, "put", url, { version: r.version, body })).status,
      409,
    );
    const snapshot = r.submitted_snapshot;
    assert.throws(
      () =>
        db.prepare("UPDATE inspections SET body=? WHERE id=?").run("{}", r.id),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE inspection_templates SET body=? WHERE id=?")
          .run("{}", t.id),
      /immutable/,
    );
    assert.equal((await other.c.get(url + "/print")).status, 403);
    const print = await viewer.c.get(url + "/print");
    assert.equal(print.status, 200);
    assert(!print.text.includes("<script>"));
    assert(!print.text.includes("ad-slot"));
    const key = randomUUID(),
      returned = await write(
        m,
        "post",
        url + "/return",
        {
          version: r.version,
          reason: "review explanation",
          authorId: ids.editor,
        },
        key,
      );
    assert.equal(returned.status, 200);
    assert.deepEqual(returned.body.record.submitted_snapshot, snapshot);
    assert(
      returned.body.next.body.answers.every(
        (a: { result: string; comment: string }) =>
          a.result === "pending" && a.comment === "",
      ),
    );
    assert.equal(returned.body.next.parent_id, r.id);
    assert.equal(
      (
        await write(
          m,
          "post",
          url + "/return",
          {
            version: r.version,
            reason: "review explanation",
            authorId: ids.editor,
          },
          key,
        )
      ).body.next.id,
      returned.body.next.id,
    );
    assert.equal(
      (
        await write(m, "post", url + "/accept", {
          version: r.version,
          reason: "race",
        })
      ).status,
      409,
    );
    const count = (await viewer.c.get(url + "/events")).body.items.length;
    assert.equal(count, 4);
    assert.throws(
      () =>
        db
          .prepare("DELETE FROM inspection_events WHERE inspection_id=?")
          .run(r.id),
      /immutable/,
    );
    const stable = (await viewer.c.get(url + "/print")).text;
    db.prepare("UPDATE users SET name=? WHERE id=?").run(
      "changed",
      ids.manager,
    );
    db.prepare("UPDATE sites SET name=? WHERE id=?").run("changed", site);
    assert.equal((await viewer.c.get(url + "/print")).text, stable);
    const self = (
      await write(m, "post", base + "/inspections", { templateId: t.id, body })
    ).body as Inspection;
    const submitted = (
      await write(m, "post", base + "/inspections/" + self.id + "/submit", {
        version: self.version,
      })
    ).body as Inspection;
    assert.equal(
      (
        await write(m, "post", base + "/inspections/" + self.id + "/accept", {
          version: submitted.version,
          reason: "self",
        })
      ).status,
      403,
    );
    const versions = await Promise.all([
      write(m, "post", base + "/inspection-templates/" + t.id + "/revise", {
        version: t.version,
      }),
      write(m, "post", base + "/inspection-templates/" + t.id + "/revise", {
        version: t.version,
      }),
    ]);
    assert.deepEqual(versions.map((v) => v.status).sort(), [200, 409]);
    assert.equal(
      (await m.c.get(base + "/inspection-templates/" + t.id)).body
        .published_snapshot.body.title,
      input.title,
    );
  } finally {
    db.close();
  }
});
