import { registerTbmRiskReferenceRoutes } from "./tbm-risk-routes.js";
import { tbmRiskReference, storeTbmRiskReference, currentTbmRiskSource, finalizeTbmRiskReference } from "./tbm-risk-reference.js";
import type { Express } from "express";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  tbmInput,
  tbmFinalDetails,
  tbmVersion,
  tbmFinalize,
  participantAdd,
  participantRecord,
  tbmRevision,
  type TbmInput,
} from "./tbm-validation.js";
import { printTbm } from "./tbm-print.js";
export type TbmRow = {
  id: string;
  site_id: string;
  body: string;
  status: "draft" | "finalized";
  version: number;
  parent_id: string | null;
  revision_reason: string;
  author_id: string;
  created_at: string;
  updated_at: string;
};
export type TbmParticipant = {
  worker_id: string;
  name: string;
  affiliation: string;
  kind: "worker" | "visitor";
  state: "pending" | "present" | "absent";
  recorded_by: string | null;
  recorded_at: string | null;
};
export type TbmSnapshot = {
  type: "TBM";
  id: string;
  site: { id: string; name: string };
  version: number;
  parentId: string | null;
  revisionReason: string;
  details: TbmInput;
  participants: TbmParticipant[];
  source: "staff-recorded";
  finalizedBy: { id: string; name: string };
  finalizedAt: string;
} & ({ schemaVersion: 1 } | { schemaVersion: 2; riskReference: ReturnType<typeof finalizeTbmRiskReference> });
export function registerTbmRoutes(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/tbm";
  function get(site: string, id: string) {
    const row = db
      .prepare("SELECT * FROM tbm_sessions WHERE site_id=? AND id=?")
      .get(site, id) as TbmRow | undefined;
    if (!row) throw new HttpError(404, "TBM 기록을 찾을 수 없습니다.");
    return row;
  }
  function participants(id: string) {
    return db
      .prepare(
        "SELECT worker_id,name,affiliation,kind,state,recorded_by,recorded_at FROM tbm_participants WHERE session_id=? ORDER BY worker_id",
      )
      .all(id) as TbmParticipant[];
  }
  function snapshot(id: string) {
    const row = db
      .prepare("SELECT body,hash FROM tbm_snapshots WHERE session_id=?")
      .get(id) as { body: string; hash: string } | undefined;
    return row
      ? { body: JSON.parse(row.body) as TbmSnapshot, hash: row.hash }
      : null;
  }
  function full(row: TbmRow) {
    const snap = snapshot(row.id);
    const ref = row.status === "finalized"
      ? (snap?.body.schemaVersion === 2 ? snap.body.riskReference?.reference ?? null : null)
      : tbmRiskReference(db,row.id);
    const state = ref ? currentTbmRiskSource(db,row.site_id,ref) : null;
    return {
      riskReference: ref,
      riskSourceState: state ? { sourceHasSuccessor: state.sourceHasSuccessor, sourceStatus: state.sourceStatus } : null,
      ...row,
      body: JSON.parse(row.body) as TbmInput,
      participants: participants(row.id),
      snapshot: snap,
      successorId:
        (
          db
            .prepare("SELECT id FROM tbm_sessions WHERE parent_id=?")
            .get(row.id) as { id: string } | undefined
        )?.id || null,
    };
  }
  registerTbmRiskReferenceRoutes(app,db,{access,mutate},(site,id)=>full(get(site,id)));
  function draft(site: string, id: string, version: number) {
    const row = get(site, id);
    if (row.status !== "draft")
      throw new HttpError(
        409,
        "관리자가 확정한 기록은 수정할 수 없습니다. 정정 초안을 만드세요.",
      );
    if (row.version !== version)
      throw new HttpError(
        409,
        "다른 요청으로 TBM 기록이 바뀌었습니다. 입력을 보관한 뒤 최신본을 다시 열어 주세요.",
      );
    return row;
  }
  function bump(site: string, id: string, version: number) {
    const changed = db
      .prepare(
        "UPDATE tbm_sessions SET version=version+1,updated_at=? WHERE id=? AND site_id=? AND version=? AND status='draft'",
      )
      .run(new Date().toISOString(), id, site, version);
    if (!changed.changes)
      throw new HttpError(
        409,
        "TBM 버전 충돌입니다. 최신본을 다시 열어 주세요.",
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
        "SELECT * FROM tbm_sessions WHERE site_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
      )
      .all(String(req.params.siteId), offset) as TbmRow[];
    res.json({
      items: rows.slice(0, 50).map((r) => ({ ...r, body: JSON.parse(r.body) })),
      hasMore: rows.length > 50,
    });
  });
  app.post(base, (req, res) => {
    access(req, true);
    const input = tbmInput.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `site:${site}:tbm:create`,
      input,
      () => {
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO tbm_sessions(id,site_id,body,status,revision_reason,author_id,created_at,updated_at) VALUES(?,?,?,'draft','',?,?,?)",
        ).run(id, site, JSON.stringify(input), req.session.userId!, now, now);
        audit(db, req.session.userId!, site, "tbm.created", id);
        return full(get(site, id));
      },
      () => {
        access(req, true);
      },
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(full(get(String(req.params.siteId), String(req.params.id))));
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true);
    const { version, ...input } = tbmInput
        .extend({ version: tbmVersion.shape.version })
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:tbm:${id}:edit`,
      { version, ...input },
      () => {
        draft(site, id, version);
        bump(site, id, version);
        db.prepare("UPDATE tbm_sessions SET body=? WHERE id=?").run(
          JSON.stringify(input),
          id,
        );
        audit(db, req.session.userId!, site, "tbm.updated", id);
        return full(get(site, id));
      },
      () => {
        access(req, true);
      },
    );
  });
  app.post(base + "/:id/participants", (req, res) => {
    access(req, true);
    const input = participantAdd.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:tbm:${id}:participant:add`,
      input,
      () => {
        draft(site, id, input.version);
        const w = activeWorker(site, input.workerId);
        if (participants(id).length >= 200)
          throw new HttpError(400, "TBM 참가 대상은 200명까지입니다.");
        if (
          db
            .prepare(
              "SELECT worker_id FROM tbm_participants WHERE session_id=? AND worker_id=?",
            )
            .get(id, w.id)
        )
          throw new HttpError(409, "이미 추가한 대상입니다.");
        bump(site, id, input.version);
        db.prepare(
          "INSERT INTO tbm_participants VALUES(?,?,?,?,?,'pending',NULL,NULL)",
        ).run(id, w.id, w.name, w.affiliation, w.kind);
        audit(db, req.session.userId!, site, "tbm.participant.added", id);
        return full(get(site, id));
      },
      () => {
        access(req, true);
      },
    );
  });
  app.put(base + "/:id/participants/:workerId", (req, res) => {
    access(req, true);
    const input = participantRecord.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id),
      workerId = String(req.params.workerId);
    mutate(
      req,
      res,
      `site:${site}:tbm:${id}:participant:${workerId}:record`,
      input,
      () => {
        draft(site, id, input.version);
        if (
          !db
            .prepare(
              "SELECT worker_id FROM tbm_participants WHERE session_id=? AND worker_id=?",
            )
            .get(id, workerId)
        )
          throw new HttpError(404, "TBM 참가 대상이 아닙니다.");
        if (input.state === "present") activeWorker(site, workerId);
        bump(site, id, input.version);
        db.prepare(
          "UPDATE tbm_participants SET state=?,recorded_by=?,recorded_at=? WHERE session_id=? AND worker_id=?",
        ).run(
          input.state,
          input.state === "pending" ? null : req.session.userId!,
          input.state === "pending" ? null : new Date().toISOString(),
          id,
          workerId,
        );
        audit(db, req.session.userId!, site, "tbm.participant.recorded", id);
        return full(get(site, id));
      },
      () => {
        access(req, true);
      },
    );
  });
  app.delete(base + "/:id/participants/:workerId", (req, res) => {
    access(req, true);
    const input = tbmVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id),
      workerId = String(req.params.workerId);
    mutate(
      req,
      res,
      `site:${site}:tbm:${id}:participant:${workerId}:remove`,
      input,
      () => {
        draft(site, id, input.version);
        if (
          !db
            .prepare(
              "SELECT worker_id FROM tbm_participants WHERE session_id=? AND worker_id=?",
            )
            .get(id, workerId)
        )
          throw new HttpError(404, "TBM 참가 대상이 아닙니다.");
        bump(site, id, input.version);
        db.prepare(
          "DELETE FROM tbm_participants WHERE session_id=? AND worker_id=?",
        ).run(id, workerId);
        audit(db, req.session.userId!, site, "tbm.participant.removed", id);
        return full(get(site, id));
      },
      () => {
        access(req, true);
      },
    );
  });
  app.post(base + "/:id/finalize", (req, res) => {
    access(req, true, true);
    const input = tbmFinalize.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:tbm:${id}:finalize`,
      input,
      () => {
        const row = draft(site, id, input.version),
          details = tbmFinalDetails.parse(JSON.parse(row.body)),
          people = participants(id);
        if (
          !people.some((p) => p.state === "present") ||
          people.some((p) => p.state === "pending")
        )
          throw new HttpError(
            409,
            "잠정 기록 정책: 참여 1명 이상이며 미확인 대상이 없어야 관리자가 기록을 확정할 수 있습니다.",
          );
        const siteRow = db
          .prepare("SELECT name FROM sites WHERE id=?")
          .get(site) as { name: string };
        const actor = db
          .prepare("SELECT name FROM users WHERE id=?")
          .get(req.session.userId!) as { name: string };
        const now = new Date().toISOString();
        const snap: TbmSnapshot = {
          schemaVersion: 2,
          riskReference: finalizeTbmRiskReference(db,site,tbmRiskReference(db,id),input.acknowledgeHistoricalSource === true,{id:req.session.userId!,name:actor.name},now),
          type: "TBM",
          id,
          site: { id: site, name: siteRow.name },
          version: row.version + 1,
          parentId: row.parent_id,
          revisionReason: row.revision_reason,
          details,
          participants: people,
          source: "staff-recorded",
          finalizedBy: { id: req.session.userId!, name: actor.name },
          finalizedAt: now,
        };
        const serialized = JSON.stringify(snap),
          hash = createHash("sha256").update(serialized).digest("hex");
        bump(site, id, input.version);
        db.prepare(
          "UPDATE tbm_sessions SET status='finalized',updated_at=? WHERE id=?",
        ).run(now, id);
        db.prepare("INSERT INTO tbm_snapshots VALUES(?,?,?,?,?)").run(
          id,
          serialized,
          hash,
          req.session.userId!,
          now,
        );
        audit(db, req.session.userId!, site, "tbm.finalized", id);
        return full(get(site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/revise", (req, res) => {
    access(req, true, true);
    const input = tbmRevision.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:tbm:${id}:revise`,
      input,
      () => {
        const old = get(site, id);
        if (old.status !== "finalized" || old.version !== input.version)
          throw new HttpError(
            409,
            "최신 확정본에서만 정정 초안을 만들 수 있습니다.",
          );
        if (db.prepare("SELECT id FROM tbm_sessions WHERE parent_id=?").get(id))
          throw new HttpError(
            409,
            "이미 연결된 정정본이 있습니다. 해당 기록을 여세요.",
          );
        const snap = snapshot(id);
        if (!snap) throw new Error("Missing TBM snapshot");
        const next = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO tbm_sessions(id,site_id,body,status,parent_id,revision_reason,author_id,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?,?)",
        ).run(
          next,
          site,
          JSON.stringify(snap.body.details),
          id,
          input.reason,
          req.session.userId!,
          now,
          now,
        );
        storeTbmRiskReference(db,next,snap.body.schemaVersion === 2 ? snap.body.riskReference?.reference ?? null : null);
        for (const p of snap.body.participants)
          db.prepare(
            "INSERT INTO tbm_participants VALUES(?,?,?,?,?,'pending',NULL,NULL)",
          ).run(next, p.worker_id, p.name, p.affiliation, p.kind);
        audit(db, req.session.userId!, site, "tbm.revision.created", next);
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
      printTbm(
        {
          id: row.id,
          site,
          details: JSON.parse(row.body),
          participants: participants(row.id),
          version: row.version,
          riskReference: tbmRiskReference(db,row.id),
        },
        snap,
      ),
    );
  });
}
