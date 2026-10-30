import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../server/app.js";
import { openDatabase } from "../server/db.js";
import { meetingInput } from "../server/validation.js";
import { escapeHtml } from "../server/print.js";
const origin = "http://127.0.0.1:3000";
const config = { secret: "test-only-" + randomUUID(), origin };
const meeting = {
  title: "월간 안전회의 <script>alert(1)</script>",
  type: "안전보건협의체",
  date: "2026-10-28",
  time: "09:30",
  location: "회의실",
  attendees: "홍길동 / 현장 / 담당",
  agenda: "안건",
  discussion: "첫 줄\n두 번째 줄",
  decisions: "결정",
  actions: [
    { task: "점검", owner: "김담당", due: "2026-10-29", status: "대기" },
  ],
};
test("strict validation and HTML encoding", () => {
  assert.equal(meetingInput.safeParse(meeting).success, true);
  for (const change of [
    { date: "2026-02-30" },
    { time: "24:00" },
    { title: " " },
    { status: "approved" },
    { authorId: "fake" },
    {
      actions: [{ task: "점검", owner: "", due: "2026-10-29", status: "대기" }],
    },
  ])
    assert.equal(
      meetingInput.safeParse({ ...meeting, ...change }).success,
      false,
    );
  assert.equal(escapeHtml("<>&\"'"), "&lt;&gt;&amp;&quot;&#39;");
});
test("auth, site boundaries, idempotency, concurrency, roles, print, persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-test-")),
    path = join(dir, "test.sqlite");
  let db = openDatabase(path);
  const hash = await argon2.hash("testing-password-only");
  for (const id of ["alice", "bob", "carol"])
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      id + "@example.test",
      id,
      hash,
    );
  const app = await createApp(db, config);
  async function login(name: string) {
    const client = request.agent(app);
    const s = await client.get("/api/session");
    const result = await client
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", s.body.csrf)
      .send({
        email: name + "@example.test",
        password: "testing-password-only",
      });
    assert.equal(result.status, 200);
    assert.match(result.headers["set-cookie"][0], /HttpOnly/);
    assert.match(result.headers["set-cookie"][0], /SameSite=Strict/);
    return {
      client,
      csrf: result.body.csrf as string,
      cookie: result.headers["set-cookie"][0].split(";")[0],
    };
  }
  const a = await login("alice"),
    b = await login("bob"),
    c = await login("carol");
  function write(
    who: typeof a,
    method: "post" | "put" | "patch" | "delete",
    path: string,
    body: object,
    key = randomUUID(),
  ) {
    return who.client[method](path)
      .set("Origin", origin)
      .set("x-csrf-token", who.csrf)
      .set("idempotency-key", key)
      .send(body);
  }
  try {
    assert.equal((await request(app).get("/api/sites")).status, 401);
    assert.equal(
      (await a.client.post("/api/sites").send({ name: "bad" })).status,
      403,
    );
    assert.equal(
      (
        await a.client
          .post("/api/sites")
          .set("Origin", origin)
          .set("x-csrf-token", "é".repeat(64))
          .send({ name: "bad" })
      ).status,
      403,
    );
    assert.equal(
      (
        await a.client
          .post("/api/sites")
          .set("Origin", "https://attacker.invalid")
          .set("x-csrf-token", a.csrf)
          .send({ name: "bad" })
      ).status,
      403,
    );
    const site = (await write(a, "post", "/api/sites", { name: "현장 A" }))
      .body;
    const prefix = `/api/sites/${site.id}`;
    const other = (await write(b, "post", "/api/sites", { name: "현장 B" }))
      .body;
    assert.equal((await a.client.get("/api/sites")).body.length, 1);
    assert.equal(
      (await a.client.get(`/api/sites/${other.id}/minutes`)).status,
      403,
    );
    const key = randomUUID();
    const created = await write(a, "post", prefix + "/minutes", meeting, key);
    assert.equal(created.status, 200);
    const id = created.body.id;
    assert.equal(
      (await write(a, "post", prefix + "/minutes", meeting, key)).body.id,
      id,
    );
    assert.equal(
      (
        await write(
          a,
          "post",
          prefix + "/minutes",
          { ...meeting, title: "different" },
          key,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await write(a, "post", prefix + "/minutes", {
          ...meeting,
          authorId: "bob",
        })
      ).status,
      400,
    );
    assert.equal((await b.client.get(prefix + "/minutes/" + id)).status, 403);
    assert.equal(
      (await b.client.get(prefix + "/minutes/" + id + "/print")).status,
      403,
    );
    const print = await a.client.get(prefix + "/minutes/" + id + "/print");
    assert.equal(print.status, 200);
    assert.ok(print.text.includes("&lt;script&gt;"));
    assert.ok(print.text.includes("김담당"));
    assert.ok(print.text.includes("첫 줄\n두 번째 줄"));
    assert.ok(!print.text.includes("<script>"));
    assert.ok(!print.text.includes("광고"));
    assert.equal(
      (
        await write(a, "put", prefix + "/members", {
          email: "bob@example.test",
          role: "viewer",
        })
      ).status,
      200,
    );
    assert.equal((await b.client.get(prefix + "/minutes/" + id)).status, 200);
    assert.equal(
      (
        await write(b, "put", prefix + "/minutes/" + id, {
          ...meeting,
          version: 1,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await write(b, "put", prefix + "/members", {
          email: "carol@example.test",
          role: "manager",
        })
      ).status,
      403,
    );
    await write(a, "put", prefix + "/members", {
      email: "carol@example.test",
      role: "editor",
    });
    const results = await Promise.all([
      write(a, "put", prefix + "/minutes/" + id, {
        ...meeting,
        title: "수정 A",
        version: 1,
      }),
      write(c, "put", prefix + "/minutes/" + id, {
        ...meeting,
        title: "수정 C",
        version: 1,
      }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (await write(a, "delete", prefix + "/members/alice", {})).status,
      409,
    );
    await write(a, "delete", prefix + "/members/bob", {});
    assert.equal((await b.client.get(prefix + "/minutes/" + id)).status, 403);
    const sessionCount = db
      .prepare("SELECT count(*) AS n FROM sessions")
      .get() as { n: number };
    assert.ok(sessionCount.n > 0);
    db.close();
    db = openDatabase(path);
    const restarted = await createApp(db, config);
    assert.equal(
      (
        await request(restarted)
          .get(prefix + "/minutes/" + id)
          .set("Cookie", a.cookie)
      ).status,
      200,
    );
    assert.equal(
      (
        db.prepare("SELECT version FROM minutes WHERE id=?").get(id) as {
          version: number;
        }
      ).version,
      2,
    );
    // Reuse a persisted cookie against an entirely new Express instance.
    const fresh = request.agent(restarted);
    const s = await fresh.get("/api/session");
    const auth = await fresh
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", s.body.csrf)
      .send({ email: "alice@example.test", password: "testing-password-only" });
    const cookie = auth.headers["set-cookie"][0].split(";")[0];
    const logout = await fresh
      .post("/api/logout")
      .set("Origin", origin)
      .set("x-csrf-token", auth.body.csrf);
    assert.equal(logout.status, 204);
    assert.equal(
      (
        await request(restarted)
          .get(prefix + "/minutes/" + id)
          .set("Cookie", cookie)
      ).status,
      401,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
