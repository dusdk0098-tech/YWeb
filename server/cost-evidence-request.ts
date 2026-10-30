import { z } from "zod";
import type { CostCategory, CostExpense } from "./cost-model.js";
import { costTotals } from "./cost-model.js";
import { journalHash } from "./daily-journal-sources.js";
import { HttpError } from "./site-operations.js";
import { renderEvidenceRequest, type EvidenceRequestRow, type EvidenceRequestView } from "./cost-evidence-request-text.js";
import type { CurrentCostEvidence } from "./cost-evidence-model.js";
export type RequestEvidenceSource = Pick<CurrentCostEvidence, "period" | "evidenceVersion" | "items" | "warnings">;
export function buildEvidenceRequestView(source: RequestEvidenceSource, expenses: CostExpense[], categories: CostCategory[]): EvidenceRequestView {
  // Consume the existing reader's warning decisions, never infer legal-required evidence or recalculate link status.
  costTotals(categories, expenses);
  const flags = new Map<string, Set<EvidenceRequestRow["reasons"][number]>>();
  function add(id: string, reason: EvidenceRequestRow["reasons"][number]) {
    const current = flags.get(id) ?? new Set<EvidenceRequestRow["reasons"][number]>(); current.add(reason); flags.set(id, current);
  }
  source.warnings.activeExpensesWithoutLink.forEach(id => add(id, "no_link"));
  source.warnings.changedLinks.forEach(l => add(l.expenseId, "changed_link"));
  source.warnings.cancelledLinks.forEach(l => add(l.expenseId, "cancelled_link"));
  const rows = expenses.filter(e => flags.has(e.id)).map(e => ({
    id: e.id, version: e.version, hash: journalHash(e), spendDate: e.spend_date, description: e.description,
    categoryLabel: categories.find(c => c.id === e.category_id)!.label, status: e.status, amount: e.amount,
    reasons: [...flags.get(e.id)!], links: source.items.flatMap(i => i.links.filter(l => l.expenseId === e.id).map(l => ({
      fileId: i.file.id, fileHash: i.file.sha256, sourceVersion: l.source.version, sourceHash: l.sourceHash,
    }))),
  }));
  if (flags.size !== rows.length || expenses.some(e => e.period_id !== source.period.id))
    throw new HttpError(409, "현재 경고와 지출 출처가 일치하지 않아 초안 생성을 중단합니다.");
  const data = { schemaVersion: 1, siteId: source.period.siteId, periodId: source.period.id,
    month: source.period.month, periodVersion: source.period.version, periodStatus: source.period.status,
    evidenceVersion: source.evidenceVersion, rows };
  return { ...data, fingerprint: journalHash(data) };
}
const hash = z.string().regex(/^[a-f0-9]{64}$/), version = z.number().int().positive();
export const evidenceRequestInput = z.object({ fingerprint: hash, periodVersion: version,
  evidenceVersion: z.number().int().nonnegative(), confirmInternalDraft: z.literal(true),
  selected: z.array(z.object({ id: z.uuid(), version, hash }).strict()).min(1).max(50),
}).strict();
export function selectEvidenceRequest(view: EvidenceRequestView, input: z.infer<typeof evidenceRequestInput>) {
  if (view.fingerprint !== input.fingerprint || view.periodVersion !== input.periodVersion || view.evidenceVersion !== input.evidenceVersion)
    throw new HttpError(409, "현재 원장 또는 참조 상태가 변경되었습니다. 최신 목록을 확인하고 다시 선택하세요.");
  if (new Set(input.selected.map(r => r.id)).size !== input.selected.length) throw new HttpError(400, "중복된 지출 선택입니다.");
  const rows = input.selected.map(ref => {
    const row = view.rows.find(r => r.id === ref.id);
    if (!row || row.version !== ref.version || row.hash !== ref.hash) throw new HttpError(409, "선택 행의 버전 또는 출처가 달라졌습니다. 최신 목록을 다시 확인하세요.");
    return row;
  });
  return renderEvidenceRequest(view, rows);
}
