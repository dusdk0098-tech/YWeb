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
import type {
  Inspection,
  InspectionTemplate,
} from "../src/inspection-types.js";
import type { InspectionLink } from "../server/inspection-links.js";
const origin = "http://127.0.0.1:3000";
test("v5 to v6 link migration preserves records and rejects future schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-link-migration-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  try {
    db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE IF EXISTS work_stop_events; DROP TABLE IF EXISTS work_stops; DROP TRIGGER IF EXISTS cost_split_active_source_frozen; DROP TRIGGER IF EXISTS cost_split_undone_child_restore; DROP TABLE IF EXISTS cost_split_children; DROP TABLE IF EXISTS cost_splits; DROP TABLE IF EXISTS education_catalog_links; DROP TABLE IF EXISTS education_catalog_revision_notes; DROP TABLE IF EXISTS education_catalog; DROP TABLE IF EXISTS work_plan_events; DROP TABLE IF EXISTS work_plan_snapshots; DROP TABLE IF EXISTS work_plans; DROP TRIGGER IF EXISTS account_auth_on_user; DROP TABLE IF EXISTS account_events; DROP TABLE IF EXISTS account_auth; DROP TABLE IF EXISTS equipment_due; DROP TABLE IF EXISTS stock_events; DROP TABLE IF EXISTS stock_movements; DROP TABLE IF EXISTS stock_items; DROP TABLE IF EXISTS cost_events; DROP TABLE IF EXISTS cost_expenses; DROP TABLE IF EXISTS cost_closures; DROP TABLE IF EXISTS cost_periods; DROP TABLE IF EXISTS daily_journal_events; DROP TABLE IF EXISTS daily_journal_snapshots; DROP TABLE IF EXISTS daily_journals; DROP TABLE IF EXISTS inspection_task_links; DROP TABLE IF EXISTS inspection_task_events; DROP TABLE IF EXISTS inspection_tasks; DROP TABLE IF EXISTS hazard_attachments; DROP TABLE IF EXISTS equipment_use_events; DROP TABLE IF EXISTS equipment_uses; DROP TABLE IF EXISTS equipment_events; DROP TABLE IF EXISTS equipment; DROP TABLE IF EXISTS notice_events; DROP TABLE IF EXISTS notice_acknowledgements; DROP TABLE IF EXISTS notice_snapshots; DROP TABLE IF EXISTS notice_targets; DROP TABLE IF EXISTS notices; DROP TABLE IF EXISTS education_snapshots; DROP TABLE IF EXISTS education_participants; DROP TABLE IF EXISTS education_sessions; DROP TABLE inspection_hazard_links;PRAGMA user_version=5;INSERT INTO users VALUES('u','u@example.test','preserved','hash')",
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
test("explicit accepted FAIL provenance linkage is unique, atomic, immutable and scoped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-link-")),
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
    const site = (await write(m, "post", "/api/sites", { name: "test" })).body
        .id as string,
      base = `/api/sites/${site}`;
    for (const [name, role] of [
      ["editor", "editor"],
      ["viewer", "viewer"],
    ])
      await write(m, "put", base + "/members", {
        email: name + "@example.test",
        role,
      });
    let t = (
      await write(m, "post", base + "/inspection-templates", {
        title: "test <script>",
        instructions: "own",
        items: ["fail A", "pass B", "NA C", "fail D"],
      })
    ).body as InspectionTemplate;
    t = (
      await write(
        m,
        "post",
        base + "/inspection-templates/" + t.id + "/publish",
        { version: t.version },
      )
    ).body;
    const body = {
      date: "2026-10-28",
      location: "route",
      performedBy: "staff",
      answers: t.body.items.map((i, n) => ({
        itemId: i.id,
        result: ["fail", "pass", "na", "fail"][n],
        comment: "note <script>",
      })),
    };
    let r = (
      await write(ed, "post", base + "/inspections", { templateId: t.id, body })
    ).body as Inspection;
    const url = base + "/inspections/" + r.id,
      linkUrl = url + "/hazard-links";
    assert.equal(
      (
        await write(m, "post", linkUrl, {
          version: r.version,
          itemId: t.body.items[0].id,
        })
      ).status,
      409,
    );
    r = (await write(ed, "post", url + "/submit", { version: r.version })).body;
    assert.equal(
      (
        await write(m, "post", linkUrl, {
          version: r.version,
          itemId: t.body.items[0].id,
        })
      ).status,
      409,
    );
    r = (
      await write(m, "post", url + "/accept", {
        version: r.version,
        reason: "record review",
      })
    ).body.record;
    const value = { version: r.version, itemId: t.body.items[0].id };
    for (const who of [ed, viewer, other])
      assert.equal((await write(who, "post", linkUrl, value)).status, 403);
    assert.equal(
      (await write(m, "post", linkUrl, { ...value, source: {} })).status,
      400,
    );
    assert.equal(
      (await write(m, "post", linkUrl, { ...value, version: r.version - 1 }))
        .status,
      409,
    );
    assert.equal(
      (await write(m, "post", linkUrl, { ...value, itemId: randomUUID() }))
        .status,
      400,
    );
    for (const n of [1, 2])
      assert.equal(
        (
          await write(m, "post", linkUrl, {
            ...value,
            itemId: t.body.items[n].id,
          })
        ).status,
        400,
      );
    const key = randomUUID(),
      result = await write(m, "post", linkUrl, value, key);
    assert.equal(result.status, 200);
    const link = result.body as InspectionLink;
    assert.equal(link.snapshot.item.result, "fail");
    assert.equal(link.snapshot.submitter.id, ids.editor);
    assert.equal(link.snapshot.linkedBy.id, ids.manager);
    assert.equal(
      (await write(m, "post", linkUrl, value, key)).body.id,
      link.id,
    );
    assert.equal((await write(m, "post", linkUrl, value)).status, 409);
    const hazard = base + "/hazards/" + link.hazard_id;
    assert.equal((await m.c.get(hazard)).body.status, "draft");
    assert.equal((await m.c.get(hazard)).body.owner_id, ids.manager);
    assert.equal(
      (await viewer.c.get(hazard + "/inspection-source")).body.id,
      link.id,
    );
    assert.equal(
      (await other.c.get(hazard + "/inspection-source")).status,
      403,
    );
    assert.equal((await other.c.get(linkUrl)).status, 403);
    assert.equal((await other.c.get(hazard + "/print")).status, 403);
    assert.equal(
      (
        await write(ed, "post", base + "/hazards", {
          title: "forged",
          observedDate: "2026-10-28",
          location: "x",
          description: "x",
          inspectionId: r.id,
        })
      ).status,
      400,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE inspection_hazard_links SET snapshot=? WHERE id=?")
          .run("{}", link.id),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare("DELETE FROM inspection_hazard_links WHERE id=?")
          .run(link.id),
      /immutable/,
    );
    const before = (await viewer.c.get(hazard + "/print")).text;
    assert(before.includes("불변 점검 출처"));
    assert(!before.includes("<script>"));
    assert((await viewer.c.get(url + "/print")).text.includes(link.hazard_id));
    db.prepare("UPDATE users SET name=? WHERE id=?").run("changed", ids.editor);
    assert.equal((await viewer.c.get(hazard + "/print")).text, before);
    const count = () =>
      [
        "hazard_reports",
        "hazard_events",
        "inspection_hazard_links",
        "idempotency",
        "audit",
      ].map(
        (table) =>
          (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number })
            .n,
      );
    const counts = count();
    db.exec(
      "CREATE TRIGGER synthetic_link_failure BEFORE INSERT ON inspection_hazard_links BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
    );
    assert.equal(
      (
        await write(m, "post", linkUrl, {
          ...value,
          itemId: t.body.items[3].id,
        })
      ).status,
      500,
    );
    assert.deepEqual(count(), counts);
    db.exec("DROP TRIGGER synthetic_link_failure");
    const races = await Promise.all([
      write(m, "post", linkUrl, { ...value, itemId: t.body.items[3].id }),
      write(m, "post", linkUrl, { ...value, itemId: t.body.items[3].id }),
    ]);
    assert.deepEqual(races.map((x) => x.status).sort(), [200, 409]);
    assert.equal((await viewer.c.get(linkUrl)).body.length, 2);
    db.prepare(
      "UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?",
    ).run(site, ids.manager);
    assert.equal((await write(m, "post", linkUrl, value, key)).status, 403);
    db.close();
    db = openDatabase(path);
    app = await createApp(db, config);
    const again = await login("viewer");
    assert.equal(
      (await again.c.get(hazard + "/inspection-source")).body.id,
      link.id,
    );
    assert.equal((await again.c.get(hazard + "/print")).text, before);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
