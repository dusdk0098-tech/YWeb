import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { costEvidenceFixture } from "./fixtures/cost-evidence-fixture.js";
import type { EvidenceRequestView } from "../server/cost-evidence-request-text.js";
function input(v: EvidenceRequestView) { return { fingerprint: v.fingerprint, periodVersion: v.periodVersion, evidenceVersion: v.evidenceVersion,
  confirmInternalDraft: true, selected: v.rows.map(r => ({ id: r.id, version: r.version, hash: r.hash })) }; }
test("real request draft reads existing evidence, stale conflicts and all finance/evidence receipts remain unchanged", async () => {
  const f = await costEvidenceFixture(); try {
    const a = await f.expense('=합성 확인', '2.123456');
    const read = () => f.agent.get(f.siteBase + f.base + '/evidence/request-candidates');
    let r = await read(); assert.equal(r.status, 200, r.text); const first = r.body;
    assert.deepEqual(first.rows[0].reasons, ['no_link']); assert.equal(first.rows[0].amount, '2.123456');
    const snapshot = () => Object.fromEntries(['cost_periods','cost_expenses','cost_events','cost_evidence_files','cost_evidence_links','cost_evidence_events','cost_closures','cost_close_evidence','audit','idempotency'].map(t => [t, f.db.prepare(`SELECT * FROM ${t}`).all()]));
    let before = snapshot();
    r = await f.send(f.base + '/evidence/request-preview', input(first)); assert.equal(r.status, 200, r.text);
    assert.match(r.body.tsv, /text: =합성 확인/); assert.match(r.body.text, /2\.123456원/);
    assert.equal(r.headers['cache-control'], 'no-store'); assert.deepEqual(snapshot(), before);
    assert.doesNotMatch(JSON.stringify(r.body), /evidence@example|합성 관리자|uploaded_by/);
    const uploaded = await f.upload(); assert.equal(uploaded.status, 200); const file = uploaded.body.items[0].file;
    assert.equal((await f.send(f.base + '/evidence/request-preview', input(first))).status, 409);
    assert.equal((await f.links(file.id, [{ expenseId: a.id, version: a.version }])).status, 200);
    assert.equal((await read()).body.total, 0);
    r = await f.send(f.base + `/expenses/${a.id}/cancel`, { version: (await f.current()).version, reason: '합성 취소' }); assert.equal(r.status, 200);
    const cancelled = (await read()).body; assert.equal(cancelled.total, 1);
    assert.deepEqual(cancelled.rows[0].reasons, ['changed_link','cancelled_link']);
    before = snapshot(); r = await f.send(f.base + '/evidence/request-preview', input(cancelled)); assert.equal(r.status, 200, r.text);
    assert.match(r.body.text, /cancelled/); assert.deepEqual(snapshot(), before);
    const bad = input(cancelled); bad.selected[0].version++; assert.equal((await f.send(f.base + '/evidence/request-preview', bad)).status, 409);
    assert.equal((await f.close()).status, 200); const closed = (await read()).body; assert.equal(closed.periodStatus, 'closed');
    before = snapshot(); assert.equal((await f.send(f.base + '/evidence/request-preview', input(closed))).status, 200); assert.deepEqual(snapshot(), before);
    assert.equal((await f.send(f.base + '/evidence/request-preview', { ...input(closed), description: 'untrusted' })).status, 400);
    f.db.prepare("UPDATE memberships SET role='editor' WHERE site_id=? AND user_id=?").run(f.site, f.manager);
    assert.equal((await read()).status, 403); assert.equal((await f.send(f.base + '/evidence/request-preview', input(closed))).status, 403);
  } finally { f.db.close(); }
});
test("request candidate actual 1000 cap/pagination, 50 selection and unavailable source fail as a whole", async () => {
  const f = await costEvidenceFixture(); try {
    const p = await f.current(), insert = f.db.prepare("INSERT INTO cost_expenses VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (let i=0;i<1000;i++) insert.run(randomUUID(),p.id,p.categories[0].id,'2026-10-01','synthetic '+i,'1','1','1','active',1,f.manager,'t'+i,'t'+i);
    const read = (offset=0) => f.agent.get(f.siteBase+f.base+`/evidence/request-candidates?offset=${offset}`);
    let r = await read(); assert.equal(r.status, 200, r.text); assert.equal(r.body.total, 1000); assert.equal(r.body.rows.length, 50); assert.equal(r.body.hasMore, true);
    const first = r.body; r = await read(950); assert.equal(r.body.hasMore, false); assert.equal(r.body.fingerprint, first.fingerprint);
    assert.equal((await f.send(f.base+'/evidence/request-preview', input(first))).status, 200);
    assert.equal((await f.send(f.base+'/evidence/request-preview', {...input(first), selected:[...input(first).selected,input(r.body).selected[0]]})).status,400);
    const missing = input(first); missing.selected[0].id=randomUUID(); assert.equal((await f.send(f.base+'/evidence/request-preview',missing)).status,409);
    insert.run(randomUUID(),p.id,p.categories[0].id,'2026-10-01','over cap','1','1','1','active',1,f.manager,'last','last');
    r=await read(); assert.equal(r.status,400); assert.equal(r.body.rows,undefined);
    assert.equal((await f.send(f.base+'/evidence/request-preview', input(first))).status,400);
  } finally { f.db.close(); }
});
