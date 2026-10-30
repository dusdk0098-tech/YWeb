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
import { noticeInput } from "../server/notice-validation.js";
import type { NoticeView } from "../server/notice-model.js";
const origin = "http://127.0.0.1:3000",
  content = {
    title: "공지 <script>",
    workScope: "통로 작업",
    applyDate: "2026-10-28",
    text: "자체 작성 안내",
  };
test("notice strict content and unique explicit recipient bounds", () => {
  const id = randomUUID();
  for (const v of [
    { content, recipientIds: [] },
    { content, recipientIds: [id, id] },
    { content: { ...content, applyDate: "2026-02-30" }, recipientIds: [id] },
    { content, recipientIds: [id], published: true },
  ])
    assert.equal(noticeInput.safeParse(v).success, false);
});
test("v7 notice migration preserves prior records and rejects future schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-notice-migration-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  try {
    db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE IF EXISTS work_stop_events; DROP TABLE IF EXISTS work_stops; DROP TRIGGER IF EXISTS cost_split_active_source_frozen; DROP TRIGGER IF EXISTS cost_split_undone_child_restore; DROP TABLE IF EXISTS cost_split_children; DROP TABLE IF EXISTS cost_splits; DROP TABLE IF EXISTS education_catalog_links; DROP TABLE IF EXISTS education_catalog_revision_notes; DROP TABLE IF EXISTS education_catalog; DROP TABLE IF EXISTS work_plan_events; DROP TABLE IF EXISTS work_plan_snapshots; DROP TABLE IF EXISTS work_plans; DROP TRIGGER IF EXISTS account_auth_on_user; DROP TABLE IF EXISTS account_events; DROP TABLE IF EXISTS account_auth; DROP TABLE IF EXISTS equipment_due; DROP TABLE IF EXISTS stock_events; DROP TABLE IF EXISTS stock_movements; DROP TABLE IF EXISTS stock_items; DROP TABLE IF EXISTS cost_events; DROP TABLE IF EXISTS cost_expenses; DROP TABLE IF EXISTS cost_closures; DROP TABLE IF EXISTS cost_periods; DROP TABLE IF EXISTS daily_journal_events; DROP TABLE IF EXISTS daily_journal_snapshots; DROP TABLE IF EXISTS daily_journals; DROP TABLE IF EXISTS inspection_task_links; DROP TABLE IF EXISTS inspection_task_events; DROP TABLE IF EXISTS inspection_tasks; DROP TABLE IF EXISTS hazard_attachments; DROP TABLE IF EXISTS equipment_use_events; DROP TABLE IF EXISTS equipment_uses; DROP TABLE IF EXISTS equipment_events; DROP TABLE IF EXISTS equipment; DROP TABLE notice_events;DROP TABLE notice_acknowledgements;DROP TABLE notice_snapshots;DROP TABLE notice_targets;DROP TABLE notices;PRAGMA user_version=7;INSERT INTO users VALUES('u','u@example.test','preserved','hash')",
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
test("notice target privacy, own account acknowledgement, supersede and withdraw are atomic and current", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-notice-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  const password = randomUUID(),
    hash = await argon2.hash(password),
    ids = {
      manager: randomUUID(),
      target: randomUUID(),
      othertarget: randomUUID(),
      nontarget: randomUUID(),
      outsider: randomUUID(),
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
    target = await login("target"),
    other = await login("othertarget"),
    non = await login("nontarget"),
    out = await login("outsider");
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
    const site = (await write(m, "post", "/api/sites", { name: "notice site" }))
        .body.id as string,
      base = `/api/sites/${site}/notices`;
    for (const name of ["target", "othertarget", "nontarget"])
      await write(m, "put", `/api/sites/${site}/members`, {
        email: name + "@example.test",
        role: "viewer",
      });
    const input = {
      content,
      recipientIds: [ids.target, ids.othertarget, ids.manager],
    };
    assert.equal((await write(target, "post", base, input)).status, 403);
    assert.equal(
      (await write(m, "post", base, { content, recipientIds: [ids.outsider] }))
        .status,
      400,
    );
    let n = (await write(m, "post", base, input)).body as NoticeView;
    let url = base + "/" + n.id;
    assert.equal((await target.c.get(url)).status, 404);
    assert.equal((await target.c.get(base)).body.items.length, 0);
    n = (await write(m, "post", url + "/publish", { version: n.version })).body;
    const original = db
      .prepare("SELECT body FROM notice_snapshots WHERE notice_id=?")
      .get(n.id);
    const visible = (await target.c.get(url)).body;
    assert.equal(visible.targets, undefined);
    assert.equal(visible.acknowledgements, undefined);
    assert.equal(visible.parentId, null);
    assert(!JSON.stringify(visible).includes(ids.othertarget));
    assert.equal((await non.c.get(url)).status, 404);
    assert.equal((await non.c.get(url + "/print")).status, 404);
    assert.equal((await out.c.get(url)).status, 403);
    assert.equal((await target.c.get(url + "/events")).status, 403);
    assert.equal((await target.c.get(base + "/recipients")).status, 403);
    assert.equal(
      (
        await write(target, "post", url + "/acknowledge", {
          version: n.version,
          userId: ids.othertarget,
        })
      ).status,
      400,
    );
    assert.equal(
      (await write(non, "post", url + "/acknowledge", { version: 999 })).status,
      404,
    );
    const key = randomUUID(),
      ack = (
        await write(
          target,
          "post",
          url + "/acknowledge",
          { version: n.version },
          key,
        )
      ).body as NoticeView;
    assert.equal(ack.ownAck!.user_id, ids.target);
    assert.equal(
      (
        await write(
          target,
          "post",
          url + "/acknowledge",
          { version: n.version },
          key,
        )
      ).body.ownAck.id,
      ack.ownAck!.id,
    );
    const duplicate = await Promise.all([
      write(other, "post", url + "/acknowledge", { version: n.version }),
      write(other, "post", url + "/acknowledge", { version: n.version }),
    ]);
    assert(duplicate.every((x) => x.status === 200));
    assert.equal(duplicate[0].body.ownAck.id, duplicate[1].body.ownAck.id);
    const targetPrint = (await target.c.get(url + "/print")).text;
    assert(!targetPrint.includes(ids.othertarget));
    assert(!targetPrint.includes("<script>"));
    assert((await m.c.get(url + "/print")).text.includes(ids.othertarget));
    const managerKey = randomUUID();
    const mr = (
      await write(
        m,
        "post",
        url + "/acknowledge",
        { version: n.version },
        managerKey,
      )
    ).body;
    assert.equal(mr.targets, undefined);
    db.prepare(
      "UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?",
    ).run(site, ids.manager);
    assert.equal(
      (
        await write(
          m,
          "post",
          url + "/acknowledge",
          { version: n.version },
          managerKey,
        )
      ).body.targets,
      undefined,
    );
    db.prepare(
      "UPDATE memberships SET role='manager' WHERE site_id=? AND user_id=?",
    ).run(site, ids.manager);
    let next = (
      await write(m, "post", url + "/revise", {
        version: n.version,
        reason: "내용 정정",
      })
    ).body as NoticeView;
    assert.equal(next.acknowledgements!.length, 0);
    assert.equal(
      (
        await write(m, "post", url + "/revise", {
          version: n.version,
          reason: "다른 초안",
        })
      ).status,
      409,
    );
    const counts = () =>
        ["notice_events", "notice_snapshots", "idempotency", "audit"].map(
          (t) =>
            (db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number })
              .n,
        ),
      before = counts();
    db.exec(
      "CREATE TRIGGER synthetic_notice_failure BEFORE INSERT ON notice_snapshots BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
    );
    assert.equal(
      (
        await write(m, "post", base + "/" + next.id + "/publish", {
          version: next.version,
        })
      ).status,
      500,
    );
    assert.deepEqual(counts(), before);
    assert.equal((await m.c.get(url)).body.status, "published");
    db.exec("DROP TRIGGER synthetic_notice_failure");
    next = (
      await write(m, "post", base + "/" + next.id + "/publish", {
        version: next.version,
      })
    ).body;
    assert.equal((await m.c.get(url)).body.status, "superseded");
    assert.equal(
      (
        await write(
          target,
          "post",
          url + "/acknowledge",
          { version: n.version },
          key,
        )
      ).status,
      409,
    );
    assert.deepEqual(
      db
        .prepare("SELECT body FROM notice_snapshots WHERE notice_id=?")
        .get(n.id),
      original,
    );
    url = base + "/" + next.id;
    const newKey = randomUUID();
    assert.equal(
      (
        await write(
          target,
          "post",
          url + "/acknowledge",
          { version: next.version },
          newKey,
        )
      ).status,
      200,
    );
    next = (
      await write(m, "post", url + "/withdraw", {
        version: next.version,
        reason: "철회",
      })
    ).body;
    assert.equal(
      (
        await write(
          target,
          "post",
          url + "/acknowledge",
          { version: next.version - 1 },
          newKey,
        )
      ).status,
      409,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE notice_snapshots SET body=? WHERE notice_id=?")
          .run("{}", next.id),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare("DELETE FROM notice_acknowledgements WHERE notice_id=?")
          .run(next.id),
      /immutable/,
    );
    db.prepare("DELETE FROM memberships WHERE site_id=? AND user_id=?").run(
      site,
      ids.target,
    );
    assert.equal((await target.c.get(url)).status, 403);
    assert.equal(
      (
        await write(
          target,
          "post",
          url + "/acknowledge",
          { version: next.version - 1 },
          newKey,
        )
      ).status,
      403,
    );
    db.close();
    db = openDatabase(path);
    app = await createApp(db, config);
    const again = await login("othertarget");
    assert.equal((await again.c.get(url)).body.status, "withdrawn");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
