import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";

const origin = "http://127.0.0.1:3000";
async function setup() {
  const db = openDatabase(":memory:"),
    manager = randomUUID(),
    site = randomUUID(),
    password = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    manager,
    "synthetic@example.test",
    "Synthetic",
    await argon2.hash(password),
  );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
    site,
    "Synthetic site",
  );
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    site,
    manager,
    "manager",
  );
  const app = await createApp(db, {
      origin,
      secret: "synthetic-business-only".repeat(3),
    }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "synthetic@example.test", password });
  assert.equal(r.status, 200);
  const csrf = r.body.csrf,
    base = `/api/sites/${site}`;
  const send = (
    method: "post" | "put",
    path: string,
    body: object,
    key = randomUUID(),
  ) =>
    agent[method](base + path)
      .set("Origin", origin)
      .set("x-csrf-token", csrf)
      .set("idempotency-key", key)
      .send(body);
  return { db, manager, site, agent, base, send };
}
const criteria = {
  name: "Synthetic human criteria",
  method: "product" as const,
  likelihood: ["L1", "L2", "L3", "L4", "L5"],
  severity: ["S1", "S2", "S3", "S4"],
  rationale: "Synthetic arithmetic test, not operational standard",
  bands: [
    { min: 1, max: 5, label: "Synthetic A", criterionAcceptable: true },
    { min: 6, max: 20, label: "Synthetic B", criterionAcceptable: false },
  ],
};
const hazard = () => ({
  id: randomUUID(),
  task: "Synthetic task",
  location: "Test location",
  category: "Human text",
  accidentType: "Human text",
  scenario: "Synthetic scenario",
  harm: "Synthetic harm",
  exposedGroup: "Generic group",
  reference: "No legal claim",
  currentControls: "Human note",
  likelihood: null as number | null,
  severity: null as number | null,
  judgmentReason: "",
  plans: [] as {
    action: string;
    controlType: "미정";
    ownerNote: string;
    due: null;
    priorityNote: string;
    preconditions: string;
  }[],
});
const draft = () => ({
  title: "Synthetic assessment",
  date: "2026-10-28",
  timing: "수시" as const,
  trigger: "Synthetic change",
  workScope: "Synthetic scope",
  method: "product" as const,
  hazards: [hazard()],
});
function complete() {
  const body = draft();
  body.hazards[0].likelihood = 5;
  body.hazards[0].severity = 4;
  body.hazards[0].judgmentReason = "Synthetic basis";
  body.hazards[0].plans = [
    {
      action: "Human plan",
      controlType: "미정",
      ownerNote: "Group",
      due: null,
      priorityNote: "",
      preconditions: "",
    },
  ];
  return body;
}
async function numericSource() {
  const f = await setup(),
    reviewer = randomUUID(),
    password = randomUUID();
  f.db
    .prepare("INSERT INTO users VALUES(?,?,?,?)")
    .run(
      reviewer,
      "action-reviewer@example.test",
      "Synthetic reviewer",
      await argon2.hash(password),
    );
  f.db
    .prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(f.site, reviewer, "manager");
  const app = await createApp(f.db, {
      origin,
      secret: "synthetic-business-only".repeat(3),
    }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "action-reviewer@example.test", password });
  const csrf = r.body.csrf,
    send = (path: string, body: object, key = randomUUID()) =>
      agent
        .post(f.base + path)
        .set("Origin", origin)
        .set("x-csrf-token", csrf)
        .set("idempotency-key", key)
        .send(body);
  r = await f.send("post", "/risk-criteria", criteria);
  const cid = r.body.id;
  r = await f.send("post", `/risk-criteria/${cid}/confirm`, {
    version: 1,
    reason: "Synthetic",
    confirmHumanCriteria: true,
  });
  assert.equal(r.status, 200);
  const body = complete();
  Object.assign(body.hazards[0].plans[0], {
    controlType: "관리적",
    due: "2026-11-01",
  });
  body.hazards[0].plans.push({
    ...body.hazards[0].plans[0],
    action: "Second human plan",
  });
  r = await f.send("post", "/risk-assessments", { body, criteriaId: cid });
  const id = r.body.id;
  r = await f.send("post", `/risk-assessments/${id}/submit`, {
    version: 1,
    reason: "Document only",
    confirmRecordOnly: true,
  });
  assert.equal(r.status, 200);
  r = await send(`/risk-assessments/${id}/review`, {
    version: 2,
    decision: "accepted",
    reason: "Record review",
    confirmRecordOnly: true,
  });
  assert.equal(r.status, 200);
  return {
    ...f,
    reviewer,
    reviewAgent: agent,
    reviewSend: send,
    doc: r.body.record,
    body,
  };
}

