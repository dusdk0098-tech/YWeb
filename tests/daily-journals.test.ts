import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import argon2 from "argon2";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { dailyBody } from "../server/daily-journal-validation.js";
import {
  dailySourceFacts,
  journalHash,
} from "../server/daily-journal-sources.js";
const body = {
  workSummary: "작업 <script>",
  workLocations: "현장",
  safetyInstructions: "수기 안내",
  observations: "관찰",
  followupNotes: "후속",
  patrols: [{ location: "통로", finding: "적치", action: "정리 요청 (수기)" }],
};
test("daily journal strict bounded text excludes legal/wage/private extras", () => {
  assert.equal(
    dailyBody.safeParse({ ...body, legallyApproved: true }).success,
    false,
  );
  assert.equal(
    dailyBody.safeParse({
      ...body,
      patrols: Array.from({ length: 21 }, () => body.patrols[0]),
    }).success,
    false,
  );
  assert.equal(
    dailyBody.safeParse({
      ...body,
      patrols: [{ ...body.patrols[0], health: "private" }],
    }).success,
    false,
  );
});
test("daily root/date, exact source freshness, immutable archive and explicit same-day correction", async () => {
  const db = openDatabase(":memory:"),
    origin = "http://127.0.0.1:3000",
    password = randomUUID(),
    hash = await argon2.hash(password),
    site = randomUUID(),
    day = "2026-10-28";
  const ids = {
    manager: randomUUID(),
    editor: randomUUID(),
    viewer: randomUUID(),
    outside: randomUUID(),
  };
  for (const [name, id] of Object.entries(ids))
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      name + "@example.test",
      name,
      hash,
    );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "日誌");
  for (const [name, role] of [
    ["manager", "manager"],
    ["editor", "editor"],
    ["viewer", "viewer"],
  ] as const)
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
      site,
      ids[name],
      role,
    );
  const worker = randomUUID(),
    attendance = randomUUID();
  db.prepare(
    "INSERT INTO workers VALUES(?,?,?,'company','worker',1,1,'now','now')",
  ).run(worker, site, "PRIVATE_WORKER_NAME");
  db.prepare(
    "INSERT INTO attendance VALUES(?,?,?,?,'PRIVATE_WORKER_NAME','company','worker','present','manual','initial',1,?,'now','now')",
  ).run(attendance, site, worker, day, ids.editor);
  const tbm = randomUUID();
  db.prepare(
    "INSERT INTO tbm_sessions(id,site_id,body,status,author_id,created_at,updated_at,revision_reason) VALUES(?,?,?,'finalized',?,'now','now','')",
  ).run(tbm, site, JSON.stringify({ title: "TBM", date: day }), ids.editor);
  db.prepare("INSERT INTO tbm_snapshots VALUES(?,?,?,?,?)").run(
    tbm,
    JSON.stringify({ details: { title: "TBM", date: day }, parentId: null }),
    "fixturehash",
    ids.manager,
    "now",
  );
  const app = await createApp(db, { origin, secret: "x".repeat(48) });
  async function login(name: keyof typeof ids) {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", r.body.csrf)
      .send({ email: name + "@example.test", password });
    assert.equal(r.status, 200);
    return { agent, csrf: r.body.csrf };
  }
  const m = await login("manager"),
    ed = await login("editor"),
    v = await login("viewer"),
    out = await login("outside");
  const write = (
    u: typeof m,
    method: "post" | "put",
    path: string,
    value: object,
    key = randomUUID(),
  ) =>
    u.agent[method](path)
      .set("Origin", origin)
      .set("x-csrf-token", u.csrf)
      .set("idempotency-key", key)
      .send(value);
  const base = `/api/sites/${site}/daily-journals`;
  try {
    const created = await write(ed, "post", base, { date: day, body });
    assert.equal(created.status, 200);
    let journal = created.body;
    const path = base + "/" + journal.id;
    assert.equal(
      (await write(m, "post", base, { date: day, body })).status,
      409,
    );
    assert.equal(
      (await write(v, "post", base, { date: "2026-10-29", body })).status,
      403,
    );
    assert.equal((await out.agent.get(path)).status, 403);
    assert.equal(
      (await write(m, "post", path + "/capture", { version: 1 })).status,
      403,
    );
    assert.equal(
      (await write(ed, "post", path + "/archive", { version: 1 })).status,
      403,
    );
    assert.equal(
      (await write(m, "post", path + "/archive", { version: 1 })).status,
      409,
    );
    journal = (await write(ed, "post", path + "/capture", { version: 1 })).body;
    assert.equal(journal.source_capture.facts.attendance.presentWorkers, 1);
    assert.equal(journal.source_capture.facts.tbm.length, 1);
    assert.ok(!JSON.stringify(journal).includes("PRIVATE_WORKER_NAME"));
    const captured = journal.source_capture.fingerprint;
    assert.equal(captured, journalHash(dailySourceFacts(db, site, day)));
    db.prepare("UPDATE users SET name='renamed' WHERE id=?").run(ids.editor);
    assert.equal(captured, journalHash(dailySourceFacts(db, site, day)));
    db.prepare(
      "UPDATE attendance SET status='cancelled',version=version+1 WHERE id=?",
    ).run(attendance);
    assert.equal(
      (await write(m, "post", path + "/archive", { version: journal.version }))
        .status,
      409,
    );
    journal = (
      await write(ed, "post", path + "/capture", { version: journal.version })
    ).body;
    assert.equal(journal.source_capture.facts.attendance.presentWorkers, 0);
    assert.equal(journal.source_capture.facts.attendance.cancelledRecords, 1);
    const child = randomUUID();
    db.prepare(
      "INSERT INTO tbm_sessions(id,site_id,body,status,parent_id,revision_reason,author_id,created_at,updated_at) VALUES(?,?,?,'draft',?,'revision',?,'now','now')",
    ).run(
      child,
      site,
      JSON.stringify({ title: "new", date: day }),
      tbm,
      ids.editor,
    );
    assert.equal(
      (await write(m, "post", path + "/archive", { version: journal.version }))
        .status,
      409,
    );
    journal = (
      await write(ed, "post", path + "/capture", { version: journal.version })
    ).body;
    const fingerprint = journal.source_capture.fingerprint;
    db.prepare("UPDATE tbm_sessions SET body=? WHERE id=?").run(
      JSON.stringify({
        title: "irrelevant draft text",
        date: day,
        topics: "changed",
      }),
      child,
    );
    assert.equal(fingerprint, journalHash(dailySourceFacts(db, site, day)));
    const unrelated = randomUUID();
    db.prepare(
      "INSERT INTO tbm_sessions(id,site_id,body,status,revision_reason,author_id,created_at,updated_at) VALUES(?,?,?,'draft','',?,'now','now')",
    ).run(
      unrelated,
      site,
      JSON.stringify({ date: "2026-10-29", title: "otherday" }),
      ids.editor,
    );
    assert.equal(fingerprint, journalHash(dailySourceFacts(db, site, day)));
    const archive = await write(m, "post", path + "/archive", {
      version: journal.version,
    });
    assert.equal(archive.status, 200);
    journal = archive.body;
    assert.equal(journal.snapshot.hash, journalHash(journal.snapshot.body));
    const print = (await v.agent.get(path + "/print")).text;
    assert.ok(!print.includes("<script>"));
    assert.ok(!print.includes("PRIVATE_WORKER_NAME"));
    db.prepare(
      "UPDATE attendance SET status='present',version=version+1 WHERE id=?",
    ).run(attendance);
    db.prepare("UPDATE sites SET name='later' WHERE id=?").run(site);
    assert.equal((await v.agent.get(path + "/print")).text, print);
    assert.equal(
      (await write(ed, "put", path, { version: journal.version, body })).status,
      409,
    );
    assert.throws(() =>
      db
        .prepare(
          "UPDATE daily_journal_snapshots SET body='{}' WHERE journal_id=?",
        )
        .run(journal.id),
    );
    const revisions = await Promise.all([
      write(m, "post", path + "/revise", {
        version: journal.version,
        authorId: ids.editor,
        reason: "정정",
      }),
      write(m, "post", path + "/revise", {
        version: journal.version,
        authorId: ids.editor,
        reason: "다른키",
      }),
    ]);
    assert.deepEqual(revisions.map((r) => r.status).sort(), [200, 409]);
    const next = revisions.find((r) => r.status === 200)!.body;
    assert.equal(next.date, day);
    assert.equal(next.source_capture, null);
    assert.equal(next.parent_id, journal.id);
    assert.equal(
      (
        await write(m, "post", base + "/" + next.id + "/archive", {
          version: 1,
        })
      ).status,
      409,
    );
    const races = await Promise.all([
      write(ed, "post", base, { date: "2026-10-30", body }),
      write(m, "post", base, { date: "2026-10-30", body }),
    ]);
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  } finally {
    db.close();
  }
});

