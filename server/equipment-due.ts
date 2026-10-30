import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import type { SiteOperations } from "./site-operations.js";
import { date, revision } from "./validation.js";
import { equipmentPage } from "./equipment-validation.js";
import {
  getEquipment,
  equipmentExpected,
  equipmentRecord,
  type EquipmentRow,
} from "./equipment-model.js";
import { equipmentEvent } from "./equipment-event.js";
import { escapeHtml as h } from "./print.js";
export const equipmentDueBody = z
  .object({
    nextInspectionDate: date.nullable(),
    insuranceRecordedUntil: date.nullable(),
    sourceNote: z.string().trim().max(1000),
  })
  .strict();
export type EquipmentDueBody = z.infer<typeof equipmentDueBody>;
const edit = z
  .object({
    version: revision,
    reason: z.string().trim().min(1).max(1000),
    body: equipmentDueBody,
  })
  .strict();
const asOf = z.object({ asOfDate: date }).strict(),
  filter = equipmentPage.extend(asOf.shape);
export function compareEnteredDate(
  value: string | null | undefined,
  day: string,
) {
  return !value
    ? "not_recorded"
    : value < day
      ? "before_reference"
      : value === day
        ? "on_reference"
        : "after_reference";
}
export function equipmentDueView(row: EquipmentRow, day: string) {
  const record = equipmentRecord(row);
  return {
    equipment: record,
    asOfDate: day,
    inspection: compareEnteredDate(record.dueMetadata?.nextInspectionDate, day),
    insurance: compareEnteredDate(
      record.dueMetadata?.insuranceRecordedUntil,
      day,
    ),
  };
}
export const dueLabel = (state: string) =>
  ({
    not_recorded: "미입력",
    before_reference: "입력된 기한 경과",
    on_reference: "기준일과 같은 날짜",
    after_reference: "기준일 이후 예정",
  })[state] || "미입력";
export function registerEquipmentDue(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  app.get("/api/sites/:siteId/equipment-due", (req, res) => {
    access(req);
    const q = filter.parse(req.query),
      rows = db
        .prepare(
          "SELECT e.*,d.body AS due_metadata FROM equipment e LEFT JOIN equipment_due d ON d.equipment_id=e.id WHERE e.site_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 51 OFFSET ?",
        )
        .all(String(req.params.siteId), q.offset) as EquipmentRow[];
    res.json({
      items: rows.slice(0, 50).map((r) => equipmentDueView(r, q.asOfDate)),
      hasMore: rows.length > 50,
      asOfDate: q.asOfDate,
    });
  });
  const base = "/api/sites/:siteId/equipment/:id/due-metadata";
  app.get(base, (req, res) => {
    access(req);
    const q = asOf.parse(req.query);
    res.json(
      equipmentDueView(
        getEquipment(db, String(req.params.siteId), String(req.params.id)),
        q.asOfDate,
      ),
    );
  });
  app.put(base, (req, res) => {
    access(req, true, true);
    const v = edit.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `equipment:due:${site}:${id}`,
      v,
      () => {
        const row = getEquipment(db, site, id);
        equipmentExpected(row, v.version);
        db.prepare(
          "INSERT INTO equipment_due(equipment_id,body) VALUES(?,?) ON CONFLICT(equipment_id) DO UPDATE SET body=excluded.body",
        ).run(id, JSON.stringify(v.body));
        db.prepare(
          "UPDATE equipment SET version=version+1,updated_at=? WHERE id=?",
        ).run(new Date().toISOString(), id);
        equipmentEvent(db, req, id, "due_metadata", v.reason);
        return equipmentRecord(getEquipment(db, site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/print", (req, res) => {
    access(req);
    const q = asOf.parse(req.query),
      view = equipmentDueView(
        getEquipment(db, String(req.params.siteId), String(req.params.id)),
        q.asOfDate,
      ),
      r = view.equipment,
      b = r.dueMetadata;
    res
      .type("html")
      .send(
        `<!doctype html><html lang="ko"><meta charset="utf-8"><title>장비 수기 기한 메모</title><link rel="stylesheet" href="/print.css"><h1>장비 수기 기한 메모</h1><p>${h(r.body.name)} · ID ${h(r.id)} · v${r.version} · ${h(r.status)}</p><p>사용자 선택 비교 기준일 ${h(q.asOfDate)}. 날짜 비교는 검사 합격·보험 유효·운행 가능 판단이 아닙니다.</p><p>입력한 검사 예정일: ${h(b?.nextInspectionDate || "미입력")} · ${h(dueLabel(view.inspection))}</p><p>보험 기록상 종료일: ${h(b?.insuranceRecordedUntil || "미입력")} · ${h(dueLabel(view.insurance))}</p><p>수기 출처 메모: ${h(b?.sourceNote || "미기록")}</p><p>현재 조회 정보이며 별도 인증/마감본이 아닙니다. 입력 변경 이력은 장비 등록 대장에 보존됩니다.</p></html>`,
      );
  });
}
