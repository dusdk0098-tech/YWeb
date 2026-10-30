import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import argon2 from "argon2";
import { openDatabase, type Db } from "../server/db.js";
import { createApp } from "../server/app.js";
import { journalHash } from "../server/daily-journal-sources.js";
import {
  readMonthlyJournals,
  journalMonth,
} from "../server/daily-monthly-report.js";
import type { DailySnapshot } from "../server/daily-journal-model.js";
function fixture() {
  const db = openDatabase(":memory:");
  db.exec(
    "INSERT INTO users VALUES('u','u@example.test','user','hash');INSERT INTO sites(id,name) VALUES('s','site <script>'),('other','other');",
  );
  return db;
}
function journal(
  db: Db,
  id: string,
  day: string,
  parent: string | null = null,
  status: "draft" | "archived" = "archived",
  version = 3,
  refs = 0,
  site = "s",
) {
  const body = {
    workSummary: id + " <script>",
    workLocations: "location",
    safetyInstructions: "manual",
    observations: "",
    followupNotes: "",
    patrols: [],
  };
  const source = {
    facts: {
      siteId: site,
      date: day,
      attendance: {
        presentWorkers: 7,
        presentVisitors: 2,
        cancelledRecords: 1,
        totalRecords: 10,
        revisionHash: "frozen",
      },
      tbm: Array.from({ length: refs }, (_, i) => ({
        id: id + "tbm" + i,
        title: "frozen TBM",
        hash: "frozen-hash",
        parentId: null,
        successor: null,
      })),
    },
    fingerprint: "captured-fingerprint",
    capturedAt: "original capture",
    capturedBy: { id: "u", name: "source actor" },
  };
  source.fingerprint = journalHash(source.facts);
  db.prepare("INSERT INTO daily_journals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
    id,
    site,
    day,
    JSON.stringify(body),
    status,
    version,
    "u",
    parent,
    parent ? "correction" : "",
    JSON.stringify(source),
    "deliberately unordered",
    "deliberately unordered",
  );
  if (status === "archived") {
    const snapshot: DailySnapshot = {
      id,
      date: day,
      version,
      site: { id: site, name: "old site" },
      author: { id: "u", name: "old author" },
      parentId: parent,
      revisionReason: parent ? "correction" : "",
      body,
      source,
      archivedBy: { id: "u", name: "old manager" },
      archivedAt: "original archive",
    };
    db.prepare("INSERT INTO daily_journal_snapshots VALUES(?,?,?)").run(
      id,
      JSON.stringify(snapshot),
      journalHash(snapshot),
    );
  }
}
test("monthly calendar strictness, root lineage selection and read-only frozen facts", () => {
  const db = fixture();
  try {
    for (const month of ["2024-00", "2024-13", "2024-2", "24-02", "2024-02-01"])
      assert.equal(journalMonth.safeParse(month).success, false);
    assert.equal(readMonthlyJournals(db, "s", "2024-02").calendarDays, 29);
    assert.equal(readMonthlyJournals(db, "s", "2023-02").calendarDays, 28);
    assert.equal(readMonthlyJournals(db, "s", "9999-12").calendarDays, 31);
    journal(db, "root", "2024-02-01", null, "archived", 99);
    journal(db, "newer", "2024-02-01", "root", "archived", 3);
    journal(db, "pending", "2024-02-01", "newer", "draft", 1);
    journal(db, "onlydraft", "2024-02-02", null, "draft", 1);
    journal(db, "othermonth", "2024-03-01");
    journal(db, "othersite", "2024-02-01", null, "archived", 3, 0, "other");
    const changes = (
      db.prepare("SELECT total_changes() AS n").get() as { n: number }
    ).n;
    const report = readMonthlyJournals(db, "s", "2024-02");
    assert.equal(report.days[0].archived?.journalId, "newer");
    assert.equal(report.days[0].archived?.revisionNumber, 2);
    assert.equal(report.days[0].pendingDraft?.kind, "pending_correction");
    assert.equal(report.days[1].archived, null);
    assert.equal(report.days[1].pendingDraft?.kind, "unarchived_root");
    assert.equal(report.days[2].rootId, null);
    assert.deepEqual(report.counts, {
      daysWithArchived: 1,
      noJournalDays: 27,
      unarchivedRootDays: 1,
      pendingCorrectionDays: 1,
    });
    assert.equal(
      report.days[0].archived?.source.facts.attendance.presentWorkers,
      7,
    );
    assert.equal(
      (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n,
      changes,
    );
    assert.equal(
      report.fingerprint,
      readMonthlyJournals(db, "s", "2024-02").fingerprint,
    );
    const inconsistent = JSON.parse(
      (
        db
          .prepare(
            "SELECT body FROM daily_journal_snapshots WHERE journal_id='newer'",
          )
          .get() as { body: string }
      ).body,
    ) as DailySnapshot;
    inconsistent.id = "bad";
    inconsistent.date = "2025-01-01";
    inconsistent.parentId = null;
    db.exec(
      "INSERT INTO daily_journals SELECT 'bad',site_id,'2025-01-01',body,status,version,author_id,NULL,'',source_capture,created_at,updated_at FROM daily_journals WHERE id='newer'",
    );
    db.prepare("INSERT INTO daily_journal_snapshots VALUES('bad',?,?)").run(
      JSON.stringify(inconsistent),
      journalHash(inconsistent),
    );
    assert.throws(() => readMonthlyJournals(db, "s", "2025-01"), /출처/);
    db.prepare("UPDATE users SET name='unrelated' WHERE id='u'").run();
    assert.equal(
      report.fingerprint,
      readMonthlyJournals(db, "s", "2024-02").fingerprint,
    );
  } finally {
    db.close();
  }
});
test("monthly actual2000 versions and1000 references exact, oneover refusal not truncation", () => {
  const db = fixture();
  try {
    db.exec("BEGIN IMMEDIATE");
    for (let i = 0; i < 2000; i++)
      journal(db, "v" + i, "2026-10-01", i ? "v" + (i - 1) : null);
    db.exec("COMMIT");
    assert.equal(
      readMonthlyJournals(db, "s", "2026-10").days[0].versionCount,
      2000,
    );
    journal(db, "overflow", "2026-10-01", "v1999", "draft", 1);
    assert.throws(() => readMonthlyJournals(db, "s", "2026-10"), /2,000/);
    db.exec("BEGIN IMMEDIATE");
    for (let i = 1; i <= 5; i++)
      journal(db, "ref" + i, "2026-11-0" + i, null, "archived", 3, 200);
    db.exec("COMMIT");
    assert.equal(
      readMonthlyJournals(db, "s", "2026-11").days.filter((d) => d.archived)
        .length,
      5,
    );
    journal(db, "refextra", "2026-11-06", null, "archived", 3, 1);
    assert.throws(() => readMonthlyJournals(db, "s", "2026-11"), /1,000/);
  } finally {
    db.close();
  }
});
test("monthly GET/print site auth, no write endpoint, fingerprint change guard and escaping", async () => {
  const db = fixture(),
    origin = "http://127.0.0.1:3000",
    password = randomUUID();
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
    await argon2.hash(password),
    "u",
  );
  db.exec("INSERT INTO memberships VALUES('s','u','viewer');");
  journal(db, "r", "2026-10-01");
  const app = await createApp(db, { origin, secret: "x".repeat(48) }),
    agent = request.agent(app);
  let session = await agent.get("/api/session");
  session = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", session.body.csrf)
    .send({ email: "u@example.test", password });
  assert.equal(session.status, 200);
  try {
    const base = "/api/sites/s/daily-journal-months",
      r = await agent.get(base + "?month=2026-10");
    assert.equal(r.status, 200);
    assert.equal(
      (await request(app).get(base + "/print?month=2026-10")).status,
      401,
    );
    assert.equal(
      (await agent.get("/api/sites/other/daily-journal-months?month=2026-10"))
        .status,
      403,
    );
    assert.equal((await agent.get(base + "?month=2026-13")).status, 400);
    assert.equal(
      (await agent.get(base + "?month=2026-10&approved=true")).status,
      400,
    );
    const printed = await agent.get(
      base + "/print?month=2026-10&expectedFingerprint=" + r.body.fingerprint,
    );
    assert.equal(printed.status, 200);
    assert.ok(!printed.text.includes("<script>"));
    assert.match(printed.text, /&lt;script&gt;/);
    assert.equal(
      (
        await agent
          .post(base)
          .set("Origin", origin)
          .set("x-csrf-token", session.body.csrf)
          .send({ month: "2026-10" })
      ).status,
      404,
    );
    journal(db, "pending", "2026-10-01", "r", "draft", 1);
    assert.equal(
      (
        await agent.get(
          base +
            "/print?month=2026-10&expectedFingerprint=" +
            r.body.fingerprint,
        )
      ).status,
      409,
    );
    const current = (await agent.get(base + "?month=2026-10")).body;
    assert.equal(current.days[0].archived.journalId, "r");
    assert.equal(current.days[0].pendingDraft.id, "pending");
    assert.equal(
      (
        await agent.get(
          base +
            "/print?month=2026-10&expectedFingerprint=" +
            current.fingerprint,
        )
      ).status,
      200,
    );
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM audit").get() as { n: number }).n,
      0,
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM idempotency").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    db.close();
  }
});
