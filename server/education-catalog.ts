import { catalogSourceHash, exactCatalog, assertCatalogNewUse } from "./education-catalog-use-model.js";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { revision } from "./validation.js";
import { inspectionPage } from "./inspection-validation.js";
import { account } from "./inspection-model.js";
import {
  educationFields,
  educationInput,
  validSchedule,
} from "./education-validation.js";
import {
  catalogBody,
  getCatalog,
  catalogRecord,
  publishedCatalog,
  type CatalogRow,
  type CatalogSnapshot,
} from "./education-catalog-model.js";
import { journalHash } from "./daily-journal-sources.js";
import { printCatalog } from "./education-catalog-print.js";
import { fullEducationRecord } from "./education-record.js";
import type { EducationRow } from "./education.js";
const create = z.object({ body: catalogBody }).strict(),
  version = z.object({ version: revision }).strict(),
  edit = version.extend({ body: catalogBody }),
  revise = version.extend({ reason: z.string().trim().min(1).max(1000) }),
  filter = inspectionPage.extend({
    status: z.enum(["draft", "published"]).optional(),
  });
export const catalogSchedule = educationFields
  .pick({
    date: true,
    startTime: true,
    endTime: true,
    breakMinutes: true,
    instructor: true,
    location: true,
  })
  .extend({ instructor: z.string().trim().min(1).max(200) })
  .refine(validSchedule, { message: "같은 날 시작/종료/휴게를 확인하세요." });
