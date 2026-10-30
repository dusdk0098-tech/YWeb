import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  getInspection,
  inspectionRecord,
  account,
  checkVersion,
  type InspectionSnapshot,
  type InspectionReview,
} from "./inspection-model.js";
import { inspectionVersion } from "./inspection-validation.js";
import { createHazardDraft } from "./hazard-write.js";
import type { HazardRow, HazardStatus } from "./hazard-model.js";
export type InspectionSource = {
  inspectionId: string;
  inspectionVersion: number;
  templateId: string;
  templateVersion: number;
  templateTitle: string;
  siteName: string;
  date: string;
  location: string;
  item: { id: string; text: string; result: "fail"; comment: string };
  submitter: InspectionSnapshot["submitter"];
  submittedAt: string;
  review: InspectionReview;
  linkedBy: { id: string; name: string };
  linkedAt: string;
};
export type InspectionLink = {
  id: string;
  site_id: string;
  inspection_id: string;
  item_id: string;
  hazard_id: string;
  snapshot: InspectionSource;
  created_by: string;
  created_at: string;
  hazard_status: HazardStatus;
};
type LinkRow = Omit<InspectionLink, "snapshot"> & { snapshot: string };
const record = (r: LinkRow): InspectionLink => ({
  ...r,
  snapshot: JSON.parse(r.snapshot) as InspectionSource,
});
export function inspectionLinks(db: Db, site: string, id: string) {
  return (
    db
      .prepare(
        "SELECT l.*,h.status AS hazard_status FROM inspection_hazard_links l JOIN hazard_reports h ON h.id=l.hazard_id AND h.site_id=l.site_id WHERE l.site_id=? AND l.inspection_id=? ORDER BY l.created_at,l.id",
      )
      .all(site, id) as LinkRow[]
  ).map(record);
}
export function hazardInspectionSource(db: Db, site: string, id: string) {
  const r = db
    .prepare(
      "SELECT l.*,h.status AS hazard_status FROM inspection_hazard_links l JOIN hazard_reports h ON h.id=l.hazard_id AND h.site_id=l.site_id WHERE l.site_id=? AND l.hazard_id=?",
    )
    .get(site, id) as LinkRow | undefined;
  return r ? record(r) : null;
}
export function registerInspectionLinkRoutes(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/inspections/:id/hazard-links";
  app.get(base, (req, res) => {
    access(req);
    const site = String(req.params.siteId),
      id = String(req.params.id);
    getInspection(db, site, id);
    res.json(inspectionLinks(db, site, id));
  });
  app.get("/api/sites/:siteId/hazards/:id/inspection-source", (req, res) => {
    access(req);
    const site = String(req.params.siteId),
      id = String(req.params.id);
    if (
      !db
        .prepare("SELECT id FROM hazard_reports WHERE site_id=? AND id=?")
        .get(site, id)
    )
      throw new HttpError(404, "신고 기록을 찾을 수 없습니다.");
    res.json(hazardInspectionSource(db, site, id));
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const site = String(req.params.siteId),
      id = String(req.params.id);
    const v = inspectionVersion.extend({ itemId: z.uuid() }).parse(req.body);
    // Check current source visibility before idempotent replay; manager gate above is also current.
    getInspection(db, site, id);
    mutate(
      req,
      res,
      `inspection:hazard-link:${site}:${id}`,
      v,
      () => {
        const source = getInspection(db, site, id);
        checkVersion(source, v.version, "accepted");
        const normalized = inspectionRecord(source),
          s = normalized.submitted_snapshot;
        if (!s || !normalized.review)
          throw new HttpError(409, "검토 수락된 제출 원문이 필요합니다.");
        const item = s.template.body.items.find((i) => i.id === v.itemId),
          answer = s.body.answers.find((a) => a.itemId === v.itemId);
        if (!item || answer?.result !== "fail")
          throw new HttpError(
            400,
            "이 점검의 부적합 항목만 신고 초안으로 연결할 수 있습니다.",
          );
        if (
          db
            .prepare(
              "SELECT id FROM inspection_hazard_links WHERE inspection_id=? AND item_id=?",
            )
            .get(id, v.itemId)
        )
          throw new HttpError(
            409,
            "이미 연결된 신고가 있습니다. 연결 목록에서 기존 신고를 여세요.",
          );
        const now = new Date().toISOString(),
          actor = account(db, req.session.userId!),
          snapshot: InspectionSource = {
            inspectionId: id,
            inspectionVersion: source.version,
            templateId: s.template.id,
            templateVersion: s.template.version,
            templateTitle: s.template.body.title,
            siteName: s.template.siteName,
            date: s.body.date,
            location: s.body.location,
            item: {
              id: item.id,
              text: item.text,
              result: "fail",
              comment: answer.comment,
            },
            submitter: s.submitter,
            submittedAt: s.submittedAt,
            review: normalized.review,
            linkedBy: actor,
            linkedAt: now,
          };
        const report: HazardRow = createHazardDraft(
          db,
          site,
          actor.id,
          {
            title: `점검 부적합: ${s.template.body.title}`.slice(0, 200),
            observedDate: s.body.date,
            location: s.body.location,
            description: `항목: ${item.text}\n점검 당시 설명: ${answer.comment}\n원 점검 ID: ${id}\n신고 내용은 제출 전에 다시 확인하세요.`,
          },
          `점검 ${id} 항목 ${item.id}에서 명시적으로 생성한 초안`,
        );
        const linkId = randomUUID();
        db.prepare(
          "INSERT INTO inspection_hazard_links VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          linkId,
          site,
          id,
          item.id,
          report.id,
          JSON.stringify(snapshot),
          actor.id,
          now,
        );
        audit(db, actor.id, site, "inspection.hazard_link_created", linkId);
        return hazardInspectionSource(db, site, report.id);
      },
      () => {
        access(req, true, true);
        getInspection(db, site, id);
      },
    );
  });
}