const levels = () => ({
  name: "Human three-level definitions",
  method: "three_level" as const,
  rationale: "Synthetic human policy, no legal default",
  levels: [true, false, false].map((criterionAcceptable, i) => ({
    id: randomUUID(),
    label: `Human label ${i}`,
    description: `Human definition ${i}`,
    criterionAcceptable,
  })),
});
const levelBody = (levelId: string | null) => {
  const b = draft();
  const { likelihood, severity, ...h } = b.hazards[0];
  void likelihood;
  void severity;
  return {
    ...b,
    method: "three_level" as const,
    hazards: [
      {
        ...h,
        levelId,
        judgmentReason: "Human selected judgment",
        plans: [
          {
            action: "Human plan",
            controlType: "관리적" as const,
            ownerNote: "Team note",
            due: "2026-11-01",
            priorityNote: "",
            preconditions: "",
          },
        ],
      },
    ],
  };
};
import {
  checklistCriteriaInput,
  validateChecklistCriteria,
  checklistAssessmentInput,
  checklistResults,
  validateChecklistCoverage,
} from "../server/risk-checklist-model.js";
const checklist = () => ({
  name: "Own checklist",
  method: "checklist" as const,
  rationale: "Human-defined prompts, no legal catalog",
  items: Array.from({ length: 3 }, (_, i) => ({
    id: randomUUID(),
    prompt: `Question ${i}`,
    guidance: `Human guidance ${i}`,
  })),
});
function checklistBody(c: ReturnType<typeof checklist>) {
  const b = draft();
  return {
    ...b,
    method: "checklist" as const,
    hazards: c.items.map((item, i) => {
      const { likelihood, severity, ...h } = hazard();
      void likelihood;
      void severity;
      return {
        ...h,
        checklistItemId: item.id,
        outcome: (["compliant", "noncompliant", "not_applicable"] as const)[
          i % 3
        ],
        judgmentReason: "Human basis including NA reason",
        plans:
          i % 3 === 1
            ? [
                {
                  action: "Explicit plan",
                  controlType: "관리적" as const,
                  ownerNote: "Team",
                  due: "2026-11-01",
                  priorityNote: "",
                  preconditions: "",
                },
              ]
            : [],
      };
    }),
  };
}
test("checklist pending/NA/failure are nonnumeric and every fixed item is required", () => {
  const c = checklist();
  validateChecklistCriteria(checklistCriteriaInput.parse(c));
  const b = checklistBody(c);
  assert.ok(
    checklistResults(b, c).every(
      (r) => r.score === null && r.criterionAcceptable === null,
    ),
  );
  validateChecklistCoverage(b, c);
  assert.throws(() => validateChecklistCriteria({ ...c, items: [] }));
  assert.throws(() =>
    validateChecklistCoverage({ ...b, hazards: b.hazards.slice(1) }, c),
  );
  assert.equal(
    checklistAssessmentInput.safeParse({
      ...b,
      hazards: [b.hazards[0], { ...b.hazards[0], id: randomUUID() }],
    }).success,
    false,
  );
  assert.equal(
    checklistAssessmentInput.safeParse({
      ...b,
      hazards: [{ ...b.hazards[0], levelId: randomUUID() }],
    }).success,
    false,
  );
  assert.throws(() =>
    checklistResults(
      { ...b, hazards: [{ ...b.hazards[0], checklistItemId: randomUUID() }] },
      c,
    ),
  );
  assert.equal(
    checklistResults(
      { ...b, hazards: [{ ...b.hazards[0], outcome: null }] },
      c,
    )[0].bandLabel,
    null,
  );
  assert.equal(
    checklistResults(
      { ...b, hazards: [{ ...b.hazards[2], judgmentReason: "" }] },
      c,
    )[0].incomplete,
    true,
  );
  const max = {
    ...c,
    items: Array.from({ length: 50 }, () => ({
      id: randomUUID(),
      prompt: "Q",
      guidance: "G",
    })),
  };
  validateChecklistCriteria(checklistCriteriaInput.parse(max));
  assert.equal(
    checklistCriteriaInput.safeParse({
      ...max,
      items: [...max.items, max.items[0]],
    }).success,
    false,
  );
});
test("checklist document review/actions/print retain fixed questions and prior methods unchanged", async () => {
  const f = await numericSource();
  try {
    const c3 = levels();
    let r = await f.send("post", "/risk-criteria", c3);
    const c3id = r.body.id;
    await f.send("post", `/risk-criteria/${c3id}/confirm`, {
      version: 1,
      reason: "Three",
      confirmHumanCriteria: true,
    });
    await f.send("post", "/risk-assessments", {
      body: levelBody(c3.levels[0].id),
      criteriaId: c3id,
    });
    const before = f.db
        .prepare(
          "SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id",
        )
        .all(),
      c = checklist();
    r = await f.send("post", "/risk-criteria", c);
    const cid = r.body.id;
    assert.equal(r.status, 200);
    r = await f.send("post", `/risk-criteria/${cid}/confirm`, {
      version: 1,
      reason: "Checklist policy",
      confirmHumanCriteria: true,
    });
    assert.equal(r.status, 200);
    const b = checklistBody(c);
    r = await f.send("post", "/risk-assessments", {
      body: { ...b, hazards: b.hazards.slice(1) },
      criteriaId: cid,
    });
    const missing = r.body.id;
    assert.equal(
      (
        await f.send("post", `/risk-assessments/${missing}/submit`, {
          version: 1,
          reason: "Missing item",
          confirmRecordOnly: true,
        })
      ).status,
      400,
    );
    r = await f.send("post", "/risk-assessments", { body: b, criteriaId: cid });
    assert.equal(r.status, 200);
    let d = r.body;
    r = await f.send("post", `/risk-assessments/${d.id}/submit`, {
      version: 1,
      reason: "Complete item records",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-assessments/${d.id}/review`, {
      version: 2,
      decision: "accepted",
      reason: "Document, not compliance certification",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    d = r.body.record;
    const pc = await f.agent.get(
        f.base + `/risk-assessments/${d.id}/print-context`,
      ),
      print = await f.agent.get(
        f.base +
          `/risk-assessments/${d.id}/print?expectedFingerprint=${pc.body.fingerprint}`,
      );
    assert.equal(print.status, 200);
    assert.match(print.text, /고정 체크항목/);
    assert.match(print.text, /이 응답의 고정 질문/);
    assert.match(print.text, /이 응답의 고정 판단 안내/);
    assert.match(print.text, /해당없음/);
    assert.match(print.text, /전체 위험 허용 판정 없음/);
    assert.doesNotMatch(print.text, /원 산술값/);
    r = await f.reviewSend(`/risk-assessments/${d.id}/actions`, {
      version: 3,
      hazardId: b.hazards[1].id,
      planIndex: 0,
      assigneeId: f.manager,
      due: "2026-11-01",
      reason: "Explicit plan tracking",
      confirmManualTracking: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.source.criteria.body.method, "checklist");
    assert.equal(
      (
        await f.agent.get(
          f.base +
            `/risk-assessments/${d.id}/hazards/${b.hazards[0].id}/residuals/context`,
        )
      ).status,
      200,
    );
    r = await f.reviewSend(`/risk-assessments/${d.id}/revise`, {
      version: 3,
      reason: "Correction",
      authorId: f.manager,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.nextDraft.body.method, "checklist");
    assert.equal(r.body.nextDraft.submission, null);
    const after = f.db
      .prepare(
        "SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments WHERE id IN (?,?) ORDER BY id",
      )
      .all(...before.map((v) => String(v.id)));
    assert.deepEqual(after, before);
  } finally {
    f.db.close();
  }
});
test("all 50 checklist items, NA/plan prerequisites, explicit replacement and synthetic backup preserve source", async () => {
  const f = await numericSource(),
    { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    { backup, DatabaseSync } = await import("node:sqlite"),
    { createBackup, restoreBackup } =
      await import("../scripts/local-backup.js"),
    dir = await mkdtemp(join(tmpdir(), "pedit-checklist-"));
  try {
    const c = {
      ...checklist(),
      items: Array.from({ length: 50 }, (_, i) => ({
        id: randomUUID(),
        prompt: `Question ${i}`,
        guidance: `Human guidance ${i}`,
      })),
    };
    let r = await f.send("post", "/risk-criteria", c);
    const cid = r.body.id;
    await f.send("post", `/risk-criteria/${cid}/confirm`, {
      version: 1,
      reason: "Human criteria",
      confirmHumanCriteria: true,
    });
    const b = checklistBody(c);
    b.hazards[2].judgmentReason = "";
    r = await f.send("post", "/risk-assessments", { body: b, criteriaId: cid });
    assert.equal(r.status, 200);
    const id = r.body.id;
    assert.equal(
      (
        await f.send("post", `/risk-assessments/${id}/submit`, {
          version: 1,
          reason: "NA missing basis",
          confirmRecordOnly: true,
        })
      ).status,
      400,
    );
    b.hazards[2].judgmentReason = "NA basis";
    const plan = b.hazards[1].plans;
    b.hazards[1].plans = [];
    await f.send("put", `/risk-assessments/${id}`, {
      version: 1,
      body: b,
      reason: "Plan missing fixture",
    });
    assert.equal(
      (
        await f.send("post", `/risk-assessments/${id}/submit`, {
          version: 2,
          reason: "No plan",
          confirmRecordOnly: true,
        })
      ).status,
      400,
    );
    b.hazards[1].plans = plan;
    await f.send("put", `/risk-assessments/${id}`, {
      version: 2,
      body: b,
      reason: "Complete content",
    });
    r = await f.send("post", `/risk-assessments/${id}/submit`, {
      version: 3,
      reason: "50 complete items",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.submission.results.length, 50);
    r = await f.send("post", "/risk-assessments", { body: b, criteriaId: cid });
    const draftId = r.body.id;
    r = await f.send("post", `/risk-assessments/${draftId}/criteria`, {
      version: 1,
      criteriaId: cid,
      confirmResetValues: true,
      reason: "Explicit links/answers reset",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.body.hazards[0].checklistItemId, null);
    assert.equal(r.body.body.hazards[0].outcome, null);
    assert.equal(r.body.body.hazards[0].judgmentReason, "");
    assert.equal(r.body.body.hazards[0].task, b.hazards[0].task);
    assert.deepEqual(r.body.body.hazards[1].plans, plan);
    const before = f.db
        .prepare(
          "SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id",
        )
        .all(),
      file = join(dir, "source.sqlite");
    await backup(f.db, file);
    await createBackup(file, join(dir, "bundle"));
    const restored = await restoreBackup(
        join(dir, "bundle"),
        join(dir, "restored"),
      ),
      db = new DatabaseSync(restored.databasePath);
    try {
      assert.deepEqual(
        db
          .prepare(
            "SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id",
          )
          .all(),
        before,
      );
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, CURRENT_SCHEMA_VERSION);
    } finally {
      db.close();
    }
    const { migrateRiskChecklist } =
      await import("../server/risk-method-schema.js");
    f.db.exec("PRAGMA user_version=27");
    migrateRiskChecklist(f.db);
    assert.deepEqual(
      f.db
        .prepare(
          "SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id",
        )
        .all(),
      before,
    );
  } finally {
    f.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
