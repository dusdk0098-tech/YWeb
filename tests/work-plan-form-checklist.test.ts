import test from "node:test";
import assert from "node:assert/strict";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import { FORM_MODULES, defaultFormChoices, formChoiceProblem } from "../server/work-plan-form-catalog.js";
const body = { title: "<양식> 계획", date: "2026-10-31", startTime: "09:00", endTime: "10:00", location: "합성", workDescription: "합성", emergencyProcedure: "합성", verificationNote: "공학 판정 없음", steps: [{ task: "작업", procedure: "절차", precaution: "주의" }], equipmentIds: [], duties: [] };
test("form checklist catalog: 17 original modules, required cannot be excluded, complete set only", () => {
  assert.equal(FORM_MODULES.length, 17);
  const d = defaultFormChoices();
  assert.equal(formChoiceProblem(d), null);
  assert.deepEqual(d.filter((c) => c.included).map((c) => c.type), ["GENERAL_WORK_PLAN", "HAZARD_CONTROL_REFERENCE"]);
  assert.match(formChoiceProblem(d.map((c) => (c.type === "GENERAL_WORK_PLAN" ? { ...c, included: false } : c)))!, /필수 양식\(일반 작업계획\)/);
  assert.match(formChoiceProblem(d.slice(1))!, /누락/);
  assert.match(formChoiceProblem([...d.slice(1), d[1]])!, /누락되었거나 중복/);
});
test("form checklist API: defaults, draft edits, version conflicts, frozen after archive, escaped print", async () => {
  const f = await methodFixture();
  try {
    let r = await f.send("post", "/work-plans", { body });
    assert.equal(r.status, 200, r.text);
    const id = r.body.id, path = `/work-plans/${id}/form-checklist`;
    let c = (await f.agent.get(f.base + path)).body;
    assert.deepEqual([c.saved, c.version, c.choices.length], [false, 0, 17]);
    const choices = c.choices.map((x: { type: string }) => (x.type === "PLATE_LOAD_TEST" ? { ...x, included: true, note: "<시험>" } : x));
    assert.equal((await f.send("put", path, { version: 0, choices: choices.map((x: { type: string }) => (x.type === "HAZARD_CONTROL_REFERENCE" ? { ...x, included: false } : x)) })).status, 400);
    r = await f.send("put", path, { version: 0, choices });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.saved, r.body.version, r.body.choices.find((x: { type: string }) => x.type === "PLATE_LOAD_TEST").included], [true, 1, true]);
    assert.equal((await f.send("put", path, { version: 0, choices })).status, 409); // stale
    const html = (await f.agent.get(f.base + path + "/print")).text;
    assert.match(html, /&lt;양식&gt; 계획/);
    assert.match(html, /<th>평판재하시험 기록<\/th><td>선택<\/td><td>포함<\/td><td><\/td><td>&lt;시험&gt;<\/td>/);
    assert.match(html, /<th>항타기 안정성 참고<\/th><td>선택<\/td><td>제외<\/td>.*계산 보류\(P-02\)/);
    // Archive: the plan is captured, then accepted by a different manager.
    r = await f.send("post", `/work-plans/${id}/capture`, { version: 1 });
    assert.equal(r.status, 200, r.text);
    r = await f.reviewSend(`/work-plans/${id}/archive`, { version: r.body.version });
    assert.equal(r.status, 200, r.text);
    c = (await f.agent.get(f.base + path)).body;
    assert.equal((await f.send("put", path, { version: c.version, choices })).status, 409);
    assert.throws(() => f.db.prepare("UPDATE work_plan_form_checklists SET body='[]'").run());
    assert.throws(() => f.db.prepare("DELETE FROM work_plan_form_checklists").run());
  } finally {
    f.db.close();
  }
});
