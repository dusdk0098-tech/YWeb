import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceRequestView, selectEvidenceRequest, evidenceRequestInput, type RequestEvidenceSource } from "../server/cost-evidence-request.js";
import type { CostExpense } from "../server/cost-model.js";
const expense: CostExpense = { id: '11111111-1111-4111-8111-111111111111', period_id: 'p', category_id: 'c', spend_date: '2026-10-01', description: 'synthetic', quantity: '1', unit_price_won: '10', amount: '10', status: 'cancelled', version: 2, created_by: 'private', created_at: 'a', updated_at: 'b' };
const source: RequestEvidenceSource = { period: { id: 'p', siteId: 's', month: '2026-10', version: 3, status: 'open' }, evidenceVersion: 4,
  items: [{ file: { id: 'f', sha256: 'a'.repeat(64), filename: 'own.png', format: 'image/png', size: 9, uploaded_by: 'private', uploaded_at: 'a' }, links: [{ expenseId: expense.id, source: { ...expense, version: 1 }, sourceHash: 'b'.repeat(64), currentVersion: 2, currentStatus: 'cancelled', changedSinceLink: true }] }],
  warnings: { unlinkedFiles: [], activeExpensesWithoutLink: [], changedLinks: [{ attachmentId: 'f', expenseId: expense.id }], cancelledLinks: [{ attachmentId: 'f', expenseId: expense.id }] } };
const categories = [{ id: 'c', label: 'Synthetic', plan: '100', opening: '0' }];
test('existing warning decisions deduplicate rows without copying private actor data', () => {
  const view = buildEvidenceRequestView(source, [expense], categories);
  assert.equal(view.rows.length, 1); assert.deepEqual(view.rows[0].reasons, ['changed_link', 'cancelled_link']);
  assert.ok(!JSON.stringify(view).includes('private'));
  const input = evidenceRequestInput.parse({ fingerprint: view.fingerprint, periodVersion: 3, evidenceVersion: 4, confirmInternalDraft: true, selected: [{ id: expense.id, version: 2, hash: view.rows[0].hash }] });
  assert.equal(selectEvidenceRequest(view, input).selectedCount, 1);
  assert.throws(() => selectEvidenceRequest(view, { ...input, evidenceVersion: 5 }));
  assert.throws(() => selectEvidenceRequest(view, { ...input, selected: [{ ...input.selected[0], version: 1 }] }));
  assert.throws(() => evidenceRequestInput.parse({ ...input, description: 'client text' }));
  assert.throws(() => buildEvidenceRequestView(source, [], categories));
  const next = buildEvidenceRequestView({ ...source, evidenceVersion: 5 }, [expense], categories);
  assert.notEqual(next.fingerprint, view.fingerprint);
});
