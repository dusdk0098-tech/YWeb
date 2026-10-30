import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import argon2 from "argon2";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import type {
  InspectionTemplate,
  Inspection,
} from "../src/inspection-types.js";
test("scheduled task explicit assigned start, immutable source and returned chain do not imply completion", async () => {
  const db = openDatabase(":memory:"),
    origin = "http://127.0.0.1:3000",
    password = randomUUID(),
    hash = await argon2.hash(password);
  const ids = {
      manager: randomUUID(),
      editor: randomUUID(),
      other: randomUUID(),
      viewer: randomUUID(),
      outside: randomUUID(),
    },
    site = randomUUID();
  for (const [name, id] of Object.entries(ids))
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      name + "@example.test",
      name,
      hash,
    );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,'task site')").run(site);
  for (const [name, role] of [
    ["manager", "manager"],
    ["editor", "editor"],
    ["other", "manager"],
    ["viewer", "viewer"],
  ] as const)
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
      site,
      ids[name],
      role,
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
    viewer = await login("viewer"),
    outside = await login("outside");
  const write = (
    u: typeof m,
    method: "post" | "put",
    path: string,
    body: object,
    key = randomUUID(),
  ) =>
    u.agent[method](path)
      .set("Origin", origin)
      .set("x-csrf-token", u.csrf)
      .set("idempotency-key", key)
      .send(body);
  const base = `/api/sites/${site}`,
    tasks = base + "/inspection-tasks";
  try {
    let template = (
      await write(m, "post", base + "/inspection-templates", {
        title: "own <script>",
        instructions: "",
        items: ["one"],
      })
    ).body as InspectionTemplate;
    assert.equal(
      (
        await write(m, "post", tasks, {
          templateId: template.id,
          assigneeId: ids.editor,
          body: { plannedDate: "2026-10-28", location: "x", instructions: "" },
        })
      ).status,
      409,
    );
    template = (
      await write(
        m,
        "post",
        base + "/inspection-templates/" + template.id + "/publish",
        { version: template.version },
      )
    ).body;
    const input = {
      templateId: template.id,
      assigneeId: ids.editor,
      body: {
        plannedDate: "2026-10-28",
        location: "<script>",
        instructions: "manual",
      },
    };
    assert.equal((await write(ed, "post", tasks, input)).status, 403);
    assert.equal(
      (await write(m, "post", tasks, { ...input, assigneeId: ids.outside }))
        .status,
      400,
    );
    assert.equal(
      (
        await write(m, "post", tasks, {
          ...input,
          body: { ...input.body, plannedDate: "2026-02-30" },
        })
      ).status,
      400,
    );
    const created = await write(m, "post", tasks, input);
    assert.equal(created.status, 200);
    const task = created.body.record,
      path = tasks + "/" + task.id;
    assert.equal((await outside.agent.get(path)).status, 403);
    assert.equal(
      (await write(m, "post", path + "/start", { version: 1 })).status,
      403,
    );
    const key = randomUUID(),
      start = await write(ed, "post", path + "/start", { version: 1 }, key);
    assert.equal(start.status, 200);
    let inspection = start.body.inspection as Inspection;
    assert.equal(inspection.body.performedBy, "");
    assert.equal(inspection.body.answers[0].result, "pending");
    assert.equal(start.body.record.status, "started");
    assert.deepEqual(
      (await write(ed, "post", path + "/start", { version: 1 }, key)).body,
      start.body,
    );
    assert.equal(
      (await write(ed, "post", path + "/start", { version: 1 })).status,
      409,
    );
    assert.equal(
      (await write(m, "post", path + "/cancel", { version: 2, reason: "no" }))
        .status,
      409,
    );
    const source = (
      await viewer.agent.get(
        base + "/inspections/" + inspection.id + "/task-source",
      )
    ).body;
    assert.equal(source.task.id, task.id);
    assert.equal(source.task.version, 1);
    const originalSource = JSON.stringify(source);
    inspection = (
      await write(ed, "put", base + "/inspections/" + inspection.id, {
        version: 1,
        body: {
          ...inspection.body,
          performedBy: "manual",
          answers: inspection.body.answers.map((a) => ({
            ...a,
            result: "pass",
          })),
        },
      })
    ).body;
    inspection = (
      await write(
        ed,
        "post",
        base + "/inspections/" + inspection.id + "/submit",
        { version: inspection.version },
      )
    ).body;
    let detail = (await viewer.agent.get(path)).body;
    assert.equal(detail.chain.latest.status, "submitted");
    const returned = await write(
      m,
      "post",
      base + "/inspections/" + inspection.id + "/return",
      { version: inspection.version, reason: "revise", authorId: ids.editor },
    );
    assert.equal(returned.status, 200);
    let next = returned.body.next as Inspection;
    detail = (await viewer.agent.get(path)).body;
    assert.equal(detail.chain.items.length, 2);
    assert.equal(detail.chain.items[0].status, "returned");
    assert.equal(detail.chain.latest.status, "draft");
    assert.equal(
      JSON.stringify(
        (
          await viewer.agent.get(
            base + "/inspections/" + next.id + "/task-source",
          )
        ).body,
      ),
      originalSource,
    );
    next = (
      await write(ed, "put", base + "/inspections/" + next.id, {
        version: 1,
        body: {
          ...next.body,
          performedBy: "manual",
          answers: next.body.answers.map((a) => ({ ...a, result: "pass" })),
        },
      })
    ).body;
    next = (
      await write(ed, "post", base + "/inspections/" + next.id + "/submit", {
        version: next.version,
      })
    ).body;
    assert.equal(
      (
        await write(m, "post", base + "/inspections/" + next.id + "/accept", {
          version: next.version,
          reason: "reviewed",
        })
      ).status,
      200,
    );
    detail = (await viewer.agent.get(path)).body;
    assert.equal(detail.chain.latest.status, "accepted");
    assert.equal(detail.record.status, "started");
    const print = await viewer.agent.get(
      base + "/inspections/" + next.id + "/print",
    );
    assert.match(print.text, /시작 당시 점검 일정 출처/);
    assert.ok(!print.text.includes("<script>"));
    assert.throws(() =>
      db
        .prepare(
          "UPDATE inspection_task_links SET snapshot='{}' WHERE inspection_id=?",
        )
        .run(next.id),
    );
    assert.throws(() =>
      db
        .prepare("UPDATE inspection_tasks SET body='{}' WHERE id=?")
        .run(task.id),
    );
    db.prepare("DELETE FROM memberships WHERE site_id=? AND user_id=?").run(
      site,
      ids.editor,
    );
    assert.equal(
      (await write(ed, "post", path + "/start", { version: 1 }, key)).status,
      403,
    );
    db.prepare("INSERT INTO memberships VALUES(?,?,'editor')").run(
      site,
      ids.editor,
    );
    const raceTask = (await write(m, "post", tasks, input)).body.record;
    const outcomes = await Promise.all([
      write(ed, "post", tasks + "/" + raceTask.id + "/start", { version: 1 }),
      write(m, "post", tasks + "/" + raceTask.id + "/cancel", {
        version: 1,
        reason: "cancel",
      }),
    ]);
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
    const failureTask = (await write(m, "post", tasks, input)).body.record;
    db.exec(
      "CREATE TRIGGER task_fault BEFORE INSERT ON inspection_task_events WHEN NEW.event='started' BEGIN SELECT RAISE(ABORT,'test fault'); END;",
    );
    const count = () =>
        Number(
          (
            db.prepare("SELECT count(*) AS n FROM inspections").get() as {
              n: number;
            }
          ).n,
        ),
      before = count(),
      failureKey = randomUUID();
    assert.equal(
      (
        await write(
          ed,
          "post",
          tasks + "/" + failureTask.id + "/start",
          { version: 1 },
          failureKey,
        )
      ).status,
      500,
    );
    assert.equal(count(), before);
    assert.equal(
      (await viewer.agent.get(tasks + "/" + failureTask.id)).body.record.status,
      "planned",
    );
    db.exec("DROP TRIGGER task_fault");
    assert.equal(
      (
        await write(
          ed,
          "post",
          tasks + "/" + failureTask.id + "/start",
          { version: 1 },
          failureKey,
        )
      ).status,
      200,
    );
  } finally {
    db.close();
  }
});
