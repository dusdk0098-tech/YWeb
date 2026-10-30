import { captureDailyInspections,type FixedDailyInspection,type DailyInspectionSelection } from "./daily-inspection-references.js";
import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import type { TbmSnapshot } from "./tbm.js";
export const journalHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type DailySourceFacts = {
  inspectionReferences?: FixedDailyInspection[];
  siteId: string;
  date: string;
  attendance: {
    presentWorkers: number;
    presentVisitors: number;
    cancelledRecords: number;
    totalRecords: number;
    revisionHash: string;
  };
  tbm: {
    id: string;
    title: string;
    hash: string;
    parentId: string | null;
    successor: {
      id: string;
      status: string;
      date: string;
      hash: string | null;
    } | null;
  }[];
};
export type DailyCapture = {
  facts: DailySourceFacts;
  fingerprint: string;
  capturedAt: string;
  capturedBy: { id: string; name: string };
};
// Called within the journal mutation transaction; only factual same-site/day source inputs.
export function dailySourceFacts(
  db: Db,
  site: string,
  date: string,
  inspections?: DailyInspectionSelection,
): DailySourceFacts {
  const attendance = db
    .prepare(
      "SELECT id,version,status,kind FROM attendance WHERE site_id=? AND date=? ORDER BY id LIMIT 2001",
    )
    .all(site, date) as {
    id: string;
    version: number;
    status: string;
    kind: string;
  }[];
  if (attendance.length > 2000)
    throw new HttpError(
      400,
      "해당일 출역 기록이2,000건을 넘어 참조를 만들 수 없습니다. 누락 없이 별도 검토가 필요합니다.",
    );
  const snapshots = db
    .prepare(
      "SELECT s.id,p.body,p.hash FROM tbm_sessions s JOIN tbm_snapshots p ON p.session_id=s.id WHERE s.site_id=? AND s.status='finalized' AND json_extract(p.body,'$.details.date')=? ORDER BY s.id LIMIT 201",
    )
    .all(site, date) as { id: string; body: string; hash: string }[];
  if (snapshots.length > 200)
    throw new HttpError(
      400,
      "해당일 TBM 확정 버전이200건을 넘어 참조를 만들 수 없습니다.",
    );
  const tbm = snapshots.map((row) => {
    const snapshot = JSON.parse(row.body) as TbmSnapshot;
    const child = db
      .prepare(
        "SELECT s.id,s.status,json_extract(s.body,'$.date') AS date,p.hash FROM tbm_sessions s LEFT JOIN tbm_snapshots p ON p.session_id=s.id WHERE s.site_id=? AND s.parent_id=?",
      )
      .get(site, row.id) as
      | { id: string; status: string; date: string; hash: string | null }
      | undefined;
    return {
      id: row.id,
      title: snapshot.details.title,
      hash: row.hash,
      parentId: snapshot.parentId,
      successor: child || null,
    };
  });
  return {
    siteId: site,
    date,
    attendance: {
      presentWorkers: attendance.filter(
        (a) => a.status === "present" && a.kind === "worker",
      ).length,
      presentVisitors: attendance.filter(
        (a) => a.status === "present" && a.kind === "visitor",
      ).length,
      cancelledRecords: attendance.filter((a) => a.status === "cancelled")
        .length,
      totalRecords: attendance.length,
      revisionHash: journalHash(attendance),
    },
    tbm,
    ...(inspections===undefined?{}:{inspectionReferences:captureDailyInspections(db,site,date,inspections)}),
  };
}
