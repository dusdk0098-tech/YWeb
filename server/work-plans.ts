import { validatePacketReferences, resetPacketBodyJson } from "./work-plan-packet.js";
import { fixedWorkPlanAttachments } from "./work-plan-attachment-model.js";
import { preventPendingPlanRevision } from "./work-plan-review-model.js";
import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { inspectionPage } from "./inspection-validation.js";
import { account } from "./inspection-model.js";
import {
  workPlanCreate,
  workPlanEdit,
  workPlanVersion,
  workPlanRevision,
  completePlan,
} from "./work-plan-validation.js";
import {
  getWorkPlan,
  fullWorkPlan,
  workPlanRecord,
  type WorkPlanRow,
  type WorkPlanSnapshot,
} from "./work-plan-model.js";
import { capturePlanSources, planSourceFacts } from "./work-plan-sources.js";
import { journalHash } from "./daily-journal-sources.js";
import { printWorkPlan } from "./work-plan-print.js";
export function registerWorkPlans(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/work-plans";
  function eligible(site: string, user: string) {
    if (
      !db
        .prepare(
          "SELECT 1 FROM memberships WHERE site_id=? AND user_id=? AND role IN('manager','editor')",
        )
        .get(site, user)
    )
      throw new HttpError(400, "현재 이 현장의 작성 가능한 계정을 지정하세요.");
  }
  function author(req: Request, row: WorkPlanRow) {
    access(req, true);
    if (row.author_id !== req.session.userId)
      throw new HttpError(
        403,
        "초안 작성 계정만 수정/참조 취합할 수 있습니다.",
      );
  }
  function expected(row: WorkPlanRow, v: number, status = "draft") {
    if (row.version !== v || row.status !== status)
      throw new HttpError(
        409,
        "작업계획 상태/버전이 변경되었습니다. 최신본을 다시 여세요.",
      );
  }
  function event(req: Request, row: WorkPlanRow, kind: string, note: string) {
    const actor = account(db, req.session.userId!);
    db.prepare(
      "INSERT INTO work_plan_events(plan_id,version,event,actor_id,actor_name,at,note) VALUES(?,?,?,?,?,?,?)",
    ).run(
      row.id,
      row.version,
      kind,
      actor.id,
      actor.name,
      row.updated_at,
      note,
    );
    audit(db, actor.id, row.site_id, "work_plan." + kind, row.id);
    return fullWorkPlan(db, row);
  }
  app.get(base, (req, res) => {
    access(req);
    const q = inspectionPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM work_plans WHERE site_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
        )
        .all(String(req.params.siteId), q.offset) as WorkPlanRow[];
    res.json({
      items: rows.slice(0, 50).map(workPlanRecord),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/authors", (req, res) => {
    access(req, true, true);
    const q = inspectionPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.site_id=? AND m.role IN('editor','manager') ORDER BY u.name,u.id LIMIT 51 OFFSET ?",
        )
        .all(String(req.params.siteId), q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post(base, (req, res) => {
    access(req, true);
    const v = workPlanCreate.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      "work_plan:create:" + site,
      v,
      () => {
        planSourceFacts(db, site, v.body);
        const id = randomUUID(),
          now = new Date().toISOString();
        validatePacketReferences(db,id,v.body);
        db.prepare(
          "INSERT INTO work_plans VALUES(?,?,?,'draft',1,?,NULL,'',NULL,?,?)",
        ).run(id, site, JSON.stringify(v.body), req.session.userId!, now, now);
        return event(
          req,
          getWorkPlan(db, site, id),
          "created",
          "참조 취합 전 초안",
        );
      },
      () => {
        access(req, true);
      },
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(
      fullWorkPlan(
        db,
        getWorkPlan(db, String(req.params.siteId), String(req.params.id)),
      ),
    );
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true);
    const site = String(req.params.siteId),
      id = String(req.params.id);
    author(req, getWorkPlan(db, site, id));
    const v = workPlanEdit.parse(req.body);
    mutate(
      req,
      res,
      `work_plan:edit:${site}:${id}`,
      v,
      () => {
        const row = getWorkPlan(db, site, id);
        author(req, row);
        expected(row, v.version);
        if ((workPlanRecord(row).body.documentForm?.kind ?? null) !== (v.body.documentForm?.kind ?? null)) throw new HttpError(409, "저장된 작업계획 형식은 변경할 수 없습니다. 별도 새 초안을 작성하세요.");
        planSourceFacts(db, site, v.body);
        validatePacketReferences(db,id,v.body);
        db.prepare(
          "UPDATE work_plans SET body=?,source_capture=NULL,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(v.body), new Date().toISOString(), id);
        return event(
          req,
          getWorkPlan(db, site, id),
          "updated",
          "본문 저장으로 참조 취합 초기화",
        );
      },
      () => {
        author(req, getWorkPlan(db, site, id));
      },
    );
  });
  app.post(base + "/:id/capture", (req, res) => {
    access(req, true);
    const site = String(req.params.siteId),
      id = String(req.params.id);
    author(req, getWorkPlan(db, site, id));
    const v = workPlanVersion.parse(req.body);
    mutate(
      req,
      res,
      `work_plan:capture:${site}:${id}`,
      v,
      () => {
        const row = getWorkPlan(db, site, id);
        author(req, row);
        expected(row, v.version);
        const source = capturePlanSources(db, site, workPlanRecord(row).body);
        db.prepare(
          "UPDATE work_plans SET source_capture=?,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(source), new Date().toISOString(), id);
        return event(
          req,
          getWorkPlan(db, site, id),
          "captured",
          source.fingerprint,
        );
      },
      () => {
        author(req, getWorkPlan(db, site, id));
      },
    );
  });
  app.post(base + "/:id/archive", (req, res) => {
    access(req, true, true);
    const site = String(req.params.siteId),
      id = String(req.params.id),
      v = workPlanVersion.parse(req.body);
    eligible(site, getWorkPlan(db, site, id).author_id);
    mutate(
      req,
      res,
      `work_plan:archive:${site}:${id}`,
      v,
      () => {
        const row = getWorkPlan(db, site, id);
        expected(row, v.version);
        eligible(site, row.author_id);
        const record = workPlanRecord(row);
        if (!completePlan(record.body))
          throw new HttpError(
            400,
            "보관하려면 위치/작업설명/비상절차와1개 이상 단계의 작업·절차·주의사항을 입력하세요.",
          );
        validatePacketReferences(db,id,record.body);
        const source = record.source_capture;
        if (
          !source ||
          source.facts.siteId !== site ||
          journalHash(source.facts) !== source.fingerprint ||
          journalHash(planSourceFacts(db, site, record.body)) !==
            source.fingerprint
        )
          throw new HttpError(
            409,
            "선택 참조가 없거나 변경되었습니다. 작성자가 명부·장비 선택을 확인하고 참조 정보를 다시 취합하세요.",
          );
        const now = new Date().toISOString(),
          snapshot: WorkPlanSnapshot = {
            id,
            version: row.version + 1,
            site: {
              id: site,
              name: (
                db.prepare("SELECT name FROM sites WHERE id=?").get(site) as {
                  name: string;
                }
              ).name,
            },
            author: account(db, row.author_id),
            parentId: row.parent_id,
            revisionReason: row.revision_reason,
            body: record.body,
            source,
            archivedBy: account(db, req.session.userId!),
            archivedAt: now,
            attachmentManifest:fixedWorkPlanAttachments(db,id),
          };
        db.prepare(
          "UPDATE work_plans SET status='archived',version=version+1,updated_at=? WHERE id=?",
        ).run(now, id);
        db.prepare("INSERT INTO work_plan_snapshots VALUES(?,?,?)").run(
          id,
          JSON.stringify(snapshot),
          journalHash(snapshot),
        );
        return event(
          req,
          getWorkPlan(db, site, id),
          "archived",
          "관리자 기록 보관; 작업허가/선임 아님",
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/revise", (req, res) => {
    access(req, true, true);
    const site = String(req.params.siteId),
      id = String(req.params.id),
      v = workPlanRevision.parse(req.body);
    eligible(site, v.authorId);
    mutate(
      req,
      res,
      `work_plan:revise:${site}:${id}`,
      v,
      () => {
        const row = getWorkPlan(db, site, id);
        expected(row, v.version, "archived");
        preventPendingPlanRevision(db,id);
        eligible(site, v.authorId);
        if (db.prepare("SELECT 1 FROM work_plans WHERE parent_id=?").get(id))
          throw new HttpError(409, "이미 연결 정정 초안이 있습니다.");
        const child = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO work_plans VALUES(?,?,?,'draft',1,?,?,?,NULL,?,?)",
        ).run(child, site, resetPacketBodyJson(row.body), v.authorId, id, v.reason, now, now);
        return event(
          req,
          getWorkPlan(db, site, child),
          "revision_created",
          v.reason,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req);
    const row = getWorkPlan(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      q = inspectionPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM work_plan_events WHERE plan_id=? ORDER BY version LIMIT 51 OFFSET ?",
        )
        .all(row.id, q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get(base + "/:id/print", (req, res) => {
    access(req);
    const site = String(req.params.siteId),
      row = getWorkPlan(db, site, String(req.params.id)),
      record = fullWorkPlan(db, row);
    if (row.status === "archived" && !record.snapshot)
      throw new HttpError(409, "보관본을 찾을 수 없습니다.");
    if (record.snapshot) {
      const s = record.snapshot;
      if (
        journalHash(s.body) !== s.hash ||
        s.body.id !== row.id ||
        s.body.version !== row.version ||
        s.body.source.facts.siteId !== site ||
        s.body.site.id !== site ||
        journalHash(s.body.source.facts) !== s.body.source.fingerprint
      )
        throw new HttpError(409, "보관본 해시/출처가 일치하지 않습니다.");
      return res.type("html").send(printWorkPlan(s.body, s.hash));
    }
    res.type("html").send(
      printWorkPlan(
        {
          id: row.id,
          version: row.version,
          site: {
            id: site,
            name: (
              db.prepare("SELECT name FROM sites WHERE id=?").get(site) as {
                name: string;
              }
            ).name,
          },
          author: account(db, row.author_id),
          body: record.body,
          ...((record.body.documentPacket||record.body.plateLoadReports||record.body.liftingDetail)?{attachmentManifest:fixedWorkPlanAttachments(db,row.id)}:{}),
          source: record.source_capture,
          parentId: row.parent_id,
          revisionReason: row.revision_reason,
        },
        null,
      ),
    );
  });
}
