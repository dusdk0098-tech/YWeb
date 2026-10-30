import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
import { journalMonth, buildMonthlyReport, type MonthlyJournalReport } from "./daily-monthly-report.js";
export const monthlyRecordCreate = z.object({
  month: journalMonth,
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedLatestId: z.uuid().nullable(),
  reason: z.string().trim().min(1).max(1000),
  acknowledgeIncomplete: z.literal(true),
}).strict();
export type MonthlyRecordBody = {
  schema: 1;
  id: string;
  number: number;
  parentId: string | null;
  parentHash: string | null;
  report: MonthlyJournalReport;
  actor: { id: string; name: string };
  recordedAt: string;
  reason: string;
  kind: "saved-month-view-not-approval";
};
export type MonthlyRecord = { body: MonthlyRecordBody; hash: string };
export function serializeMonthlyRecord(body: MonthlyRecordBody) {
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new HttpError(409, "월간 고정 기록 4MiB 한도를 넘었습니다.");
  return text;
}
export function latestMonthlyRecord(db: Db, site: string, month: string) {
  return db.prepare("SELECT id,number,hash FROM daily_monthly_records WHERE site_id=? AND month=? ORDER BY number DESC LIMIT 1").get(site, month) as {id:string;number:number;hash:string}|undefined;
}
export function fixedMonthlyRecord(db: Db, site: string, id: string): MonthlyRecord {
  const row = db.prepare("SELECT * FROM daily_monthly_records WHERE site_id=? AND id=?").get(site,id) as {id:string;site_id:string;month:string;number:number;parent_id:string|null;body:string;hash:string;created_at:string}|undefined;
  if (!row) throw new HttpError(404,"월간 고정 기록을 찾을 수 없습니다.");
  const body = JSON.parse(row.body) as MonthlyRecordBody;
  const { fingerprint, site: reportSite, month, calendarDays, counts, days } = body.report;
  const facts = { site: reportSite, month, calendarDays, counts, days };
  if (Buffer.byteLength(row.body)>4*1024*1024 || body.schema!==1 || body.id!==row.id || body.number!==row.number || body.parentId!==row.parent_id || body.recordedAt!==row.created_at || body.report.site.id!==site || body.report.month!==row.month || body.kind!=="saved-month-view-not-approval" || journalHash(body)!==row.hash || journalHash(facts)!==fingerprint)
    throw new HttpError(409,"월간 고정 기록의 해시/출처가 일치하지 않습니다.");
  if (body.parentId) {
    const parent=db.prepare("SELECT hash FROM daily_monthly_records WHERE id=? AND site_id=? AND month=? AND number=?").get(body.parentId,site,row.month,row.number-1) as {hash:string}|undefined;
    if (!parent || parent.hash!==body.parentHash) throw new HttpError(409,"이전 월간 기록 연결이 일치하지 않습니다.");
  } else if (body.number!==1 || body.parentHash!==null) throw new HttpError(409,"최초 월간 기록 연결이 일치하지 않습니다.");
  return {body,hash:row.hash};
}
// Caller supplies a read or mutation transaction. No nested transaction, no source updates.
export function compareMonthlyRecord(db: Db, record: MonthlyRecord) {
  try {
    const current=buildMonthlyReport(db,record.body.report.site.id,record.body.report.month);
    return {status:current.fingerprint===record.body.report.fingerprint?"unchanged" as const:"changed" as const,currentFingerprint:current.fingerprint,comparedAt:current.generatedAt};
  } catch {
    return {status:"unavailable" as const,currentFingerprint:null,comparedAt:new Date().toISOString()};
  }
}
