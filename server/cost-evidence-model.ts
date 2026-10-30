import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
import { costExpenses, getCostPeriod, type CostExpense, type CostSnapshot } from "./cost-model.js";
export const COST_EVIDENCE_MANIFEST_BYTES = 4 * 1024 * 1024;
export type CostEvidenceFile = { id: string; filename: string; format: "image/png" | "image/jpeg" | "application/pdf";
  size: number; sha256: string; uploaded_by: string; uploaded_at: string };
export type EvidenceLink = { attachment_id: string; expense_id: string; period_id: string; active: number; source: string; source_hash: string };
export function evidenceVersion(db: Db, period: string) {
  return (db.prepare("SELECT COALESCE(MAX(version),0) AS n FROM cost_evidence_events WHERE period_id=?").get(period) as { n: number }).n;
}
export function evidenceFiles(db: Db, period: string) {
  const rows = db.prepare("SELECT id,filename,format,size,sha256,uploaded_by,uploaded_at FROM cost_evidence_files WHERE period_id=? ORDER BY uploaded_at,id LIMIT 21")
    .all(period) as CostEvidenceFile[];
  if (rows.length > 20) throw new HttpError(409, "월 보존 원본20개 한도를 초과해 목록을 중단합니다. 일부만 마감하지 않습니다.");
  return rows;
}
export function evidenceLinks(db: Db, period: string) {
  const rows = db.prepare("SELECT * FROM cost_evidence_links WHERE period_id=? AND active=1 ORDER BY attachment_id,expense_id LIMIT 1001").all(period) as EvidenceLink[];
  if (rows.length > 1000) throw new HttpError(409, "월 활성 연결1000개 한도입니다. 연결을 명시 분리하고 다시 확인하세요.");
  return rows;
}
export function linkSource(link: EvidenceLink): CostExpense {
  const s = JSON.parse(link.source) as CostExpense;
  if (journalHash(s) !== link.source_hash || s.id !== link.expense_id || s.period_id !== link.period_id ||
    !Number.isSafeInteger(s.version) || s.version < 1 || !["active", "cancelled"].includes(s.status))
    throw new HttpError(409, "증빙 연결 당시 지출 출처/해시가 일치하지 않습니다.");
  return s;
}
export function currentCostEvidence(db: Db, site: string, id: string) {
  const period = getCostPeriod(db, site, id), files = evidenceFiles(db, id), links = evidenceLinks(db, id), expenses = costExpenses(db, id);
  const byId = new Map(expenses.map(e => [e.id, e]));
  if (links.some(l => !files.some(f => f.id === l.attachment_id) || !byId.has(l.expense_id)))
    throw new HttpError(409, "증빙 파일/지출 출처가 없어 전체 조회를 중단합니다.");
  const items = files.map(file => {
    const selected = links.filter(l => l.attachment_id === file.id);
    if (selected.length > 50) throw new HttpError(409, "파일별 활성 연결50개 한도입니다. 연결을 좁힌 뒤 다시 확인하세요.");
    return { file, links: selected.map(l => {
      const source = linkSource(l), current = byId.get(l.expense_id)!;
      return { expenseId: l.expense_id, source, sourceHash: l.source_hash,
        currentVersion: current.version, currentStatus: current.status,
        changedSinceLink: journalHash(current) !== l.source_hash };
    }) };
  });
  const activeIds = new Set(links.map(l => l.expense_id));
  return { period: { id, siteId: site, month: period.month, version: period.version, status: period.status },
    evidenceVersion: evidenceVersion(db, id), items,
    warnings: { activeExpensesWithoutLink: expenses.filter(e => e.status === "active" && !activeIds.has(e.id)).map(e => e.id),
      changedLinks: items.flatMap(i => i.links.filter(l => l.changedSinceLink).map(l => ({ attachmentId: i.file.id, expenseId: l.expenseId }))),
      cancelledLinks: items.flatMap(i => i.links.filter(l => l.currentStatus === "cancelled").map(l => ({ attachmentId: i.file.id, expenseId: l.expenseId }))),
      unlinkedFiles: items.filter(i => i.links.length === 0).map(i => i.file.id) } };
}
export type CurrentCostEvidence = ReturnType<typeof currentCostEvidence>;
export type CloseEvidence = { schemaVersion: 1; closureId: string; closureHash: string; capturedAt: string;
  evidence: CurrentCostEvidence; policy: "unscanned-reference-only-no-financial-allocation-v1" };
