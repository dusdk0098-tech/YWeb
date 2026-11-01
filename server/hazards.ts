import { SOLE_MANAGER_NOTE, soleManager } from "./sole-manager.js";
import { attachmentManifest } from "./hazard-attachment-model.js";
import { hazardInspectionSource } from "./inspection-links.js";
import type { Express, Request } from "express";
import { z } from "zod";
import { type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  hazardInput,
  hazardSubmitDetails,
  hazardVersion,
  hazardReason,
  hazardAssignment,
  hazardRemediation,
  hazardList,
} from "./hazard-validation.js";
import { printHazard } from "./hazard-print.js";
export type {
  HazardStatus,
  HazardRow,
  HazardOriginal,
  HazardEvent,
} from "./hazard-model.js";
import {
  hazardRecord,
  type HazardStatus,
  type HazardRow,
  type HazardOriginal,
  type HazardEvent,
} from "./hazard-model.js";
import { createHazardDraft, recordHazardEvent } from "./hazard-write.js";
export function registerHazardRoutes(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/hazards";
  function get(site: string, id: string) {
    const row = db
      .prepare("SELECT * FROM hazard_reports WHERE site_id=? AND id=?")
      .get(site, id) as HazardRow | undefined;
    if (!row) throw new HttpError(404, "신고 기록을 찾을 수 없습니다.");
    return row;
  }
  function expected(
    site: string,
    id: string,
    version: number,
    states: HazardStatus[],
  ) {
    const r = get(site, id);
    if (r.version !== version || !states.includes(r.status))
      throw new HttpError(
        409,
        "기록의 버전 또는 상태가 바뀌었습니다. 입력을 보관하고 최신본을 다시 열어 주세요.",
      );
    return r;
  }
  function author(req: Request, row: HazardRow) {
    if (row.owner_id !== req.session.userId)
      throw new HttpError(403, "신고 초안의 작성자만 수정·제출할 수 있습니다.");
  }
  function eligible(site: string, userId: string) {
    const user = db
      .prepare(
        "SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? AND m.user_id=? AND m.role IN ('editor','manager')",
      )
      .get(site, userId) as { id: string; name: string } | undefined;
    if (!user)
      throw new HttpError(
        400,
        "담당자는 현재 이 현장의 작성자 또는 관리자 계정이어야 합니다.",
      );
    return user;
  }
  function event(
    req: Request,
    row: HazardRow,
    type: string,
    from: HazardStatus | null,
    note: string,
  ) {
    recordHazardEvent(db, req.session.userId!, row, type, from, note);
  }
  function save(
    req: Request,
    old: HazardRow,
    change: Partial<HazardRow>,
    type: string,
    note: string,
  ) {
    const next = {
      ...old,
      ...change,
      version: old.version + 1,
      updated_at: new Date().toISOString(),
    };
    const result = db
      .prepare(
        "UPDATE hazard_reports SET body=?,status=?,version=?,assignee_id=?,due_date=?,remediation=?,remediator_id=?,submitted_snapshot=?,updated_at=? WHERE site_id=? AND id=? AND version=? AND status=?",
      )
      .run(
        next.body,
        next.status,
        next.version,
        next.assignee_id,
        next.due_date,
        next.remediation,
        next.remediator_id,
        next.submitted_snapshot,
        next.updated_at,
        old.site_id,
        old.id,
        old.version,
        old.status,
      );
    if (!result.changes)
      throw new HttpError(409, "다른 요청이 먼저 처리되었습니다.");
    event(req, next, type, old.status, note);
    return hazardRecord(next);
  }
  app.get(base, (req, res) => {
    access(req);
    const q = hazardList.parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM hazard_reports WHERE site_id=? AND (? IS NULL OR status=?) ORDER BY updated_at DESC,id DESC LIMIT 51 OFFSET ?",
      )
      .all(
        String(req.params.siteId),
        q.status || null,
        q.status || null,
        q.offset,
      ) as HazardRow[];
    res.json({
      items: rows.slice(0, 50).map(hazardRecord),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/assignees", (req, res) => {
    access(req, false, true);
    res.json(
      db
        .prepare(
          "SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? AND m.role IN ('editor','manager') ORDER BY u.name,u.id",
        )
        .all(String(req.params.siteId)),
    );
  });
  app.post(base, (req, res) => {
    access(req, true);
    const input = hazardInput.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `site:${site}:hazard:create`,
      input,
      () => {
        return hazardRecord(
          createHazardDraft(db, site, req.session.userId!, input),
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
      hazardRecord(get(String(req.params.siteId), String(req.params.id))),
    );
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true);
    const { version, ...input } = hazardInput
        .extend({ version: hazardVersion.shape.version })
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:hazard:${id}:edit`,
      { version, ...input },
      () => {
        const row = expected(site, id, version, ["draft"]);
        author(req, row);
        return save(
          req,
          row,
          { body: JSON.stringify(input) },
          "draft_updated",
          "작성자 초안 수정",
        );
      },
      () => {
        access(req, true);
        author(req, get(site, id));
      },
    );
  });
  app.post(base + "/:id/submit", (req, res) => {
    access(req, true);
    const input = hazardVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:hazard:${id}:submit`,
      input,
      () => {
        const row = expected(site, id, input.version, ["draft"]);
        author(req, row);
        const details = hazardSubmitDetails.parse(JSON.parse(row.body));
        const siteName = (
          db.prepare("SELECT name FROM sites WHERE id=?").get(site) as {
            name: string;
          }
        ).name;
        const name = (
          db.prepare("SELECT name FROM users WHERE id=?").get(row.owner_id) as {
            name: string;
          }
        ).name;
        const original: HazardOriginal = {
          id,
          site: { id: site, name: siteName },
          reporter: { id: row.owner_id, name },
          details,
          submittedAt: new Date().toISOString(),
          attachments: attachmentManifest(db, id),
        };
        return save(
          req,
          row,
          { status: "reported", submitted_snapshot: JSON.stringify(original) },
          "submitted",
          "작성자 신고 제출",
        );
      },
      () => {
        access(req, true);
        author(req, get(site, id));
      },
    );
  });
  app.post(base + "/:id/assign", (req, res) => {
    access(req, true, true);
    const input = hazardAssignment.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:hazard:${id}:assign`,
      input,
      () => {
        const row = expected(site, id, input.version, [
          "reported",
          "assigned",
          "review_requested",
        ]);
        const user = eligible(site, input.assigneeId);
        return save(
          req,
          row,
          {
            status: "assigned",
            assignee_id: user.id,
            due_date: input.dueDate,
            remediation: "",
            remediator_id: null,
          },
          "assigned",
          input.reason,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/remediate", (req, res) => {
    access(req, true);
    const input = hazardRemediation.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:hazard:${id}:remediate`,
      input,
      () => {
        const row = expected(site, id, input.version, ["assigned"]);
        if (row.assignee_id !== req.session.userId)
          throw new HttpError(
            403,
            "현재 배정된 담당자 본인만 조치 내용을 제출할 수 있습니다.",
          );
        eligible(site, req.session.userId!);
        const requested = save(
          req,
          row,
          {
            status: "review_requested",
            remediation: input.text,
            remediator_id: req.session.userId!,
          },
          "remediation_submitted",
          "담당자 조치 기록 제출·관리자 검토 요청",
        );
        if (!soleManager(db, site, req.session.userId!)) return requested;
        return save(req, get(site, id), { status: "closed" }, "closed", SOLE_MANAGER_NOTE);
      },
      () => {
        access(req, true);
        if (get(site, id).assignee_id !== req.session.userId)
          throw new HttpError(
            403,
            "현재 배정된 담당자만 조치 기록을 제출할 수 있습니다.",
          );
      },
    );
  });
  app.post(base + "/:id/reject", (req, res) => {
    access(req, true, true);
    const input = hazardReason.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:hazard:${id}:reject`,
      input,
      () => {
        const row = expected(site, id, input.version, ["review_requested"]);
        eligible(site, row.assignee_id!);
        return save(
          req,
          row,
          { status: "assigned", remediation: "", remediator_id: null },
          "rejected",
          input.reason,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/close", (req, res) => {
    access(req, true, true);
    const input = hazardReason.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:hazard:${id}:close`,
      input,
      () => {
        const row = expected(site, id, input.version, ["review_requested"]);
        if (row.remediator_id === req.session.userId && !soleManager(db, site, req.session.userId!))
          throw new HttpError(
            403,
            "잠정 독립 검토 정책: 본인이 제출한 조치는 종결할 수 없습니다. 다른 현장 관리자가 검토해야 합니다. 현장 관리에서 기존 계정에 관리자 권한을 배정하거나 다른 담당자에게 재배정하세요.",
          );
        return save(req, row, { status: "closed" }, "closed", input.reason);
      },
      () => {
        access(req, true, true);
        if (get(site, id).remediator_id === req.session.userId && !soleManager(db, site, req.session.userId!))
          throw new HttpError(
            403,
            "잠정 독립 검토 정책: 본인이 제출한 조치는 종결할 수 없습니다. 다른 현장 관리자가 검토해야 합니다. 현장 관리에서 기존 계정에 관리자 권한을 배정하거나 다른 담당자에게 재배정하세요.",
          );
      },
    );
  });
  app.post(base + "/:id/reopen", (req, res) => {
    access(req, true, true);
    const input = hazardAssignment.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:hazard:${id}:reopen`,
      input,
      () => {
        const row = expected(site, id, input.version, ["closed"]);
        const user = eligible(site, input.assigneeId);
        return save(
          req,
          row,
          {
            status: "assigned",
            assignee_id: user.id,
            due_date: input.dueDate,
            remediation: "",
            remediator_id: null,
          },
          "reopened",
          input.reason,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req);
    const row = get(String(req.params.siteId), String(req.params.id));
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(req.query.offset || 0);
    const events = db
      .prepare(
        "SELECT * FROM hazard_events WHERE report_id=? ORDER BY version LIMIT 51 OFFSET ?",
      )
      .all(row.id, offset) as HazardEvent[];
    res.json({
      items: events
        .slice(0, 50)
        .map((e) => ({ ...e, snapshot: JSON.parse(e.snapshot) })),
      hasMore: events.length > 50,
    });
  });
  app.get(base + "/:id/print", (req, res) => {
    access(req);
    const row = get(String(req.params.siteId), String(req.params.id));
    const events = db
      .prepare(
        "SELECT * FROM hazard_events WHERE report_id=? ORDER BY version LIMIT 1001",
      )
      .all(row.id) as HazardEvent[];
    if (events.length > 1000)
      throw new HttpError(
        400,
        "변경 이력이 1,000건을 넘어 전체 인쇄를 제공할 수 없습니다. 누락 방지를 위해 생성을 중단했습니다.",
      );
    res
      .type("html")
      .send(
        printHazard(
          row,
          events,
          hazardInspectionSource(db, row.site_id, row.id),
        ),
      );
  });
}
