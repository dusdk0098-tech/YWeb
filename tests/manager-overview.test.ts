import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  overviewQuery,
  readManagerOverview,
} from "../server/manager-overview.js";
import { printManagerOverview } from "../server/manager-overview-print.js";
const day = "2026-10-28";
test("manager overview strict date/scope and bounded deterministic pages are read only", () => {
  for (const q of [
    { asOfDate: "2025-02-29" },
    { asOfDate: day, offset: -1 },
    { asOfDate: day, offset: 1.5 },
    { asOfDate: day, siteIds: "" },
    {
      asOfDate: day,
      siteIds: Array(51)
        .fill(0)
        .map(() => randomUUID())
        .join(","),
    },
    { asOfDate: day, unknown: 1 },
  ])
    assert.equal(overviewQuery.safeParse(q).success, false);
  const id = randomUUID();
  assert.equal(
    overviewQuery.safeParse({ asOfDate: day, siteIds: id + "," + id }).success,
    false,
  );
  const db = openDatabase(":memory:");
  db.exec(
    "INSERT INTO users VALUES('u','u@example.test','user','hash'),('other','other@example.test','other','hash')",
  );
  const ids: string[] = [];
  for (let i = 0; i < 51; i++) {
    const sid = randomUUID();
    ids.push(sid);
    db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
      sid,
      "same <script>",
    );
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
      sid,
      "u",
      "manager",
    );
  }
  const foreign = randomUUID();
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(foreign, "private");
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    foreign,
    "u",
    "editor",
  );
  const changes = () => db.prepare("SELECT total_changes() n").get();
  const before = changes();
  const a = readManagerOverview(
    db,
    "u",
    overviewQuery.parse({ asOfDate: day }),
  );
  const b = readManagerOverview(
    db,
    "u",
    overviewQuery.parse({ asOfDate: day, offset: 50 }),
  );
  assert.equal(a.sites.length, 50);
  assert.equal(a.totalSites, 51);
  assert.equal(a.hasMore, true);
  assert.equal(b.sites.length, 1);
  assert.equal(b.hasMore, false);
  assert.deepEqual(
    [...a.sites, ...b.sites].map((s) => s.id),
    ids.sort(),
  );
  assert.equal(a.sites[0].journal.rootExists, false);
  assert.equal(a.sites[0].journal.archivedVersions, 0);
  assert.equal(
    a.fingerprint,
    readManagerOverview(db, "u", overviewQuery.parse({ asOfDate: day }))
      .fingerprint,
  );
  assert.deepEqual(changes(), before);
  assert.throws(
    () =>
      readManagerOverview(
        db,
        "u",
        overviewQuery.parse({ asOfDate: day, siteIds: ids[0] + "," + foreign }),
      ),
    /관리자 권한/,
  );
  assert.equal(
    readManagerOverview(db, "other", overviewQuery.parse({ asOfDate: day }))
      .totalSites,
    0,
  );
  const html = printManagerOverview(a);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<style>"));
  assert.ok(html.includes('href="/print.css"'));
  assert.ok(!html.includes("private"));
  db.close();
});
test("manager overview current statuses, date-only task buckets, journal revision presence, API privacy and stale print", async () => {
  const db = openDatabase(":memory:");
  const hash = await argon2.hash("synthetic-overview-password");
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    "u",
    "u@example.test",
    "user",
    hash,
  );
  const s = randomUUID(),
    other = randomUUID();
  for (const id of [s, other])
    db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
      id,
      id === s ? "owned <script>" : "hidden",
    );
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(s, "u", "manager");
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(other, "u", "viewer");
  for (const status of [
    "draft",
    "reported",
    "assigned",
    "review_requested",
    "closed",
  ])
    db.prepare(
      "INSERT INTO hazard_reports(id,site_id,owner_id,body,status,created_at,updated_at) VALUES(?,?,?,'{}',?,'now','now')",
    ).run(randomUUID(), s, "u", status);
  db.prepare(
    "INSERT INTO inspection_templates(id,site_id,body,status,version,created_at) VALUES('t',?,'{}','draft',1,'now')",
  ).run(s);
  for (const [status, date] of [
    ["planned", "2026-10-27"],
    ["planned", day],
    ["planned", "2026-10-29"],
    ["started", day],
    ["cancelled", day],
  ])
    db.prepare(
      "INSERT INTO inspection_tasks(id,site_id,template_id,template_snapshot,body,assignee_id,status,version,created_by,created_at,updated_at) VALUES(?,?,'t','{}',?,'u',?,1,'u','now','now')",
    ).run(randomUUID(), s, JSON.stringify({ plannedDate: date }), status);
  db.prepare(
    "INSERT INTO daily_journals(id,site_id,date,body,status,version,author_id,parent_id,revision_reason,created_at,updated_at) VALUES('root',?,?,'{}','archived',1,'u',NULL,'','now','now')",
  ).run(s, day);
  db.prepare(
    "INSERT INTO daily_journals(id,site_id,date,body,status,version,author_id,parent_id,revision_reason,created_at,updated_at) VALUES('child',?,?,'{}','draft',1,'u','root','correction','now','now')",
  ).run(s, day);
  const app = await createApp(db, {
      origin: "http://127.0.0.1:3107",
      secret: "o".repeat(48),
    }),
    agent = request.agent(app);
  const session = await agent.get("/api/session");
  await agent
    .post("/api/login")
    .set("Origin", "http://127.0.0.1:3107")
    .set("x-csrf-token", session.body.csrf)
    .send({ email: "u@example.test", password: "synthetic-overview-password" })
    .expect(200);
  const query = `asOfDate=${day}&siteIds=${s}`;
  const r = (await agent.get("/api/manager-overview?" + query).expect(200))
    .body;
  assert.deepEqual(r.sites[0].hazards, {
    reported: 1,
    assigned: 1,
    reviewRequested: 1,
    closed: 1,
  });
  assert.deepEqual(r.sites[0].tasks, {
    beforeDate: 1,
    onDate: 1,
    afterDate: 1,
  });
  assert.deepEqual(r.sites[0].journal, {
    rootExists: true,
    archivedVersions: 1,
    initialDraft: false,
    correctionDraft: true,
  });
  const output = JSON.stringify(r);
  for (const secret of [
    "owner_id",
    "assignee_id",
    "password",
    "hidden",
    "contents",
    "snapshot",
  ])
    assert.ok(!output.includes(secret));
  await agent.get("/api/manager-overview?" + query + "," + other).expect(403);
  await agent
    .get(
      "/api/manager-overview/print?" +
        query +
        "&expectedFingerprint=" +
        r.fingerprint,
    )
    .expect(200);
  db.prepare("UPDATE sites SET name=? WHERE id=?").run("renamed", s);
  await agent
    .get(
      "/api/manager-overview/print?" +
        query +
        "&expectedFingerprint=" +
        r.fingerprint,
    )
    .expect(409);
  db.prepare(
    "UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id='u'",
  ).run(s);
  await agent.get("/api/manager-overview?" + query).expect(403);
  await agent
    .get(
      "/api/manager-overview/print?" +
        query +
        "&expectedFingerprint=" +
        r.fingerprint,
    )
    .expect(403);
  assert.equal(
    (await agent.get("/api/manager-overview?asOfDate=" + day).expect(200)).body
      .sites.length,
    0,
  );
  await request(app)
    .get("/api/manager-overview?asOfDate=" + day)
    .expect(401);
  db.close();
});