export function serializeCostEvidence(value: unknown) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > COST_EVIDENCE_MANIFEST_BYTES)
    throw new HttpError(409, "고정 증빙 목록4MiB 한도입니다. 열린 월에서 불필요한 행 연결을 명시 분리하거나 연결 범위를 좁힌 후 다시 조회·마감하세요. 원본은 보존되며 목록을 잘라내지 않습니다.");
  return json;
}
export function captureCloseEvidence(db: Db, snapshot: CostSnapshot, hash: string) {
  const evidence = currentCostEvidence(db, snapshot.site.id, snapshot.period.id);
  // Called after immutable closure insert but before period state changes, in the same transaction.
  if (JSON.stringify(costExpenses(db, snapshot.period.id)) !== JSON.stringify(snapshot.expenses))
    throw new HttpError(409, "마감 지출과 증빙 참조 시점이 일치하지 않습니다.");
  const sidecar: CloseEvidence = { schemaVersion: 1, closureId: snapshot.id, closureHash: hash,
    capturedAt: snapshot.closedAt, evidence, policy: "unscanned-reference-only-no-financial-allocation-v1" };
  db.prepare("INSERT INTO cost_close_evidence VALUES(?,?,?,?,?)")
    .run(snapshot.id, snapshot.period.id, hash, serializeCostEvidence(sidecar), journalHash(sidecar));
}
export function fixedCostEvidence(db: Db, site: string, id: string, closureId: string) {
  getCostPeriod(db, site, id);
  const closure = db.prepare("SELECT body,hash FROM cost_closures WHERE id=? AND period_id=?").get(closureId, id) as { body: string; hash: string } | undefined;
  if (!closure) throw new HttpError(404, "이 월의 마감본을 찾을 수 없습니다.");
  const original = JSON.parse(closure.body) as CostSnapshot;
  if (journalHash(original) !== closure.hash || original.id !== closureId || original.site.id !== site || original.period.id !== id)
    throw new HttpError(409, "마감 원문 출처/해시가 일치하지 않습니다.");
  const row = db.prepare("SELECT * FROM cost_close_evidence WHERE closure_id=? AND period_id=?").get(closureId, id) as
    { closure_hash: string; snapshot: string; hash: string } | undefined;
  if (!row) return { recorded: false as const, closureId, closureHash: closure.hash };
  if (Buffer.byteLength(row.snapshot, "utf8") > COST_EVIDENCE_MANIFEST_BYTES) throw new HttpError(409, "고정 증빙 목록 읽기 한도 초과");
  const s = JSON.parse(row.snapshot) as CloseEvidence;
  if (s.schemaVersion !== 1 || s.closureId !== closureId || s.closureHash !== closure.hash || row.closure_hash !== closure.hash || journalHash(s) !== row.hash ||
    s.evidence.period.id !== id || s.evidence.period.siteId !== site || s.evidence.items.length > 20)
    throw new HttpError(409, "고정 증빙 목록 출처/해시가 일치하지 않습니다.");
  const files = evidenceFiles(db, id), originals = new Map(original.expenses.map(e => [e.id, e]));
  for (const item of s.evidence.items) {
    if (JSON.stringify(files.find(f => f.id === item.file.id)) !== JSON.stringify(item.file) || item.links.length > 50)
      throw new HttpError(409, "고정 증빙 원본 목록이 보존 원본과 다릅니다.");
    for (const link of item.links) {
      const e = originals.get(link.expenseId);
      if (!e || link.source.id !== e.id || link.source.period_id !== id || journalHash(link.source) !== link.sourceHash ||
        e.version !== link.currentVersion || e.status !== link.currentStatus || (journalHash(e) !== link.sourceHash) !== link.changedSinceLink)
        throw new HttpError(409, "마감 당시 지출 참조와 고정 증빙이 다릅니다.");
    }
  }
  return { recorded: true as const, closureId, closureHash: closure.hash, snapshot: s, hash: row.hash };
}

export const costEvidenceReview = z.object({ version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), confirmUnverified: z.literal(true) }).strict();
export function assertCostEvidenceReview(db: Db, period: string, review?: z.infer<typeof costEvidenceReview>) {
  const n = evidenceVersion(db, period);
  if ((n > 0 && !review) || (review && review.version !== n))
    throw new HttpError(409, "증빙 이력이 있거나 변경되었습니다. 미연결·변경 경고를 다시 조회하고 미검사 참조임을 명시 확인한 후 마감하세요.");
}
