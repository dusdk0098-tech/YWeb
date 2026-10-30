import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { revision } from "./validation.js";
import { account } from "./inspection-model.js";
export type Company = {
  id: string;
  site_id: string;
  name: string;
  active: number;
  version: number;
  created_at: string;
  updated_at: string;
};
export type AffiliatedWorker = {
  id: string;
  site_id: string;
  name: string;
  affiliation: string;
  kind: string;
  active: number;
  version: number;
};
export const companyPage = z
  .object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) })
  .strict();
const nameInput = z
    .object({ name: z.string().trim().min(1).max(200) })
    .strict(),
  reason = z.string().trim().min(1).max(1000);
export function getCompany(db: Db, site: string, id: string) {
  const row = db
    .prepare("SELECT * FROM companies WHERE site_id=? AND id=?")
    .get(site, id) as Company | undefined;
  if (!row) throw new HttpError(404, "이 현장의 업체를 찾을 수 없습니다.");
  return row;
}
export function workerCompany(db: Db, site: string, id: string) {
  const worker = db
    .prepare("SELECT * FROM workers WHERE site_id=? AND id=?")
    .get(site, id) as AffiliatedWorker | undefined;
  if (!worker)
    throw new HttpError(404, "이 현장의 명부 대상을 찾을 수 없습니다.");
  const assignment = db
    .prepare("SELECT * FROM worker_companies WHERE site_id=? AND worker_id=?")
    .get(site, id) as
    | { company_id: string | null; version: number; updated_at: string }
    | undefined;
  return {
    worker,
    version: assignment?.version || 0,
    company: assignment?.company_id
      ? getCompany(db, site, assignment.company_id)
      : null,
    updatedAt: assignment?.updated_at || null,
  };
}
export function registerCompanies(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/companies";
  app.get(base, (req, res) => {
    access(req);
    const q = companyPage
      .extend({ active: z.enum(["true", "false"]).optional() })
      .parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM companies WHERE site_id=? AND (? IS NULL OR active=?) ORDER BY name,id LIMIT 51 OFFSET ?",
      )
      .all(
        String(req.params.siteId),
        q.active === undefined ? null : Number(q.active === "true"),
        Number(q.active === "true"),
        q.offset,
      );
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const input = nameInput.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `company:create:${site}`,
      input,
      () => {
        const id = randomUUID(),
          at = new Date().toISOString(),
          a = account(db, req.session.userId!);
        db.prepare("INSERT INTO companies VALUES(?,?,?,1,1,?,?)").run(
          id,
          site,
          input.name,
          at,
          at,
        );
        const row = getCompany(db, site, id);
        db.prepare(
          "INSERT INTO company_events(company_id,version,actor_id,actor_name,at,reason,snapshot) VALUES(?,?,?,?,?,?,?)",
        ).run(id, 1, a.id, a.name, at, "업체 등록", JSON.stringify(row));
        audit(db, a.id, site, "company.created", id);
        return row;
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true, true);
    const v = nameInput
        .extend({ active: z.boolean(), version: revision, reason })
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `company:edit:${site}:${id}`,
      v,
      () => {
        const old = getCompany(db, site, id);
        if (old.version !== v.version)
          throw new HttpError(409, "업체 버전이 바뀌었습니다.");
        const at = new Date().toISOString(),
          a = account(db, req.session.userId!);
        db.prepare(
          "UPDATE companies SET name=?,active=?,version=version+1,updated_at=? WHERE id=?",
        ).run(v.name, Number(v.active), at, id);
        const row = getCompany(db, site, id);
        db.prepare(
          "INSERT INTO company_events(company_id,version,actor_id,actor_name,at,reason,snapshot) VALUES(?,?,?,?,?,?,?)",
        ).run(id, row.version, a.id, a.name, at, v.reason, JSON.stringify(row));
        audit(db, a.id, site, "company.changed", id);
        return row;
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(getCompany(db, String(req.params.siteId), String(req.params.id)));
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req);
    const id = String(req.params.id);
    getCompany(db, String(req.params.siteId), id);
    const q = companyPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM company_events WHERE company_id=? ORDER BY version LIMIT 51 OFFSET ?",
        )
        .all(id, q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  const link = "/api/sites/:siteId/workers/:workerId/company";
  app.get(link, (req, res) => {
    access(req);
    res.json(
      workerCompany(db, String(req.params.siteId), String(req.params.workerId)),
    );
  });
  app.put(link, (req, res) => {
    access(req, true, true);
    const v = z
        .object({
          version: z.number().int().nonnegative(),
          workerVersion: revision,
          companyId: z.uuid().nullable(),
          reason,
        })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.workerId);
    mutate(
      req,
      res,
      `worker:company:${site}:${id}`,
      v,
      () => {
        const old = workerCompany(db, site, id);
        if (old.version !== v.version || old.worker.version !== v.workerVersion)
          throw new HttpError(409, "명부/소속 연결이 바뀌었습니다.");
        if (
          v.companyId &&
          (!old.worker.active || !getCompany(db, site, v.companyId).active)
        )
          throw new HttpError(
            409,
            "새 소속 연결은 활성 명부·업체만 가능합니다. 해제와 과거 조회는 가능합니다.",
          );
        const at = new Date().toISOString(),
          a = account(db, req.session.userId!);
        db.prepare(
          "INSERT INTO worker_companies VALUES(?,?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET company_id=excluded.company_id,version=excluded.version,updated_at=excluded.updated_at",
        ).run(id, site, v.companyId, old.version + 1, at);
        const result = workerCompany(db, site, id);
        db.prepare(
          "INSERT INTO worker_company_events(worker_id,site_id,version,actor_id,actor_name,at,reason,snapshot) VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          id,
          site,
          result.version,
          a.id,
          a.name,
          at,
          v.reason,
          JSON.stringify(result),
        );
        audit(db, a.id, site, "worker.company.changed", id);
        return result;
      },
      () => {
        access(req, true, true);
        workerCompany(db, site, id);
      },
    );
  });
  app.get(link + "/events", (req, res) => {
    access(req);
    const site = String(req.params.siteId),
      id = String(req.params.workerId);
    workerCompany(db, site, id);
    const q = companyPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM worker_company_events WHERE site_id=? AND worker_id=? ORDER BY version LIMIT 51 OFFSET ?",
        )
        .all(site, id, q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
}
