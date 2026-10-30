import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import argon2 from "argon2";
import request from "supertest";
import session from "express-session";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { SqliteSessionStore } from "../server/session-store.js";
import { passwordChangeInput } from "../server/authentication.js";
test("password schema strict without trimming or credential receipts", () => {
  assert.equal(
    passwordChangeInput.safeParse({
      currentPassword: "old",
      newPassword: "synthetic-new-pass",
      confirmPassword: "wrong",
    }).success,
    false,
  );
  assert.equal(
    passwordChangeInput.safeParse({
      currentPassword: "old",
      newPassword: "short",
      confirmPassword: "short",
    }).success,
    false,
  );
  assert.equal(
    passwordChangeInput.safeParse({
      currentPassword: "same-password",
      newPassword: "same-password",
      confirmPassword: "same-password",
    }).success,
    false,
  );
  assert.equal(
    passwordChangeInput.safeParse({
      currentPassword: "old",
      newPassword: "synthetic-new-pass",
      confirmPassword: "synthetic-new-pass",
      userId: "other",
    }).success,
    false,
  );
});
test("schema16 preserves password hashes, invalidates old sessions, provisions epochs via trigger", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-auth-")),
    path = join(dir, "synthetic.sqlite");
  let db = openDatabase(path);
  try {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      "u",
      "u@example.test",
      "u",
      "unchanged hash",
    );
    db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE IF EXISTS work_stop_events; DROP TABLE IF EXISTS work_stops; DROP TRIGGER cost_split_active_source_frozen;DROP TRIGGER cost_split_undone_child_restore;DROP TABLE cost_split_children;DROP TABLE cost_splits;DROP TABLE education_catalog_links; DROP TABLE education_catalog_revision_notes; DROP TABLE education_catalog; DROP TABLE work_plan_events; DROP TABLE work_plan_snapshots; DROP TABLE work_plans; DROP TRIGGER account_auth_on_user;DROP TABLE account_events;DROP TABLE account_auth;PRAGMA user_version=15",
    );
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      "old",
      JSON.stringify({ userId: "u" }),
      Date.now() + 10000,
    );
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions").get()!.n, 0);
    assert.equal(
      db.prepare("SELECT epoch FROM account_auth WHERE user_id=?").get("u")!
        .epoch,
      1,
    );
    assert.equal(
      db.prepare("SELECT password_hash FROM users WHERE id=?").get("u")!
        .password_hash,
      "unchanged hash",
    );
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      "v",
      "v@example.test",
      "v",
      "hash",
    );
    assert.equal(
      db.prepare("SELECT epoch FROM account_auth WHERE user_id=?").get("v")!
        .epoch,
      1,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
async function fixture() {
  const db = openDatabase(":memory:"),
    password = "synthetic-old-" + randomUUID(),
    id = randomUUID(),
    other = randomUUID(),
    origin = "http://127.0.0.1:3000";
  const hash = await argon2.hash(password);
  for (const [user, email] of [
    [id, "account@example.test"],
    [other, "other@example.test"],
  ])
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      user,
      email,
      "synthetic",
      hash,
    );
  const app = await createApp(db, { origin, secret: "a".repeat(48) });
  async function login(email = "account@example.test", pass = password) {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", r.body.csrf)
      .send({ email, password: pass });
    return { agent, csrf: r.body.csrf as string, response: r };
  }
  return { db, id, other, password, origin, app, login };
}
test("login limit counts failures per account, not successes or other accounts on the shared loopback IP", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 11; i++)
      assert.equal((await f.login()).response.status, 200);
    for (let i = 0; i < 10; i++)
      assert.equal((await f.login("other@example.test", "wrong-password")).response.status, 401);
    assert.equal((await f.login("other@example.test", "wrong-password")).response.status, 429);
    assert.equal((await f.login()).response.status, 200);
  } finally {
    f.db.close();
  }
});
test("self change revokes all caller sessions but not others; stale store writes cannot resurrect", async () => {
  const f = await fixture();
  try {
    const a = await f.login(),
      b = await f.login(),
      other = await f.login("other@example.test"),
      next = "synthetic-new-" + randomUUID(),
      payload = {
        currentPassword: f.password,
        newPassword: next,
        confirmPassword: next,
      };
    const saved = f.db
      .prepare(
        "SELECT sid,data FROM sessions WHERE json_extract(data,'$.userId')=? LIMIT 1",
      )
      .get(f.id) as { sid: string; data: string };
    const stale = JSON.parse(saved.data) as session.SessionData;
    stale.cookie = new session.Cookie();
    stale.cookie.expires = new Date(Date.now() + 100000);
    const call = () =>
      a.agent
        .post("/api/account/password")
        .set("Origin", f.origin)
        .set("x-csrf-token", a.csrf)
        .send(payload);
    assert.equal(
      (
        await a.agent
          .post("/api/account/password")
          .set("Origin", f.origin)
          .send(payload)
      ).status,
      403,
    );
    assert.equal((await call()).status, 204);
    assert.equal((await a.agent.get("/api/sites")).status, 401);
    assert.equal((await b.agent.get("/api/sites")).status, 401);
    assert.equal((await b.agent.get("/api/session")).body.user, null);
    assert.equal((await other.agent.get("/api/sites")).status, 200);
    assert.equal((await f.login()).response.status, 401);
    assert.equal(
      (await f.login("account@example.test", next)).response.status,
      200,
    );
    const store = new SqliteSessionStore(f.db);
    await new Promise<void>((resolve, reject) =>
      store.set(saved.sid, stale, (e) => (e ? reject(e) : resolve())),
    );
    assert.equal(
      f.db.prepare("SELECT sid FROM sessions WHERE sid=?").get(saved.sid),
      undefined,
    );
    await new Promise<void>((resolve, reject) =>
      store.touch(saved.sid, stale, (e) => (e ? reject(e) : resolve())),
    );
    assert.equal(
      f.db.prepare("SELECT sid FROM sessions WHERE sid=?").get(saved.sid),
      undefined,
    );
    const events = JSON.stringify(
      f.db.prepare("SELECT * FROM account_events").all(),
    );
    assert.ok(!events.includes(next) && !events.includes(f.password));
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM idempotency").get()!.n,
      0,
    );
    assert.equal(
      f.db.prepare("SELECT epoch FROM account_auth WHERE user_id=?").get(f.id)!
        .epoch,
      2,
    );
    assert.match(
      String(
        f.db.prepare("SELECT password_hash FROM users WHERE id=?").get(f.id)!
          .password_hash,
      ),
      /^\$argon2id\$/,
    );
  } finally {
    f.db.close();
  }
});
test("concurrent password changes single winner and delayed old login rejects changed epoch", async () => {
  const f = await fixture();
  const originalVerify = argon2.verify;
  let release = () => {};
  try {
    const a = await f.login(),
      b = await f.login();
    const next = "synthetic-race-" + randomUUID();
    const change = (actor: typeof a, password: string) =>
      actor.agent
        .post("/api/account/password")
        .set("Origin", f.origin)
        .set("x-csrf-token", actor.csrf)
        .send({
          currentPassword: f.password,
          newPassword: password,
          confirmPassword: password,
        });
    const responses = await Promise.all([change(a, next), change(b, next)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [204, 401]);
    assert.equal(
      f.db.prepare("SELECT epoch FROM account_auth WHERE user_id=?").get(f.id)!
        .epoch,
      2,
    );
    const current = await f.login("account@example.test", next),
      pending = request.agent(f.app);
    const sessionResponse = await pending.get("/api/session");
    let entered = () => {};
    const ready = new Promise<void>((r) => {
        entered = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    let first = true;
    argon2.verify = async (...args: Parameters<typeof argon2.verify>) => {
      const valid = await originalVerify(...args);
      if (first && args[1] === next) {
        first = false;
        entered();
        await gate;
      }
      return valid;
    };
    const delayed = pending
      .post("/api/login")
      .set("Origin", f.origin)
      .set("x-csrf-token", sessionResponse.body.csrf)
      .send({ email: "account@example.test", password: next })
      .then((r) => r);
    await ready;
    const newer = "synthetic-newer-" + randomUUID();
    const changed = await current.agent
      .post("/api/account/password")
      .set("Origin", f.origin)
      .set("x-csrf-token", current.csrf)
      .send({
        currentPassword: next,
        newPassword: newer,
        confirmPassword: newer,
      });
    assert.equal(changed.status, 204, changed.text);
    release();
    assert.equal((await delayed).status, 401);
    assert.equal((await pending.get("/api/session")).body.user, null);
  } finally {
    release();
    argon2.verify = originalVerify;
    f.db.close();
  }
});