export const catalogInstantiateInput = version.extend({ schedule: catalogSchedule,sourceHash:catalogSourceHash.optional() });
const instantiate = catalogInstantiateInput;
export function registerEducationCatalog(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/education-catalog";
  function expected(r: CatalogRow, v: number, status = "draft") {
    if (r.version !== v || r.status !== status)
      throw new HttpError(
        409,
        "교육내용 상태/버전이 변경되었습니다. 최신본을 다시 여세요.",
      );
  }
  function readable(req: import("express").Request) {
    const role = access(req),
      row = getCatalog(db, String(req.params.siteId), String(req.params.id));
    if (row.status === "draft" && role !== "manager")
      throw new HttpError(404, "게시 교육내용을 찾을 수 없습니다.");
    return row;
  }
  function visibleRecord(row: CatalogRow, role: string) {
    const record = catalogRecord(db, row);
    if (role !== "manager" && record.successorId) {
      const child = db
        .prepare(
          "SELECT status FROM education_catalog WHERE id=? AND site_id=?",
        )
        .get(record.successorId, row.site_id) as { status: string } | undefined;
      if (child?.status !== "published") record.successorId = null;
    }
    return record;
  }
  app.get(base, (req, res) => {
    const role = access(req),
      q = filter.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM education_catalog WHERE site_id=? AND (?='manager' OR status='published') AND (? IS NULL OR status=?) ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
        )
        .all(
          String(req.params.siteId),
          role,
          q.status || null,
          q.status || null,
          q.offset,
        ) as CatalogRow[];
    res.json({
      items: rows.slice(0, 50).map((r) => visibleRecord(r, role)),
      hasMore: rows.length > 50,
    });
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = create.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      "education_catalog:create:" + site,
      v,
      () => {
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO education_catalog VALUES(?,?,NULL,?,'draft',1,NULL,NULL,?,?)",
        ).run(id, site, JSON.stringify(v.body), now, now);
        audit(db, req.session.userId!, site, "education_catalog.created", id);
        return catalogRecord(db, getCatalog(db, site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id", (req, res) =>
    res.json(visibleRecord(readable(req), access(req))),
  );
  app.put(base + "/:id", (req, res) => {
    access(req, true, true);
    const v = edit.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `education_catalog:edit:${site}:${id}`,
      v,
      () => {
        const row = getCatalog(db, site, id);
        expected(row, v.version);
        db.prepare(
          "UPDATE education_catalog SET body=?,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(v.body), new Date().toISOString(), id);
        audit(db, req.session.userId!, site, "education_catalog.updated", id);
        return catalogRecord(db, getCatalog(db, site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/publish", (req, res) => {
    access(req, true, true);
    const v = version.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `education_catalog:publish:${site}:${id}`,
      v,
      () => {
        const row = getCatalog(db, site, id);
        expected(row, v.version);
        const body = catalogBody.parse(JSON.parse(row.body));
        if (!body.categoryLabel || !body.objectives || !body.contents)
          throw new HttpError(
            400,
            "게시하려면 자체 분류/목표/내용을 입력하세요.",
          );
        const now = new Date().toISOString(),
          snapshot: CatalogSnapshot = {
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
            parentId: row.parent_id,
            body,
            publishedBy: account(db, req.session.userId!),
            publishedAt: now,
          };
        db.prepare(
          "UPDATE education_catalog SET status='published',version=version+1,published_snapshot=?,published_hash=?,updated_at=? WHERE id=?",
        ).run(JSON.stringify(snapshot), journalHash(snapshot), now, id);
        audit(db, req.session.userId!, site, "education_catalog.published", id);
        return catalogRecord(db, getCatalog(db, site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/revise", (req, res) => {
    access(req, true, true);
    const v = revise.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `education_catalog:revise:${site}:${id}`,
      v,
      () => {
        const row = getCatalog(db, site, id);
        expected(row, v.version, "published");
        const source = publishedCatalog(row);
        if (
          db
            .prepare("SELECT 1 FROM education_catalog WHERE parent_id=?")
            .get(id)
        )
          throw new HttpError(409, "이미 연결 내용 초안이 있습니다.");
        const child = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO education_catalog VALUES(?,?,?,?,'draft',1,NULL,NULL,?,?)",
        ).run(child, site, id, JSON.stringify(source.body), now, now);
        db.prepare(
          "INSERT INTO education_catalog_revision_notes(catalog_id,reason,actor_id,actor_name,at) VALUES(?,?,?,?,?)",
        ).run(
          child,
          v.reason,
          req.session.userId!,
          account(db, req.session.userId!).name,
          now,
        );
        audit(
          db,
          req.session.userId!,
          site,
          "education_catalog.revised",
          child,
        );
        return catalogRecord(db, getCatalog(db, site, child));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/journals", (req, res) => {
    access(req, true);
    const v = instantiate.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    const original = readable(req);
    expected(original, v.version, "published");
    exactCatalog(original,v.sourceHash);
    mutate(
      req,
      res,
      `education_catalog:journal:${site}:${id}`,
      v,
      () => {
        const row = getCatalog(db, site, id);
        expected(row, v.version, "published");
        assertCatalogNewUse(db,row);
        const source = exactCatalog(row,v.sourceHash),
          b = source.body,
          details = educationInput.parse({
            title: b.title,
            courseLabel: b.categoryLabel,
            objectives: b.objectives,
            contents: b.contents,
            ...v.schedule,
          }),
          session = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO education_sessions(id,site_id,body,status,revision_reason,author_id,created_at,updated_at) VALUES(?,?,?,'draft','',?,?,?)",
        ).run(
          session,
          site,
          JSON.stringify(details),
          req.session.userId!,
          now,
          now,
        );
        db.prepare("INSERT INTO education_catalog_links VALUES(?,?,?,?)").run(
          session,
          id,
          JSON.stringify(source),
          row.published_hash,
        );
        audit(
          db,
          req.session.userId!,
          site,
          "education.created_from_catalog",
          session,
        );
        return fullEducationRecord(
          db,
          db
            .prepare("SELECT * FROM education_sessions WHERE id=?")
            .get(session) as EducationRow,
        );
      },
      () => {
        access(req, true);
        const source = readable(req);
        expected(source, v.version, "published");
        exactCatalog(source,v.sourceHash);
      },
    );
  });
  app.get(base + "/:id/print", (req, res) => {
    const row = readable(req),
      source = row.status === "published" ? publishedCatalog(row) : null;
    res
      .type("html")
      .send(
        printCatalog(
          source?.body || JSON.parse(row.body),
          source,
          row.published_hash,
        ),
      );
  });
}
