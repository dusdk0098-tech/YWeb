import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  templateInput,
  inspectionVersion,
  inspectionPage,
  type TemplateBody,
} from "./inspection-validation.js";
import {
  getTemplate,
  templateRecord,
  account,
  checkVersion,
  type TemplateRow,
  type TemplateSnapshot,
} from "./inspection-model.js";
export function registerInspectionTemplates(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/inspection-templates";
  app.get(base, (req, res) => {
    access(req);
    const { offset } = inspectionPage.parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM inspection_templates WHERE site_id=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?",
      )
      .all(String(req.params.siteId), offset) as TemplateRow[];
    res.json({
      items: rows.slice(0, 50).map(templateRecord),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(
      templateRecord(
        getTemplate(db, String(req.params.siteId), String(req.params.id)),
      ),
    );
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const body = templateInput.parse(req.body);
    const site = String(req.params.siteId);
    mutate(
      req,
      res,
      `template:create:${site}`,
      body,
      () => {
        const id = randomUUID();
        const normalized = {
          ...body,
          items: body.items.map((text) => ({ id: randomUUID(), text })),
        };
        db.prepare(
          "INSERT INTO inspection_templates VALUES(?,?,NULL,?,'draft',1,NULL,?)",
        ).run(id, site, JSON.stringify(normalized), new Date().toISOString());
        audit(db, req.session.userId!, site, "inspection.template.created", id);
        return templateRecord(getTemplate(db, site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true, true);
    const v = templateInput
      .extend({ version: inspectionVersion.shape.version })
      .parse(req.body);
    const site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `template:edit:${site}:${id}`,
      v,
      () => {
        const row = getTemplate(db, site, id);
        checkVersion(row, v.version, "draft");
        const body = {
          title: v.title,
          instructions: v.instructions,
          items: v.items.map((text) => ({ id: randomUUID(), text })),
        };
        db.prepare(
          "UPDATE inspection_templates SET body=?,version=version+1 WHERE id=?",
        ).run(JSON.stringify(body), id);
        audit(db, req.session.userId!, site, "inspection.template.updated", id);
        return templateRecord(getTemplate(db, site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/publish", (req, res) => {
    access(req, true, true);
    const v = inspectionVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `template:publish:${site}:${id}`,
      v,
      () => {
        const row = getTemplate(db, site, id);
        checkVersion(row, v.version, "draft");
        const snapshot: TemplateSnapshot = {
          id,
          version: row.version + 1,
          body: JSON.parse(row.body) as TemplateBody,
          siteName: (
            db.prepare("SELECT name FROM sites WHERE id=?").get(site) as {
              name: string;
            }
          ).name,
          publishedBy: account(db, req.session.userId!),
          publishedAt: new Date().toISOString(),
        };
        db.prepare(
          "UPDATE inspection_templates SET status='published',version=version+1,published_snapshot=? WHERE id=?",
        ).run(JSON.stringify(snapshot), id);
        audit(
          db,
          req.session.userId!,
          site,
          "inspection.template.published",
          id,
        );
        return templateRecord(getTemplate(db, site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/revise", (req, res) => {
    access(req, true, true);
    const v = inspectionVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `template:revise:${site}:${id}`,
      v,
      () => {
        const row = getTemplate(db, site, id);
        checkVersion(row, v.version, "published");
        if (
          db
            .prepare("SELECT id FROM inspection_templates WHERE parent_id=?")
            .get(id)
        )
          throw new HttpError(
            409,
            "이미 후속 양식 버전이 있습니다. 목록에서 여세요.",
          );
        const next = randomUUID(),
          body = JSON.parse(row.body) as TemplateBody;
        body.items = body.items.map((item) => ({
          id: randomUUID(),
          text: item.text,
        }));
        db.prepare(
          "INSERT INTO inspection_templates VALUES(?,?,?,?, 'draft',1,NULL,?)",
        ).run(next, site, id, JSON.stringify(body), new Date().toISOString());
        audit(
          db,
          req.session.userId!,
          site,
          "inspection.template.revised",
          next,
        );
        return templateRecord(getTemplate(db, site, next));
      },
      () => {
        access(req, true, true);
      },
    );
  });
}
