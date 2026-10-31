import test from "node:test";
import assert from "node:assert/strict";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import { calcBody, evaluateCalc, evaluateGround, groundDefaults, tensionFactor, type CalcBody } from "../server/equipment-calc.js";
const plan = { title: "<계산> 계획", date: "2026-10-31", startTime: "09:00", endTime: "10:00", location: "합성", workDescription: "합성", emergencyProcedure: "합성", verificationNote: "합성", steps: [{ task: "작업", procedure: "절차", precaution: "주의" }], equipmentIds: [], duties: [] };
// Expected numbers are hand-computed from the source formulas (g = 9.80665), not taken from the code under test.
const near = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 0.001, `${a} ≠ ${b}`);
const line = (c: ReturnType<typeof evaluateGround>, label: string) => c.lines.find((l) => l.label.startsWith(label))?.value;
test("ground bearing: crawler uses one track's area once (fixes the original double division), outriggers follow KOSHA 방법 2", () => {
  const crawler = evaluateGround({ ...groundDefaults("crawler_crane"), equipmentWeightT: 45, liftLoadT: 4, extraLoadT: 1, trackWidthM: 0.8, tumblerDistanceM: 4, trackHeightM: 1, allowableKpa: 300 });
  near(line(crawler, "A"), 3.48);
  near(line(crawler, "q1"), 305.284); // 1.3 × 490.3325 / (0.6 × 3.48)
  near(line(crawler, "q3"), 284.931);
  near(line(crawler, "q0"), 91.585);
  assert.deepEqual([crawler.ok, crawler.verdict], [false, "부적합 (q > 허용지내력)"]); // the original sheet showed 21.9 → "적합"
  assert.match(crawler.warnings.join(), /높이 × 0.35/);
  const truck = evaluateGround({ ...groundDefaults("truck_crane"), equipmentWeightT: 30, padLengthM: 1, padWidthM: 1, allowableKpa: 300 });
  near(line(truck, "Pmax"), 243.818); // 0.85 × (30 × 9.80665 × 1.3) × 0.5 × 1.5
  assert.equal(truck.ok, true);
  assert.match(truck.warnings.join(), /1\.65배/);
  const maker = evaluateGround({ ...groundDefaults("truck_crane"), equipmentWeightT: 30, manufacturerReactionKn: 400, padLengthM: 1.2, padWidthM: 1.2, allowableKpa: 300 });
  near(line(maker, "최대 접지압"), 277.778);
  assert.equal(maker.warnings.length, 0);
  const lift = evaluateGround({ ...groundDefaults("aerial_platform"), equipmentWeightT: 30, padLengthM: 1, padWidthM: 1, allowableKpa: 300 });
  assert.match(lift.warnings.join(), /고소작업차에 이동식크레인 아웃트리거 식/);
  const pile = evaluateGround({ ...groundDefaults("pile_driver"), equipmentWeightT: 20, padLengthM: 1, padWidthM: 2, allowableKpa: 137 });
  near(line(pile, "Pmax"), 274.586);
  near(line(pile, "최대 접지압"), 137.293);
  assert.equal(pile.ok, false);
  assert.match(pile.warnings.join(), /1\.4/);
  assert.equal(evaluateGround({ ...groundDefaults("truck_crane"), equipmentWeightT: 1 }).ok, null); // no pad area yet
});
test("slings divide by the real tension factor (the original multiplied by a fixed 1.16), law minimum safety factors", () => {
  near(tensionFactor(60), 1.1547);
  near(tensionFactor(80), 1.3054); // the original table's "1.3.5"
  near(tensionFactor(120), 2);
  const body = (angle: number): CalcBody => ({ loadT: 5, hookT: 0.5, otherT: 0.5, ground: null, lifting: { kind: "truck_crane", ratedCapacityT: 10, workRatioPercent: 85 },
    slings: [{ type: "wire", breakingLoadT: 16, legs: 2, hitch: "vertical", modeFactor: 1, efficiencyPercent: 100, safetyFactor: 5, includedAngleDeg: angle }], shackles: [{ wllT: 3.25, count: 2 }] });
  let r = evaluateCalc(body(60));
  near(r.checks[0].lines[0].value, 6); // total 5 + 0.5 + 0.5
  near(r.checks[0].lines[1].value, 8.5);
  near(r.checks[1].lines[1].value, 5.543); // 16 × 2 ÷ 5 ÷ 1.1547
  assert.deepEqual(r.checks.map((c) => c.ok), [true, true, true]); // below-hook load 5.5 ≤ 5.543; shackles 6.5
  r = evaluateCalc(body(120));
  near(r.checks[1].lines[1].value, 3.2);
  assert.equal(r.checks[1].ok, false);
  const bad = (patch: object) => calcBody.safeParse({ ...body(60), slings: [{ ...body(60).slings[0], ...patch }] }).success;
  assert.equal(bad({ safetyFactor: 4 }), false); // wire rope ≥ 5 (제163조)
  assert.equal(bad({ type: "belt", safetyFactor: 4 }), true);
  assert.equal(bad({ legs: 1, includedAngleDeg: 30 }), false);
  assert.equal(bad({ includedAngleDeg: 130 }), false);
  const ex = evaluateCalc({ ...body(60), lifting: { kind: "excavator", ratedCapacityT: 10, workRatioPercent: 60 } });
  assert.match(ex.warnings.join(), /굴착기 작업하중 비율 60%/);
});
test("calculation API: draft edits, version conflicts, frozen after archive, print without engineering warnings", async () => {
  const f = await methodFixture();
  try {
    let r = await f.send("post", "/work-plans", { body: plan });
    assert.equal(r.status, 200, r.text);
    const id = r.body.id, path = `/work-plans/${id}/calculations`;
    let c = (await f.agent.get(f.base + path)).body;
    assert.deepEqual([c.saved, c.version, c.result.checks], [false, 0, []]);
    const body: CalcBody = { loadT: 4, hookT: 0.3, otherT: 1, lifting: null, slings: [], shackles: [],
      ground: { ...groundDefaults("crawler_crane"), equipmentWeightT: 45, liftLoadT: 4, extraLoadT: 1, trackWidthM: 0.8, tumblerDistanceM: 4, trackHeightM: 1, allowableKpa: 300, allowableNote: "<평판재하>" } };
    assert.equal((await f.send("put", path, { version: 0, body: { ...body, ground: { ...body.ground, allowableKpa: 0 } } })).status, 400);
    r = await f.send("put", path, { version: 0, body });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.saved, r.body.version, r.body.result.checks[0].ok], [true, 1, false]);
    assert.ok(r.body.result.warnings.length > 0); // the editor shows these
    assert.equal((await f.send("put", path, { version: 0, body })).status, 409); // stale
    const html = (await f.agent.get(f.base + path + "/print")).text;
    assert.match(html, /&lt;계산&gt; 계획/);
    assert.match(html, /&lt;평판재하&gt;/);
    assert.match(html, /판정: 부적합 \(q &gt; 허용지내력\)/);
    assert.match(html, /305\.284 kN\/㎡/);
    assert.doesNotMatch(html, /근거|기술사|검토되지|KOSHA|경고/); // warnings stay in the app only
    r = await f.send("post", `/work-plans/${id}/capture`, { version: 1 });
    assert.equal(r.status, 200, r.text);
    r = await f.reviewSend(`/work-plans/${id}/archive`, { version: r.body.version });
    assert.equal(r.status, 200, r.text);
    c = (await f.agent.get(f.base + path)).body;
    assert.equal((await f.send("put", path, { version: c.version, body })).status, 409);
    assert.throws(() => f.db.prepare("UPDATE work_plan_calculations SET body='{}'").run());
    assert.throws(() => f.db.prepare("DELETE FROM work_plan_calculations").run());
    // A revision draft starts from the archived inputs, editable again; the archived copy stays as it was.
    const archived = (await f.agent.get(f.base + `/work-plans/${id}`)).body;
    r = await f.send("post", `/work-plans/${id}/revise`, { version: archived.version, authorId: f.manager, reason: "개정" });
    assert.equal(r.status, 200, r.text);
    const child = (await f.agent.get(f.base + `/work-plans/${r.body.id}/calculations`)).body;
    assert.deepEqual([child.saved, child.version, child.body, child.result.checks[0].ok], [true, 1, body, false]);
    assert.equal((await f.send("put", `/work-plans/${r.body.id}/calculations`, { version: 1, body: { ...body, loadT: 5 } })).status, 200);
    assert.equal((await f.agent.get(f.base + path)).body.body.loadT, 4);
  } finally {
    f.db.close();
  }
});
