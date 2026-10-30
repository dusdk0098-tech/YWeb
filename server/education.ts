import { captureEducationAttachments } from "./education-attachment-model.js";
import { fullEducationRecord } from "./education-record.js";
import {
  educationCatalogSource,
  copyEducationCatalogSource,
  type CatalogProvenance,
} from "./education-catalog-source.js";
import type { Express } from "express";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  educationInput,
  educationArchiveDetails,
  educationVersion,
  educationAdd,
  educationParticipation,
  educationRevision,
  educationEdit,
  scheduledMinutes,
  type EducationInput,
} from "./education-validation.js";
import { printEducation } from "./education-print.js";
export type EducationRow = {
  id: string;
  site_id: string;
  body: string;
  status: "draft" | "archived";
  version: number;
  parent_id: string | null;
  revision_reason: string;
  author_id: string;
  created_at: string;
  updated_at: string;
};
export type EducationParticipant = {
  worker_id: string;
  name: string;
  affiliation: string;
  kind: "worker" | "visitor";
  state: "pending" | "attended" | "absent";
  attended_minutes: number;
  recorded_by: string | null;
  recorded_at: string | null;
};
export type EducationSnapshot = {
  schemaVersion: 1;
  catalogSource?: CatalogProvenance | null;
  type: "education-journal";
  id: string;
  site: { id: string; name: string };
  version: number;
  parentId: string | null;
  revisionReason: string;
  details: EducationInput;
  participants: EducationParticipant[];
  source: "staff-recorded";
  scheduledMinutes: number;
  author: { id: string; name: string };
  archivedBy: { id: string; name: string };
  archivedAt: string;
};
export function registerEducationRoutes(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/education";
  function get(site: string, id: string) {
    const row = db
      .prepare("SELECT * FROM education_sessions WHERE site_id=? AND id=?")
      .get(site, id) as EducationRow | undefined;
    if (!row) throw new HttpError(404, "교육일지 기록을 찾을 수 없습니다.");
    return row;
  }
  function participants(id: string) {
    return db
      .prepare(
        "SELECT worker_id,name,affiliation,kind,state,attended_minutes,recorded_by,recorded_at FROM education_participants WHERE session_id=? ORDER BY worker_id",
      )
      .all(id) as EducationParticipant[];
  }
  function snapshot(id: string) {
    const row = db
      .prepare("SELECT body,hash FROM education_snapshots WHERE session_id=?")
      .get(id) as { body: string; hash: string } | undefined;
    return row
      ? { body: JSON.parse(row.body) as EducationSnapshot, hash: row.hash }
      : null;
  }
  const full = (row: EducationRow) => fullEducationRecord(db, row);
  function draft(site: string, id: string, version: number) {
    const row = get(site, id);
    if (row.status !== "draft")
      throw new HttpError(
        409,
        "관리자가 보관 확정한 기록은 수정할 수 없습니다. 정정 초안을 만드세요.",
      );
    if (row.version !== version)
      throw new HttpError(
        409,
        "다른 요청으로 교육일지 기록이 바뀌었습니다. 입력을 보관한 뒤 최신본을 다시 열어 주세요.",
      );
    return row;
  }
  function bump(site: string, id: string, version: number) {
    const changed = db
      .prepare(
        "UPDATE education_sessions SET version=version+1,updated_at=? WHERE id=? AND site_id=? AND version=? AND status='draft'",
      )
      .run(new Date().toISOString(), id, site, version);
    if (!changed.changes)
      throw new HttpError(
        409,
        "교육일지 버전 충돌입니다. 최신본을 다시 열어 주세요.",
      );
  }
  function author(req: import("express").Request, site: string, id: string) {
    if (get(site, id).author_id !== req.session.userId)
      throw new HttpError(
        403,
        "원 작성자만 교육 초안/참여 기록을 수정할 수 있습니다.",
      );
  }
  function activeWorker(site: string, id: string) {
    const worker = db
      .prepare(
        "SELECT id,name,affiliation,kind,active FROM workers WHERE site_id=? AND id=?",
      )
      .get(site, id) as
      | {
          id: string;
          name: string;
          affiliation: string;
          kind: string;
          active: number;
        }
      | undefined;
    if (!worker) throw new HttpError(404, "이 현장 명부에 없는 대상입니다.");
    if (!worker.active)
      throw new HttpError(
        409,
        "비활성 명부 대상은 추가하거나 참여로 기록할 수 없습니다.",
      );
    return worker;
  }
  app.get(base, (req, res) => {
    access(req);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(req.query.offset || 0);
    const rows = db
      .prepare(
        "SELECT * FROM education_sessions WHERE site_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
      )
      .all(String(req.params.siteId), offset) as EducationRow[];
    res.json({
      items: rows.slice(0, 50).map((r) => ({ ...r, body: JSON.parse(r.body) })),
      hasMore: rows.length > 50,
    });
  });
  app.post(base, (req, res) => {
    access(req, true);
    const input = educationInput.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `site:${site}:education:create`,
      input,
      () => {
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO education_sessions(id,site_id,body,status,revision_reason,author_id,created_at,updated_at) VALUES(?,?,?,'draft','',?,?,?)",
        ).run(id, site, JSON.stringify(input), req.session.userId!, now, now);
        audit(db, req.session.userId!, site, "education.created", id);
        return full(get(site, id));
      },
      () => {
        access(req, true);
      },
    );
  });
  app.get(base + "/authors", (req, res) => {
    access(req, true, true);
    res.json(
      db
        .prepare(
          "SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? AND m.role IN ('editor','manager') ORDER BY u.name,u.id",
        )
        .all(String(req.params.siteId)),
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(full(get(String(req.params.siteId), String(req.params.id))));
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true);
    const { version, ...input } = educationEdit.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    author(req, site, id);
    mutate(
      req,
      res,
      `site:${site}:education:${id}:edit`,
      { version, ...input },
      () => {
        draft(site, id, version);
        if (
          participants(id).some(
            (p) => p.attended_minutes > scheduledMinutes(input),
          )
        )
          throw new HttpError(
            409,
            "예정시간보다 큰 수기 참여시간이 있습니다. 참여 기록을 먼저 수정하세요.",
          );
        bump(site, id, version);
        db.prepare("UPDATE education_sessions SET body=? WHERE id=?").run(
          JSON.stringify(input),
          id,
        );
        audit(db, req.session.userId!, site, "education.updated", id);
        return full(get(site, id));
      },
      () => {
        access(req, true);
        author(req, site, id);
      },
    );
  });
  app.post(base + "/:id/participants", (req, res) => {
    access(req, true);
    const input = educationAdd.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    author(req, site, id);
    mutate(
      req,
      res,
      `site:${site}:education:${id}:participant:add`,
      input,
      () => {
        draft(site, id, input.version);
        const w = activeWorker(site, input.workerId);
        if (participants(id).length >= 200)
          throw new HttpError(400, "교육일지 참가 대상은 200명까지입니다.");
        if (
          db
            .prepare(
              "SELECT worker_id FROM education_participants WHERE session_id=? AND worker_id=?",
            )
            .get(id, w.id)
        )
          throw new HttpError(409, "이미 추가한 대상입니다.");
        bump(site, id, input.version);
        db.prepare(
          "INSERT INTO education_participants VALUES(?,?,?,?,?,'pending',0,NULL,NULL)",
        ).run(id, w.id, w.name, w.affiliation, w.kind);
        audit(db, req.session.userId!, site, "education.participant.added", id);
        return full(get(site, id));
      },
      () => {
        access(req, true);
        author(req, site, id);
      },
    );
  });
  app.put(base + "/:id/participants/:workerId", (req, res) => {
    access(req, true);
    const input = educationParticipation.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id),
      workerId = String(req.params.workerId);
    author(req, site, id);
    mutate(
      req,
      res,
      `site:${site}:education:${id}:participant:${workerId}:record`,
      input,
      () => {
        const row = draft(site, id, input.version);
        if (
          !db
            .prepare(
              "SELECT worker_id FROM education_participants WHERE session_id=? AND worker_id=?",
            )
            .get(id, workerId)
        )
          throw new HttpError(404, "교육일지 참가 대상이 아닙니다.");
        if (input.state === "attended") activeWorker(site, workerId);
        if (
          input.attendedMinutes >
          scheduledMinutes(JSON.parse(row.body) as EducationInput)
        )
          throw new HttpError(
            400,
            "수기 참여시간은 교육 예정시간 이내여야 합니다.",
          );
        bump(site, id, input.version);
        db.prepare(
          "UPDATE education_participants SET state=?,attended_minutes=?,recorded_by=?,recorded_at=? WHERE session_id=? AND worker_id=?",
        ).run(
          input.state,
          input.attendedMinutes,
          input.state === "pending" ? null : req.session.userId!,
          input.state === "pending" ? null : new Date().toISOString(),
          id,
          workerId,
        );
        audit(
          db,
          req.session.userId!,
          site,
          "education.participant.recorded",
          id,
        );
        return full(get(site, id));
      },
      () => {
        access(req, true);
        author(req, site, id);
      },
    );
  });
  app.delete(base + "/:id/participants/:workerId", (req, res) => {
    access(req, true);
    const input = educationVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id),
      workerId = String(req.params.workerId);
    author(req, site, id);
    mutate(
      req,
      res,
      `site:${site}:education:${id}:participant:${workerId}:remove`,
      input,
      () => {
        draft(site, id, input.version);
        if (
          !db
            .prepare(
              "SELECT worker_id FROM education_participants WHERE session_id=? AND worker_id=?",
            )
            .get(id, workerId)
        )
          throw new HttpError(404, "교육일지 참가 대상이 아닙니다.");
        bump(site, id, input.version);
        db.prepare(
          "DELETE FROM education_participants WHERE session_id=? AND worker_id=?",
        ).run(id, workerId);
        audit(
          db,
          req.session.userId!,
          site,
          "education.participant.removed",
          id,
        );
        return full(get(site, id));
      },
      () => {
        access(req, true);
        author(req, site, id);
      },
    );
  });
  app.post(base + "/:id/archive", (req, res) => {
    access(req, true, true);
    const input = educationVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:education:${id}:archive`,
      input,
      () => {
        const row = draft(site, id, input.version),
          details = educationArchiveDetails.parse(JSON.parse(row.body)),
          people = participants(id);
        if (
          !people.some((p) => p.state === "attended") ||
          people.some(
            (p) =>
              p.state === "pending" ||
              p.attended_minutes > scheduledMinutes(details),
          )
        )
          throw new HttpError(
            409,
            "잠정 기록 정책: 참여 1명 이상이며 미확인 대상이 없어야 관리자가 기록을 보관 확정할 수 있습니다.",
          );
        const siteRow = db
          .prepare("SELECT name FROM sites WHERE id=?")
          .get(site) as { name: string };
        const actor = db
          .prepare("SELECT name FROM users WHERE id=?")
          .get(req.session.userId!) as { name: string };
        const now = new Date().toISOString();
        const snap: EducationSnapshot = {
          schemaVersion: 1,
          type: "education-journal",
          id,
          site: { id: site, name: siteRow.name },
          version: row.version + 1,
          parentId: row.parent_id,
          revisionReason: row.revision_reason,
          details,
          catalogSource: educationCatalogSource(db, id, details),
          participants: people,
          source: "staff-recorded",
          scheduledMinutes: scheduledMinutes(details),
          author: db
            .prepare("SELECT id,name FROM users WHERE id=?")
            .get(row.author_id) as { id: string; name: string },
          archivedBy: { id: req.session.userId!, name: actor.name },
          archivedAt: now,
        };
        const serialized = JSON.stringify(snap),
          hash = createHash("sha256").update(serialized).digest("hex");
        bump(site, id, input.version);
        db.prepare(
          "UPDATE education_sessions SET status='archived',updated_at=? WHERE id=?",
        ).run(now, id);
        db.prepare("INSERT INTO education_snapshots VALUES(?,?,?,?,?)").run(
          id,
          serialized,
          hash,
          req.session.userId!,
          now,
        );
        captureEducationAttachments(db,site,id,hash);
        audit(db, req.session.userId!, site, "education.archived", id);
        return full(get(site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/revise", (req, res) => {
    access(req, true, true);
    const input = educationRevision.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:education:${id}:revise`,
      input,
      () => {
        const old = get(site, id);
        if (old.status !== "archived" || old.version !== input.version)
          throw new HttpError(
            409,
            "최신 보관본에서만 정정 초안을 만들 수 있습니다.",
          );
        if (
          db
            .prepare("SELECT id FROM education_sessions WHERE parent_id=?")
            .get(id)
        )
          throw new HttpError(
            409,
            "이미 연결된 정정본이 있습니다. 해당 기록을 여세요.",
          );
        if (
          !db
            .prepare(
              "SELECT 1 FROM memberships WHERE site_id=? AND user_id=? AND role IN ('editor','manager')",
            )
            .get(site, input.authorId)
        )
          throw new HttpError(
            400,
            "후속 작성자는 현재 같은 현장의 편집자/관리자여야 합니다.",
          );
        const snap = snapshot(id);
        if (!snap) throw new Error("Missing 교육일지 snapshot");
        const next = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO education_sessions(id,site_id,body,status,parent_id,revision_reason,author_id,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?,?)",
        ).run(
          next,
          site,
          JSON.stringify(snap.body.details),
          id,
          input.reason,
          input.authorId,
          now,
          now,
        );
        copyEducationCatalogSource(db, id, next);
        for (const p of snap.body.participants)
          db.prepare(
            "INSERT INTO education_participants VALUES(?,?,?,?,?,'pending',0,NULL,NULL)",
          ).run(next, p.worker_id, p.name, p.affiliation, p.kind);
        audit(
          db,
          req.session.userId!,
          site,
          "education.revision.created",
          next,
        );
        return full(get(site, next));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id/print", (req, res) => {
    access(req);
    const row = get(String(req.params.siteId), String(req.params.id));
    const snap = snapshot(row.id);
    const site = (
      db.prepare("SELECT name FROM sites WHERE id=?").get(row.site_id) as {
        name: string;
      }
    ).name;
    res.type("html").send(
      printEducation(
        {
          id: row.id,
          site,
          details: JSON.parse(row.body),
          participants: participants(row.id),
          version: row.version,
          catalogSource: educationCatalogSource(
            db,
            row.id,
            JSON.parse(row.body),
          ),
        },
        snap,
      ),
    );
  });
}
