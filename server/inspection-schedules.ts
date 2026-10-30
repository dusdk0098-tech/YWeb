import { assertInspectionNewUse, inspectionSelection } from "./inspection-use.js";
import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { date, revision } from "./validation.js";
import {
  getTemplate,
  getInspection,
  inspectionRecord,
  account,
  checkVersion,
} from "./inspection-model.js";
import { inspectionPage } from "./inspection-validation.js";
import { createInspectionDraft } from "./inspection-write.js";
import {
  getTask,
  taskRecord,
  taskChain,
  inspectionTaskSource,
  type InspectionTaskRow,
  type TaskSource,
} from "./inspection-schedule-model.js";
import { printInspectionTask } from "./inspection-schedule-print.js";
const bodySchema = z
  .object({
    plannedDate: date,
    location: z.string().trim().min(1).max(300),
    instructions: z.string().trim().max(3000),
  })
  .strict();
const createSchema = z
  .object({ templateId: z.uuid(), assigneeId: z.uuid(), body: bodySchema,...inspectionSelection })
  .strict();
const editSchema = z
  .object({
    version: revision,
    assigneeId: z.uuid(),
    body: bodySchema,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const cancelSchema = z
  .object({ version: revision, reason: z.string().trim().min(1).max(1000) })
  .strict();
export function registerInspectionSchedules(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/inspection-tasks";
  function eligible(site: string, id: string) {
    const r = db
      .prepare(
        "SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.site_id=? AND u.id=? AND m.role IN ('editor','manager')",
      )
      .get(site, id) as { id: string; name: string } | undefined;
    if (!r)
      throw new HttpError(400, "담당자는 현재 현장 작성자/관리자여야 합니다.");
    return r;
  }
  function event(
    req: Request,
    row: InspectionTaskRow,
    type: string,
    reason: string,
  ) {
    const a = account(db, req.session.userId!);
    db.prepare(
      "INSERT INTO inspection_task_events(task_id,version,event,reason,actor_id,actor_name,at,snapshot) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      row.id,
      row.version,
      type,
      reason,
      a.id,
      a.name,
      row.updated_at,
      JSON.stringify(taskRecord(row)),
    );
    audit(db, a.id, row.site_id, "inspection_task." + type, row.id);
  }
  function response(row: InspectionTaskRow) {
    return { record: taskRecord(row), chain: taskChain(db, row) };
  }
  function assigned(req: Request) {
    access(req, true);
    const row = getTask(db, String(req.params.siteId), String(req.params.id));
    if (row.assignee_id !== req.session.userId)
      throw new HttpError(403, "현재 배정 계정만 점검을 시작할 수 있습니다.");
    eligible(row.site_id, req.session.userId!);
    if (row.status === "cancelled")
      throw new HttpError(409, "취소된 일정입니다.");
    return row;
  }
  app.get(base, (req, res) => {
    access(req);
    const q = inspectionPage
      .extend({
        status: z.enum(["planned", "started", "cancelled"]).optional(),
      })
      .parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM inspection_tasks WHERE site_id=? AND (? IS NULL OR status=?) ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?",
      )
      .all(
        String(req.params.siteId),
        q.status || null,
        q.status || null,
        q.offset,
      ) as InspectionTaskRow[];
    res.json({
      items: rows.slice(0, 50).map(taskRecord),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/assignees", (req, res) => {
    access(req, true, true);
    res.json(
      db
        .prepare(
          "SELECT u.id,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.site_id=? AND m.role IN ('manager','editor') ORDER BY u.name,u.id",
        )
        .all(String(req.params.siteId)),
    );
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = createSchema.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `inspection-task:create:${site}`,
      v,
      () => {
        eligible(site, v.assigneeId);
        const template = getTemplate(db, site, v.templateId);
        assertInspectionNewUse(db,template,v);
        if (template.status !== "published" || !template.published_snapshot)
          throw new HttpError(
            409,
            "게시된 양식 버전만 일정에 고정할 수 있습니다.",
          );
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO inspection_tasks VALUES(?,?,?,?,?,?,'planned',1,NULL,?,?,?)",
        ).run(
          id,
          site,
          template.id,
          template.published_snapshot,
          JSON.stringify(v.body),
          v.assigneeId,
          req.session.userId!,
          now,
          now,
        );
        const row = getTask(db, site, id);
        event(req, row, "created", "수기 점검 일정 생성");
        return response(row);
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(
      response(getTask(db, String(req.params.siteId), String(req.params.id))),
    );
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true, true);
    const v = editSchema.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `inspection-task:edit:${site}:${id}`,
      v,
      () => {
        const row = getTask(db, site, id);
        checkVersion(row, v.version, "planned");
        eligible(site, v.assigneeId);
        db.prepare(
          "UPDATE inspection_tasks SET body=?,assignee_id=?,version=version+1,updated_at=? WHERE id=?",
        ).run(
          JSON.stringify(v.body),
          v.assigneeId,
          new Date().toISOString(),
          id,
        );
        const next = getTask(db, site, id);
        event(req, next, "updated", v.reason);
        return response(next);
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/cancel", (req, res) => {
    access(req, true, true);
    const v = cancelSchema.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `inspection-task:cancel:${site}:${id}`,
      v,
      () => {
        const row = getTask(db, site, id);
        checkVersion(row, v.version, "planned");
        db.prepare(
          "UPDATE inspection_tasks SET status='cancelled',version=version+1,updated_at=? WHERE id=?",
        ).run(new Date().toISOString(), id);
        const next = getTask(db, site, id);
        event(req, next, "cancelled", v.reason);
        return response(next);
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/start", (req, res) => {
    assigned(req);
    const v = z.object({ version: revision }).strict().parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `inspection-task:start:${site}:${id}`,
      v,
      () => {
        const row = assigned(req);
        checkVersion(row, v.version, "planned");
        const t = taskRecord(row),
          a = account(db, req.session.userId!);
        const inspectionId = createInspectionDraft(
          db,
          site,
          row.template_id,
          row.template_snapshot,
          a.id,
          {
            date: t.body.plannedDate,
            location: t.body.location,
            performedBy: "",
            answers: t.template_snapshot.body.items.map((item) => ({
              itemId: item.id,
              result: "pending",
              comment: "",
            })),
          },
          null,
        );
        const now = new Date().toISOString();
        const source: TaskSource = {
          task: t,
          assignee: eligible(site, row.assignee_id),
          startedBy: a,
          startedAt: now,
        };
        db.prepare("INSERT INTO inspection_task_links VALUES(?,?,?)").run(
          inspectionId,
          id,
          JSON.stringify(source),
        );
        db.prepare(
          "INSERT INTO inspection_events(inspection_id,version,event,actor_id,actor_name,at,note) VALUES(?,1,'scheduled_draft_created',?,?,?,?)",
        ).run(
          inspectionId,
          a.id,
          a.name,
          now,
          `수기 일정 ${id}에서 명시적 초안 시작`,
        );
        db.prepare(
          "UPDATE inspection_tasks SET status='started',version=version+1,root_inspection_id=?,updated_at=? WHERE id=?",
        ).run(inspectionId, now, id);
        const next = getTask(db, site, id);
        event(req, next, "started", "배정 계정이 명시적으로 점검 초안 시작");
        return {
          ...response(next),
          inspection: inspectionRecord(getInspection(db, site, inspectionId)),
        };
      },
      () => {
        assigned(req);
      },
    );
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req);
    const row = getTask(db, String(req.params.siteId), String(req.params.id)),
      q = inspectionPage.parse(req.query);
    const events = db
      .prepare(
        "SELECT * FROM inspection_task_events WHERE task_id=? ORDER BY version LIMIT 51 OFFSET ?",
      )
      .all(row.id, q.offset) as { snapshot: string }[];
    res.json({
      items: events
        .slice(0, 50)
        .map((e) => ({ ...e, snapshot: JSON.parse(e.snapshot) })),
      hasMore: events.length > 50,
    });
  });
  app.get(base + "/:id/print", (req, res) => {
    access(req);
    const row = getTask(db, String(req.params.siteId), String(req.params.id));
    const events = db
      .prepare(
        "SELECT * FROM inspection_task_events WHERE task_id=? ORDER BY version LIMIT 1001",
      )
      .all(row.id) as {
      event: string;
      reason: string;
      actor_name: string;
      at: string;
      version: number;
      actor_id: string;
      snapshot: string;
    }[];
    if (events.length > 1000)
      throw new HttpError(
        400,
        "일정 이력이 1,000건을 넘어 누락 방지를 위해 전체 인쇄를 중단합니다.",
      );
    res
      .type("html")
      .send(printInspectionTask(taskRecord(row), taskChain(db, row), events));
  });
  app.get("/api/sites/:siteId/inspections/:id/task-source", (req, res) => {
    access(req);
    getInspection(db, String(req.params.siteId), String(req.params.id));
    res.json(
      inspectionTaskSource(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
    );
  });
}
