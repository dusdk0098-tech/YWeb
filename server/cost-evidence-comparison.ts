import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
import { baselineView } from "./cost-baseline-model.js";
import { costExpenses, getCostPeriod, type CostExpense, type CostSnapshot } from "./cost-model.js";
import { currentCostEvidence, fixedCostEvidence, COST_EVIDENCE_MANIFEST_BYTES, type CurrentCostEvidence } from "./cost-evidence-model.js";
export type EvidenceComparisonSelector = { closureId: string } | { baselineId: string };
const expenseFact = (e: CostExpense) => ({ version: e.version, status: e.status, hash: journalHash(e) });
function references(evidence: CurrentCostEvidence, expenses: CostExpense[]) {
  if (evidence.items.length > 20 || expenses.length > 1000 || new Set(expenses.map(e => e.id)).size !== expenses.length || expenses.some(e => e.period_id !== evidence.period.id)) throw new HttpError(409, "비교 출처 또는 한도 불일치");
  const rows = new Map(expenses.map(e => [e.id, e]));
  const result = new Map<string, { fileId: string; expenseId: string; sourceHash: string; sourceVersion: number; expense: ReturnType<typeof expenseFact> }>();
  if (new Set(evidence.items.map(i => i.file.id)).size !== evidence.items.length) throw new HttpError(409, "원본 UUID 중복");
  for (const item of evidence.items) {
    if (item.links.length > 50) throw new HttpError(409, "파일 참조 한도 초과");
    for (const link of item.links) {
      const e = rows.get(link.expenseId), key = `${item.file.id}:${link.expenseId}`;
      if (!e || result.has(key) || link.source.id !== e.id || link.source.period_id !== evidence.period.id || journalHash(link.source) !== link.sourceHash || link.currentVersion !== e.version || link.currentStatus !== e.status || link.changedSinceLink !== (journalHash(e) !== link.sourceHash)) throw new HttpError(409, "참조 출처 불일치");
      result.set(key, { fileId: item.file.id, expenseId: e.id, sourceHash: link.sourceHash, sourceVersion: link.source.version, expense: expenseFact(e) });
    }
  }
  if (result.size > 1000) throw new HttpError(409, "참조 한도 초과");
  return result;
}
const fileFact = (f: CurrentCostEvidence["items"][number]["file"]) => ({ id: f.id, filename: f.filename, format: f.format, size: f.size, sha256: f.sha256 });
export function compareEvidenceFacts(fixed: CurrentCostEvidence, current: CurrentCostEvidence, oldExpenses: CostExpense[], nowExpenses: CostExpense[]) {
  if (fixed.period.id !== current.period.id || fixed.period.siteId !== current.period.siteId) throw new HttpError(409, "비교 월 출처 불일치");
  for (const item of fixed.items) if (JSON.stringify(item.file) !== JSON.stringify(current.items.find(i => i.file.id === item.file.id)?.file)) throw new HttpError(409, "불변 원본 메타데이터 불일치");
  const before = references(fixed, oldExpenses), after = references(current, nowExpenses);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  if (keys.length > 2000) throw new HttpError(409, "참조 합집합 한도 초과");
  const addedReferences = [], removedReferences = [], changedReferences = [];
  for (const key of keys) {
    const a = before.get(key), b = after.get(key);
    if (!a) addedReferences.push(b!);
    else if (!b) removedReferences.push(a);
    else {
      const sourceReselected = a.sourceHash !== b.sourceHash, currentExpenseChanged = JSON.stringify(a.expense) !== JSON.stringify(b.expense);
      if (sourceReselected || currentExpenseChanged) changedReferences.push({ before: a, after: b, sourceReselected, currentExpenseChanged });
    }
  }
  return { addedOriginals: current.items.filter(i => !fixed.items.some(o => o.file.id === i.file.id)).map(i => fileFact(i.file)).sort((a,b) => a.id.localeCompare(b.id)), addedReferences, removedReferences, changedReferences };
}
export function boundedComparisonJson(value: unknown) {
  const json = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(json) > COST_EVIDENCE_MANIFEST_BYTES) throw new HttpError(409, "비교 출력 4MiB 한도입니다. 전체 출력을 중단합니다. 기존 고정 목록과 개별 기록을 확인하세요. 과거 기록을 바꾸거나 일부만 내보내지 않습니다.");
  return json;
}
export function buildEvidenceComparison(db: Db, site: string, id: string, selection: EvidenceComparisonSelector) {
  const period = getCostPeriod(db, site, id);
  const unavailable = (state: "not_recorded" | "unavailable") => ({ state, selection, fingerprint: null, changes: null, queriedAt: new Date().toISOString(), reason: state === "not_recorded" ? "과거 고정 증빙 목록 미기록: 빈 목록이나 차이 없음이 아닙니다." : "출처 무결성 또는 전체 읽기 한도로 비교 불가: 차이를 0으로 계산하지 않습니다." });
  try {
    const baseline = "baselineId" in selection ? baselineView(db, site, id, selection.baselineId) : null;
    const closureId = "closureId" in selection ? selection.closureId : baseline!.body.closureId;
    const fixed = fixedCostEvidence(db, site, id, closureId);
    if (!fixed.recorded) return unavailable("not_recorded");
    const row = db.prepare("SELECT body FROM cost_closures WHERE id=? AND period_id=?").get(closureId,id) as { body: string };
    const closure = JSON.parse(row.body) as CostSnapshot;
    const current = currentCostEvidence(db, site, id), expenses = costExpenses(db, id);
    boundedComparisonJson(current);
    const changes = compareEvidenceFacts(fixed.snapshot.evidence, current, closure.expenses, expenses);
    const source = { closureId, closureHash: fixed.closureHash, sidecarHash: fixed.hash, baselineId: baseline?.id ?? null, baselineHash: baseline?.hash ?? null, closedAt: closure.closedAt, periodVersion: closure.period.version, evidenceVersion: fixed.snapshot.evidence.evidenceVersion };
    const now = { ...current.period, currentCloseId: period.current_close_id, evidenceVersion: current.evidenceVersion, originals: current.items.map(i => fileFact(i.file)), evidenceHistoryChanged: fixed.snapshot.evidence.evidenceVersion !== current.evidenceVersion };
    const fingerprint = journalHash({ selection, source, current, currentCloseId: period.current_close_id, expenses: expenses.map(e => ({ id:e.id, ...expenseFact(e) })) });
    return { state: "ready" as const, schemaVersion: 1, selection, source, current: now, fingerprint, queriedAt: new Date().toISOString(), scope: "stored-metadata-and-active-references-only; no-blob-rehash-no-proof-validation-no-allocation", changes };
  } catch (e) {
    if (e instanceof HttpError && [403,404].includes(e.status)) throw e;
    if (e instanceof HttpError || e instanceof SyntaxError || e instanceof TypeError) return unavailable("unavailable");
    throw e;
  }
}
export type EvidenceComparison = ReturnType<typeof buildEvidenceComparison>;
