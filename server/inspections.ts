import { assertInspectionNewUse, inspectionSelection } from "./inspection-use.js";
import { createInspectionDraft } from "./inspection-write.js";
import {
  carryTaskSource,
  inspectionTaskSource,
} from "./inspection-schedule-model.js";
import { inspectionLinks } from "./inspection-links.js";
import type { Express, Request } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  inspectionBody,
  inspectionVersion,
  inspectionReview,
  inspectionReturn,
  inspectionPage,
  type InspectionBody,
  type TemplateBody,
} from "./inspection-validation.js";
import {
  getTemplate,
  getInspection,
  inspectionRecord,
  account,
  checkVersion,
  type InspectionRow,
  type TemplateSnapshot,
  type InspectionSnapshot,
} from "./inspection-model.js";
import { printInspection } from "./inspection-print.js";
export function registerInspectionRoutes(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/inspections";
  function own(req: Request, r: InspectionRow) {
    if (r.owner_id !== req.session.userId)
      throw new HttpError(
        403,
        "원 작성자만 점검 초안을 수정·제출할 수 있습니다.",
      );
  }
  function answers(
    body: InspectionBody,
    template: TemplateBody,
    submit = false,
  ) {
    const ids = new Set(body.answers.map((a) => a.itemId));
    if (
      ids.size !== body.answers.length ||
      body.answers.length !== template.items.length ||
      template.items.some((i) => !ids.has(i.id))
    )
      throw new HttpError(
        400,
        "양식의 모든 항목을 중복 없이 정확히 입력하세요.",
      );
    if (
      submit &&
      (!body.location ||
        !body.performedBy ||
        body.answers.some(
          (a) =>
            a.result === "pending" ||
            (["fail", "na"].includes(a.result) && !a.comment),
        ))
    )
      throw new HttpError(
        400,
        "장소·점검자 표시와 모든 항목 결과가 필요합니다. 부적합/해당 없음에는 설명을 입력하세요.",
      );
  }
  function event(req: Request, id: string, name: string, note = "") {
    const r = getInspection(db, String(req.params.siteId), id),
      actor = account(db, req.session.userId!);
    db.prepare(
      "INSERT INTO inspection_events(inspection_id,version,event,actor_id,actor_name,at,note) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      r.version,
      name,
      actor.id,
      actor.name,
      new Date().toISOString(),
      note,
    );
  }
  app.get(base, (req, res) => {
    access(req);
    const { offset } = inspectionPage.parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM inspections WHERE site_id=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?",
      )
      .all(String(req.params.siteId), offset) as InspectionRow[];
    res.json({
      items: rows.slice(0, 50).map(inspectionRecord),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/authors", (req, res) => {
    access(req, true, true);
    res.json(
      db
        .prepare(
          "SELECT u.id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? AND m.role IN ('editor','manager') ORDER BY u.name,u.id",
        )
        .all(String(req.params.siteId)),
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(
      inspectionRecord(
        getInspection(db, String(req.params.siteId), String(req.params.id)),
      ),
    );
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req);
    const r = getInspection(
      db,
      String(req.params.siteId),
      String(req.params.id),
    );
    const { offset } = inspectionPage.parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM inspection_events WHERE inspection_id=? ORDER BY version LIMIT 51 OFFSET ?",
      )
      .all(r.id, offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get(base + "/:id/print", (req, res) => {
    access(req);
    const r = getInspection(
      db,
      String(req.params.siteId),
      String(req.params.id),
    );
    res
      .type("html")
      .send(
        printInspection(
          inspectionRecord(r),
          inspectionLinks(db, r.site_id, r.id),
          inspectionTaskSource(db, r.site_id, r.id),
        ),
      );
  });
  app.post(base, (req, res) => {
    access(req, true);
    const v = z
        .object({ templateId: z.uuid(), body: inspectionBody,...inspectionSelection })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `inspection:create:${site}`,
      v,
      () => {
        const template = getTemplate(db, site, v.templateId);
        assertInspectionNewUse(db,template,v);
        if (template.status !== "published" || !template.published_snapshot)
          throw new HttpError(409, "게시된 양식 버전만 사용할 수 있습니다.");
        answers(v.body, JSON.parse(template.body) as TemplateBody);
        const id = createInspectionDraft(
          db,
          site,
          template.id,
          template.published_snapshot,
          req.session.userId!,
          v.body,
          null,
        );
        event(req, id, "created");
        return inspectionRecord(getInspection(db, site, id));
      },
      () => {
        access(req, true);
      },
    );
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true);
    const site = String(req.params.siteId),
      id = String(req.params.id);
    own(req, getInspection(db, site, id));
    const v = z
      .object({
        version: inspectionVersion.shape.version,
        body: inspectionBody,
      })
      .strict()
      .parse(req.body);
    mutate(
      req,
      res,
      `inspection:edit:${site}:${id}`,
      v,
      () => {
        const row = getInspection(db, site, id);
        checkVersion(row, v.version, "draft");
        answers(
          v.body,
          (JSON.parse(row.template_snapshot) as TemplateSnapshot).body,
        );
        db.prepare(
          "UPDATE inspections SET body=?,version=version+1 WHERE id=?",
        ).run(JSON.stringify(v.body), id);
        event(req, id, "draft_updated");
        return inspectionRecord(getInspection(db, site, id));
      },
      () => {
        access(req, true);
        own(req, getInspection(db, site, id));
      },
    );
  });
  app.post(base + "/:id/submit", (req, res) => {
    access(req, true);
    const site = String(req.params.siteId),
      id = String(req.params.id);
    own(req, getInspection(db, site, id));
    const v = inspectionVersion.parse(req.body);
    mutate(
      req,
      res,
      `inspection:submit:${site}:${id}`,
      v,
      () => {
        const row = getInspection(db, site, id);
        checkVersion(row, v.version, "draft");
        const body = JSON.parse(row.body) as InspectionBody,
          template = JSON.parse(row.template_snapshot) as TemplateSnapshot;
        answers(body, template.body, true);
        const snapshot: InspectionSnapshot = {
          id,
          template,
          body,
          submitter: account(db, req.session.userId!),
          submittedAt: new Date().toISOString(),
        };
        db.prepare(
          "UPDATE inspections SET status='submitted',version=version+1,submitted_snapshot=? WHERE id=?",
        ).run(JSON.stringify(snapshot), id);
        event(req, id, "submitted");
        return inspectionRecord(getInspection(db, site, id));
      },
      () => {
        access(req, true);
        own(req, getInspection(db, site, id));
      },
    );
  });
  for (const action of ["accept", "return"] as const)
    app.post(base + "/:id/" + action, (req, res) => {
      access(req, true, true);
      const site = String(req.params.siteId),
        id = String(req.params.id);
      const row = getInspection(db, site, id);
      if (row.owner_id === req.session.userId)
        throw new HttpError(
          403,
          "제출 계정은 자신의 기록을 검토할 수 없습니다. 현장 설정에서 다른 관리자 계정을 지정하세요.",
        );
      const v = (
        action === "return" ? inspectionReturn : inspectionReview
      ).parse(req.body);
      mutate(
        req,
        res,
        `inspection:${action}:${site}:${id}`,
        v,
        () => {
          const current = getInspection(db, site, id);
          checkVersion(current, v.version, "submitted");
          const review = {
            actor: account(db, req.session.userId!),
            at: new Date().toISOString(),
            reason: v.reason,
            successorId: undefined as string | undefined,
          };
          let next: InspectionRow | undefined;
          if (action === "return") {
            const authorId = (v as z.infer<typeof inspectionReturn>).authorId;
            if (
              !db
                .prepare(
                  "SELECT 1 FROM memberships WHERE site_id=? AND user_id=? AND role IN ('editor','manager')",
                )
                .get(site, authorId)
            )
              throw new HttpError(
                400,
                "후속 작성자는 현재 현장 편집자 또는 관리자여야 합니다.",
              );
            if (
              db.prepare("SELECT id FROM inspections WHERE parent_id=?").get(id)
            )
              throw new HttpError(409, "후속 점검 초안이 이미 있습니다.");
            const body = JSON.parse(current.body) as InspectionBody;
            body.answers = body.answers.map((a) => ({
              ...a,
              result: "pending",
              comment: "",
            }));
            const nextId = createInspectionDraft(
              db,
              site,
              current.template_id,
              current.template_snapshot,
              authorId,
              body,
              id,
            );
            carryTaskSource(db, id, nextId);
            review.successorId = nextId;
            event(
              req,
              nextId,
              "returned_draft_created",
              `원본 ${id}; 후속 작성 계정 ${authorId}; ${v.reason}`,
            );
            next = getInspection(db, site, nextId);
          }
          db.prepare(
            "UPDATE inspections SET status=?,version=version+1,review=? WHERE id=?",
          ).run(
            action === "accept" ? "accepted" : "returned",
            JSON.stringify(review),
            id,
          );
          event(req, id, action, v.reason);
          return {
            record: inspectionRecord(getInspection(db, site, id)),
            next: next ? inspectionRecord(next) : null,
          };
        },
        () => {
          access(req, true, true);
          if (getInspection(db, site, id).owner_id === req.session.userId)
            throw new HttpError(
              403,
              "제출 계정은 자신의 기록을 검토할 수 없습니다.",
            );
        },
      );
    });
}
