import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  workerInput,
  workerUpdate,
  workerFilter,
  attendanceCreate,
  attendanceUpdate,
  attendanceFilter,
} from "./attendance-validation.js";
import { printAttendance } from "./attendance-print.js";
export type WorkerRow = {
  id: string;
  site_id: string;
  name: string;
  affiliation: string;
  kind: "worker" | "visitor";
  active: number;
  version: number;
  created_at: string;
  updated_at: string;
};
export type AttendanceRow = {
  id: string;
  site_id: string;
  worker_id: string;
  date: string;
  name: string;
  affiliation: string;
  kind: "worker" | "visitor";
  status: "present" | "cancelled";
  source: "manual";
  reason: string;
  version: number;
  actor_id: string;
  created_at: string;
  updated_at: string;
};
export function registerAttendanceRoutes(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId";
  const siteOf = (req: Request) => String(req.params.siteId);
  function worker(site: string, id: string) {
    const row = db
      .prepare("SELECT * FROM workers WHERE site_id=? AND id=?")
      .get(site, id) as WorkerRow | undefined;
    if (!row)
      throw new HttpError(404, "이 현장의 명부에서 대상을 찾을 수 없습니다.");
    return row;
  }
  function attendance(site: string, id: string) {
    const row = db
      .prepare("SELECT * FROM attendance WHERE site_id=? AND id=?")
      .get(site, id) as AttendanceRow | undefined;
    if (!row) throw new HttpError(404, "출역 기록을 찾을 수 없습니다.");
    return row;
  }
  function history(row: AttendanceRow) {
    db.prepare(
      "INSERT INTO attendance_history(attendance_id,version,status,reason,actor_id,at) VALUES(?,?,?,?,?,?)",
    ).run(
      row.id,
      row.version,
      row.status,
      row.reason,
      row.actor_id,
      row.updated_at,
    );
  }
  app.get(base + "/workers", (req, res) => {
    access(req);
    const q = workerFilter.parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM workers WHERE site_id=? AND instr(name || char(10) || affiliation,?)>0 AND (? IS NULL OR active=?) ORDER BY name,id LIMIT 51 OFFSET ?",
      )
      .all(
        siteOf(req),
        q.search,
        q.active === undefined ? null : Number(q.active === "true"),
        Number(q.active === "true"),
        q.offset,
      ) as WorkerRow[];
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post(base + "/workers", (req, res) => {
    access(req, true, true);
    const input = workerInput.parse(req.body),
      site = siteOf(req);
    mutate(
      req,
      res,
      `site:${site}:worker:create`,
      input,
      () => {
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO workers(id,site_id,name,affiliation,kind,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        ).run(id, site, input.name, input.affiliation, input.kind, now, now);
        audit(db, req.session.userId!, site, "worker.created", id);
        return worker(site, id);
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.put(base + "/workers/:id", (req, res) => {
    access(req, true, true);
    const input = workerUpdate.parse(req.body),
      site = siteOf(req),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:worker:${id}:edit`,
      input,
      () => {
        worker(site, id);
        const changed = db
          .prepare(
            "UPDATE workers SET name=?,affiliation=?,kind=?,active=?,version=version+1,updated_at=? WHERE site_id=? AND id=? AND version=?",
          )
          .run(
            input.name,
            input.affiliation,
            input.kind,
            Number(input.active),
            new Date().toISOString(),
            site,
            id,
            input.version,
          );
        if (!changed.changes)
          throw new HttpError(
            409,
            "명부가 변경되었습니다. 입력을 보관한 뒤 최신 목록을 다시 불러와 주세요.",
          );
        audit(db, req.session.userId!, site, "worker.updated", id);
        return worker(site, id);
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/attendance", (req, res) => {
    access(req);
    const q = attendanceFilter.parse(req.query),
      site = siteOf(req),
      aff = q.affiliation || null;
    const rows = db
      .prepare(
        "SELECT * FROM attendance WHERE site_id=? AND date=? AND (? IS NULL OR affiliation=?) ORDER BY name,id LIMIT 51 OFFSET ?",
      )
      .all(site, q.date, aff, aff, q.offset) as AttendanceRow[];
    const summary = db
      .prepare(
        "SELECT count(*) AS recorded,coalesce(sum(status='present'),0) AS present,coalesce(sum(status='cancelled'),0) AS cancelled FROM attendance WHERE site_id=? AND date=? AND (? IS NULL OR affiliation=?)",
      )
      .get(site, q.date, aff, aff);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50, summary });
  });
  app.get(base + "/attendance/print", (req, res) => {
    access(req);
    const q = attendanceFilter.parse(req.query),
      site = siteOf(req),
      aff = q.affiliation || null;
    const rows = db
      .prepare(
        "SELECT * FROM attendance WHERE site_id=? AND date=? AND (? IS NULL OR affiliation=?) ORDER BY affiliation,name,id LIMIT 2001",
      )
      .all(site, q.date, aff, aff) as AttendanceRow[];
    if (rows.length > 2000)
      throw new HttpError(
        400,
        "한 번에 2,000건까지 인쇄할 수 있습니다. 소속 필터로 범위를 좁혀 주세요.",
      );
    const name = (
      db.prepare("SELECT name FROM sites WHERE id=?").get(site) as {
        name: string;
      }
    ).name;
    res.type("html").send(printAttendance(rows, name, q.date, q.affiliation));
  });
  app.get(base + "/attendance/:id/history", (req, res) => {
    access(req);
    const row = attendance(siteOf(req), String(req.params.id));
    res.json(
      db
        .prepare(
          "SELECT h.version,h.status,h.reason,h.actor_id,u.name AS actor_name,h.at FROM attendance_history h JOIN users u ON u.id=h.actor_id WHERE attendance_id=? ORDER BY version",
        )
        .all(row.id),
    );
  });
  app.post(base + "/attendance", (req, res) => {
    access(req, true);
    const input = attendanceCreate.parse(req.body),
      site = siteOf(req);
    mutate(
      req,
      res,
      `site:${site}:attendance:create`,
      input,
      () => {
        const w = worker(site, input.workerId);
        if (!w.active)
          throw new HttpError(
            409,
            "비활성 명부 대상은 새 출역을 등록할 수 없습니다.",
          );
        if (
          db
            .prepare(
              "SELECT id FROM attendance WHERE site_id=? AND worker_id=? AND date=?",
            )
            .get(site, w.id, input.date)
        )
          throw new HttpError(
            409,
            "같은 대상·날짜의 기록이 있습니다. 기존 기록의 정정/취소 기능을 사용하세요.",
          );
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO attendance(id,site_id,worker_id,date,name,affiliation,kind,status,source,reason,actor_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'present','manual','최초 수기 등록',?,?,?)",
        ).run(
          id,
          site,
          w.id,
          input.date,
          w.name,
          w.affiliation,
          w.kind,
          req.session.userId!,
          now,
          now,
        );
        const row = attendance(site, id);
        history(row);
        audit(db, req.session.userId!, site, "attendance.created", id);
        return row;
      },
      () => {
        access(req, true);
      },
    );
  });
  app.put(base + "/attendance/:id", (req, res) => {
    access(req, true);
    const input = attendanceUpdate.parse(req.body),
      site = siteOf(req),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:attendance:${id}:edit`,
      input,
      () => {
        const old = attendance(site, id);
        if (input.status === "present" && !worker(site, old.worker_id).active)
          throw new HttpError(
            409,
            "비활성 대상은 출역 상태로 복구할 수 없습니다. 명부를 먼저 활성화해 주세요.",
          );
        const changed = db
          .prepare(
            "UPDATE attendance SET status=?,reason=?,version=version+1,actor_id=?,updated_at=? WHERE site_id=? AND id=? AND version=?",
          )
          .run(
            input.status,
            input.reason,
            req.session.userId!,
            new Date().toISOString(),
            site,
            id,
            input.version,
          );
        if (!changed.changes)
          throw new HttpError(
            409,
            "출역 기록이 변경되었습니다. 사유를 보관한 뒤 최신 기록을 다시 불러와 주세요.",
          );
        const row = attendance(site, id);
        history(row);
        audit(db, req.session.userId!, site, "attendance.corrected", id);
        return row;
      },
      () => {
        access(req, true);
      },
    );
  });
}