test("daily source boundaries include exactly2000 attendance and200 TBM versions, reject one more without truncation", () => {
  const db = openDatabase(":memory:");
  const day = "2026-10-28";
  try {
    db.exec(
      "INSERT INTO users VALUES('u','cap@example.test','synthetic','hash');INSERT INTO sites(id,name) VALUES('a','a'),('b','b');BEGIN IMMEDIATE;",
    );
    for (let i = 0; i < 2001; i++) {
      db.prepare(
        "INSERT INTO workers VALUES(?,'a','synthetic','','worker',1,1,'now','now')",
      ).run("w" + i);
      if (i < 2000)
        db.prepare(
          "INSERT INTO attendance VALUES(?,'a',?,?,'synthetic','','worker','present','manual','fixture',1,'u','now','now')",
        ).run("a" + i, "w" + i, day);
    }
    for (let i = 0; i < 200; i++) {
      const id = "t" + i,
        snapshot = {
          details: { title: "synthetic", date: day },
          parentId: null,
        };
      db.prepare(
        "INSERT INTO tbm_sessions(id,site_id,body,status,revision_reason,author_id,created_at,updated_at) VALUES(?,'b',?,'finalized','','u','now','now')",
      ).run(id, JSON.stringify(snapshot.details));
      db.prepare("INSERT INTO tbm_snapshots VALUES(?,?,?,'u','now')").run(
        id,
        JSON.stringify(snapshot),
        "fixture" + i,
      );
    }
    db.exec("COMMIT");
    assert.equal(
      dailySourceFacts(db, "a", day).attendance.presentWorkers,
      2000,
    );
    assert.equal(dailySourceFacts(db, "b", day).tbm.length, 200);
    db.prepare(
      "INSERT INTO attendance VALUES('overflow','a','w2000',?,'synthetic','','worker','cancelled','manual','fixture',1,'u','now','now')",
    ).run(day);
    assert.throws(() => dailySourceFacts(db, "a", day), /2,000/);
    db.prepare(
      "INSERT INTO tbm_sessions(id,site_id,body,status,revision_reason,author_id,created_at,updated_at) VALUES('overflow','b',?,'finalized','','u','now','now')",
    ).run(JSON.stringify({ date: day, title: "overflow" }));
    db.prepare(
      "INSERT INTO tbm_snapshots VALUES('overflow',?,'fixture','u','now')",
    ).run(
      JSON.stringify({
        details: { date: day, title: "overflow" },
        parentId: null,
      }),
    );
    assert.throws(() => dailySourceFacts(db, "b", day), /200/);
  } finally {
    db.close();
  }
});
